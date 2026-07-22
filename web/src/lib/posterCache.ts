// In-session cache of captured video poster frames (outputId/key -> JPEG dataURL).
// Thumbnails are rendered from a live <video> that must load, seek, and paint -
// which flashes blank on every remount. Once we've painted a frame we snapshot
// it here so revisiting the page can show a static <img> instantly, with no
// reload flash. Lives in module scope so it survives route changes.
const posterCache = new Map<string, string>();

export function getCachedPoster(key: string): string | null {
  return posterCache.get(key) ?? null;
}

// Snapshot the current frame of a (CORS-enabled) video to a dataURL. Returns the
// cached value if present, or null when the canvas is tainted / not ready - in
// which case the caller keeps showing the live video.
export function capturePoster(
  key: string,
  video: HTMLVideoElement,
): string | null {
  const existing = posterCache.get(key);
  if (existing) return existing;

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    posterCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    // Tainted canvas (no CORS headers) - keep using the live video element.
    return null;
  }
}
