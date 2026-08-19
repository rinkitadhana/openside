/**
 * One fixed output geometry per video master.
 *
 * WHY THIS EXISTS:
 * A `getDisplayMedia` track RESIZES mid-capture whenever the shared surface
 * changes shape - switching tabs, resizing or maximizing the shared window, a
 * display-scale change. MediaRecorder happily encodes that as a resolution
 * switch mid-stream, but libx264 cannot change frame size mid-encode: with no
 * explicit size filter, everything after the switch is fed to an encoder still
 * configured for the ORIGINAL geometry, which is what produced the smeared /
 * garbage masters ("leave the recorder page, get a broken video").
 *
 * Both finalizers (screen recorder + space) share this so neither can drift
 * back to an unpinned encode.
 */

import { spawn } from "node:child_process";
import { ffmpegPath } from "./ffmpeg-path.ts";

export interface VideoSize {
	width: number;
	height: number;
}

/** Run ffmpeg purely to read its stderr (probing); never rejects on exit code. */
function ffmpegStderr(args: string[]): Promise<string> {
	return new Promise((resolve) => {
		const proc = spawn(ffmpegPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		const timeout = setTimeout(() => proc.kill("SIGKILL"), 30_000);
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("error", () => {
			clearTimeout(timeout);
			resolve(stderr);
		});
		proc.on("close", () => {
			clearTimeout(timeout);
			resolve(stderr);
		});
	});
}

/** First video frame size reported in the container header (null if unreadable). */
export async function probeVideoSize(file: string): Promise<VideoSize | null> {
	// No output file: ffmpeg prints the input's stream table to stderr, then
	// exits non-zero ("At least one output file must be specified").
	const out = await ffmpegStderr(["-hide_banner", "-i", file]);
	const match = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(out);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!width || !height) return null;
	return { width, height };
}

/** yuv420p needs even dimensions. */
export function evenDim(n: number): number {
	return Math.max(2, Math.floor(n / 2) * 2);
}

/**
 * The size every frame of a master is normalized to.
 *
 * Target = the LARGEST size we know about (the client-reported max observed
 * dimensions vs the container header), so a surface that GREW mid-capture is
 * downscaled rather than cropped.
 */
export async function resolveTargetSize(
	rec: { width: number | null; height: number | null },
	rawPath: string,
): Promise<VideoSize> {
	const candidates: VideoSize[] = [];
	if (rec.width && rec.height && rec.width > 1 && rec.height > 1) {
		candidates.push({ width: rec.width, height: rec.height });
	}
	const probed = await probeVideoSize(rawPath);
	if (probed) candidates.push(probed);

	const best = candidates.reduce<VideoSize | null>(
		(acc, c) => (!acc || c.width * c.height > acc.width * acc.height ? c : acc),
		null,
	) ?? { width: 1920, height: 1080 };

	return { width: evenDim(best.width), height: evenDim(best.height) };
}

/** scale-to-fit + letterbox onto the pinned canvas, so a mid-stream resolution
 *  change becomes black bars instead of a corrupt encode. */
export function sizeFilter(size: VideoSize): string {
	return (
		`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,` +
		`pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
	);
}
