/**
 * Session-level recording constants (client side).
 *
 * Frame rate is a per-user recording preference (Settings → Recording) that
 * becomes the session target when that user hosts. Capture requests it as a
 * hint (`frameRate: { ideal }`); the server's CFR normalization at finalization
 * is what actually guarantees every participant's master lands on the same
 * constant frame rate regardless of what hardware delivered.
 */

/** The only frame rates a session may target. */
export const ALLOWED_FPS = [24, 30] as const;

/** Default frame rate: 30 FPS ("Standard (web)"). */
export const DEFAULT_FPS = 30;

/** DEMO plan is locked to 24 FPS ("Cinematic"); it can't pick 30. */
export const DEMO_FPS = 24;

export type AllowedFps = (typeof ALLOWED_FPS)[number];

/** Coerce any input to a valid target fps, falling back to the default. */
export function clampFps(value: unknown): AllowedFps {
  const n = typeof value === "number" ? Math.round(value) : Number(value);
  return (ALLOWED_FPS as readonly number[]).includes(n)
    ? (n as AllowedFps)
    : DEFAULT_FPS;
}
