/**
 * Session-level recording constants shared across capture, finalization, and
 * settings. Frame rate is chosen ONCE per session by the host and applied to
 * every participant so their masters can be normalized to a single constant
 * frame rate (CFR) at finalization - the fix for VFR lip-sync drift and
 * cross-participant misalignment.
 */

/** The only frame rates a session may target. */
export const ALLOWED_FPS = [24, 30] as const;

/** Default frame rate: 30 FPS ("Standard (web)"). */
export const DEFAULT_FPS = 30;

/** DEMO plan is locked to 24 FPS ("Cinematic"); it can't pick 30. */
export const DEMO_FPS = 24;

export type AllowedFps = (typeof ALLOWED_FPS)[number];

export const ALLOWED_VIDEO_RESOLUTIONS = [720, 1080, 2160] as const;
export const DEFAULT_VIDEO_RESOLUTION = 2160;
export type AllowedVideoResolution = (typeof ALLOWED_VIDEO_RESOLUTIONS)[number];

export const ALLOWED_AUDIO_SAMPLE_RATES = [44100, 48000] as const;
export const DEFAULT_AUDIO_SAMPLE_RATE = 48000;
export type AllowedAudioSampleRate =
	(typeof ALLOWED_AUDIO_SAMPLE_RATES)[number];

export const RECORDING_MODES = ["VIDEO_AND_AUDIO", "AUDIO_ONLY"] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];
export const DEFAULT_RECORDING_MODE: RecordingMode = "VIDEO_AND_AUDIO";

/** Coerce any input to a valid target fps, falling back to the default. */
export function clampFps(value: unknown): AllowedFps {
	const n = typeof value === "number" ? Math.round(value) : Number(value);
	return (ALLOWED_FPS as readonly number[]).includes(n)
		? (n as AllowedFps)
		: DEFAULT_FPS;
}

export function clampVideoResolution(value: unknown): AllowedVideoResolution {
	const n = typeof value === "number" ? Math.round(value) : Number(value);
	return (ALLOWED_VIDEO_RESOLUTIONS as readonly number[]).includes(n)
		? (n as AllowedVideoResolution)
		: DEFAULT_VIDEO_RESOLUTION;
}

export function clampAudioSampleRate(value: unknown): AllowedAudioSampleRate {
	const n = typeof value === "number" ? Math.round(value) : Number(value);
	return (ALLOWED_AUDIO_SAMPLE_RATES as readonly number[]).includes(n)
		? (n as AllowedAudioSampleRate)
		: DEFAULT_AUDIO_SAMPLE_RATE;
}

export function clampRecordingMode(value: unknown): RecordingMode {
	return (RECORDING_MODES as readonly string[]).includes(value as string)
		? (value as RecordingMode)
		: DEFAULT_RECORDING_MODE;
}
