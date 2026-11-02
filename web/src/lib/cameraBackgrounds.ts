import type { LocalVideoTrack } from "livekit-client";

// Virtual backgrounds for the camera (Google Meet style): LiveKit's
// track-processors segments the person on-device (MediaPipe) and swaps the
// background for a blur or an image. The processor lives on the camera track,
// so whatever the preview shows is exactly what gets published - and recorded.
// The package (and its model) is loaded lazily, only once someone uses it.

export type CameraBackground =
  | { kind: "none" }
  | { kind: "blur" }
  | { kind: "preset"; id: string }
  | { kind: "custom" };

export const backgroundKey = (background: CameraBackground) =>
  background.kind === "preset" ? `preset:${background.id}` : background.kind;

const BACKGROUND_STORAGE_KEY = "openside:cameraBackground";
const CUSTOM_IMAGE_STORAGE_KEY = "openside:cameraBackgroundCustom";

// Generated on a canvas rather than shipped as image files. Each is a soft
// gradient "wall" with a few out-of-focus light spots, like a blurred room.
interface PresetSpec {
  id: string;
  label: string;
  stops: string[];
  angle: number;
  bokeh: string;
}

export const BACKGROUND_PRESETS: PresetSpec[] = [
  {
    id: "studio",
    label: "Studio",
    stops: ["#2d323c", "#1a1d23", "#0f1114"],
    angle: 0,
    bokeh: "255, 236, 210",
  },
  {
    id: "warm",
    label: "Warm wall",
    stops: ["#efe4d4", "#d9c5aa", "#b89c7c"],
    angle: 20,
    bokeh: "255, 248, 235",
  },
  {
    id: "dusk",
    label: "Dusk",
    stops: ["#24124f", "#8e3f8f", "#f0926b"],
    angle: 75,
    bokeh: "255, 214, 180",
  },
  {
    id: "ocean",
    label: "Ocean",
    stops: ["#0c1f2b", "#1f4b5e", "#4f8a95"],
    angle: 60,
    bokeh: "190, 240, 255",
  },
  {
    id: "forest",
    label: "Forest",
    stops: ["#10291f", "#2f5b3e", "#7da36b"],
    angle: 40,
    bokeh: "235, 255, 200",
  },
];

const PRESET_WIDTH = 1280;
const PRESET_HEIGHT = 720;
const presetUrlCache = new Map<string, string>();

// Small deterministic PRNG so a preset looks the same every time.
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

export function getPresetImageUrl(id: string): string {
  const cached = presetUrlCache.get(id);
  if (cached) return cached;
  const preset = BACKGROUND_PRESETS.find((item) => item.id === id);
  if (!preset) return "";

  const canvas = document.createElement("canvas");
  canvas.width = PRESET_WIDTH;
  canvas.height = PRESET_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const radians = (preset.angle * Math.PI) / 180;
  const dx = (Math.cos(radians) * PRESET_WIDTH) / 2;
  const dy = (Math.sin(radians) * PRESET_HEIGHT) / 2;
  const cx = PRESET_WIDTH / 2;
  const cy = PRESET_HEIGHT / 2;
  const base = context.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  preset.stops.forEach((color, index) =>
    base.addColorStop(index / (preset.stops.length - 1), color),
  );
  context.fillStyle = base;
  context.fillRect(0, 0, PRESET_WIDTH, PRESET_HEIGHT);

  const random = seeded(preset.id.length * 7919 + preset.angle + 1);
  for (let i = 0; i < 14; i++) {
    const x = random() * PRESET_WIDTH;
    const y = random() * PRESET_HEIGHT * 0.75;
    const radius = 40 + random() * 140;
    const alpha = 0.05 + random() * 0.12;
    const spot = context.createRadialGradient(x, y, 0, x, y, radius);
    spot.addColorStop(0, `rgba(${preset.bokeh}, ${alpha})`);
    spot.addColorStop(1, `rgba(${preset.bokeh}, 0)`);
    context.fillStyle = spot;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Vignette, so the edges fall off like a real room behind someone.
  const vignette = context.createRadialGradient(
    cx,
    cy,
    PRESET_HEIGHT * 0.35,
    cx,
    cy,
    PRESET_WIDTH * 0.7,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.35)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, PRESET_WIDTH, PRESET_HEIGHT);

  const url = canvas.toDataURL("image/jpeg", 0.9);
  presetUrlCache.set(id, url);
  return url;
}

export function loadSavedBackground(): CameraBackground {
  try {
    const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (!raw) return { kind: "none" };
    const parsed = JSON.parse(raw) as CameraBackground;
    if (parsed.kind === "blur" || parsed.kind === "none") return parsed;
    if (
      parsed.kind === "preset" &&
      BACKGROUND_PRESETS.some((preset) => preset.id === parsed.id)
    ) {
      return parsed;
    }
    if (parsed.kind === "custom" && loadCustomImage()) return parsed;
  } catch {
    // Unreadable or blocked storage - start without a background.
  }
  return { kind: "none" };
}

export function saveBackground(background: CameraBackground) {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(background));
  } catch {
    // Remembering the choice is a convenience only.
  }
}

export function loadCustomImage(): string | null {
  try {
    return localStorage.getItem(CUSTOM_IMAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Scale an uploaded image to cover 1920x1080 and re-encode it as JPEG - keeps
 * it small enough to remember in localStorage and cheap for the processor.
 */
export async function prepareCustomImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const width = 1920;
  const height = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  bitmap.close();

  const url = canvas.toDataURL("image/jpeg", 0.85);
  try {
    localStorage.setItem(CUSTOM_IMAGE_STORAGE_KEY, url);
  } catch {
    // Too big for storage - it still works for this session.
  }
  return url;
}

export async function isCameraBackgroundSupported(): Promise<boolean> {
  try {
    const { supportsBackgroundProcessors } = await import(
      "@livekit/track-processors"
    );
    return supportsBackgroundProcessors();
  } catch {
    return false;
  }
}

// One apply at a time per track. Without this, quick clicks each see "no
// processor yet" and each build a full segmenter (WASM + model + GPU init on
// the main thread) instead of switching the first one in place.
const applyQueues = new WeakMap<LocalVideoTrack, Promise<void>>();

/**
 * Put `background` on a camera track, reusing its processor when it already
 * has one (switching modes in place avoids a flash of the real room).
 */
export function applyCameraBackground(
  track: LocalVideoTrack,
  background: CameraBackground,
  customImageUrl: string | null,
): Promise<void> {
  const previous = applyQueues.get(track) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => applyNow(track, background, customImageUrl));
  applyQueues.set(track, next);
  return next;
}

async function applyNow(
  track: LocalVideoTrack,
  background: CameraBackground,
  customImageUrl: string | null,
): Promise<void> {
  const current = track.getProcessor();
  if (background.kind === "none") {
    if (current) await track.stopProcessor();
    return;
  }

  const imagePath =
    background.kind === "preset"
      ? getPresetImageUrl(background.id)
      : background.kind === "custom"
        ? customImageUrl
        : null;
  if (background.kind !== "blur" && !imagePath) return;

  const {
    BackgroundProcessor,
    BackgroundProcessorWrapper,
    supportsBackgroundProcessors,
  } = await import("@livekit/track-processors");
  if (!supportsBackgroundProcessors()) return;

  const options =
    background.kind === "blur"
      ? ({ mode: "background-blur" } as const)
      : ({ mode: "virtual-background", imagePath: imagePath! } as const);

  if (current instanceof BackgroundProcessorWrapper) {
    await current.switchTo(options);
    return;
  }
  if (current) await track.stopProcessor();
  await track.setProcessor(BackgroundProcessor(options));
}
