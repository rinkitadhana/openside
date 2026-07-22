/**
 * Download service - resolves a presigned download URL for a FinalOutput in a
 * requested format.
 *
 * WebM is the stored master, so it's served immediately. MP4/MP3/WAV are
 * derived on demand with ffmpeg the FIRST time they're requested, cached in R2
 * next to the master, and presigned thereafter. While a transcode is running we
 * return `ready: false` so the client can poll.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpegPath } from "../lib/ffmpeg-path.ts";
import { enqueueTranscode, isQueueConfigured } from "../lib/queue.ts";
import {
	getObjectBuffer,
	objectExists,
	presignGet,
	putFileObject,
} from "./storage-service.ts";

export type DownloadFormat = "webm" | "mp4" | "mp3" | "wav";

export const DOWNLOAD_FORMATS: DownloadFormat[] = ["webm", "mp4", "mp3", "wav"];

const CONTENT_TYPE: Record<DownloadFormat, string> = {
	webm: "video/webm",
	mp4: "video/mp4",
	mp3: "audio/mpeg",
	wav: "audio/wav",
};

// In-process transcodes in progress, keyed by target R2 key. Only used on the
// fallback path when Redis isn't configured; the authoritative cross-replica
// dedup is the BullMQ jobId (see enqueueTranscode).
const inFlight = new Set<string>();

function extensionOf(key: string): DownloadFormat | null {
	const match = key.toLowerCase().match(/\.([a-z0-9]+)$/);
	const ext = match?.[1];
	return DOWNLOAD_FORMATS.includes(ext as DownloadFormat)
		? (ext as DownloadFormat)
		: null;
}

function derivedKey(masterKey: string, format: DownloadFormat): string {
	const currentFormat = extensionOf(masterKey);
	if (currentFormat === format) return masterKey;
	if (currentFormat) return masterKey.replace(/\.[a-z0-9]+$/i, `.${format}`);
	return `${masterKey}.${format}`;
}

function ffmpegArgs(
	input: string,
	output: string,
	format: DownloadFormat,
): string[] {
	// Input-side resilience so an imperfect/salvaged master (interior chunk gap,
	// non-monotonic or missing timestamps) still transcodes instead of erroring:
	// regenerate PTS, ignore bad DTS, and don't abort on a stray corrupt packet.
	const inFlags = ["-fflags", "+genpts+igndts", "-err_detect", "ignore_err"];
	switch (format) {
		case "mp4":
			return [
				"-y",
				...inFlags,
				"-i",
				input,
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"23",
				// Broadest player compatibility (Safari/QuickTime need yuv420p).
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				"-movflags",
				"+faststart",
				output,
			];
		case "mp3":
			return [
				"-y",
				...inFlags,
				"-i",
				input,
				"-vn",
				"-c:a",
				"libmp3lame",
				"-q:a",
				"2",
				output,
			];
		case "wav":
			return [
				"-y",
				...inFlags,
				"-i",
				input,
				"-vn",
				"-c:a",
				"pcm_s16le",
				output,
			];
		case "webm":
			return ["-y", ...inFlags, "-i", input, "-c", "copy", output];
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

export async function transcodeToR2(
	masterKey: string,
	targetKey: string,
	format: DownloadFormat,
): Promise<void> {
	let tmp: string | null = null;
	try {
		tmp = await mkdtemp(path.join(tmpdir(), "openside-transcode-"));
		const inPath = path.join(tmp, "in.webm");
		const outPath = path.join(tmp, `out.${format}`);

		await writeFile(inPath, await getObjectBuffer(masterKey));
		await runFfmpeg(ffmpegArgs(inPath, outPath, format));

		// Sanity check the output exists / is non-empty before uploading.
		const outStat = await stat(outPath);
		if (outStat.size === 0) throw new Error("Transcode produced an empty file");

		await putFileObject(targetKey, outPath, CONTENT_TYPE[format]);
	} finally {
		if (tmp)
			await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	}
}

interface ResolveInput {
	masterKey: string | null;
	hasVideo: boolean | null;
	hasAudio?: boolean | null;
	format: DownloadFormat;
	/** Lossless WAV master built from the participant's raw-PCM mic track, if any.
	 *  When present it's the source of truth for wav/mp3 downloads. Null for legacy
	 *  recordings (which fall back to extracting audio from the WebM master). */
	audioWavKey?: string | null;
	/** Filename to force a download; omit for inline preview playback. */
	downloadName?: string;
}

export interface ResolveResult {
	ready: boolean;
	url?: string;
	format: DownloadFormat;
	/** Set when the request is invalid for this output (e.g. mp4 for audio). */
	error?: string;
}

export async function resolveDownloadUrl({
	masterKey,
	hasVideo,
	hasAudio,
	format,
	audioWavKey,
	downloadName,
}: ResolveInput): Promise<ResolveResult> {
	if (!masterKey) {
		return { ready: false, format, error: "Recording is not ready yet." };
	}

	// Video container requested for an audio-only master makes no sense.
	if (format === "mp4" && !hasVideo) {
		return { ready: false, format, error: "This recording has no video." };
	}

	// Audio-only formats need an audio stream - a video-only screen share has
	// none, and ffmpeg would fail producing an empty file. Guard so the client
	// gets a clear message instead of polling a transcode that can't succeed.
	if ((format === "mp3" || format === "wav") && hasAudio === false) {
		return { ready: false, format, error: "This recording has no audio." };
	}

	const presignOpts = downloadName ? { downloadName } : undefined;

	// Lossless-audio path: when a real PCM-derived WAV master exists, it is the
	// source of truth for audio downloads. WAV is served DIRECTLY (no transcode);
	// MP3 is encoded FROM the WAV (better source than the WebM's lossy Opus).
	// Legacy recordings have no audioWavKey and fall through to the old behavior
	// of extracting audio from the WebM master.
	if (audioWavKey && (format === "wav" || format === "mp3")) {
		if (format === "wav") {
			return {
				ready: true,
				format,
				url: await presignGet(audioWavKey, presignOpts),
			};
		}
		// MP3 from the WAV: transcode-and-cache next to the WAV, then presign.
		const mp3Key = derivedKey(audioWavKey, "mp3");
		if (await objectExists(mp3Key)) {
			return {
				ready: true,
				format,
				url: await presignGet(mp3Key, presignOpts),
			};
		}
		if (isQueueConfigured()) {
			try {
				await enqueueTranscode({
					masterKey: audioWavKey,
					targetKey: mp3Key,
					format,
				});
			} catch (error) {
				console.error(
					`[Download] enqueue failed for ${mp3Key} (queue configured):`,
					error,
				);
			}
			return { ready: false, format };
		}
		if (!inFlight.has(mp3Key)) {
			inFlight.add(mp3Key);
			void transcodeToR2(audioWavKey, mp3Key, format)
				.catch((error) =>
					console.error(`[Download] transcode failed for ${mp3Key}:`, error),
				)
				.finally(() => inFlight.delete(mp3Key));
		}
		return { ready: false, format };
	}

	if (extensionOf(masterKey) === format) {
		return {
			ready: true,
			format,
			url: await presignGet(masterKey, presignOpts),
		};
	}

	const targetKey = derivedKey(masterKey, format);

	if (await objectExists(targetKey)) {
		return {
			ready: true,
			format,
			url: await presignGet(targetKey, presignOpts),
		};
	}

	// Not cached yet: hand the encode to the worker fleet and tell the client to
	// poll. The API server itself never runs ffmpeg.
	if (isQueueConfigured()) {
		try {
			await enqueueTranscode({ masterKey, targetKey, format });
		} catch (error) {
			// Queue is configured but unreachable (Redis outage). Do NOT transcode
			// in-process - that would melt the API fleet under load. Tell the client
			// to keep polling; the next poll (or a recovered queue) will pick it up.
			console.error(
				`[Download] enqueue failed for ${targetKey} (queue configured):`,
				error,
			);
		}
		return { ready: false, format };
	}

	// Fallback (no queue configured): run the transcode in-process, once.
	if (!inFlight.has(targetKey)) {
		inFlight.add(targetKey);
		void transcodeToR2(masterKey, targetKey, format)
			.catch((error) =>
				console.error(`[Download] transcode failed for ${targetKey}:`, error),
			)
			.finally(() => inFlight.delete(targetKey));
	}

	return { ready: false, format };
}
