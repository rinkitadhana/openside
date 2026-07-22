/**
 * Screen-recorder finalization.
 *
 * When a SCREEN_RECORDER session has stopped and all of its track recordings
 * finished uploading, we stitch each track's chunks into a master file and
 * register the result keys on the session's `outputs`:
 *   - screen : the `combined` track (screen video + mic audio), if any
 *   - camera : the `camera` track (webcam video), if any
 *   - both   : screen with the camera composited as a bottom-right PiP, matching
 *              the size/shape/corner the user picked (stored in `composition`)
 *
 * Chunk stitching mirrors the Space finalizer: MediaRecorder timeslices are
 * byte-fragments of one stream, so concatenating them in order reconstructs the
 * capture. Video masters are then re-encoded to CFR H.264/MP4 - the client's
 * codec ladder is H.264-first (mp4/mkv containers), which ffmpeg's WebM muxer
 * rejects, so the old `-c copy` → .webm remux failed for most real recordings
 * and silently degraded to a non-seekable raw concat. Missing chunks are
 * salvaged (gap logged, footage kept) instead of failing the track.
 */

import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../db/index.ts";
import { ffmpegPath } from "../lib/ffmpeg-path.ts";
import { enqueueFinalize, isQueueConfigured } from "../lib/queue.ts";
import { describeSegmentGaps, findSegmentGaps } from "../lib/segment-gaps.ts";
import { escapeFilterPath, watermarkFontPath } from "../lib/watermark-font.ts";
import { sessionNeedsWatermark } from "./entitlements-service.ts";
import { getObjectBuffer, putFileObject } from "./storage-service.ts";

/** Bottom-right "openside.pro" badge burned into DEMO masters only. Points
 *  drawtext at a bundled font so it renders on the deploy image (no system
 *  fonts); see watermark-font.ts. */
const WATERMARK_FONT_ARG = watermarkFontPath
	? `fontfile=${escapeFilterPath(watermarkFontPath)}:`
	: "";
// Large, bold, outlined + boxed so it's prominent and not trivially cropped out.
function watermarkFilter(x: string): string {
	return `drawtext=${WATERMARK_FONT_ARG}text='openside.pro':x=${x}:y=h-th-24:fontsize=44:fontcolor=white:borderw=2:bordercolor=black@0.6:box=1:boxcolor=black@0.45:boxborderw=16`;
}
const WATERMARK_FILTER = watermarkFilter("w-tw-28");
// The "both" composite parks the camera PiP in the bottom-right - exactly over
// the masters' badge - so the composite re-stamps its own at the bottom-LEFT,
// where nothing covers it.
const WATERMARK_FILTER_LEFT = watermarkFilter("28");

const inFlight = new Set<string>();
const FFMPEG_TIMEOUT_MS =
	Number(process.env.SCREEN_FFMPEG_TIMEOUT_MS) || 2 * 60 * 60 * 1000;

/**
 * Kick off screen-recorder finalization through the same worker queue used by
 * space recordings.
 *
 * Fallback policy: run in-process ONLY when no queue is configured (local/dev).
 * When a queue IS configured but the enqueue fails (Redis outage), we do NOT run
 * ffmpeg in-process - that would overload the API fleet. The session is left for
 * finalization recovery to retry.
 */
export async function triggerScreenFinalize(sessionId: string): Promise<void> {
	if (!isQueueConfigured()) {
		console.warn(
			`[ScreenFinalize] Redis not configured; finalizing ${sessionId} in API process`,
		);
		void finalizeScreenSession(sessionId);
		return;
	}

	try {
		await enqueueFinalize(sessionId);
		console.log(
			`[ScreenFinalize] queued session ${sessionId} for worker finalization`,
		);
	} catch (error) {
		console.error(
			`[ScreenFinalize] enqueue failed for ${sessionId} (queue configured); leaving for recovery:`,
			error,
		);
	}
}

interface Composition {
	layout?: "screen" | "camera" | "screen-camera";
	cameraSize?: "normal" | "big";
	cameraShape?: "square" | "rectangle";
	cameraCorner?: string; // currently always "bottom-right"
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		const timeout = setTimeout(() => {
			proc.kill("SIGKILL");
			reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`));
		}, FFMPEG_TIMEOUT_MS);
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		proc.on("close", (code) => {
			clearTimeout(timeout);
			code === 0
				? resolve()
				: reject(new Error(`ffmpeg ${code}: ${stderr.slice(-2000)}`));
		});
	});
}

type MasterExt = "mp4" | "webm";

function screenKey(
	userId: string,
	sessionId: string,
	kind: string,
	ext: MasterExt,
): string {
	return `screen/${userId}/sessions/${sessionId}/${kind}/master.${ext}`;
}

function masterContentType(ext: MasterExt): string {
	return ext === "mp4" ? "video/mp4" : "video/webm";
}

type Role = "screen" | "camera" | "audio";

function roleOf(rec: { hasVideo: boolean; isScreenShare: boolean }): Role {
	if (!rec.hasVideo) return "audio";
	return rec.isScreenShare ? "screen" : "camera";
}

interface MasterInfo {
	role: Role;
	path: string;
	key: string;
	width: number | null;
	height: number | null;
	fps: number | null;
	durationMs: number;
}

/** Stitch one track's chunks → normalized master on disk, uploaded to R2. */
async function stitchMaster(
	rec: {
		id: string;
		hasVideo: boolean;
		isScreenShare: boolean;
		container: string | null;
		width: number | null;
		height: number | null;
		fps: number | null;
		expectedSegments: number | null;
		segments: {
			sequenceNumber: number;
			assetKey: string;
			durationMs: number;
		}[];
	},
	userId: string,
	sessionId: string,
	tmpDir: string,
	watermark: boolean,
): Promise<MasterInfo | null> {
	if (rec.segments.length === 0) {
		await prisma.participantRecording.update({
			where: { id: rec.id },
			data: { status: "FAILED", processingError: "No segments uploaded" },
		});
		return null;
	}

	await prisma.participantRecording.update({
		where: { id: rec.id },
		data: { status: "PROCESSING", processingError: null },
	});

	const role = roleOf(rec);
	const rawPath = path.join(tmpDir, `${rec.id}-raw.bin`);

	// Salvage rather than fail: concat whatever arrived, in order. A missing
	// chunk no longer loses the whole track - worst case a brief glitch at the
	// seam (interior gap) or a shortened tail (trailing gap).
	const ordered = [...rec.segments].sort(
		(a, b) => a.sequenceNumber - b.sequenceNumber,
	);
	const gapNote = describeSegmentGaps(
		findSegmentGaps(ordered, rec.expectedSegments),
	);
	if (gapNote) {
		console.warn(
			`[ScreenFinalize] ${rec.id}: ${gapNote} - salvaging available footage`,
		);
	}
	await writeFile(rawPath, Buffer.alloc(0));
	for (const seg of ordered) {
		await appendFile(rawPath, await getObjectBuffer(seg.assetKey));
	}

	// Normalize video masters to CFR H.264/MP4, mirroring the Space finalizer:
	// the capture is VFR and the client's codec ladder is H.264-first, whose
	// mp4/mkv output ffmpeg cannot remux into WebM (that legacy `-c copy` path
	// failed for every H.264 recording). DEMO watermarks burn into the SAME
	// pass. Audio is re-encoded to AAC because Opus sources can't be copied
	// into MP4. Audio-only masters keep the cheap WebM remux.
	const fps = rec.fps && rec.fps >= 10 ? Math.round(rec.fps) : 30;
	let outExt: MasterExt = rec.hasVideo ? "mp4" : "webm";
	let outPath = path.join(tmpDir, `${rec.id}-master.${outExt}`);
	let masterPath = outPath;
	let encoded = false;

	if (rec.hasVideo) {
		try {
			console.log(
				`[ScreenFinalize] stitching ${rec.id} role=${role} segments=${rec.segments.length} fps=${fps}${watermark ? " (watermark)" : ""}`,
			);
			await runFfmpeg([
				"-y",
				"-fflags",
				"+genpts",
				"-i",
				rawPath,
				...(watermark ? ["-vf", WATERMARK_FILTER] : []),
				"-r",
				String(fps),
				"-fps_mode",
				"cfr",
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				watermark ? "20" : "16",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				outPath,
			]);
			encoded = true;
		} catch (error) {
			console.error(
				`[ScreenFinalize] CFR re-encode failed for ${rec.id}, falling back to WebM remux:`,
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
			// Last resort: upload the raw concat, labeled by its real container so
			// the key/content-type aren't lying about mp4/mkv bytes.
			console.error(
				`[ScreenFinalize] remux failed for ${rec.id}, using raw concat:`,
				error,
			);
			masterPath = rawPath;
			outExt = rec.container === "mp4" ? "mp4" : "webm";
		}
	}

	const key = screenKey(userId, sessionId, role, outExt);
	const contentType = masterContentType(outExt);
	await putFileObject(key, masterPath, contentType);

	const durationMs = ordered.reduce((sum, s) => sum + (s.durationMs || 0), 0);
	const fileStat = await stat(masterPath);

	await prisma.participantRecording.update({
		where: { id: rec.id },
		data: {
			status: "READY",
			mergedFileKey: key,
			fileSize: BigInt(fileStat.size),
			durationMs,
			mimeType: contentType,
			processingError: gapNote,
		},
	});

	return {
		role,
		path: masterPath,
		key,
		width: rec.width,
		height: rec.height,
		fps: rec.fps,
		durationMs,
	};
}

/**
 * Build a rounded-rect alpha expr for geq (W,H = plane dims, r = radius px).
 * NOTE: this is embedded inside a single-quoted filter option (a='…'), so the
 * single quotes already protect commas - they must NOT be backslash-escaped.
 */
function roundedAlphaExpr(r: number): string {
	// alpha = 0 only in the four corners outside the quarter-circle of radius r.
	const tl = `lt(X,${r})*lt(Y,${r})*gt(hypot(${r}-X,${r}-Y),${r})`;
	const tr = `gt(X,W-${r})*lt(Y,${r})*gt(hypot(X-(W-${r}),${r}-Y),${r})`;
	const bl = `lt(X,${r})*gt(Y,H-${r})*gt(hypot(${r}-X,Y-(H-${r})),${r})`;
	const br = `gt(X,W-${r})*gt(Y,H-${r})*gt(hypot(X-(W-${r}),Y-(H-${r})),${r})`;
	return `if(gt(${tl}+${tr}+${bl}+${br},0),0,255)`;
}

/**
 * Composite the camera master onto the screen master as a bottom-right PiP.
 *
 * `fast` is the fallback path: it keeps the rounded-corner camera (the `geq`
 * pass is cheap - it only runs on the small camera image, not the full frame)
 * but uses a quicker VP9 preset. The quality path can time out on long/high-res
 * recordings, so callers retry in fast mode to still produce a combined output.
 */
async function composeBoth(
	screen: MasterInfo,
	camera: MasterInfo,
	comp: Composition,
	userId: string,
	sessionId: string,
	tmpDir: string,
	watermark: boolean,
	fast = false,
): Promise<{ key: string; durationMs: number } | null> {
	const baseH = screen.height && screen.height > 0 ? screen.height : 1080;
	const aspect = comp.cameraShape === "rectangle" ? 16 / 9 : 1;
	const camH = Math.round((comp.cameraSize === "big" ? 0.3 : 0.22) * baseH);
	const camW = Math.round(camH * aspect);
	const margin = Math.round(0.03 * baseH);
	const radius = Math.max(2, Math.round(0.12 * camH));
	// Screen capture is variable-frame-rate; normalize both inputs to a constant
	// fps before overlay (and force CFR output) so the merged video isn't laggy.
	const fps = screen.fps && screen.fps >= 10 ? Math.round(screen.fps) : 30;

	const aspectStr = aspect.toFixed(6);
	// Rounded corners via per-pixel alpha. Runs on the small scaled camera only,
	// so it's cheap - kept on both the quality and fast paths for consistency.
	const camChain =
		`[1:v]crop='min(iw,ih*${aspectStr})':'min(ih,iw/${aspectStr})',` +
		`scale=${camW}:${camH},fps=${fps},setpts=PTS-STARTPTS,format=rgba,` +
		`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlphaExpr(radius)}'[cam];`;
	const filter =
		// format=yuv420p: the geq/rgba path yields gbrap, which encoders reject.
		// DEMO composites re-stamp the badge AFTER the overlay (bottom-left): the
		// screen master's own badge sits under the PiP and would be hidden.
		`[0:v]fps=${fps},setpts=PTS-STARTPTS[base];${camChain}[base][cam]overlay=main_w-overlay_w-${margin}:main_h-overlay_h-${margin}:format=auto,format=yuv420p${watermark ? `,${WATERMARK_FILTER_LEFT}` : ""}[v]`;

	const outPath = path.join(tmpDir, `${sessionId}-both.mp4`);
	console.log(
		`[ScreenFinalize] composing both for ${sessionId} (${fast ? "fast" : "quality"}): screen=${screen.key} camera=${camera.key} size=${camW}x${camH} fps=${fps} shape=${comp.cameraShape ?? "square"} sizeMode=${comp.cameraSize ?? "normal"}`,
	);
	await runFfmpeg([
		"-y",
		"-i",
		screen.path,
		"-i",
		camera.path,
		"-filter_complex",
		filter,
		"-map",
		"[v]",
		"-map",
		"0:a?",
		"-r",
		String(fps),
		"-fps_mode",
		"cfr",
		"-af",
		"aresample=async=1:first_pts=0",
		"-c:v",
		"libx264",
		"-preset",
		fast ? "veryfast" : "medium",
		"-crf",
		fast ? "23" : "18",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		outPath,
	]);

	const key = screenKey(userId, sessionId, "both", "mp4");
	await putFileObject(key, outPath, masterContentType("mp4"));
	console.log(`[ScreenFinalize] composed both for ${sessionId}: ${key}`);
	return { key, durationMs: screen.durationMs };
}

export async function finalizeScreenSession(sessionId: string): Promise<void> {
	if (inFlight.has(sessionId)) return;
	inFlight.add(sessionId);
	let tmp: string | null = null;

	try {
		const session = await prisma.recordingSession.findUnique({
			where: { id: sessionId },
			include: {
				participantRecordings: {
					include: { segments: { orderBy: { sequenceNumber: "asc" } } },
				},
			},
		});

		if (!session || session.source !== "SCREEN_RECORDER" || !session.userId) {
			console.warn(
				`[ScreenFinalize] ${sessionId} skipped: missing/non-screen session`,
			);
			return;
		}
		if (session.status === "READY") {
			console.log(
				`[ScreenFinalize] ${sessionId} skipped: status=${session.status}`,
			);
			return;
		}
		if (!["STOPPED", "PROCESSING", "FAILED"].includes(session.status)) {
			console.log(
				`[ScreenFinalize] ${sessionId} skipped: status=${session.status}`,
			);
			return;
		}

		console.log(
			`[ScreenFinalize] starting ${sessionId}: status=${session.status} recordings=${session.participantRecordings.length}`,
			session.participantRecordings.map((r) => ({
				id: r.id,
				screen: r.isScreenShare,
				hasVideo: r.hasVideo,
				hasAudio: r.hasAudio,
				complete: r.isComplete,
				segments: r.segments.length,
				width: r.width,
				height: r.height,
				fps: r.fps,
			})),
		);

		await prisma.recordingSession.update({
			where: { id: sessionId },
			data: { status: "PROCESSING" },
		});

		tmp = await mkdtemp(path.join(tmpdir(), "openside-screen-"));
		const comp = (session.composition as Composition | null) ?? {};
		console.log(`[ScreenFinalize] ${sessionId} composition`, comp);

		// Owner entitlement, resolved server-side once per session.
		const watermark = await sessionNeedsWatermark({
			spaceId: null,
			userId: session.userId,
		});

		const masters: Partial<Record<Role, MasterInfo>> = {};
		for (const rec of session.participantRecordings) {
			try {
				const master = await stitchMaster(
					rec,
					session.userId,
					sessionId,
					tmp,
					watermark,
				);
				if (master) masters[master.role] = master;
			} catch (error) {
				const message = errorMessage(error);
				console.error(
					`[ScreenFinalize] track ${rec.id} failed for ${sessionId}:`,
					error,
				);
				await prisma.participantRecording
					.update({
						where: { id: rec.id },
						data: { status: "FAILED", processingError: message.slice(0, 2000) },
					})
					.catch(() => undefined);
			}
		}

		console.log(
			`[ScreenFinalize] ${sessionId} masters=${Object.keys(masters).join(",") || "none"}`,
			Object.fromEntries(
				Object.entries(masters).map(([role, master]) => [
					role,
					master
						? {
								key: master.key,
								width: master.width,
								height: master.height,
								fps: master.fps,
								durationMs: master.durationMs,
							}
						: null,
				]),
			),
		);

		const outputs: Record<string, { key: string; durationMs: number }> = {};
		if (masters.screen)
			outputs.screen = {
				key: masters.screen.key,
				durationMs: masters.screen.durationMs,
			};
		if (masters.screen)
			outputs.screenAligned = {
				key: masters.screen.key,
				durationMs: masters.screen.durationMs,
			};
		if (masters.camera)
			outputs.camera = {
				key: masters.camera.key,
				durationMs: masters.camera.durationMs,
			};

		// "Both" composite - produce it whenever both tracks exist unless the
		// saved layout explicitly says this was not a screen+camera recording.
		const shouldComposeBoth =
			masters.screen &&
			masters.camera &&
			(comp.layout === undefined || comp.layout === "screen-camera");

		if (shouldComposeBoth && masters.screen && masters.camera) {
			try {
				const both = await composeBoth(
					masters.screen,
					masters.camera,
					comp,
					session.userId,
					sessionId,
					tmp,
					watermark,
				);
				if (both) outputs.both = both;
			} catch (error) {
				// The quality path can fail or hit the timeout on long/high-res
				// recordings. Retry once in fast mode so the user still gets a
				// combined video instead of only the split tracks.
				console.error(
					`[ScreenFinalize] composite failed for ${sessionId}, retrying fast:`,
					error,
				);
				try {
					const both = await composeBoth(
						masters.screen,
						masters.camera,
						comp,
						session.userId,
						sessionId,
						tmp,
						watermark,
						true,
					);
					if (both) outputs.both = both;
				} catch (retryError) {
					console.error(
						`[ScreenFinalize] fast composite also failed for ${sessionId}:`,
						retryError,
					);
				}
			}
		} else {
			console.log(
				`[ScreenFinalize] ${sessionId} skipping both: layout=${comp.layout ?? "missing"} hasScreen=${Boolean(masters.screen)} hasCamera=${Boolean(masters.camera)}`,
			);
		}

		if (Object.keys(outputs).length === 0) {
			await prisma.recordingSession.update({
				where: { id: sessionId },
				data: { status: "FAILED", outputs: outputs as never },
			});
			console.error(
				`[ScreenFinalize] Session ${sessionId} failed: no outputs were produced.`,
			);
			return;
		}

		await prisma.recordingSession.update({
			where: { id: sessionId },
			data: { status: "READY", outputs: outputs as never },
		});
		console.log(
			`[ScreenFinalize] Session ${sessionId} ready.`,
			Object.keys(outputs),
		);
	} catch (error) {
		const message = errorMessage(error);
		console.error(`[ScreenFinalize] Session ${sessionId} failed:`, error);
		await prisma.recordingSession
			.update({ where: { id: sessionId }, data: { status: "FAILED" } })
			.catch(() => undefined);
		await prisma.participantRecording
			.updateMany({
				where: { recordingSessionId: sessionId, status: "PROCESSING" },
				data: { status: "FAILED", processingError: message.slice(0, 2000) },
			})
			.catch(() => undefined);
	} finally {
		inFlight.delete(sessionId);
		if (tmp)
			await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** Finalize once the session is stopped and all its recordings are complete. */
export async function maybeFinalizeScreenSession(
	sessionId: string,
): Promise<void> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: {
			source: true,
			status: true,
			participantRecordings: {
				select: {
					id: true,
					isComplete: true,
					uploadedSegments: true,
					expectedSegments: true,
					status: true,
				},
			},
		},
	});

	if (!session || session.source !== "SCREEN_RECORDER") {
		console.warn(
			`[ScreenFinalize] maybe ${sessionId}: session missing or not screen recorder`,
		);
		return;
	}
	if (session.status !== "STOPPED") {
		console.log(
			`[ScreenFinalize] maybe ${sessionId}: waiting for STOPPED, status=${session.status}`,
		);
		return;
	}
	const recs = session.participantRecordings;
	if (recs.length === 0) {
		console.log(`[ScreenFinalize] maybe ${sessionId}: no track recordings yet`);
		return;
	}
	if (!recs.every((r) => r.isComplete)) {
		console.log(
			`[ScreenFinalize] maybe ${sessionId}: waiting for complete tracks`,
			recs.map((r) => ({
				id: r.id,
				status: r.status,
				complete: r.isComplete,
				uploaded: r.uploadedSegments,
				expected: r.expectedSegments,
			})),
		);
		return;
	}

	console.log(
		`[ScreenFinalize] maybe ${sessionId}: all tracks complete, triggering finalization`,
	);
	await triggerScreenFinalize(sessionId);
}
