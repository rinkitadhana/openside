/**
 * Finalization worker (in-process).
 *
 * When a recording session has stopped and every participant recording has
 * finished uploading, we stitch each recording's chunks into a single master
 * file and register a downloadable FinalOutput.
 *
 * HOW THE STITCH WORKS:
 * MediaRecorder timeslices are byte-fragments of ONE continuous WebM stream, so
 * concatenating the chunk bytes in sequence order reconstructs the original
 * file. We then run a fast `ffmpeg -c copy` remux to write a proper seekable
 * header/duration (no re-encode). MP4/MP3/WAV are derived on demand at download
 * time, not here, to keep finalization cheap.
 *
 * This runs inside the Express process via child_process. It's structured so it
 * can later move to a dedicated queue/worker without touching callers.
 */

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../db/index.ts";
import { ffmpegPath } from "../lib/ffmpeg-path.ts";
import { enqueueFinalize, isQueueConfigured } from "../lib/queue.ts";
import {
	type AllowedFps,
	DEFAULT_FPS,
	clampFps,
} from "../lib/recording-constants.ts";
import {
	describeSegmentGaps,
	findSegmentGaps,
	waitForLateSegments,
} from "../lib/segment-gaps.ts";
import { escapeFilterPath, watermarkFontPath } from "../lib/watermark-font.ts";
import { sessionNeedsWatermark } from "./entitlements-service.ts";
import {
	deleteObjects,
	getObjectBuffer,
	putFileObject,
} from "./storage-service.ts";

// Local guard against the same session being finalized twice concurrently
// WITHIN one process. The authoritative, cross-replica dedup is the BullMQ jobId
// (see enqueueFinalize); this just protects the in-process fallback path.
const inFlight = new Set<string>();

// Minimum join delay before we bother generating an aligned ("with space")
// variant. Below this, the gap is just recorder-startup/measurement noise - not
// a real late join - so padding it would only burn a full re-encode for a sliver
// of black nobody needs. Genuine latecomers are seconds late, well above this.
const ALIGNED_MIN_OFFSET_MS = 500;

/**
 * Kick off finalization the right way. Callers should use this instead of
 * calling finalizeSession directly.
 *
 * Fallback policy: run finalization in-process ONLY when no queue is configured
 * (local dev / not-yet-migrated deploy). When a queue IS configured but the
 * enqueue fails (Redis outage), we deliberately do NOT run ffmpeg in-process -
 * doing so would dump heavy encode load onto every API replica at once, exactly
 * what the queue exists to prevent. The session is left for finalization
 * recovery to retry later.
 */
export async function triggerFinalize(
	recordingSessionId: string,
): Promise<void> {
	if (!isQueueConfigured()) {
		void finalizeSession(recordingSessionId);
		return;
	}
	try {
		await enqueueFinalize(recordingSessionId);
	} catch (error) {
		console.error(
			"[Finalize] enqueue failed (queue configured); leaving for recovery:",
			error,
		);
	}
}

type TrackKind = "combined" | "audio" | `screen-${string}`;

function recordingTrackKind(rec: {
	id: string;
	hasVideo: boolean;
	hasAudio: boolean;
	isScreenShare: boolean;
}): TrackKind {
	// A screen share lives under the SAME participant/session prefix as that
	// participant's camera master, so it must not reuse the "combined" kind - its
	// master/aligned/thumb keys would overwrite the camera's (and each other's when
	// there are multiple shares). Scope every screen share by its recording id.
	if (rec.isScreenShare) return `screen-${rec.id}`;
	return rec.hasVideo ? "combined" : "audio";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Video masters are now CFR-normalized H.264/MP4 (see finalizeRecording); only
// audio-only masters stay WebM. The extension is passed in so keys, content
// types, and mimeType stay in lockstep with what was actually written.
function masterExt(hasVideo: boolean): "mp4" | "webm" {
	return hasVideo ? "mp4" : "webm";
}

function masterContentType(ext: "mp4" | "webm"): string {
	return ext === "mp4" ? "video/mp4" : "video/webm";
}

function masterKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
	kind: TrackKind,
	ext: "mp4" | "webm",
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/${kind}/master.${ext}`;
}

function alignedKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
	kind: TrackKind,
	ext: "mp4" | "webm",
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/${kind}/aligned.${ext}`;
}

function thumbnailKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
	kind: TrackKind,
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/${kind}/thumb.jpg`;
}

/**
 * Object key for a participant's lossless WAV master (built from their raw-PCM
 * mic track). One per participant per session, under its own "audio-wav" prefix
 * so it never collides with or overwrites the WebM video master.
 */
function audioWavKey(
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
): string {
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/audio-wav/master.wav`;
}

/**
 * Extract a sharp poster JPEG from a completed video master and upload it to
 * R2. It stays compact enough for cards, while preserving enough detail for
 * larger project previews. Uses ffmpeg's `thumbnail` filter to pick a
 * representative frame (it skips near-uniform frames, so camera warm-up / black
 * frames at the very start are avoided). Best-effort: a failure here never fails
 * the recording - the master is already safe.
 */
async function generateThumbnail(
	masterPath: string,
	spaceId: string,
	recordingSessionId: string,
	participantId: string,
	kind: TrackKind,
	tmpDir: string,
): Promise<string | null> {
	const thumbPath = path.join(tmpDir, `${participantId}-${kind}-thumb.jpg`);
	try {
		await runFfmpeg([
			"-y",
			"-i",
			masterPath,
			// Analyse a batch of early frames and keep the most representative one.
			"-vf",
			"thumbnail=n=100,scale=640:-2",
			"-frames:v",
			"1",
			// 2 (best) – 31 (worst). Keep the final poster crisp for the project UI.
			"-q:v",
			"4",
			thumbPath,
		]);
	} catch (error) {
		console.error("[Finalize] thumbnail extract failed:", error);
		return null;
	}

	const key = thumbnailKey(spaceId, recordingSessionId, participantId, kind);
	try {
		await putFileObject(key, thumbPath, "image/jpeg");
	} catch (error) {
		console.error("[Finalize] thumbnail upload failed:", error);
		return null;
	}
	return key;
}

/**
 * Extract a poster from the FIRST uploaded chunk while the recording is still in
 * progress, so a thumbnail is ready within seconds of pressing record - long
 * before finalization. The first chunk carries the WebM header, so it's a
 * self-contained decodable file (later chunks are headerless fragments and
 * can't be decoded alone). Writes to the same key finalization would use, so the
 * finalizer reuses it instead of re-extracting. Best-effort and fire-and-forget.
 */
export async function generateEarlyThumbnailFromChunk(params: {
	chunkKey: string;
	spaceId: string;
	recordingSessionId: string;
	participantId: string;
	recordingId: string;
}): Promise<void> {
	let tmp: string | null = null;
	try {
		tmp = await mkdtemp(path.join(tmpdir(), "openside-early-thumb-"));
		const chunkPath = path.join(tmp, "chunk0.webm");
		await writeFile(chunkPath, await getObjectBuffer(params.chunkKey));

		const thumbPath = path.join(tmp, "thumb.jpg");
		await runFfmpeg([
			"-y",
			"-i",
			chunkPath,
			// Pick a representative frame from the chunk (skips near-uniform
			// warm-up/black frames). This temporary poster is replaced by the
			// higher-quality final thumbnail once the master is complete.
			"-vf",
			"thumbnail=n=60,scale=640:-2",
			"-frames:v",
			"1",
			"-q:v",
			"5",
			thumbPath,
		]);

		// Camera track master kind is always "combined".
		const key = thumbnailKey(
			params.spaceId,
			params.recordingSessionId,
			params.participantId,
			"combined",
		);
		await putFileObject(key, thumbPath, "image/jpeg");
		await prisma.participantRecording
			.update({
				where: { id: params.recordingId },
				data: { thumbnailKey: key },
			})
			.catch(() => undefined);
	} catch (error) {
		console.error(
			"[Thumbnail] early thumbnail from first chunk failed:",
			error,
		);
	} finally {
		if (tmp)
			await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	}
}

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
		});
	});
}

async function readyOutputCount(recordingSessionId: string): Promise<number> {
	return prisma.finalOutput.count({
		where: { recordingSessionId, status: "READY", masterKey: { not: null } },
	});
}

/**
 * Trigger finalization IF the session has stopped and at least one track has
 * finished uploading. Tracks finalize independently - we no longer wait for
 * every participant. Safe to call repeatedly (on every track completion).
 */
export async function maybeFinalizeSession(
	recordingSessionId: string,
): Promise<void> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: recordingSessionId },
		select: {
			id: true,
			status: true,
			participantRecordings: { select: { status: true, isComplete: true } },
		},
	});

	if (!session) return;

	// Recordings only reach UPLOADED after the host stops, so only act once the
	// session is stopped / already finalizing.
	if (!["STOPPED", "PROCESSING", "FAILED", "READY"].includes(session.status)) {
		return;
	}

	const recordings = session.participantRecordings;
	if (recordings.length === 0) return;

	// Per-track finalization: as soon as ANY track is fully uploaded we finalize
	// it - we no longer wait for every participant. A track abandoned by a
	// refresh/crash therefore can't hold up everyone else's output. Each later
	// completion re-triggers to pick up the next ready track.
	const hasFinalizable = recordings.some((rec) => rec.status === "UPLOADED");

	// Edge case: a still-STOPPED session where nothing is left to encode and no
	// upload is pending (e.g. every track failed with zero segments) still needs
	// one run to settle its final status to FAILED.
	const needsSettle =
		session.status === "STOPPED" && recordings.every((rec) => rec.isComplete);

	if (!hasFinalizable && !needsSettle) return;

	// Hand off to the worker fleet (or in-process fallback). Callers (HTTP
	// handlers) never block on encoding.
	await triggerFinalize(recordingSessionId);
}

/** Stitch + register masters for every recording in a session. */
export async function finalizeSession(
	recordingSessionId: string,
): Promise<void> {
	if (inFlight.has(recordingSessionId)) return;
	inFlight.add(recordingSessionId);

	let tmp: string | null = null;

	try {
		const session = await prisma.recordingSession.findUnique({
			where: { id: recordingSessionId },
			select: { status: true, spaceId: true, targetFps: true },
		});

		if (!session) return;
		if (!["STOPPED", "PROCESSING", "FAILED", "READY"].includes(session.status))
			return;
		// Finalization/merge is space-only for now; screen recordings aren't merged.
		if (!session.spaceId) return;
		const spaceId = session.spaceId;

		// Watermark is an owner entitlement (DEMO plan), resolved server-side once
		// per session and burned into every master below.
		const watermark = await sessionNeedsWatermark({ spaceId, userId: null });
		// Only flip to PROCESSING on the very first run (session still STOPPED).
		// Re-runs for late-completing tracks must not downgrade an already-READY
		// session back to PROCESSING and flicker the UI.
		const isFirstRun = session.status === "STOPPED";

		tmp = await mkdtemp(path.join(tmpdir(), "openside-finalize-"));

		let processedAny = false;

		// Drain every fully-uploaded track, one at a time, INCLUDING any that
		// finish uploading while we're still working - so no track waits on
		// another. Each track is claimed atomically (UPLOADED -> PROCESSING) so
		// two concurrent workers never encode the same one twice.
		while (true) {
			const claimable = await prisma.participantRecording.findFirst({
				where: {
					recordingSessionId,
					status: "UPLOADED",
					participantId: { not: null },
				},
				include: { segments: { orderBy: { sequenceNumber: "asc" } } },
			});
			if (!claimable || !claimable.participantId) break;

			const claim = await prisma.participantRecording.updateMany({
				where: { id: claimable.id, status: "UPLOADED" },
				data: { status: "PROCESSING" },
			});
			if (claim.count !== 1) continue; // another worker grabbed it first

			if (!processedAny) {
				processedAny = true;
				if (isFirstRun) {
					await prisma.recordingSession
						.update({
							where: { id: recordingSessionId },
							data: { status: "PROCESSING" },
						})
						.catch(() => undefined);
					// A space stays LIVE while its meeting is open. Recording-session
					// status owns processing state so the host can start another run.
				}
			}

			const participantId = claimable.participantId;

			// The parallel raw-PCM mic track (container "pcm") is wrapped into a
			// lossless WAV and back-linked to the participant's video output - a
			// wholly separate path from the WebM master. It never produces its own
			// FinalOutput, and it handles its own errors internally (so a PCM
			// failure never creates a phantom failed audio output).
			if (claimable.container === "pcm") {
				await finalizePcmRecording({
					rec: { ...claimable, participantId },
					spaceId,
					recordingSessionId,
					tmpDir: tmp,
				});
				continue;
			}

			try {
				await finalizeRecording({
					rec: { ...claimable, participantId },
					spaceId,
					recordingSessionId,
					tmpDir: tmp,
					watermark,
					targetFps: clampFps(session.targetFps),
				});
			} catch (error) {
				const message = errorMessage(error);
				console.error(`[Finalize] recording ${claimable.id} failed:`, error);
				await prisma.participantRecording
					.update({
						where: { id: claimable.id },
						data: { status: "FAILED", processingError: message.slice(0, 2000) },
					})
					.catch(() => undefined);
				await upsertFailedParticipantOutput({
					recordingSessionId,
					spaceId,
					rec: { ...claimable, participantId },
					errorMessage: message,
				}).catch(() => undefined);
			}
		}

		// Settle the session status from where its tracks actually landed.
		const [readyOutputs, recordings] = await Promise.all([
			readyOutputCount(recordingSessionId),
			prisma.participantRecording.findMany({
				where: { recordingSessionId },
				select: { status: true, isComplete: true },
			}),
		]);

		// Anything still uploading, queued, or mid-encode means more tracks are
		// coming - don't call the session finished yet.
		const stillPending = recordings.some(
			(rec) =>
				!rec.isComplete ||
				rec.status === "UPLOADED" ||
				rec.status === "PROCESSING",
		);

		if (readyOutputs > 0) {
			// At least one downloadable track exists → the session is usable now.
			// Late tracks (a straggler upload) get added incrementally by re-runs.
			await prisma.recordingSession
				.update({
					where: { id: recordingSessionId },
					data: { status: "READY" },
				})
				.catch(() => undefined);
			console.log(`[Finalize] Session ${recordingSessionId} ready.`);
			return;
		}

		if (!stillPending && recordings.length > 0) {
			// Everything terminal and nothing succeeded → the session failed.
			await prisma.recordingSession
				.update({
					where: { id: recordingSessionId },
					data: { status: "FAILED" },
				})
				.catch(() => undefined);
			await prisma.space
				.update({
					where: { id: spaceId },
					data: { recordingStatus: "STOPPED" },
				})
				.catch(() => undefined);
			console.error(
				`[Finalize] Session ${recordingSessionId} failed: no recordings finalized.`,
			);
			return;
		}

		// Nothing ready yet but tracks are still uploading - leave PROCESSING; a
		// later completion will re-trigger and pick them up.
		console.log(
			`[Finalize] Session ${recordingSessionId} waiting on pending uploads.`,
		);
	} catch (error) {
		const message = errorMessage(error);
		console.error(`[Finalize] Session ${recordingSessionId} failed:`, error);
		await prisma.recordingSession
			.update({ where: { id: recordingSessionId }, data: { status: "FAILED" } })
			.catch(() => undefined);
		await prisma.participantRecording
			.updateMany({
				where: { recordingSessionId, status: "PROCESSING" },
				data: { status: "FAILED", processingError: message.slice(0, 2000) },
			})
			.catch(() => undefined);
	} finally {
		inFlight.delete(recordingSessionId);
		if (tmp) {
			await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

interface FinalizeRecordingArgs {
	rec: {
		id: string;
		participantId: string;
		hasVideo: boolean;
		hasAudio: boolean;
		isScreenShare: boolean;
		width: number | null;
		height: number | null;
		fps: number | null;
		bitrate: number | null;
		sampleRate: number | null;
		channels: number | null;
		startOffsetMs: number | null;
		expectedSegments: number | null;
		// True only when every expected chunk uploaded contiguously - i.e. no late
		// straggler can still arrive to rebuild a fuller master. Gates chunk cleanup.
		isComplete: boolean;
		// Set if an early poster was already extracted from the first chunk; reused
		// here so we don't re-extract at finalize time.
		thumbnailKey: string | null;
		segments: {
			sequenceNumber: number;
			assetKey: string;
			durationMs: number;
		}[];
	};
	spaceId: string;
	recordingSessionId: string;
	tmpDir: string;
	/** Burn the DEMO watermark into the master (owner entitlement, not client). */
	watermark: boolean;
	/** Constant frame rate to normalize every video master to (session-level). */
	targetFps: AllowedFps;
}

interface FinalizedRecording {
	id: string;
	participantId: string;
	hasVideo: boolean;
	hasAudio: boolean;
	isScreenShare: boolean;
	width: number | null;
	height: number | null;
	fps: number | null;
	bitrate: number | null;
	sampleRate: number | null;
	channels: number | null;
	startOffsetMs: number | null;
	masterPath: string;
	durationMs: number;
	fileSize: bigint;
}

async function upsertFailedParticipantOutput(args: {
	recordingSessionId: string;
	spaceId: string;
	rec: FinalizeRecordingArgs["rec"];
	errorMessage: string;
}): Promise<void> {
	const { recordingSessionId, spaceId, rec } = args;
	const outputData = {
		recordingSessionId,
		spaceId,
		type: "PER_PARTICIPANT" as const,
		mode: rec.hasVideo ? ("MIXED" as const) : ("AUDIO_ONLY" as const),
		targetParticipantId: rec.participantId,
		sourceRecordingId: rec.id,
		width: rec.width,
		height: rec.height,
		fps: rec.fps,
		bitrate: rec.bitrate,
		sampleRate: rec.sampleRate,
		channels: rec.channels,
		hasVideo: rec.hasVideo,
		hasAudio: rec.hasAudio,
		masterKey: null,
		mimeType: "video/webm",
		durationMs: null,
		fileSize: null,
		status: "FAILED" as const,
		variant: "RAW" as const,
		errorMessage: args.errorMessage.slice(0, 2000),
	};

	const existingOutput = await prisma.finalOutput.findFirst({
		where: { sourceRecordingId: rec.id, variant: "RAW" },
		select: { id: true },
	});

	if (existingOutput) {
		await prisma.finalOutput.update({
			where: { id: existingOutput.id },
			data: outputData,
		});
	} else {
		await prisma.finalOutput.create({ data: outputData });
	}
}

/**
 * Bottom-right "openside.pro" badge burned into DEMO masters only. Fixed
 * fontsize is fine - DEMO capture is capped at 1080p by entitlements. We point
 * drawtext at a bundled font so it renders on the deploy image (which has no
 * system fonts); if the font can't be located we fall back to a fontconfig
 * lookup (works in dev), and if drawtext fails entirely the encode degrades to
 * an un-watermarked master rather than losing the recording.
 */
const WATERMARK_FONT_ARG = watermarkFontPath
	? `fontfile=${escapeFilterPath(watermarkFontPath)}:`
	: "";
// Large, bold, outlined + boxed so it's prominent and not trivially cropped out.
const WATERMARK_FILTER = `drawtext=${WATERMARK_FONT_ARG}text='openside.pro':x=w-tw-28:y=h-th-24:fontsize=44:fontcolor=white:borderw=2:bordercolor=black@0.6:box=1:boxcolor=black@0.45:boxborderw=16`;

async function finalizeRecording({
	rec,
	spaceId,
	recordingSessionId,
	tmpDir,
	watermark,
	targetFps,
}: FinalizeRecordingArgs): Promise<FinalizedRecording | null> {
	if (rec.segments.length === 0) {
		// The client can mark a recording "complete" with 0 segments if its very
		// last chunk (often its only chunk, for a take under 5s) was still being
		// persisted when it checked whether its upload queue had drained. Give
		// that straggler a few seconds to actually land before condemning the
		// track - re-checking straight from the DB rather than trusting the
		// (possibly stale) `rec.segments` this finalize pass was claimed with.
		const lateSegments = await waitForLateSegments(rec.id, () =>
			prisma.recordingSegment.findMany({
				where: { participantRecordingId: rec.id },
				select: { sequenceNumber: true, assetKey: true, durationMs: true },
				orderBy: { sequenceNumber: "asc" },
			}),
		);
		if (lateSegments.length > 0) {
			rec = { ...rec, segments: lateSegments };
		} else {
			const message = "No segments uploaded";
			await prisma.participantRecording.update({
				where: { id: rec.id },
				data: { status: "FAILED", processingError: message },
			});
			await upsertFailedParticipantOutput({
				recordingSessionId,
				spaceId,
				rec,
				errorMessage: message,
			});
			return null;
		}
	}

	await prisma.participantRecording.update({
		where: { id: rec.id },
		data: { status: "PROCESSING", processingError: null },
	});

	const kind = recordingTrackKind(rec);
	const rawPath = path.join(tmpDir, `${rec.id}-raw.webm`);

	// 1. Byte-concat chunks in order → reconstructs the original WebM stream.
	// Append each downloaded chunk straight to disk so we never hold a whole
	// (potentially multi-GB) recording in memory at once.
	const ordered = [...rec.segments].sort(
		(a, b) => a.sequenceNumber - b.sequenceNumber,
	);
	// Salvage rather than fail: concat whatever arrived, in order. A missing chunk
	// no longer loses the whole track - worst case a brief glitch at the seam.
	const gaps = findSegmentGaps(ordered, rec.expectedSegments);
	const gapNote = describeSegmentGaps(gaps);
	if (gapNote) {
		console.warn(
			`[Finalize] ${rec.id}: ${gapNote} - salvaging available footage`,
		);
	}
	await writeFile(rawPath, Buffer.alloc(0));
	for (const seg of ordered) {
		const buf = await getObjectBuffer(seg.assetKey);
		await appendFile(rawPath, buf);
	}

	// 2. Normalize to a CONSTANT frame rate. The raw WebM is VFR (MediaRecorder
	// timeslices), which drifts lip-sync and misaligns participants against each
	// other. Re-encode video masters to CFR H.264/MP4 locked to the session's
	// targetFps (`-r <fps> -fps_mode cfr`); this replaces the old `-c copy`
	// passthrough and is the core fix. DEMO masters burn the watermark into the
	// SAME pass. Audio-only masters have no video to normalize, so they keep the
	// cheap WebM remux. `outExt` tracks what was actually written so the key,
	// content-type, and mimeType stay in lockstep.
	const cfrArgs = ["-r", String(targetFps), "-fps_mode", "cfr"];
	let outExt: "mp4" | "webm" = masterExt(rec.hasVideo);
	let outPath = path.join(tmpDir, `${rec.id}-master.${outExt}`);
	let masterPath = outPath;
	let encoded = false;

	if (rec.hasVideo) {
		try {
			await runFfmpeg([
				"-y",
				"-fflags",
				"+genpts",
				"-i",
				rawPath,
				...(watermark ? ["-vf", WATERMARK_FILTER] : []),
				...cfrArgs,
				"-c:v",
				"libx264",
				"-preset",
				// DEMO watermark re-encodes keep their light settings; the plain CFR
				// master favors quality (crf 16) since it's the deliverable.
				"medium",
				"-crf",
				watermark ? "20" : "16",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				"-c:a",
				"copy",
				outPath,
			]);
			encoded = true;
		} catch (error) {
			// Re-encode failed (drawtext missing in a stripped build, odd container,
			// etc.) - never lose the recording. Fall through to a plain WebM remux.
			console.error(
				`[Finalize] CFR re-encode failed for ${rec.id}, falling back to WebM remux:`,
				error,
			);
		}
	}

	if (!encoded) {
		// Audio-only, or the video re-encode failed: remux (no re-encode) to WebM.
		outExt = "webm";
		outPath = path.join(tmpDir, `${rec.id}-master.webm`);
		masterPath = outPath;
		try {
			await runFfmpeg([
				"-y",
				"-fflags",
				"+genpts",
				"-i",
				rawPath,
				"-c",
				"copy",
				outPath,
			]);
		} catch (error) {
			// Remux failed (rare container edge case) - fall back to the raw concat,
			// which is still a playable WebM, just without a clean duration index.
			console.error(
				`[Finalize] remux failed for ${rec.id}, using raw concat:`,
				error,
			);
			masterPath = rawPath;
		}
	}

	// 3. Upload the master to R2 with the format we actually produced.
	const key = masterKey(
		spaceId,
		recordingSessionId,
		rec.participantId,
		kind,
		outExt,
	);
	await putFileObject(key, masterPath, masterContentType(outExt));
	const masterMime = masterContentType(outExt);

	const fileStat = await stat(masterPath);
	const durationMs = ordered.reduce(
		(sum, seg) => sum + (seg.durationMs || 0),
		0,
	);

	// 3b. Thumbnail (video tracks only). Always replace any early poster with a
	// high-quality image from the completed master. If extraction fails, retain
	// the early thumbnail so cards still have an image to show.
	const generatedThumbKey = rec.hasVideo
		? await generateThumbnail(
				masterPath,
				spaceId,
				recordingSessionId,
				rec.participantId,
				kind,
				tmpDir,
			)
		: null;
	const thumbKey = generatedThumbKey ?? rec.thumbnailKey ?? null;

	// 4. Mark the recording ready + create a downloadable FinalOutput. If we
	// salvaged over gaps, keep it READY but record the note so it's diagnosable.
	await prisma.participantRecording.update({
		where: { id: rec.id },
		data: {
			status: "READY",
			mergedFileKey: key,
			thumbnailKey: thumbKey,
			fileSize: BigInt(fileStat.size),
			durationMs,
			mimeType: masterMime,
			processingError: gapNote,
		},
	});

	const outputData = {
		recordingSessionId,
		spaceId,
		type: "PER_PARTICIPANT" as const,
		mode: rec.hasVideo ? ("MIXED" as const) : ("AUDIO_ONLY" as const),
		targetParticipantId: rec.participantId,
		sourceRecordingId: rec.id,
		width: rec.width,
		height: rec.height,
		fps: rec.fps,
		bitrate: rec.bitrate,
		sampleRate: rec.sampleRate,
		channels: rec.channels,
		hasVideo: rec.hasVideo,
		hasAudio: rec.hasAudio,
		masterKey: key,
		thumbnailKey: thumbKey,
		mimeType: masterMime,
		durationMs,
		fileSize: BigInt(fileStat.size),
		status: "READY" as const,
		variant: "RAW" as const,
		errorMessage: null,
	};

	const existingOutput = await prisma.finalOutput.findFirst({
		where: { sourceRecordingId: rec.id, variant: "RAW" },
		select: { id: true },
	});

	if (existingOutput) {
		await prisma.finalOutput.update({
			where: { id: existingOutput.id },
			data: outputData,
		});
	} else {
		await prisma.finalOutput.create({ data: outputData });
	}

	// This is intentionally role-agnostic: any track that actually starts late,
	// including the host's, receives the black lead-in needed for timeline sync.
	if (
		rec.hasVideo &&
		rec.startOffsetMs &&
		rec.startOffsetMs >= ALIGNED_MIN_OFFSET_MS
	) {
		try {
			// The aligned (black lead-in) variant re-encodes anyway, so it lands on
			// the SAME CFR H.264/MP4 target as the plain master - the two must agree.
			const alignedPath = path.join(tmpDir, `${rec.id}-aligned.mp4`);
			await createAlignedVideo({
				inputPath: masterPath,
				outputPath: alignedPath,
				gapMs: rec.startOffsetMs,
				width: rec.width,
				height: rec.height,
				fps: targetFps,
				hasAudio: rec.hasAudio,
			});

			const alignedFileStat = await stat(alignedPath);
			const alignedFileKey = alignedKey(
				spaceId,
				recordingSessionId,
				rec.participantId,
				kind,
				"mp4",
			);
			await putFileObject(
				alignedFileKey,
				alignedPath,
				masterContentType("mp4"),
			);

			const alignedOutputData = {
				...outputData,
				masterKey: alignedFileKey,
				mimeType: masterContentType("mp4"),
				durationMs: durationMs + rec.startOffsetMs,
				fileSize: BigInt(alignedFileStat.size),
				variant: "ALIGNED" as const,
			};

			const existingAlignedOutput = await prisma.finalOutput.findFirst({
				where: { sourceRecordingId: rec.id, variant: "ALIGNED" },
				select: { id: true },
			});

			if (existingAlignedOutput) {
				await prisma.finalOutput.update({
					where: { id: existingAlignedOutput.id },
					data: alignedOutputData,
				});
			} else {
				await prisma.finalOutput.create({ data: alignedOutputData });
			}
		} catch (error) {
			const message = errorMessage(error).slice(0, 2000);
			console.error(`[Finalize] aligned output failed for ${rec.id}:`, error);
			const failedAlignedData = {
				...outputData,
				masterKey: null,
				durationMs: null,
				fileSize: null,
				status: "FAILED" as const,
				variant: "ALIGNED" as const,
				errorMessage: message,
			};

			const existingAlignedOutput = await prisma.finalOutput.findFirst({
				where: { sourceRecordingId: rec.id, variant: "ALIGNED" },
				select: { id: true },
			});

			if (existingAlignedOutput) {
				await prisma.finalOutput.update({
					where: { id: existingAlignedOutput.id },
					data: failedAlignedData,
				});
			} else {
				await prisma.finalOutput.create({ data: failedAlignedData });
			}
		}
	}

	// Order-independent back-link: if this participant's parallel PCM track has
	// already produced a WAV, attach it to the output(s) we just wrote. If PCM
	// hasn't finalized yet, this is a no-op and finalizePcmRecording performs the
	// link when it runs. Camera masters only - screen shares have no mic PCM.
	if (rec.hasVideo && !rec.isScreenShare) {
		await linkPcmWavToVideoOutput({
			recordingSessionId,
			spaceId,
			participantId: rec.participantId,
		}).catch((error) =>
			console.error(
				`[Finalize] PCM WAV back-link failed for ${rec.id} (video master is safe):`,
				error,
			),
		);
	}

	// The master (and any aligned variant) is safely in R2 now, so the loose
	// per-chunk segment objects have served their only purpose. Delete them to
	// reclaim storage - but ONLY when the track is fully complete, so a late
	// straggler chunk that would re-trigger a fuller re-stitch still has its
	// source. `mergedFileKey` on the recording remains the canonical master.
	if (rec.isComplete) {
		const chunkKeys = ordered.map((seg) => seg.assetKey);
		if (chunkKeys.length > 0) {
			await deleteObjects(chunkKeys).catch((error) => {
				console.error(
					`[Finalize] failed to delete chunk objects for ${rec.id} (master is safe, leaving chunks):`,
					error,
				);
			});
		}
	}

	return {
		id: rec.id,
		participantId: rec.participantId,
		hasVideo: rec.hasVideo,
		hasAudio: rec.hasAudio,
		isScreenShare: rec.isScreenShare,
		width: rec.width,
		height: rec.height,
		fps: rec.fps,
		bitrate: rec.bitrate,
		sampleRate: rec.sampleRate,
		channels: rec.channels,
		startOffsetMs: rec.startOffsetMs,
		masterPath,
		durationMs,
		fileSize: BigInt(fileStat.size),
	};
}

interface FinalizePcmArgs {
	rec: {
		id: string;
		participantId: string;
		sampleRate: number | null;
		channels: number | null;
		expectedSegments: number | null;
		isComplete: boolean;
		segments: {
			sequenceNumber: number;
			assetKey: string;
			durationMs: number;
			sampleRate: number | null;
			bitDepth: number | null;
			channelCount: number | null;
		}[];
	};
	spaceId: string;
	recordingSessionId: string;
	tmpDir: string;
}

/**
 * Canonical 44-byte PCM WAV header. Used only on the manual-header fallback path
 * (if this ffmpeg build can't mux s24le). bitsPerSample=24 is written faithfully
 * so the packed 3-bytes/sample data is interpreted correctly.
 */
function buildWavHeader(params: {
	sampleRate: number;
	channelCount: number;
	bitDepth: number;
	dataSize: number;
}): Buffer {
	const { sampleRate, channelCount, bitDepth, dataSize } = params;
	const blockAlign = channelCount * (bitDepth / 8);
	const byteRate = sampleRate * blockAlign;
	const buf = Buffer.alloc(44);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16); // PCM fmt chunk size
	buf.writeUInt16LE(1, 20); // audio format = 1 (integer PCM)
	buf.writeUInt16LE(channelCount, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(byteRate, 28);
	buf.writeUInt16LE(blockAlign, 32);
	buf.writeUInt16LE(bitDepth, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(dataSize, 40);
	return buf;
}

/**
 * Manual WAV writer: prepend a hand-built header to the raw PCM and stream the
 * body through (never loads the whole recording into memory). The fallback for
 * when ffmpeg can't handle s24le on this platform.
 */
async function writeWavWithManualHeader(
	rawPath: string,
	wavPath: string,
	fmt: { sampleRate: number; channelCount: number; bitDepth: number },
): Promise<void> {
	const dataSize = (await stat(rawPath)).size;
	const header = buildWavHeader({ ...fmt, dataSize });
	await new Promise<void>((resolve, reject) => {
		const out = createWriteStream(wavPath);
		out.on("error", reject);
		out.on("finish", resolve);
		out.write(header);
		const input = createReadStream(rawPath);
		input.on("error", reject);
		input.on("end", () => out.end());
		input.pipe(out, { end: false });
	});
}

/**
 * Attach a participant's finalized lossless WAV to their video output(s). For
 * PCM-only sessions, create an AUDIO_ONLY output whose WAV is the master; this
 * keeps both WAV and derived MP3 downloads available without any video track.
 */
async function linkPcmWavToVideoOutput(args: {
	recordingSessionId: string;
	spaceId: string;
	participantId: string;
}): Promise<void> {
	const { recordingSessionId, participantId } = args;

	const pcm = await prisma.participantRecording.findFirst({
		where: {
			recordingSessionId,
			participantId,
			container: "pcm",
			mergedFileKey: { not: null },
		},
		select: { mergedFileKey: true },
	});
	if (!pcm?.mergedFileKey) return; // PCM not finalized yet - link happens later

	const session = await prisma.recordingSession.findUnique({
		where: { id: recordingSessionId },
		select: { recordingMode: true },
	});
	if (session?.recordingMode === "AUDIO_ONLY") {
		const pcmRecording = await prisma.participantRecording.findFirst({
			where: {
				recordingSessionId,
				participantId,
				container: "pcm",
			},
			select: {
				id: true,
				sampleRate: true,
				channels: true,
				durationMs: true,
				fileSize: true,
			},
		});
		if (!pcmRecording) return;

		const outputData = {
			recordingSessionId,
			spaceId: args.spaceId,
			type: "PER_PARTICIPANT" as const,
			mode: "AUDIO_ONLY" as const,
			variant: "RAW" as const,
			targetParticipantId: participantId,
			sourceRecordingId: pcmRecording.id,
			sampleRate: pcmRecording.sampleRate,
			channels: pcmRecording.channels,
			hasVideo: false,
			hasAudio: true,
			masterKey: pcm.mergedFileKey,
			audioWavKey: pcm.mergedFileKey,
			mimeType: "audio/wav",
			durationMs: pcmRecording.durationMs,
			fileSize: pcmRecording.fileSize,
			status: "READY" as const,
			errorMessage: null,
		};
		const existing = await prisma.finalOutput.findFirst({
			where: { sourceRecordingId: pcmRecording.id, variant: "RAW" },
			select: { id: true },
		});
		if (existing) {
			await prisma.finalOutput.update({
				where: { id: existing.id },
				data: outputData,
			});
		} else {
			await prisma.finalOutput.create({ data: outputData });
		}
		return;
	}

	const videoRecordings = await prisma.participantRecording.findMany({
		where: {
			recordingSessionId,
			participantId,
			isScreenShare: false,
			hasVideo: true,
		},
		select: { id: true },
	});
	if (videoRecordings.length === 0) return; // video output not ready yet

	await prisma.finalOutput.updateMany({
		where: {
			recordingSessionId,
			sourceRecordingId: { in: videoRecordings.map((r) => r.id) },
		},
		data: { audioWavKey: pcm.mergedFileKey },
	});
}

/**
 * Wrap a participant's raw-PCM mic segments into a lossless WAV master.
 *
 * Byte-concats the headerless 24-bit-LE PCM chunks in sequence order (same
 * salvage-over-gaps approach as the video master), then muxes a real WAV with
 * `ffmpeg -f s24le -c:a copy` using the stored capture format. Falls back to a
 * hand-written 44-byte header if this ffmpeg build can't handle s24le. Produces
 * NO FinalOutput of its own - it sets an audioWavKey on the participant's video
 * output instead. Never throws: PCM is a best-effort enhancement over the WebM
 * master's lossy audio, so its failure must not fail the session.
 */
async function finalizePcmRecording({
	rec,
	spaceId,
	recordingSessionId,
	tmpDir,
}: FinalizePcmArgs): Promise<void> {
	try {
		if (rec.segments.length === 0) {
			await prisma.participantRecording.update({
				where: { id: rec.id },
				data: {
					status: "FAILED",
					processingError: "No PCM segments uploaded",
				},
			});
			return;
		}

		await prisma.participantRecording.update({
			where: { id: rec.id },
			data: { status: "PROCESSING", processingError: null },
		});

		const ordered = [...rec.segments].sort(
			(a, b) => a.sequenceNumber - b.sequenceNumber,
		);
		const gapNote = describeSegmentGaps(
			findSegmentGaps(ordered, rec.expectedSegments),
		);
		if (gapNote) {
			console.warn(
				`[Finalize] PCM ${rec.id}: ${gapNote} - salvaging available audio`,
			);
		}

		// Format comes from the captured chunks (hardware may have ignored the
		// requested 48000), falling back to the recording metadata then defaults.
		const first = ordered[0];
		const sampleRate = first?.sampleRate ?? rec.sampleRate ?? 48000;
		const channelCount = first?.channelCount ?? rec.channels ?? 1;
		const bitDepth = first?.bitDepth ?? 24;

		const rawPath = path.join(tmpDir, `${rec.id}-raw.pcm`);
		const wavPath = path.join(tmpDir, `${rec.id}-out.wav`);

		// Byte-concat chunks straight to disk - never hold the whole recording in
		// memory (a long mic track is many MB of raw PCM).
		await writeFile(rawPath, Buffer.alloc(0));
		for (const seg of ordered) {
			await appendFile(rawPath, await getObjectBuffer(seg.assetKey));
		}

		// TODO(drift, Part D): the PCM stream (ctx.currentTime clock) and the video
		// master (performance.now clock) drift apart over long recordings. Both
		// clocks' start references are persisted per recording (PCM baseline +
		// video startOffsetMs). When there's real long-recording data to tune
		// against, the final mux should apply `aresample=async=1:first_pts=0` here
		// to correct it. NOT implemented yet - left as a deliberate hook.

		// s24le = signed 24-bit LE, matching our 3-bytes/sample packing. Verify at
		// runtime and fall back to a hand-written header if the binary differs.
		let wroteWav = false;
		try {
			await runFfmpeg([
				"-y",
				"-f",
				"s24le",
				"-ar",
				String(sampleRate),
				"-ac",
				String(channelCount),
				"-i",
				rawPath,
				"-c:a",
				"copy",
				wavPath,
			]);
			wroteWav = true;
		} catch (error) {
			console.error(
				`[Finalize] PCM ${rec.id}: ffmpeg s24le mux failed, writing WAV header by hand:`,
				error,
			);
		}
		if (!wroteWav) {
			await writeWavWithManualHeader(rawPath, wavPath, {
				sampleRate,
				channelCount,
				bitDepth,
			});
		}

		const wavKey = audioWavKey(spaceId, recordingSessionId, rec.participantId);
		await putFileObject(wavKey, wavPath, "audio/wav");

		const fileStat = await stat(wavPath);
		const durationMs = ordered.reduce(
			(sum, seg) => sum + (seg.durationMs || 0),
			0,
		);

		await prisma.participantRecording.update({
			where: { id: rec.id },
			data: {
				status: "READY",
				mergedFileKey: wavKey,
				fileSize: BigInt(fileStat.size),
				durationMs,
				mimeType: "audio/wav",
				processingError: gapNote,
			},
		});

		console.log(
			`[Finalize] PCM ${rec.id}: wrote lossless WAV ${wavKey} (${sampleRate}Hz / 24-bit / ${channelCount}ch)`,
		);

		// Back-link to the participant's video output (order-independent).
		await linkPcmWavToVideoOutput({
			recordingSessionId,
			spaceId,
			participantId: rec.participantId,
		});

		// Drop the raw chunk objects once the track is fully complete (a late
		// straggler could otherwise still rebuild a fuller WAV).
		if (rec.isComplete) {
			const chunkKeys = ordered.map((seg) => seg.assetKey);
			if (chunkKeys.length > 0) {
				await deleteObjects(chunkKeys).catch((error) =>
					console.error(
						`[Finalize] failed to delete PCM chunk objects for ${rec.id} (WAV is safe):`,
						error,
					),
				);
			}
		}
	} catch (error) {
		// Best-effort: never fail the session over the lossless-audio enhancement.
		console.error(`[Finalize] PCM ${rec.id} failed:`, error);
		await prisma.participantRecording
			.update({
				where: { id: rec.id },
				data: {
					status: "FAILED",
					processingError: errorMessage(error).slice(0, 2000),
				},
			})
			.catch(() => undefined);
	}
}

async function createAlignedVideo({
	inputPath,
	outputPath,
	gapMs,
	width,
	height,
	fps,
	hasAudio,
}: {
	inputPath: string;
	outputPath: string;
	gapMs: number;
	width: number | null;
	height: number | null;
	fps: number | null;
	hasAudio: boolean;
}): Promise<void> {
	const safeWidth = width && width > 0 ? width : 1280;
	const safeHeight = height && height > 0 ? height : 720;
	// `fps` is the session's CFR target (24/30). The black lead-in is generated at
	// this rate and the real segment is resampled to it, so the concatenated
	// output is constant frame rate - matching the plain master exactly.
	const safeFps = fps && fps >= 10 ? Math.round(fps) : DEFAULT_FPS;
	const gapSeconds = Math.max(0.001, gapMs / 1000);

	// CFR H.264/MP4 output, same target as the plain master. yuv420p + faststart
	// for broad player compatibility; aac audio (opus isn't standard in MP4).
	const videoOut = [
		"-fps_mode",
		"cfr",
		"-r",
		String(safeFps),
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		"18",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
	];

	if (!hasAudio) {
		await runFfmpeg([
			"-y",
			"-f",
			"lavfi",
			"-t",
			String(gapSeconds),
			"-i",
			`color=c=black:s=${safeWidth}x${safeHeight}:r=${safeFps}`,
			"-i",
			inputPath,
			"-filter_complex",
			`[0:v]setpts=PTS-STARTPTS[v0];[1:v]scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease,pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2,fps=${safeFps},setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[v]`,
			"-map",
			"[v]",
			...videoOut,
			outputPath,
		]);
		return;
	}

	await runFfmpeg([
		"-y",
		"-f",
		"lavfi",
		"-t",
		String(gapSeconds),
		"-i",
		`color=c=black:s=${safeWidth}x${safeHeight}:r=${safeFps}`,
		"-f",
		"lavfi",
		"-t",
		String(gapSeconds),
		"-i",
		"anullsrc=channel_layout=stereo:sample_rate=48000",
		"-i",
		inputPath,
		"-filter_complex",
		`[0:v]setpts=PTS-STARTPTS[v0];[1:a]asetpts=PTS-STARTPTS[a0];[2:v]scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease,pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2,fps=${safeFps},setpts=PTS-STARTPTS[v1];[2:a]aresample=48000,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
		"-map",
		"[v]",
		"-map",
		"[a]",
		...videoOut,
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		outputPath,
	]);
}
