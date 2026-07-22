/**
 * Resolves the bundled DejaVu Sans font used for the DEMO watermark.
 *
 * WHY BUNDLE A FONT:
 * `ffmpeg-static` ships a static binary with libfreetype, but the deploy image
 * has no system fonts and no fontconfig cache, so `drawtext` with no `fontfile`
 * fails to find a font and the watermark silently drops (the encode falls back
 * to an un-watermarked master). Pointing `drawtext` at a font we ship makes the
 * watermark render on every platform.
 *
 * The font is a runtime asset (not bundled by tsup), so we probe the handful of
 * locations it can sit at relative to the running module (src via tsx, dist via
 * node) or the working directory. Null if none exist - callers then fall back to
 * a fontconfig lookup.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bold weight - the DEMO watermark is intentionally large/heavy.
const FONT_RELATIVE = path.join("assets", "fonts", "DejaVuSans-Bold.ttf");

function resolveWatermarkFont(): string | null {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// dev: core/src/lib -> core/
		path.resolve(here, "..", "..", FONT_RELATIVE),
		// built bundle: core/dist -> core/
		path.resolve(here, "..", FONT_RELATIVE),
		path.resolve(here, FONT_RELATIVE),
		// last resort: relative to the process working directory
		path.resolve(process.cwd(), FONT_RELATIVE),
		path.resolve(process.cwd(), "core", FONT_RELATIVE),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export const watermarkFontPath: string | null = resolveWatermarkFont();

/** Escape a path for safe use inside an ffmpeg filtergraph option value. */
export function escapeFilterPath(p: string): string {
	return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}
