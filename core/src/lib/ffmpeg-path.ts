import ffmpegStatic from "ffmpeg-static";

/**
 * Path to the ffmpeg binary. `ffmpeg-static` bundles a platform-specific
 * static binary into node_modules so we don't depend on the deploy image
 * having ffmpeg installed. Falls back to a PATH lookup if it's unavailable.
 */
export const ffmpegPath: string = ffmpegStatic ?? "ffmpeg";
