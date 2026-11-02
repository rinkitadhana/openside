/**
 * HOOK: useRecordingManager
 *
 * PURPOSE:
 * Orchestrates per-participant local recording end-to-end:
 *   - starts/stops on the server's recording-started / recording-stopped
 *     broadcasts (the API publishes them; clients can't)
 *   - records the camera track (useLocalRecording, in parts that follow
 *     LiveKit's track changes), the lossless PCM mic, and every screen share
 *   - registers one ParticipantRecording per track (retrying until it lands)
 *   - streams every chunk through useChunkUploader (IndexedDB → R2 → segment)
 *   - on stop, reports how many chunks each track RECORDED; the server
 *     completes the track the moment the last one lands, however slow the
 *     uplink - nothing is cut off at a timeout
 *
 * FLOW:
 * 1. Host starts → API creates session → server broadcasts "recording-started"
 * 2. Every participant (incl. host) counts down to the same server instant,
 *    then starts local recording + creates (or, after a refresh, resumes) rows
 * 3. Chunks emitted every 5s → uploaded directly to R2
 * 4. Host stops → server broadcasts → all stop, report counts, finish uploads
 *
 * PAUSE:
 * A host pause/resume is broadcast with the server instant it takes effect,
 * and every recorder flips at that instant. Chunk times run on a recording
 * clock that stands still while paused, so the paused stretch never enters the
 * timeline - the finalizer stitches the take as if it hadn't happened.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { isAxiosError } from "axios";
import { type RecordingPauseData, useSocket } from "@/context/socket";
import { useClockSync } from "@/context/clockSync";
import api from "@/lib/axiosInstance";
import { toast } from "@/lib/toast";
import { callSoundLengthMs, playCallSound } from "@/lib/callSounds";
import { getMaxBufferedSequence } from "@/lib/recordingDb";
import {
  type BlackVideoSource,
  createBlackVideoTrack,
} from "@/lib/blackVideoTrack";
import { sendUsageHeartbeat } from "./useUsage";
import useLocalRecording, {
  type LocalChunk,
  type RecordingMetadata,
} from "./useLocalRecording";
import useChunkUploader from "./useChunkUploader";
import usePcmCapture, { type PcmChunkMeta } from "./usePcmCapture";
import {
  useStartRecordingSession,
  useStopRecordingSession,
  useGetActiveRecordingSession,
} from "./useRecording";
import type {
  CreateParticipantRecordingPayload,
  CreateParticipantRecordingResponse,
  RecordingSession,
} from "@/types/recordingTypes";

export type RecordingState =
  | "idle"
  | "starting"
  | "countdown"
  | "recording"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

/** Synchronized 3-2-1 lead-in before everyone's recorder actually starts. */
const COUNTDOWN_MS = 3000;

/** The start chime plays when the countdown ends; capture waits this long so
 *  no one's mic picks it up. Fixed (not 0 with sounds off) so every client
 *  starts at the same instant; the margin covers speaker/Bluetooth latency. */
const START_CHIME_MS = callSoundLengthMs("recordingStart") + 300;

/** Uploader routing key per local track. */
type UploadTrack = "combined" | "screen" | "pcm";
type TrackKey = "combined" | "pcm" | `screen:${number}`;

interface RecordingStartedData {
  sessionId: string;
  spaceRecordingSessionId: string;
  startedAt: number;
  /** Lead-in duration broadcast by the server so all clients count down together. */
  countdownMs?: number;
  videoResolution: number;
  targetFps?: number;
  audioSampleRate: number;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  recordingMode: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
  pausedMs?: number;
  pausedAt?: number | null;
}

/** How often the recording host reports metered seconds to the server. */
const USAGE_HEARTBEAT_MS = 15_000;

/** A pause/resume that runs this late here (missed broadcast, a throttled
 *  timer) restarts the camera recorder so its footage re-lines up. */
const PAUSE_SYNC_TOLERANCE_MS = 250;

/** A late joiner's camera track can attach a beat after the start; wait this
 *  long for it so their first part has video. (A camera that lands later is
 *  picked up as a new part anyway - nothing is lost by not waiting longer.) */
const VIDEO_ATTACH_GRACE_MS = 2000;

/** Coalesce a burst of track changes (camera + background effect) into one
 *  recorder rotation. */
const SOURCE_SYNC_DEBOUNCE_MS = 300;

/** Fewer parallel uploads while recording, to leave uplink for the call. */
const UPLOAD_CONCURRENCY_RECORDING = 2;
const UPLOAD_CONCURRENCY_DRAINING = 4;

/** Registering a track retries this long (network trouble, a busy API). The
 *  server accepts late registration for a while after the stop. */
const CREATE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const CREATE_GIVE_UP_AFTER_MS = 14 * 60 * 1000;

/** On leave, wait at most this long for uploads before letting the user go -
 *  the rest uploads from IndexedDB in the background. */
const LEAVE_DRAIN_TIMEOUT_MS = 30_000;

interface UseRecordingManagerOptions {
  spaceId: string;
  participantSessionId: string;
  isHost: boolean;
  /** Per-session cloud backup opt-in (PRO/self-host; ignored server-side otherwise). */
  cloudBackup?: boolean;
  /** Reads the participant's current local A/V MediaStream on demand. */
  getLiveStream?: () => MediaStream | null;
  /** Whether the participant's camera is on - i.e. whether video is expected. */
  cameraEnabled?: boolean;
  /** Whether the call mic is unmuted. The lossless PCM track (its own mic
   *  capture) records silence while the call mic is muted. */
  micEnabled?: boolean;
  /** Per-participant choice from pre-join: speakers request PCM AEC. */
  recordingEchoCancellation?: boolean;
}

interface UseRecordingManagerReturn {
  recordingState: RecordingState;
  isRecording: boolean;
  /** The take is paused for everyone (recordingState stays "recording"). */
  isPaused: boolean;
  /** A pause/resume request is on its way to the server. */
  isPauseRequestPending: boolean;
  recordingDurationMs: number;
  error: string | null;
  /** True when the server could not confirm the previous recording stopped. */
  stopRequestFailed: boolean;
  sessionId: string | null;
  spaceRecordingSessionId: string | null;
  combinedRecordingId: string | null;
  screenRecordingId: string | null;
  combinedChunkIndex: number;
  screenChunkIndex: number;
  pendingUploads: number;
  /** Byte progress (0-100) of the chunks uploading right now; 100 when idle. */
  chunkUploadProgress: number;
  /** This take's chunks so far (every track: camera, mic audio, screen). */
  takeChunks: TakeChunkCounts;
  /** Seconds left in the synced lead-in (3,2,1), or null when not counting down. */
  countdownValue: number | null;
  startRecording: (
    stream: MediaStream,
    screenStream?: MediaStream | null,
  ) => Promise<void>;
  stopRecording: () => Promise<void>;
  /** HOST/CO-HOST: pause or resume the take for everyone. */
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  /** Flush + complete this participant's own recording immediately (e.g. when
   *  they leave mid-recording). No-op if not currently recording. */
  finishLocalRecording: () => Promise<void>;
  setStream: (stream: MediaStream | null) => void;
  setScreenStream: (stream: MediaStream | null) => void;
  attachScreenStream: (stream: MediaStream) => Promise<void>;
  detachScreenStream: () => Promise<void>;
}

interface TakeChunkCounts {
  /** Chunks recorded so far in the current take. */
  total: number;
  /** Of those, uploaded and registered. */
  uploaded: number;
}

interface PendingChunk {
  blob: Blob;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  mimeType: string;
  sampleRate?: number;
  bitDepth?: number;
  channelCount?: number;
}

/** One local track's path to the server. Chunks are numbered locally from 0;
 *  `baseSequence`/`baseStartMs` continue a resumed track (a refreshed tab). */
interface TrackRoute {
  key: TrackKey;
  trackType: UploadTrack;
  sessionId: string;
  spaceRecordingSessionId: string;
  recordingId: string | null;
  baseSequence: number;
  baseStartMs: number;
  /** Chunks recorded before the row existed. */
  pending: PendingChunk[];
  /** Local chunks recorded so far (highest local sequence + 1). */
  localCount: number;
  ready: Promise<string | null>;
  abandoned: boolean;
  completed: boolean;
}

function generateRecordingSessionId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function liveTracks(stream: MediaStream | null | undefined): MediaStreamTrack[] {
  return (stream?.getTracks() ?? []).filter(
    (track) => track.readyState === "live",
  );
}

function startDataFromSession(session: RecordingSession): RecordingStartedData {
  return {
    sessionId: session.id,
    spaceRecordingSessionId: session.spaceRecordingSessionId,
    // The same formula the server broadcasts and replays, so every client
    // lands on one timeline.
    startedAt: new Date(session.startedAt).getTime() + COUNTDOWN_MS,
    countdownMs: COUNTDOWN_MS,
    videoResolution: session.videoResolution ?? 2160,
    targetFps: session.targetFps,
    audioSampleRate: session.audioSampleRate ?? 48000,
    noiseSuppression: session.noiseSuppression ?? false,
    autoGainControl: session.autoGainControl ?? false,
    echoCancellation: session.echoCancellation ?? false,
    recordingMode:
      session.recordingMode === "AUDIO_ONLY" ? "AUDIO_ONLY" : "VIDEO_AND_AUDIO",
    pausedMs: session.pausedMs ?? 0,
    pausedAt: session.pausedAt ? new Date(session.pausedAt).getTime() : null,
  };
}

/** Recorded (unpaused) time of a take at server instant `at`. */
function recordedMsAt(
  startedAt: number,
  pause: RecordingPauseData | null,
  at: number,
): number {
  let paused = pause?.pausedMs ?? 0;
  if (pause?.pausedAt != null && at > pause.pausedAt) {
    paused += Math.min(at, pause.resumedAt ?? at) - pause.pausedAt;
  }
  return Math.max(0, at - startedAt - paused);
}

/** Whether the take is paused at server instant `at`. */
function isPausedAt(pause: RecordingPauseData | null, at: number): boolean {
  return (
    pause?.pausedAt != null &&
    at >= pause.pausedAt &&
    (pause.resumedAt == null || at < pause.resumedAt)
  );
}

export default function useRecordingManager(
  options: UseRecordingManagerOptions,
): UseRecordingManagerReturn {
  const {
    spaceId,
    participantSessionId,
    isHost,
    cloudBackup,
    getLiveStream,
    cameraEnabled,
    micEnabled,
    recordingEchoCancellation,
  } = options;

  // Kept in refs so async flows (which outlive renders) always read the
  // freshest values.
  const getLiveStreamRef = useRef(getLiveStream);
  getLiveStreamRef.current = getLiveStream;
  const cameraEnabledRef = useRef(cameraEnabled);
  cameraEnabledRef.current = cameraEnabled;
  const micEnabledRef = useRef(micEnabled ?? true);
  micEnabledRef.current = micEnabled ?? true;
  const recordingEchoCancellationRef = useRef(
    recordingEchoCancellation ?? false,
  );
  recordingEchoCancellationRef.current = recordingEchoCancellation ?? false;
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const participantSessionIdRef = useRef(participantSessionId);
  participantSessionIdRef.current = participantSessionId;

  const socket = useSocket();
  // Server-time helper. All recording timestamps below run through this so every
  // participant is measured on the server's clock, not their own laptop's.
  const { getServerTime, waitUntilSynced } = useClockSync();
  const getServerTimeRef = useRef(getServerTime);
  getServerTimeRef.current = getServerTime;
  const waitUntilSyncedRef = useRef(waitUntilSynced);
  waitUntilSyncedRef.current = waitUntilSynced;

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stopRequestFailed, setStopRequestFailed] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spaceRecordingSessionId, setSpaceRecordingSessionId] = useState<
    string | null
  >(null);
  const [combinedRecordingId, setCombinedRecordingId] = useState<string | null>(
    null,
  );
  const [screenRecordingId, setScreenRecordingId] = useState<string | null>(
    null,
  );
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isPauseRequestPending, setIsPauseRequestPending] = useState(false);
  // What the host just clicked, shown until the recorders actually flip (the
  // server's lead time) - so the button and timer react on click.
  const [optimisticPaused, setOptimisticPaused] = useState<boolean | null>(
    null,
  );
  const optimisticPausedRef = useRef<boolean | null>(null);
  optimisticPausedRef.current = optimisticPaused;

  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const sessionClockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const startRequestInFlightRef = useRef(false);
  const stopRequestInFlightRef = useRef(false);
  const screenAttachInFlightRef = useRef(false);

  /** The session we're counting down to / recording / stopping. */
  const activeSessionRef = useRef<string | null>(null);
  /** The session this tab is actually capturing for (set once capture begins). */
  const capturingSessionRef = useRef<string | null>(null);
  /** Sessions already stopped here - a stale broadcast or poll never restarts them. */
  const finishedSessionsRef = useRef<Set<string>>(new Set());
  const stoppingSessionRef = useRef<string | null>(null);
  const isCountingDownRef = useRef(false);
  const beginningRef = useRef(false);
  const startDataRef = useRef<RecordingStartedData | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  /** Server-time lateness of this tab's start, shared by its camera and PCM rows. */
  const startOffsetMsRef = useRef(0);
  /** performance.now() at this tab's start - every chunk time is relative to it. */
  const timeOriginRef = useRef(0);
  /** The take's pause state, as broadcast by the server. */
  const pauseStateRef = useRef<RecordingPauseData | null>(null);
  /** The recording clock's link to server time, fixed at this tab's start
   *  (performance.now() is monotonic; the synced server clock may step). */
  const perfToServerRef = useRef(0);
  /** Recorders are paused here (follows the server, a timer's jitter late). */
  const pausedLocallyRef = useRef(false);
  /** A pause or resume landed late here, so the recorder's footage no longer
   *  lines up with the clock - resume on a fresh recorder part. */
  const rotateOnResumeRef = useRef(false);
  const pauseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pauseRequestInFlightRef = useRef(false);
  // Assigned in the pause section below; reached through a ref by flows
  // defined earlier.
  const applyPauseStateRef = useRef<(state: RecordingPauseData) => void>(
    () => undefined,
  );
  const routesRef = useRef<Map<TrackKey, TrackRoute>>(new Map());
  const screenKeyRef = useRef<TrackKey | null>(null);
  const screenMaxSizesRef = useRef<
    Map<TrackKey, { width: number; height: number }>
  >(new Map());
  const pcmSourceTrackIdRef = useRef<string | null>(null);
  const pcmStartingRef = useRef(false);
  // Stands in for the camera while it's off; lives for one take.
  const blackVideoRef = useRef<BlackVideoSource | null>(null);
  const sourceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const releaseRecorderLockRef = useRef<(() => void) | null>(null);
  // Assigned once handleRecordingStopped exists (below); reached through a ref
  // by flows that are defined earlier or outlive a render.
  const handleRecordingStoppedRef = useRef<
    (stoppedSessionId?: string | null) => Promise<void>
  >(async () => undefined);
  /** Resolves once the session being stopped has released its recorders. */
  const captureStoppedRef = useRef<Promise<void> | null>(null);
  /** The last stop's completion reports (awaited briefly on leave). */
  const completionsRef = useRef<Promise<unknown> | null>(null);
  const pcmStartFailuresRef = useRef(0);
  const unavailableNotifiedRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);

  const startSessionMutation = useStartRecordingSession();
  const stopSessionMutation = useStopRecordingSession(sessionId || "");
  const activeRecordingQuery = useGetActiveRecordingSession(
    spaceId,
    participantSessionId,
    !!spaceId,
  );

  // Chunk counts for the take being captured. Only chunks this tab recorded
  // count as uploaded - a resumed track's older chunks (another tab's) don't.
  const takeChunksRef = useRef({
    sessionId: null as string | null,
    total: 0,
    routedKeys: new Set<string>(),
    uploadedKeys: new Set<string>(),
  });
  const [takeChunks, setTakeChunks] = useState<TakeChunkCounts>({
    total: 0,
    uploaded: 0,
  });
  const publishTakeChunks = useCallback(() => {
    const take = takeChunksRef.current;
    setTakeChunks({ total: take.total, uploaded: take.uploadedKeys.size });
  }, []);
  const onChunkUploaded = useCallback(
    (info: { participantRecordingId: string; sequenceNumber: number }) => {
      const key = `${info.participantRecordingId}:${info.sequenceNumber}`;
      const take = takeChunksRef.current;
      if (!take.routedKeys.has(key) || take.uploadedKeys.has(key)) return;
      take.uploadedKeys.add(key);
      publishTakeChunks();
    },
    [publishTakeChunks],
  );

  const uploader = useChunkUploader(onChunkUploaded, undefined, {
    concurrency: UPLOAD_CONCURRENCY_DRAINING,
  });
  const uploaderRef = useRef(uploader);
  uploaderRef.current = uploader;

  // Drain any chunks left over from a previous crashed session on mount.
  // Ref-gated: the uploader object's identity changes with its state.
  const resumedOrphansRef = useRef(false);
  useEffect(() => {
    if (resumedOrphansRef.current) return;
    resumedOrphansRef.current = true;
    void uploader.resumeOrphans();
  }, [uploader]);

  const clearCountdown = useCallback(() => {
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdownValue(null);
  }, []);

  const clearPauseTimers = useCallback(() => {
    for (const timer of pauseTimersRef.current) clearTimeout(timer);
    pauseTimersRef.current = [];
  }, []);

  const stopSessionClock = useCallback(() => {
    if (sessionClockIntervalRef.current) {
      clearInterval(sessionClockIntervalRef.current);
      sessionClockIntervalRef.current = null;
    }
  }, []);

  /** Every recorder's clock: performance.now() that stands still across the
   *  take's pauses - by the server's instants, so it agrees for everyone. */
  const recordingNow = useCallback(() => {
    const data = startDataRef.current;
    if (!data) return performance.now();
    const recorded = recordedMsAt(
      data.startedAt,
      pauseStateRef.current,
      performance.now() + perfToServerRef.current,
    );
    return timeOriginRef.current + recorded - startOffsetMsRef.current;
  }, []);

  const startSessionClock = useCallback(
    (startedAt: number) => {
      // Recorded time, so the timer holds still while paused.
      const updateElapsed = () => {
        // Paused on click, before the server's pause instant arrives.
        if (optimisticPausedRef.current === true) return;
        setSessionElapsedMs(
          recordedMsAt(
            startedAt,
            pauseStateRef.current,
            getServerTimeRef.current(),
          ),
        );
      };
      stopSessionClock();
      updateElapsed();
      sessionClockIntervalRef.current = setInterval(updateElapsed, 500);
    },
    [stopSessionClock],
  );

  // ── Track routing ─────────────────────────────────────────────────────

  const enqueueRouted = useCallback(
    (route: TrackRoute, chunk: PendingChunk) => {
      if (!route.recordingId) return;
      const take = takeChunksRef.current;
      if (route.sessionId === take.sessionId) {
        take.routedKeys.add(
          `${route.recordingId}:${route.baseSequence + chunk.sequenceNumber}`,
        );
      }
      void uploaderRef.current.enqueue({
        spaceId: spaceIdRef.current,
        spaceRecordingSessionId: route.spaceRecordingSessionId,
        recordingSessionId: route.sessionId,
        participantRecordingId: route.recordingId,
        participantSessionId: participantSessionIdRef.current,
        trackType: route.trackType,
        sequenceNumber: route.baseSequence + chunk.sequenceNumber,
        startMs: route.baseStartMs + chunk.startMs,
        durationMs: chunk.durationMs,
        mimeType: chunk.mimeType,
        blob: chunk.blob,
        // Only populated for "pcm" - the WAV-header fields the server needs.
        sampleRate: chunk.sampleRate,
        bitDepth: chunk.bitDepth,
        channelCount: chunk.channelCount,
      });
    },
    [],
  );

  /**
   * Register a track's row - retrying through network trouble - and flush the
   * chunks it recorded meanwhile. Camera/PCM rows are resumable: a refreshed
   * tab gets the same row back and continues its sequence past anything the
   * old tab uploaded or still has buffered.
   */
  const registerRoute = useCallback(
    async (
      route: TrackRoute,
      payload: CreateParticipantRecordingPayload,
    ): Promise<string | null> => {
      const startedAt = Date.now();
      let forbidden = 0;
      for (let attempt = 0; ; attempt++) {
        if (route.abandoned) return null;
        try {
          const { data } = await api.post<CreateParticipantRecordingResponse>(
            "/recording/participant",
            payload,
          );
          const created = data.data;
          let baseSequence = 0;
          let baseStartMs = 0;
          if (created.resume) {
            const buffered = await getMaxBufferedSequence(created.id).catch(
              () => -1,
            );
            baseSequence = Math.max(
              created.resume.nextSequenceNumber,
              buffered + 1,
            );
            if (
              created.resume.startOffsetMs !== null &&
              payload.startOffsetMs !== undefined
            ) {
              baseStartMs = payload.startOffsetMs - created.resume.startOffsetMs;
            }
          }
          route.recordingId = created.id;
          route.baseSequence = baseSequence;
          route.baseStartMs = baseStartMs;
          const pending = route.pending;
          route.pending = [];
          for (const chunk of pending) enqueueRouted(route, chunk);
          if (route.key === "combined") setCombinedRecordingId(created.id);
          if (route.key.startsWith("screen:")) setScreenRecordingId(created.id);
          return created.id;
        } catch (err) {
          const status = isAxiosError(err) ? err.response?.status : undefined;
          // The session is gone / over, or the request is invalid: retrying
          // can't help.
          const terminal = status === 400 || status === 404;
          if (status === 403) forbidden += 1;
          if (
            terminal ||
            forbidden >= 5 ||
            Date.now() - startedAt > CREATE_GIVE_UP_AFTER_MS
          ) {
            console.error(
              `[RecordingManager] giving up registering ${route.key} (its chunks are lost):`,
              err,
            );
            route.abandoned = true;
            route.pending = [];
            return null;
          }
          console.warn(
            `[RecordingManager] registering ${route.key} failed (attempt ${attempt + 1}), retrying:`,
            err,
          );
          await delay(
            CREATE_RETRY_DELAYS_MS[
              Math.min(attempt, CREATE_RETRY_DELAYS_MS.length - 1)
            ] ?? 15000,
          );
        }
      }
    },
    [enqueueRouted],
  );

  const ensureRoute = useCallback(
    (
      key: TrackKey,
      trackType: UploadTrack,
      buildPayload: () => CreateParticipantRecordingPayload,
    ): TrackRoute | null => {
      const existing = routesRef.current.get(key);
      if (existing) return existing;
      const data = startDataRef.current;
      const sessionForRoute = capturingSessionRef.current;
      if (!data || !sessionForRoute || data.sessionId !== sessionForRoute) {
        return null;
      }
      const route: TrackRoute = {
        key,
        trackType,
        sessionId: data.sessionId,
        spaceRecordingSessionId: data.spaceRecordingSessionId,
        recordingId: null,
        baseSequence: 0,
        baseStartMs: 0,
        pending: [],
        localCount: 0,
        ready: Promise.resolve(null),
        abandoned: false,
        completed: false,
      };
      routesRef.current.set(key, route);
      route.ready = registerRoute(route, buildPayload());
      return route;
    },
    [registerRoute],
  );

  const routeChunk = useCallback(
    (key: TrackKey, chunk: PendingChunk) => {
      const route = routesRef.current.get(key);
      if (!route) {
        console.error(`[RecordingManager] chunk for unregistered track ${key}`);
        return;
      }
      route.localCount = Math.max(route.localCount, chunk.sequenceNumber + 1);
      if (route.abandoned) return;
      if (route.sessionId === takeChunksRef.current.sessionId) {
        takeChunksRef.current.total += 1;
        publishTakeChunks();
      }
      if (route.recordingId) enqueueRouted(route, chunk);
      else route.pending.push(chunk);
    },
    [enqueueRouted, publishTakeChunks],
  );

  /** Report how many chunks a track recorded. Retries; never blocks on uploads. */
  const completeRoute = useCallback(
    async (
      route: TrackRoute,
      recordedCount: number,
      size?: { width: number; height: number },
    ) => {
      if (route.completed) return;
      route.completed = true;
      const recordingId = route.recordingId ?? (await route.ready);
      if (!recordingId) return;
      const expectedSegments =
        route.baseSequence + Math.max(recordedCount, route.localCount);
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          await api.post(`/recording/participant/${recordingId}/complete`, {
            expectedSegments,
            participantSessionId: participantSessionIdRef.current,
            spaceId: spaceIdRef.current,
            ...(size ? { width: size.width, height: size.height } : {}),
          });
          return;
        } catch (err) {
          const status = isAxiosError(err) ? err.response?.status : undefined;
          if (status && status >= 400 && status < 500 && status !== 429) {
            console.error(
              `[RecordingManager] completing ${route.key} was rejected:`,
              err,
            );
            return;
          }
          // The server's recovery sweep completes it anyway if this never
          // lands - retrying just makes it immediate.
          await delay(1000 * 2 ** attempt);
        }
      }
    },
    [],
  );

  // ── Local capture ────────────────────────────────────────────────────

  const pcmCapture = usePcmCapture({
    onPcmChunk: (blob, meta: PcmChunkMeta) => {
      routeChunk("pcm", {
        blob,
        sequenceNumber: meta.sequenceNumber,
        startMs: meta.startMs,
        durationMs: meta.durationMs,
        mimeType: "audio/pcm-raw",
        sampleRate: meta.sampleRate,
        bitDepth: meta.bitDepth,
        channelCount: meta.channelCount,
      });
    },
    onError: (err) => {
      console.error("[RecordingManager] PCM capture error:", err);
    },
  });
  const pcmRef = useRef(pcmCapture);
  pcmRef.current = pcmCapture;

  const localRecording = useLocalRecording({
    onCombinedChunkReady: (chunk: LocalChunk) =>
      routeChunk("combined", chunk),
    onScreenChunkReady: (shareId, chunk) =>
      routeChunk(`screen:${shareId}`, chunk),
    onCombinedPartStart: (metadata: RecordingMetadata) => {
      // First part creates (or resumes) the camera track's row. Every later
      // part continues the same row.
      ensureRoute("combined", "combined", () => ({
        recordingSessionId: startDataRef.current?.sessionId ?? "",
        spaceId: spaceIdRef.current,
        participantSessionId: participantSessionIdRef.current,
        type: "VIDEO",
        container: metadata.container,
        codec: metadata.codec,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        bitrate: metadata.bitrate,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        // It's the camera track even while the camera is off - the finalizer
        // records what was actually captured.
        hasAudio: true,
        hasVideo: true,
        startOffsetMs: startOffsetMsRef.current,
        resumable: true,
      }));
    },
    onCombinedTrackEnded: () => scheduleSourceSyncRef.current(0),
    onCombinedUnavailable: (err) => {
      if (unavailableNotifiedRef.current) return;
      unavailableNotifiedRef.current = true;
      setError(`Your camera recording couldn't start: ${err.message}`);
      toast.error(
        "Your camera recording couldn't start. Your audio is still being recorded.",
        8000,
      );
    },
    onScreenError: (shareId, err) => {
      console.error(`[RecordingManager] screen share ${shareId} recorder failed:`, err);
    },
  });
  const localRef = useRef(localRecording);
  localRef.current = localRecording;

  const readLiveStream = useCallback(
    (): MediaStream | null => getLiveStreamRef.current?.() ?? streamRef.current,
    [],
  );

  const startPcm = useCallback(
    async (mic: MediaStreamTrack) => {
      const data = startDataRef.current;
      if (!data || pcmStartingRef.current || pcmRef.current.isRunning()) return;
      // A mic capture that keeps failing (permission, device busy) isn't
      // retried on every track change.
      if (pcmStartFailuresRef.current >= 3) return;
      pcmStartingRef.current = true;
      try {
        // Register first so its chunks can route the moment they exist.
        const route = ensureRoute("pcm", "pcm", () => ({
          recordingSessionId: data.sessionId,
          spaceId: spaceIdRef.current,
          participantSessionId: participantSessionIdRef.current,
          type: "AUDIO",
          // Marks this as the raw-PCM track so finalization wraps it in a WAV.
          container: "pcm",
          codec: "pcm_s24le",
          sampleRate: data.audioSampleRate,
          channels: 1,
          hasAudio: true,
          hasVideo: false,
          startOffsetMs: startOffsetMsRef.current,
          resumable: true,
        }));
        if (!route) return;
        pcmSourceTrackIdRef.current = mic.id;
        await pcmRef.current.start({
          audioId: mic.getSettings().deviceId,
          callTrack: mic,
          sampleRate: data.audioSampleRate === 44100 ? 44100 : 48000,
          noiseSuppression: data.noiseSuppression,
          autoGainControl: data.autoGainControl,
          echoCancellation: recordingEchoCancellationRef.current,
          timeOrigin: timeOriginRef.current,
          clock: recordingNow,
          paused: pausedLocallyRef.current,
          muted: !micEnabledRef.current,
        });
        if (!pcmRef.current.isRunning()) pcmStartFailuresRef.current += 1;
        // Paused while the capture was opening.
        pcmRef.current.setPaused(pausedLocallyRef.current);
      } finally {
        pcmStartingRef.current = false;
      }
    },
    [ensureRoute, recordingNow],
  );

  /** The camera track's recorder tracks: the live ones, with black video in
   *  place of the camera while it's off (mic off too: black on its own). */
  const combinedTracksFor = useCallback(
    (live: MediaStreamTrack[]): MediaStreamTrack[] => {
      if (live.some((track) => track.kind === "video")) return live;
      blackVideoRef.current ??= createBlackVideoTrack();
      const black = blackVideoRef.current?.track;
      return black ? [black, ...live] : live;
    },
    [],
  );

  const releaseBlackVideo = useCallback(() => {
    blackVideoRef.current?.stop();
    blackVideoRef.current = null;
  }, []);

  /** Point every recorder at the participant's current tracks. */
  const syncSources = useCallback(() => {
    const sessionForSync = capturingSessionRef.current;
    const data = startDataRef.current;
    if (!sessionForSync || !data || data.sessionId !== sessionForSync) return;
    const stream = readLiveStream();
    const live = liveTracks(stream);

    if (data.recordingMode !== "AUDIO_ONLY") {
      const tracks = combinedTracksFor(live);
      void localRef.current.setCombinedStream(
        tracks.length > 0 ? new MediaStream(tracks) : null,
      );
    }

    // The lossless PCM track follows the call's mic.
    const mic = live.find((track) => track.kind === "audio");
    if (!mic) return;
    if (!pcmRef.current.isRunning()) {
      void startPcm(mic);
    } else if (pcmSourceTrackIdRef.current !== mic.id) {
      pcmSourceTrackIdRef.current = mic.id;
      void pcmRef.current.switchDevice({
        audioId: mic.getSettings().deviceId,
        callTrack: mic,
      });
    }
    if (data.recordingMode === "AUDIO_ONLY") setError(null);
  }, [readLiveStream, combinedTracksFor, startPcm]);

  const scheduleSourceSyncRef = useRef<(delayMs?: number) => void>(
    () => undefined,
  );
  scheduleSourceSyncRef.current = (delayMs = SOURCE_SYNC_DEBOUNCE_MS) => {
    if (sourceSyncTimerRef.current) clearTimeout(sourceSyncTimerRef.current);
    sourceSyncTimerRef.current = setTimeout(() => {
      sourceSyncTimerRef.current = null;
      syncSources();
    }, delayMs);
  };

  // Mirror the call mic's mute onto the PCM track (its own capture would
  // otherwise keep recording a muted participant).
  useEffect(() => {
    pcmRef.current.setMuted(!(micEnabled ?? true));
  }, [micEnabled]);

  const setStream = useCallback((stream: MediaStream | null) => {
    streamRef.current = stream;
    if (capturingSessionRef.current) scheduleSourceSyncRef.current();
  }, []);

  const setScreenStream = useCallback((stream: MediaStream | null) => {
    screenStreamRef.current = stream;
  }, []);

  // LiveKit stops a muted camera's track with track.stop(), which fires no
  // "ended" event, and a background-effect swap may not re-render the
  // provider. Compare the recorders' tracks with the live ones every second so
  // a change is never missed.
  useEffect(() => {
    if (recordingState !== "recording") return;
    const interval = setInterval(() => {
      const data = startDataRef.current;
      if (!capturingSessionRef.current || !data) return;
      if (sourceSyncTimerRef.current) return; // a sync is already scheduled
      const live = liveTracks(readLiveStream());
      const mic = live.find((track) => track.kind === "audio");
      let cameraDrift = false;
      if (data.recordingMode !== "AUDIO_ONLY") {
        const expectedIds = combinedTracksFor(live)
          .map((track) => track.id)
          .sort()
          .join(",");
        const recordingIds = [...localRef.current.getCombinedTrackIds()]
          .sort()
          .join(",");
        cameraDrift = expectedIds !== recordingIds;
      }
      const micDrift =
        !!mic &&
        (!pcmRef.current.isRunning() || pcmSourceTrackIdRef.current !== mic.id);
      if (cameraDrift || micDrift) scheduleSourceSyncRef.current(0);
    }, 1000);
    return () => clearInterval(interval);
  }, [recordingState, readLiveStream, combinedTracksFor]);

  /** Only one tab records a participant: a newer tab (same participant)
   *  takes over, and this one stops and completes what it captured. */
  const acquireRecorderLock = useCallback((sessionForLock: string) => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return;
    releaseRecorderLockRef.current?.();
    void locks
      .request(
        `openside-recorder:${participantSessionIdRef.current}`,
        { steal: true },
        () =>
          new Promise<void>((resolve) => {
            releaseRecorderLockRef.current = resolve;
          }),
      )
      .catch((err: unknown) => {
        if (
          err instanceof DOMException &&
          err.name === "AbortError" &&
          capturingSessionRef.current === sessionForLock
        ) {
          toast.error(
            "This recording continued in another tab - this tab stopped recording.",
            8000,
          );
          void handleRecordingStoppedRef.current(sessionForLock);
        }
      });
  }, []);

  const releaseRecorderLock = useCallback(() => {
    releaseRecorderLockRef.current?.();
    releaseRecorderLockRef.current = null;
  }, []);

  // ── Start ─────────────────────────────────────────────────────────────

  // The actual recorder start - fires for EVERY participant when the synced
  // countdown reaches zero.
  const beginRecording = useCallback(
    async (data: RecordingStartedData) => {
      if (beginningRef.current) return;
      beginningRef.current = true;
      try {
        // A previous take still releasing its recorders (we missed its stop).
        if (captureStoppedRef.current) await captureStoppedRef.current;
        if (capturingSessionRef.current) return;
        clearCountdown();
        isCountingDownRef.current = false;
        startSessionClock(data.startedAt);

        const audioOnly = data.recordingMode === "AUDIO_ONLY";
        // Camera on but its track hasn't attached yet (a late joiner): wait
        // briefly so the first part has video.
        if (!audioOnly && cameraEnabledRef.current) {
          const deadline = Date.now() + VIDEO_ATTACH_GRACE_MS;
          while (
            Date.now() < deadline &&
            !liveTracks(readLiveStream()).some((track) => track.kind === "video")
          ) {
            await delay(250);
          }
        }

        // The session may have been stopped while we waited.
        if (activeSessionRef.current !== data.sessionId) return;

        // Make sure the clock is synced before we trust it. Bounded so it can
        // never block the recorder.
        await waitUntilSyncedRef.current(1500);
        if (activeSessionRef.current !== data.sessionId) return;

        // "How late am I" on the take's recorded time, measured at the go
        // instant - ~0 for on-time participants, the real gap for a late
        // joiner (pauses before they joined left out, like everyone's).
        const serverNow = getServerTimeRef.current();
        startOffsetMsRef.current = recordedMsAt(
          data.startedAt,
          pauseStateRef.current,
          serverNow,
        );
        timeOriginRef.current = performance.now();
        perfToServerRef.current = serverNow - timeOriginRef.current;
        // Joined mid-pause: the recorders start paused.
        const startPaused = isPausedAt(pauseStateRef.current, serverNow);
        pausedLocallyRef.current = startPaused;
        rotateOnResumeRef.current = false;
        setIsPaused(startPaused);
        routesRef.current = new Map();
        takeChunksRef.current = {
          sessionId: data.sessionId,
          total: 0,
          routedKeys: new Set(),
          uploadedKeys: new Set(),
        };
        publishTakeChunks();
        screenKeyRef.current = null;
        screenMaxSizesRef.current.clear();
        unavailableNotifiedRef.current = false;
        pcmStartFailuresRef.current = 0;
        pcmSourceTrackIdRef.current = null;
        capturingSessionRef.current = data.sessionId;
        acquireRecorderLock(data.sessionId);
        uploaderRef.current.setConcurrency(UPLOAD_CONCURRENCY_RECORDING);
        setError(null);
        setStopRequestFailed(false);
        setRecordingState("recording");

        if (!audioOnly) {
          localRef.current.startRecording(timeOriginRef.current, {
            videoResolution: data.videoResolution,
            targetFps: data.targetFps,
            clock: recordingNow,
            paused: startPaused,
          });
        }
        // Follow any pause or resume still ahead.
        if (pauseStateRef.current) {
          applyPauseStateRef.current(pauseStateRef.current);
        }

        // Starts the camera part and the PCM track from whatever tracks exist
        // now; tracks that appear later (mic/camera turned on) are picked up
        // by the same sync as they land.
        syncSources();

        const hasMic = liveTracks(readLiveStream()).some(
          (track) => track.kind === "audio",
        );
        if (audioOnly && !hasMic) {
          setError("Recording is active. Turn on your microphone to be captured.");
        }
      } catch (err) {
        console.error("[RecordingManager] start failed:", err);
        setError(err instanceof Error ? err.message : "Failed to start recording");
      } finally {
        beginningRef.current = false;
      }
    },
    [
      clearCountdown,
      startSessionClock,
      readLiveStream,
      acquireRecorderLock,
      syncSources,
      publishTakeChunks,
      recordingNow,
    ],
  );

  // Handle "recording-started" (fires for EVERY participant). Every client
  // runs the same 3-2-1 lead-in so capture begins in sync for everyone.
  const handleRecordingStarted = useCallback(
    (data: RecordingStartedData) => {
      // Duplicate broadcast for a session we're already handling, or a stale
      // replay of one we finished.
      if (activeSessionRef.current === data.sessionId) return;
      if (finishedSessionsRef.current.has(data.sessionId)) return;

      // A new session while an old one is still capturing means we missed its
      // stop - stop it first (it completes what it captured).
      const previous = capturingSessionRef.current;
      if (previous && previous !== data.sessionId) {
        void handleRecordingStoppedRef.current(previous);
      }

      // The countdown ends at the broadcast instant and the chime plays then;
      // capture starts once it's over, so no one's mic records it. Every
      // client shifts by the same amount, so the take stays in sync.
      const chimeAt = data.startedAt;
      const take = { ...data, startedAt: data.startedAt + START_CHIME_MS };

      setSessionId(take.sessionId);
      setSpaceRecordingSessionId(take.spaceRecordingSessionId);
      setCombinedRecordingId(null);
      setScreenRecordingId(null);
      startDataRef.current = take;
      sessionStartedAtRef.current = take.startedAt;
      activeSessionRef.current = take.sessionId;
      pauseStateRef.current = {
        sessionId: take.sessionId,
        pausedMs: take.pausedMs ?? 0,
        pausedAt: take.pausedAt ?? null,
        resumedAt: null,
      };

      const countdownMs = take.countdownMs ?? COUNTDOWN_MS;
      clearCountdown();
      setError(null);

      const serverNow = getServerTimeRef.current();
      const delayMs =
        take.startedAt > serverNow
          ? Math.min(countdownMs + START_CHIME_MS, take.startedAt - serverNow)
          : 0;

      if (delayMs <= 0) {
        void beginRecording(take);
        return;
      }

      isCountingDownRef.current = true;
      setRecordingState("countdown");

      // Joined mid-chime: no countdown or chime left, just wait out the rest.
      const countdownLeftMs = Math.min(countdownMs, chimeAt - serverNow);
      if (countdownLeftMs <= 0) {
        countdownTimeoutRef.current = setTimeout(() => {
          void beginRecording(take);
        }, delayMs);
        return;
      }

      setCountdownValue(Math.max(1, Math.ceil(countdownLeftMs / 1000)));

      // Visual tick: 3 → 2 → 1, adjusted for late socket replays.
      countdownIntervalRef.current = setInterval(() => {
        const remainingMs = chimeAt - getServerTimeRef.current();
        if (remainingMs <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return;
        }
        setCountdownValue(Math.max(1, Math.ceil(remainingMs / 1000)));
      }, 250);

      // At zero: clear the countdown, chime, and start everyone's recorder
      // together once the chime is over.
      countdownTimeoutRef.current = setTimeout(() => {
        setCountdownValue(null);
        playCallSound("recordingStart");
        countdownTimeoutRef.current = setTimeout(
          () => void beginRecording(take),
          Math.max(0, take.startedAt - getServerTimeRef.current()),
        );
      }, countdownLeftMs);
    },
    [beginRecording, clearCountdown],
  );

  // ── Stop ──────────────────────────────────────────────────────────────

  /**
   * Stop capturing for `stoppedSessionId` (or the current session), report
   * every track's recorded chunk count, and keep uploading in the background.
   * Resolves once capture has stopped and completion is reported - NOT when
   * the uploads finish.
   */
  const handleRecordingStopped = useCallback(
    async (stoppedSessionId?: string | null) => {
      const current = activeSessionRef.current ?? capturingSessionRef.current;
      const target = stoppedSessionId ?? current;
      if (!target) return;
      // A stale stop (an earlier session's) must not end the current take.
      if (stoppedSessionId && current && stoppedSessionId !== current) {
        if (capturingSessionRef.current !== stoppedSessionId) return;
      }
      if (stoppingSessionRef.current === target) return;
      finishedSessionsRef.current.add(target);
      // Not a session this tab is counting down to or capturing - nothing to do.
      if (
        activeSessionRef.current !== target &&
        capturingSessionRef.current !== target
      ) {
        return;
      }

      // Stopped during the lead-in (before capture began): just cancel.
      if (isCountingDownRef.current && activeSessionRef.current === target) {
        isCountingDownRef.current = false;
        activeSessionRef.current = null;
        stopSessionClock();
        clearCountdown();
        setRecordingState("complete");
        return;
      }

      if (capturingSessionRef.current !== target) {
        // Never got to capture (start still settling, or failed): cancel it.
        if (activeSessionRef.current === target) activeSessionRef.current = null;
        stopSessionClock();
        clearCountdown();
        setError(null);
        setRecordingState("complete");
        return;
      }

      stoppingSessionRef.current = target;
      clearPauseTimers();
      setIsPaused(false);
      setOptimisticPaused(null);
      // A newer take may already be counting down (we missed this one's stop):
      // never overwrite its UI state from here.
      const ownsUi = () =>
        !activeSessionRef.current || activeSessionRef.current === target;
      let markCaptureStopped: () => void = () => undefined;
      captureStoppedRef.current = new Promise<void>((resolve) => {
        markCaptureStopped = resolve;
      });
      try {
        // Freeze the elapsed timer the instant we start stopping.
        if (ownsUi()) {
          stopSessionClock();
          setRecordingState("stopping");
        }
        if (sourceSyncTimerRef.current) {
          clearTimeout(sourceSyncTimerRef.current);
          sourceSyncTimerRef.current = null;
        }

        const { combinedChunks, screen } = await localRef.current.stopRecording();
        releaseBlackVideo();
        // stop() flushes the final partial PCM chunk before closing.
        await pcmRef.current.stop();
        const pcmChunks = pcmRef.current.getChunkCount();
        // This take's routes - read before a newer take can replace them.
        const routes = routesRef.current;
        capturingSessionRef.current = null;
        if (activeSessionRef.current === target) activeSessionRef.current = null;
        releaseRecorderLock();
        markCaptureStopped();

        // Report what each track RECORDED, right away. The server completes a
        // track when its last chunk lands, however long the upload takes.
        const completions: Promise<void>[] = [];
        const combinedRoute = routes.get("combined");
        if (combinedRoute) {
          completions.push(completeRoute(combinedRoute, combinedChunks));
        }
        const pcmRoute = routes.get("pcm");
        if (pcmRoute) completions.push(completeRoute(pcmRoute, pcmChunks));
        for (const route of routes.values()) {
          if (!route.key.startsWith("screen:") || route.completed) continue;
          const count =
            screen && `screen:${screen.shareId}` === route.key
              ? screen.chunkCount
              : route.localCount;
          completions.push(
            completeRoute(route, count, screenMaxSizesRef.current.get(route.key)),
          );
        }
        screenKeyRef.current = null;

        if (ownsUi()) {
          uploaderRef.current.setConcurrency(UPLOAD_CONCURRENCY_DRAINING);
          setRecordingState("uploading");
        }
        // Not awaited: a track whose registration is still retrying would hold
        // the stop up. They land on their own.
        completionsRef.current = Promise.allSettled(completions);

        // Uploads finish in the background; the UI shows progress meanwhile.
        void uploaderRef.current
          .waitUntilDrained(Number.POSITIVE_INFINITY)
          .then(() => {
            if (stoppingSessionRef.current === target) {
              stoppingSessionRef.current = null;
            }
            // A newer take may already be running - don't clobber its state.
            if (!activeSessionRef.current && !capturingSessionRef.current) {
              setRecordingState("complete");
            }
          });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to stop recording";
        console.error("[RecordingManager] stop failed:", err);
        if (ownsUi()) {
          setError(message);
          setRecordingState("error");
        }
        if (stoppingSessionRef.current === target) {
          stoppingSessionRef.current = null;
        }
      } finally {
        markCaptureStopped();
        captureStoppedRef.current = null;
      }
    },
    [
      clearCountdown,
      clearPauseTimers,
      completeRoute,
      releaseRecorderLock,
      releaseBlackVideo,
      stopSessionClock,
    ],
  );
  handleRecordingStoppedRef.current = handleRecordingStopped;

  // HOST: Start recording
  const startRecording = useCallback(
    async (stream: MediaStream, screenStream?: MediaStream | null) => {
      if (
        !isHost ||
        startRequestInFlightRef.current ||
        stopRequestInFlightRef.current ||
        stopRequestFailed
      ) {
        return;
      }

      startRequestInFlightRef.current = true;
      try {
        setRecordingState("starting");
        setError(null);
        setStopRequestFailed(false);

        const session = await startSessionMutation.mutateAsync({
          spaceId,
          spaceRecordingSessionId: generateRecordingSessionId(),
          participantSessionId,
          cloudBackup: cloudBackup === true,
        });

        streamRef.current = stream;
        screenStreamRef.current = screenStream ?? null;

        // The server already broadcast the start to the room. Start here too,
        // from the response - a host whose socket is down still records (the
        // broadcast arriving later is deduped).
        await waitUntilSyncedRef.current(1500);
        handleRecordingStarted(startDataFromSession(session));
      } catch (err) {
        // Out of metered recording credit - surface the upgrade CTA instead of
        // a generic failure. The server is the authority on remaining minutes.
        if (
          isAxiosError(err) &&
          err.response?.status === 402 &&
          err.response.data?.data?.code === "USAGE_EXHAUSTED"
        ) {
          toast.error(
            "You're out of recording credit. Upgrade to Pro for 20 hours every month.",
            8000,
          );
          setError("Recording credit used up - upgrade to keep recording.");
          setRecordingState("idle");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to start");
        setRecordingState("error");
        throw err;
      } finally {
        startRequestInFlightRef.current = false;
      }
    },
    [
      isHost,
      spaceId,
      participantSessionId,
      stopRequestFailed,
      startSessionMutation,
      cloudBackup,
      handleRecordingStarted,
    ],
  );

  // HOST: Stop recording
  const stopRecording = useCallback(async () => {
    if (!isHost || !sessionId || stopRequestInFlightRef.current) return;

    stopRequestInFlightRef.current = true;
    const stoppingSession = sessionId;
    try {
      setRecordingState("stopping");
      // Freeze the timer on click, not when the server answers.
      stopSessionClock();
      // The server stops the session and broadcasts the stop to everyone.
      await stopSessionMutation.mutateAsync({ spaceId, participantSessionId });
      setStopRequestFailed(false);
      // Stop here right away too (the broadcast echo is deduped).
      await handleRecordingStopped(stoppingSession);
    } catch (err) {
      // Nothing stopped - the take is still running everywhere. Say so and let
      // the host retry.
      setError(err instanceof Error ? err.message : "Failed to stop");
      setStopRequestFailed(true);
      setRecordingState(capturingSessionRef.current ? "recording" : "error");
      if (capturingSessionRef.current && sessionStartedAtRef.current) {
        startSessionClock(sessionStartedAtRef.current);
      }
    } finally {
      stopRequestInFlightRef.current = false;
    }
  }, [
    isHost,
    sessionId,
    spaceId,
    participantSessionId,
    stopSessionMutation,
    handleRecordingStopped,
    stopSessionClock,
    startSessionClock,
  ]);

  // ── Screen share ──────────────────────────────────────────────────────

  const sampleScreenSize = useCallback(() => {
    const key = screenKeyRef.current;
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!key || !track || track.readyState !== "live") return;
    const { width, height } = track.getSettings();
    if (!width || !height) return;
    const current = screenMaxSizesRef.current.get(key);
    if (!current || width * height > current.width * current.height) {
      screenMaxSizesRef.current.set(key, { width, height });
    }
  }, []);

  // A shared surface RESIZES mid-capture (switching tabs, resizing the shared
  // window), so finalization needs the largest size seen, not the first.
  useEffect(() => {
    if (recordingState !== "recording") return;
    const interval = setInterval(sampleScreenSize, 1000);
    return () => clearInterval(interval);
  }, [recordingState, sampleScreenSize]);

  const attachScreenStream = useCallback(
    async (screenStream: MediaStream) => {
      const data = startDataRef.current;
      if (
        !capturingSessionRef.current ||
        !data ||
        data.recordingMode === "AUDIO_ONLY" ||
        screenKeyRef.current ||
        screenAttachInFlightRef.current ||
        // Paused: attached on resume.
        pausedLocallyRef.current ||
        screenStream.getVideoTracks().length === 0
      ) {
        return;
      }

      screenAttachInFlightRef.current = true;
      try {
        const attached = await localRef.current.attachScreenRecording(
          screenStream,
        );
        if (!attached) return;
        const { shareId, metadata } = attached;
        const key: TrackKey = `screen:${shareId}`;

        // Screen share can begin well after the session start, so its own
        // offset (in recorded time) places it correctly on the timeline too.
        const startOffsetMs = sessionStartedAtRef.current
          ? recordedMsAt(
              sessionStartedAtRef.current,
              pauseStateRef.current,
              getServerTimeRef.current(),
            )
          : 0;

        screenKeyRef.current = key;
        ensureRoute(key, "screen", () => ({
          recordingSessionId: data.sessionId,
          spaceId: spaceIdRef.current,
          participantSessionId: participantSessionIdRef.current,
          type: "VIDEO",
          isScreenShare: true,
          container: metadata.container,
          codec: metadata.codec,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          bitrate: metadata.bitrate,
          sampleRate: metadata.sampleRate,
          channels: metadata.channels,
          hasAudio: metadata.hasAudio,
          hasVideo: true,
          startOffsetMs,
        }));
        sampleScreenSize();
      } catch (err) {
        console.error("[RecordingManager] screen attach failed:", err);
      } finally {
        screenAttachInFlightRef.current = false;
      }
    },
    [ensureRoute, sampleScreenSize],
  );

  // Screen share ended (but the meeting recording continues). Stop the screen
  // recorder, flush its final chunk, and complete that share's track so a
  // LATER share records as its own track.
  const detachScreenStream = useCallback(async () => {
    sampleScreenSize();
    let result: { shareId: number; chunkCount: number } | null = null;
    try {
      result = await localRef.current.detachScreenRecording();
    } catch (err) {
      console.error("[RecordingManager] screen detach failed:", err);
    }
    if (!result) return;
    const key: TrackKey = `screen:${result.shareId}`;
    if (screenKeyRef.current === key) screenKeyRef.current = null;
    const route = routesRef.current.get(key);
    if (route) {
      void completeRoute(
        route,
        result.chunkCount,
        screenMaxSizesRef.current.get(key),
      );
    }
    setScreenRecordingId(null);
  }, [completeRoute, sampleScreenSize]);

  // ── Pause ─────────────────────────────────────────────────────────────

  /** Pause every recorder now; `lateMs` past the take's pause instant. */
  const pauseLocally = useCallback((lateMs: number) => {
    if (!capturingSessionRef.current || pausedLocallyRef.current) return;
    pausedLocallyRef.current = true;
    if (lateMs > PAUSE_SYNC_TOLERANCE_MS) rotateOnResumeRef.current = true;
    localRef.current.setPaused(true);
    pcmRef.current.setPaused(true);
    setIsPaused(true);
  }, []);

  const resumeLocally = useCallback((lateMs: number) => {
    if (!capturingSessionRef.current || !pausedLocallyRef.current) return;
    pausedLocallyRef.current = false;
    const rotate =
      rotateOnResumeRef.current || lateMs > PAUSE_SYNC_TOLERANCE_MS;
    rotateOnResumeRef.current = false;
    localRef.current.setPaused(false, { rotate });
    pcmRef.current.setPaused(false);
    setIsPaused(false);
    // A share that started while paused was held back until now.
    const screen = screenStreamRef.current;
    if (screen && !screenKeyRef.current && liveTracks(screen).length > 0) {
      void attachScreenStream(screen);
    }
  }, [attachScreenStream]);

  /** Follow the take's pause state: flip at the instants it names. */
  applyPauseStateRef.current = (state: RecordingPauseData) => {
    if (state.sessionId !== activeSessionRef.current) return;
    pauseStateRef.current = state;
    clearPauseTimers();
    // Not capturing yet (counting down): beginRecording picks it up.
    if (!capturingSessionRef.current) return;
    const at = (instant: number, action: (lateMs: number) => void) => {
      const run = () => action(getServerTimeRef.current() - instant);
      const delayMs = instant - getServerTimeRef.current();
      if (delayMs <= 0) run();
      else pauseTimersRef.current.push(setTimeout(run, delayMs));
    };
    const { pausedAt, resumedAt } = state;
    if (pausedAt == null) {
      // Resumed at an instant we never heard about: treat it as late.
      resumeLocally(Number.POSITIVE_INFINITY);
      return;
    }
    if (resumedAt == null || resumedAt > pausedAt) {
      if (resumedAt == null || getServerTimeRef.current() < resumedAt) {
        at(pausedAt, pauseLocally);
      }
    }
    if (resumedAt != null) at(resumedAt, resumeLocally);
    // Keep the timer honest across the flip.
    if (sessionStartedAtRef.current) {
      startSessionClock(sessionStartedAtRef.current);
    }
  };

  const requestPause = useCallback(
    async (paused: boolean) => {
      if (!isHost || !sessionId || pauseRequestInFlightRef.current) return;
      pauseRequestInFlightRef.current = true;
      setIsPauseRequestPending(true);
      setOptimisticPaused(paused);
      try {
        const { data } = await api.post<{ data: RecordingPauseData }>(
          `/recording/session/${sessionId}/${paused ? "pause" : "resume"}`,
          { spaceId, participantSessionId },
        );
        // The broadcast does the same; this covers a socket that's down.
        if (data.data) applyPauseStateRef.current(data.data);
      } catch (err) {
        console.error(
          `[RecordingManager] ${paused ? "pause" : "resume"} failed:`,
          err,
        );
        setOptimisticPaused(null);
        toast.error(
          `Couldn't ${paused ? "pause" : "resume"} the recording. Try again.`,
        );
      } finally {
        pauseRequestInFlightRef.current = false;
        setIsPauseRequestPending(false);
      }
    },
    [isHost, sessionId, spaceId, participantSessionId],
  );

  // The recorders caught up with the click.
  useEffect(() => {
    if (optimisticPaused !== null && optimisticPaused === isPaused) {
      setOptimisticPaused(null);
    }
  }, [optimisticPaused, isPaused]);

  const pauseRecording = useCallback(() => requestPause(true), [requestPause]);
  const resumeRecording = useCallback(
    () => requestPause(false),
    [requestPause],
  );

  // ── Lifecycle wiring ──────────────────────────────────────────────────

  // Finalize THIS participant's own recording on demand - used when leaving
  // the space mid-recording. Waits briefly for uploads; anything left keeps
  // uploading from IndexedDB in the background.
  const finishLocalRecording = useCallback(async () => {
    const current = capturingSessionRef.current ?? activeSessionRef.current;
    if (!current) return;
    await handleRecordingStopped(current);
    // Give the completion reports a moment to land before the page goes.
    await Promise.race([completionsRef.current, delay(5000)]);
    await uploaderRef.current.waitUntilDrained(LEAVE_DRAIN_TIMEOUT_MS);
  }, [handleRecordingStopped]);

  // Clear timers on unmount.
  useEffect(
    () => () => {
      clearCountdown();
      stopSessionClock();
      clearPauseTimers();
      if (sourceSyncTimerRef.current) clearTimeout(sourceSyncTimerRef.current);
      releaseRecorderLockRef.current?.();
      releaseBlackVideo();
    },
    [clearCountdown, stopSessionClock, clearPauseTimers, releaseBlackVideo],
  );

  // Missed the socket start (joined during the take, socket reconnecting, or
  // between takes): the 5s active-session poll starts it.
  useEffect(() => {
    const active = activeRecordingQuery.data;
    if (!active) return;
    if (activeSessionRef.current === active.id) return;
    if (finishedSessionsRef.current.has(active.id)) return;
    if (!["idle", "error", "complete", "uploading"].includes(recordingState)) {
      return;
    }
    handleRecordingStarted(startDataFromSession(active));
  }, [activeRecordingQuery.data, handleRecordingStarted, recordingState]);

  // Missed a pause or resume broadcast: the poll's pause state disagrees.
  useEffect(() => {
    const active = activeRecordingQuery.data;
    if (!active || active.id !== activeSessionRef.current) return;
    const polled = startDataFromSession(active);
    // Compare where each state ends up, not the state right now: the server
    // records a pause/resume before its lead time runs out here.
    const current = pauseStateRef.current;
    const willBePaused = current?.pausedAt != null && current.resumedAt == null;
    if ((polled.pausedAt != null) === willBePaused) return;
    applyPauseStateRef.current({
      sessionId: active.id,
      pausedMs: polled.pausedMs ?? 0,
      pausedAt: polled.pausedAt ?? null,
      resumedAt: null,
    });
  }, [activeRecordingQuery.data]);

  // Missed the socket stop: the poll shows our session is no longer the active
  // one while we're still capturing (after a short grace for a brand-new take).
  useEffect(() => {
    if (activeRecordingQuery.isFetching) return;
    if (activeRecordingQuery.isError) return;
    const current = capturingSessionRef.current ?? activeSessionRef.current;
    if (!current) return;
    if (activeRecordingQuery.data?.id === current) return;
    if (
      getServerTimeRef.current() -
        (sessionStartedAtRef.current ?? getServerTimeRef.current()) <
      5000
    ) {
      return;
    }
    if (!["countdown", "recording", "error"].includes(recordingState)) return;
    void handleRecordingStopped(current);
  }, [
    activeRecordingQuery.data,
    activeRecordingQuery.isError,
    activeRecordingQuery.isFetching,
    handleRecordingStopped,
    recordingState,
  ]);

  // Socket wiring
  useEffect(() => {
    if (!socket) return;
    const onStarted = (data: RecordingStartedData) =>
      handleRecordingStarted(data);
    const onStopped = (stoppedSessionId: string) =>
      void handleRecordingStopped(stoppedSessionId);
    const onPauseChanged = (data: RecordingPauseData) =>
      applyPauseStateRef.current(data);
    socket.on("recording-started", onStarted);
    socket.on("recording-stopped", onStopped);
    socket.on("recording-pause-changed", onPauseChanged);
    return () => {
      socket.off("recording-started", onStarted);
      socket.off("recording-stopped", onStopped);
      socket.off("recording-pause-changed", onPauseChanged);
    };
  }, [socket, handleRecordingStarted, handleRecordingStopped]);

  // Usage heartbeat - the HOST reports metered seconds every 15s while
  // recording. The server credits elapsed time (so a crashed tab still counts
  // what ran), warns when ~2 minutes remain, and force-stops the session when
  // credit hits 0 - everything captured so far is kept. Self-host sessions
  // return null (never metered).
  const usageWarnedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (recordingState !== "recording" || !isHost || !sessionId) return;

    let cancelled = false;

    const tick = async () => {
      // A slow response must not stack a second request on top of the current
      // one when the 15s interval fires again.
      if (heartbeatInFlightRef.current) return;
      heartbeatInFlightRef.current = true;
      try {
        const usage = await sendUsageHeartbeat(sessionId);
        if (cancelled || !usage) return;

        if (usage.exhausted) {
          toast.error(
            "Recording credit used up - recording stopped. Everything captured was saved. Upgrade to Pro for 20 hours every month.",
            10000,
          );
          // The server already stopped the session and told every participant.
          void handleRecordingStoppedRef.current(sessionId);
          return;
        }

        if (usage.warning && usageWarnedSessionRef.current !== sessionId) {
          usageWarnedSessionRef.current = sessionId;
          const minutesLeft = Math.max(
            1,
            Math.ceil((usage.remaining ?? 0) / 60),
          );
          toast.error(
            `About ${minutesLeft} min of recording credit left - the recording will stop and save automatically when it runs out.`,
            10000,
          );
        }
      } catch {
        // Transient network error - the server-side sweep still meters.
      } finally {
        heartbeatInFlightRef.current = false;
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), USAGE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [recordingState, isHost, sessionId]);

  return {
    recordingState,
    isRecording: recordingState === "recording",
    isPaused: optimisticPaused ?? isPaused,
    isPauseRequestPending,
    recordingDurationMs: sessionElapsedMs || localRecording.recordingDurationMs,
    error,
    stopRequestFailed,
    sessionId,
    spaceRecordingSessionId,
    combinedRecordingId,
    screenRecordingId,
    combinedChunkIndex: localRecording.combinedChunkIndex,
    screenChunkIndex: localRecording.screenChunkIndex,
    pendingUploads: uploader.pendingCount,
    chunkUploadProgress: uploader.chunkProgress,
    takeChunks,
    countdownValue,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    finishLocalRecording,
    setStream,
    setScreenStream,
    attachScreenStream,
    detachScreenStream,
  };
}
