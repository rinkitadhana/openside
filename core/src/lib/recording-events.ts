/**
 * Server-originated recording start/stop broadcasts.
 *
 * Clients used to announce start/stop over an unauthenticated socket event, so
 * anyone with a room code could stop someone else's recording, and a host whose
 * socket was down silently failed to start anyone. Now the authenticated API (and
 * every server-side stop path: usage exhaustion, space end, the abandoned-session
 * reaper) publishes here after the database change commits.
 *
 * The socket server registers the publisher at boot. Processes without sockets
 * (the media worker) never register one, so publishing there is a no-op.
 */

/** Synced 3-2-1 lead-in every participant counts down before capturing. */
export const RECORDING_COUNTDOWN_MS = 3000;

export interface RecordingStartedPayload {
	sessionId: string;
	spaceRecordingSessionId: string;
	/** Server-clock instant every participant's recorder starts at. */
	startedAt: number;
	countdownMs: number;
	videoResolution: number;
	/** Session frame rate - every camera is capped to it at capture. */
	targetFps: number;
	audioSampleRate: number;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	echoCancellation: boolean;
	recordingMode: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
	/** Pause state at the time of sending - see RecordingPausePayload. */
	pausedMs: number;
	pausedAt: number | null;
}

/** Lead time before a pause or resume takes effect, so every participant's
 *  recorder flips at the same server instant despite socket latency. */
export const RECORDING_PAUSE_LEAD_MS = 400;

/**
 * A take paused or resumed. Recorders leave paused time out of their timeline,
 * so at server time T a take has recorded
 *   T - startedAt - pausedMs - (time since pausedAt, until resumedAt).
 */
export interface RecordingPausePayload {
	sessionId: string;
	/** Pauses resumed before the one at `pausedAt`. */
	pausedMs: number;
	/** Server instant the current (or just-resumed) pause began; null = none. */
	pausedAt: number | null;
	/** Server instant the pause at `pausedAt` ends; null while still paused. */
	resumedAt: number | null;
}

interface RecordingEventPublisher {
	started(roomId: string, payload: RecordingStartedPayload): void;
	stopped(roomId: string, sessionId: string): void;
	pauseChanged(roomId: string, payload: RecordingPausePayload): void;
}

let publisher: RecordingEventPublisher | null = null;

export function setRecordingEventPublisher(next: RecordingEventPublisher) {
	publisher = next;
}

/**
 * One formula for the start instant everywhere (live broadcast, join-room
 * replay, the client's active-session poll), so a late joiner lands on exactly
 * the same timeline as everyone who saw the original broadcast.
 */
export function buildRecordingStartedPayload(session: {
	id: string;
	spaceRecordingSessionId: string;
	startedAt: Date;
	videoResolution: number;
	targetFps: number;
	audioSampleRate: number;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	echoCancellation: boolean;
	recordingMode: string;
	pausedMs?: number;
	pausedAt?: Date | null;
}): RecordingStartedPayload {
	return {
		sessionId: session.id,
		spaceRecordingSessionId: session.spaceRecordingSessionId,
		startedAt: session.startedAt.getTime() + RECORDING_COUNTDOWN_MS,
		countdownMs: RECORDING_COUNTDOWN_MS,
		videoResolution: session.videoResolution,
		targetFps: session.targetFps,
		audioSampleRate: session.audioSampleRate,
		noiseSuppression: session.noiseSuppression,
		autoGainControl: session.autoGainControl,
		echoCancellation: session.echoCancellation,
		recordingMode:
			session.recordingMode === "AUDIO_ONLY" ? "AUDIO_ONLY" : "VIDEO_AND_AUDIO",
		pausedMs: session.pausedMs ?? 0,
		pausedAt: session.pausedAt?.getTime() ?? null,
	};
}

export function publishRecordingStarted(
	roomId: string | null | undefined,
	payload: RecordingStartedPayload,
) {
	if (!roomId) return;
	try {
		publisher?.started(roomId, payload);
	} catch (error) {
		console.error("[RecordingEvents] start broadcast failed:", error);
	}
}

export function publishRecordingStopped(
	roomId: string | null | undefined,
	sessionId: string,
) {
	if (!roomId) return;
	try {
		publisher?.stopped(roomId, sessionId);
	} catch (error) {
		console.error("[RecordingEvents] stop broadcast failed:", error);
	}
}

export function publishRecordingPauseChanged(
	roomId: string | null | undefined,
	payload: RecordingPausePayload,
) {
	if (!roomId) return;
	try {
		publisher?.pauseChanged(roomId, payload);
	} catch (error) {
		console.error("[RecordingEvents] pause broadcast failed:", error);
	}
}
