/**
 * HOOK: useRecordingManager
 *
 * PURPOSE:
 * Orchestrates per-participant local recording end-to-end:
 *   - listens for host start/stop over Socket.IO
 *   - records 2 local tracks (combined V+A, audio-only) via useLocalRecording
 *   - registers ParticipantRecording rows
 *   - streams every chunk through useChunkUploader (IndexedDB → R2 → segment)
 *   - on stop, drains the upload queue and marks each recording complete
 *
 * FLOW:
 * 1. Host starts → API creates session → socket broadcast "recording-started"
 * 2. Every participant (incl. host) starts local recording + creates recordings
 * 3. Chunks emitted every 5s → uploaded directly to R2
 * 4. Host stops → socket broadcast → all stop, finish uploads, mark complete
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { isAxiosError } from "axios";
import { useSocket } from "@/context/socket";
import { useClockSync } from "@/context/clockSync";
import api from "@/lib/axiosInstance";
import { toast } from "@/lib/toast";
import { sendUsageHeartbeat } from "./useUsage";
import useLocalRecording, {
  RecordingMetadata,
  StreamType,
} from "./useLocalRecording";
import useChunkUploader from "./useChunkUploader";
import usePcmCapture, { type PcmChunkMeta } from "./usePcmCapture";
import {
  useStartRecordingSession,
  useStopRecordingSession,
  useCreateParticipantRecording,
  useGetActiveRecordingSession,
} from "./useRecording";

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

/** Uploader routing key: the two MediaRecorder streams plus the parallel raw-PCM
 *  mic capture that produces the lossless WAV master. */
type UploadTrack = StreamType | "pcm";

/** A chunk headed for the uploader. Superset of RecordingChunk that also carries
 *  the PCM audio-format fields - set only on "pcm" chunks, undefined otherwise. */
type UploadChunk = {
  blob: Blob;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
} & Partial<Pick<PcmChunkMeta, "sampleRate" | "bitDepth" | "channelCount">>;

interface RecordingStartedData {
  sessionId: string;
  spaceRecordingSessionId: string;
  startedAt: number;
  /** Lead-in duration broadcast by the host so all clients count down together. */
  countdownMs?: number;
  videoResolution: number;
  audioSampleRate: number;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  recordingMode: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
}

/** How often the recording host reports metered seconds to the server. */
const USAGE_HEARTBEAT_MS = 15_000;

interface UseRecordingManagerOptions {
  spaceId: string;
  participantSessionId: string;
  isHost: boolean;
  roomId: string;
  /** Per-session cloud backup opt-in (PRO/self-host; ignored server-side otherwise). */
  cloudBackup?: boolean;
  /** Reads the participant's current local A/V MediaStream on demand. Preferred
   *  over the pushed `setStream` snapshot when starting, because a late joiner's
   *  camera track can attach a beat after the recorder is asked to start. */
  getLiveStream?: () => MediaStream | null;
  /** Whether the participant's camera is on - i.e. whether video is expected.
   *  Lets a late-join start wait briefly for the camera track instead of
   *  capturing audio-only (or nothing). */
  cameraEnabled?: boolean;
  /** Per-participant choice from pre-join: speakers request PCM AEC. */
  recordingEchoCancellation?: boolean;
  onRecordingStart?: (combinedMeta: RecordingMetadata) => void;
  onRecordingStop?: (combinedChunks: number) => void;
}

/** How long a late-join start waits for the camera track to attach before it
 *  gives up and records with whatever's available. Early joiners never hit this
 *  (their track is ready by the time the countdown ends). */
const VIDEO_ATTACH_GRACE_MS = 8000;

interface UseRecordingManagerReturn {
  recordingState: RecordingState;
  isRecording: boolean;
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
  /** Seconds left in the synced lead-in (3,2,1), or null when not counting down. */
  countdownValue: number | null;
  startRecording: (
    stream: MediaStream,
    screenStream?: MediaStream | null,
  ) => Promise<void>;
  stopRecording: () => Promise<void>;
  /** Flush + upload + complete this participant's own recording immediately
   *  (e.g. when they leave mid-recording). No-op if not currently recording. */
  finishLocalRecording: () => Promise<void>;
  setStream: (stream: MediaStream | null) => void;
  setScreenStream: (stream: MediaStream | null) => void;
  attachScreenStream: (stream: MediaStream) => Promise<void>;
  detachScreenStream: () => Promise<void>;
}

function generateRecordingSessionId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function useRecordingManager(
  options: UseRecordingManagerOptions,
): UseRecordingManagerReturn {
  const {
    spaceId,
    participantSessionId,
    isHost,
    roomId,
    cloudBackup,
    getLiveStream,
    cameraEnabled,
    recordingEchoCancellation,
    onRecordingStart,
    onRecordingStop,
  } = options;

  // Kept in refs so beginRecording (which can run async, mid-await) always reads
  // the freshest getter/intent without being re-created on every render.
  const getLiveStreamRef = useRef<(() => MediaStream | null) | undefined>(
    getLiveStream,
  );
  getLiveStreamRef.current = getLiveStream;
  const cameraEnabledRef = useRef<boolean | undefined>(cameraEnabled);
  cameraEnabledRef.current = cameraEnabled;
  const recordingEchoCancellationRef = useRef(
    recordingEchoCancellation ?? false,
  );
  recordingEchoCancellationRef.current = recordingEchoCancellation ?? false;
  // Guards against two beginRecording runs overlapping (detection + the
  // stream-ready retry) and double-creating recording rows.
  const beginningRef = useRef(false);

  const socket = useSocket();
  // Server-time helper. All recording timestamps below run through this so every
  // participant is measured on the server's clock, not their own laptop's.
  const { getServerTime, waitUntilSynced } = useClockSync();

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
  const [streamReadyVersion, setStreamReadyVersion] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingRecordingStartRef = useRef<RecordingStartedData | null>(null);
  const sessionClockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Countdown timers (the synced 3-2-1 lead-in before recording actually starts).
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  // React state updates are asynchronous, so these refs close the tiny window
  // where a rapid second press could otherwise create a duplicate request.
  const startRequestInFlightRef = useRef(false);
  const stopRequestInFlightRef = useRef(false);
  // Guards the screen-attach POST so a re-render can't fire a second one while
  // the first is still in flight (which otherwise storms /recording/participant).
  const screenAttachInFlightRef = useRef(false);

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

  const stopSessionClock = useCallback(() => {
    if (sessionClockIntervalRef.current) {
      clearInterval(sessionClockIntervalRef.current);
      sessionClockIntervalRef.current = null;
    }
  }, []);

  const startSessionClock = useCallback(
    (startedAt: number) => {
      const updateElapsed = () => {
        setSessionElapsedMs(Math.max(0, getServerTime() - startedAt));
      };

      stopSessionClock();
      updateElapsed();
      sessionClockIntervalRef.current = setInterval(updateElapsed, 500);
    },
    [stopSessionClock, getServerTime],
  );

  /** True while a synced countdown is pending (recorder hasn't started yet). */
  const isCountingDownRef = useRef(false);
  /** Session we're already counting down / recording, to ignore duplicate
   *  "recording-started" broadcasts that would otherwise restart the countdown. */
  const activeSessionRef = useRef<string | null>(null);
  const recordingModeRef = useRef<"VIDEO_AND_AUDIO" | "AUDIO_ONLY">(
    "VIDEO_AND_AUDIO",
  );

  // Mutable copies for use inside callbacks that fire before React state settles.
  const sessionIdRef = useRef<string | null>(null);
  const spaceRecordingSessionIdRef = useRef<string | null>(null);
  const combinedRecordingIdRef = useRef<string | null>(null);
  const screenRecordingIdRef = useRef<string | null>(null);
  // The parallel raw-PCM mic recording (its own ParticipantRecording so its
  // sequence numbers don't collide with the combined track's under the shared
  // unique [participantRecordingId, sequenceNumber] key). Finalization wraps its
  // segments in a WAV and links it back to the combined video's output.
  const pcmRecordingIdRef = useRef<string | null>(null);
  // Screen recordings from earlier shares in this session that have already
  // stopped capturing. Each share is its own track; all are completed at stop.
  const detachedScreenRecordingIdsRef = useRef<string[]>([]);
  const combinedMetaRef = useRef<RecordingMetadata | null>(null);
  const screenMetaRef = useRef<RecordingMetadata | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  // Assigned once handleRecordingStopped exists (below); invoked when the
  // combined encoder dies mid-session so we save the captured footage instead of
  // losing the whole recording.
  const onCombinedEncoderFailedRef = useRef<((error: Error) => void) | null>(
    null,
  );

  // Chunks that arrived before their ParticipantRecording id existed.
  const pendingChunksRef = useRef<
    { streamType: UploadTrack; chunk: UploadChunk }[]
  >([]);

  const startSessionMutation = useStartRecordingSession();
  const stopSessionMutation = useStopRecordingSession(sessionId || "");
  const createParticipantRecordingMutation = useCreateParticipantRecording();
  // React Query mutation objects change identity on every status flip
  // (idle -> pending -> error). Hold a stable ref so callbacks that use it don't
  // themselves change identity - otherwise effects depending on those callbacks
  // re-fire on every attempt and turn one failure into a request storm.
  const createParticipantRecordingRef = useRef(createParticipantRecordingMutation);
  createParticipantRecordingRef.current = createParticipantRecordingMutation;
  const activeRecordingQuery = useGetActiveRecordingSession(
    spaceId,
    participantSessionId,
    !!spaceId,
  );

  const uploader = useChunkUploader(({ sequenceNumber, totalUploaded }) => {
    // Let the host see progress.
    socket?.emit("recording-chunk-uploaded", roomId, {
      participantId: participantSessionId,
      sequenceNumber,
      totalUploaded,
    });
  });

  // Drain any chunks left over from a previous crashed session on mount.
  // Ref-gated: the uploader object's identity changes with its state, and an
  // every-render resume can race enqueue into double-queuing a chunk.
  const resumedOrphansRef = useRef(false);
  useEffect(() => {
    if (resumedOrphansRef.current) return;
    resumedOrphansRef.current = true;
    void uploader.resumeOrphans();
  }, [uploader]);

  const enqueueChunk = useCallback(
    (streamType: UploadTrack, chunk: UploadChunk) => {
      const participantRecordingId =
        streamType === "screen"
          ? screenRecordingIdRef.current
          : streamType === "pcm"
            ? pcmRecordingIdRef.current
            : combinedRecordingIdRef.current;

      if (
        !participantRecordingId ||
        !spaceRecordingSessionIdRef.current ||
        !sessionIdRef.current
      ) {
        // Recordings not registered yet - hold and flush later.
        pendingChunksRef.current.push({ streamType, chunk });
        return;
      }

      // PCM is headerless raw audio; the other tracks are WebM from MediaRecorder.
      const mimeType =
        streamType === "pcm"
          ? "audio/pcm-raw"
          : (streamType === "screen"
              ? screenMetaRef.current
              : combinedMetaRef.current
            )?.mimeType ?? "application/octet-stream";

      void uploader.enqueue({
        spaceId,
        spaceRecordingSessionId: spaceRecordingSessionIdRef.current,
        recordingSessionId: sessionIdRef.current,
        participantRecordingId,
        participantSessionId,
        trackType: streamType,
        sequenceNumber: chunk.sequenceNumber,
        startMs: chunk.startMs,
        durationMs: chunk.durationMs,
        mimeType,
        blob: chunk.blob,
        // Only populated for "pcm" - the WAV-header fields the server needs.
        sampleRate: chunk.sampleRate,
        bitDepth: chunk.bitDepth,
        channelCount: chunk.channelCount,
      });
    },
    [spaceId, participantSessionId, uploader],
  );

  const flushPendingChunks = useCallback(() => {
    const pending = pendingChunksRef.current;
    pendingChunksRef.current = [];
    for (const { streamType, chunk } of pending) {
      enqueueChunk(streamType, chunk);
    }
  }, [enqueueChunk]);

  // Parallel lossless raw-PCM mic capture. Routed to the uploader under the "pcm"
  // trackType against its own ParticipantRecording (pcmRecordingIdRef). Its
  // lifecycle mirrors the combined recorder: started in beginRecording, stopped
  // in handleRecordingStopped. A failure here is non-fatal - the combined video
  // (with its lossy Opus audio) is unaffected.
  const pcmCapture = usePcmCapture({
    onPcmChunk: (blob, meta: PcmChunkMeta) => {
      enqueueChunk("pcm", { blob, ...meta });
    },
    onError: (err) => {
      console.error("[RecordingManager] PCM capture error:", err);
    },
  });

  const {
    isRecording: isLocalRecording,
    recordingDurationMs,
    combinedChunkIndex,
    screenChunkIndex,
    startRecording: startLocalRecording,
    attachScreenRecording: attachLocalScreenRecording,
    detachScreenRecording: detachLocalScreenRecording,
    stopRecording: stopLocalRecording,
  } = useLocalRecording({
    onCombinedChunkReady: (chunk) => enqueueChunk("combined", chunk),
    onScreenChunkReady: (chunk) => enqueueChunk("screen", chunk),
    onRecordingStart: (combinedMeta, screenMeta) => {
      combinedMetaRef.current = combinedMeta;
      screenMetaRef.current = screenMeta ?? null;
      onRecordingStart?.(combinedMeta);
    },
    onRecordingStop: (combinedChunks) => {
      onRecordingStop?.(combinedChunks);
    },
    onError: (err, streamType) => {
      setError(`${streamType}: ${err.message}`);
      setRecordingState("error");
    },
    onCombinedEncoderFailedMidSession: (err) => {
      onCombinedEncoderFailedRef.current?.(err);
    },
  });

  const setStream = useCallback((stream: MediaStream | null) => {
    streamRef.current = stream;
    if (stream && stream.getTracks().length > 0) {
      setStreamReadyVersion((version) => version + 1);
    }
  }, []);

  const setScreenStream = useCallback((stream: MediaStream | null) => {
    screenStreamRef.current = stream;
  }, []);

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

        const newSpaceRecordingSessionId = generateRecordingSessionId();

        const session = await startSessionMutation.mutateAsync({
          spaceId,
          spaceRecordingSessionId: newSpaceRecordingSessionId,
          participantSessionId,
          cloudBackup: cloudBackup === true,
        });

        setSessionId(session.id);
        setSpaceRecordingSessionId(session.spaceRecordingSessionId);

        streamRef.current = stream;
        screenStreamRef.current = screenStream ?? null;

        // The broadcast target must be on the server clock - every other client
        // counts down to it against their own synced clocks. Ensure we're synced
        // before stamping it (bounded so it can't hang the start).
        await waitUntilSynced(1500);

        socket?.emit("recording-start", roomId, {
          sessionId: session.id,
          spaceRecordingSessionId: session.spaceRecordingSessionId,
          // Server-time target so every client counts down to the same instant.
          startedAt: getServerTime() + COUNTDOWN_MS,
          countdownMs: COUNTDOWN_MS,
          videoResolution: session.videoResolution ?? 2160,
          audioSampleRate: session.audioSampleRate ?? 48000,
          noiseSuppression: session.noiseSuppression ?? false,
          autoGainControl: session.autoGainControl ?? false,
          echoCancellation: session.echoCancellation ?? false,
          recordingMode:
            session.recordingMode === "AUDIO_ONLY"
              ? "AUDIO_ONLY"
              : "VIDEO_AND_AUDIO",
        });
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
      socket,
      roomId,
      cloudBackup,
      getServerTime,
      waitUntilSynced,
    ],
  );

  // HOST: Stop recording
  const stopRecording = useCallback(async () => {
    if (!isHost || !sessionId || stopRequestInFlightRef.current) return;

    stopRequestInFlightRef.current = true;
    try {
      setRecordingState("stopping");
      socket?.emit("recording-stop", roomId, sessionId);
      await stopSessionMutation.mutateAsync({ spaceId, participantSessionId });
      setStopRequestFailed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
      setStopRequestFailed(true);
      setRecordingState("error");
    } finally {
      stopRequestInFlightRef.current = false;
    }
  }, [
    isHost,
    sessionId,
    spaceId,
    participantSessionId,
    stopSessionMutation,
    socket,
    roomId,
  ]);

  // The actual recorder start - fires for EVERY participant when the synced
  // countdown reaches zero.
  const beginRecording = useCallback(
    async (data: RecordingStartedData) => {
      // Don't let two starts overlap (detection + the stream-ready retry both
      // fire) and double-create rows, and don't restart an active recorder.
      if (beginningRef.current || isLocalRecording) return;
      beginningRef.current = true;

      clearCountdown();
      isCountingDownRef.current = false;
      pendingRecordingStartRef.current = null;
      startSessionClock(data.startedAt);

      // Prefer reading the live stream on demand over the pushed snapshot - a
      // late joiner's camera track can attach a beat after we're asked to start.
      const readStream = (): MediaStream | null =>
        getLiveStreamRef.current?.() ?? streamRef.current;

      let stream = readStream();

      // Camera is on but its track hasn't attached yet: wait briefly for it
      // instead of capturing audio-only (video would be lost for the whole
      // session) or parking forever on a fragile effect chain. This is THE
      // late-joiner fix - it resolves instantly once the video track is present.
      const audioOnly = data.recordingMode === "AUDIO_ONLY";
      if (
        !audioOnly &&
        cameraEnabledRef.current &&
        (!stream || stream.getVideoTracks().length === 0)
      ) {
        const deadline = Date.now() + VIDEO_ATTACH_GRACE_MS;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const next = readStream();
          if (next && next.getVideoTracks().length > 0) {
            stream = next;
            break;
          }
          stream = next ?? stream;
        }
      }

      // The session may have been stopped while we waited for the camera.
      if (activeSessionRef.current !== data.sessionId) {
        beginningRef.current = false;
        return;
      }

      if (!stream || stream.getTracks().length === 0) {
        pendingRecordingStartRef.current = data;
        beginningRef.current = false;
        setError("Recording is active. Turn on your mic or camera to be captured.");
        setRecordingState("recording");
        return;
      }

      if (audioOnly && stream.getAudioTracks().length === 0) {
        pendingRecordingStartRef.current = data;
        beginningRef.current = false;
        setError("Recording is active. Turn on your microphone to be captured.");
        setRecordingState("recording");
        return;
      }

      try {
        // Make sure the clock is synced before we trust it. Normally it synced
        // long ago (on room join); this only matters for a start that races the
        // very first handshake. Bounded so it can never block the recorder.
        await waitUntilSynced(1500);

        // Measure "how late am I" at the exact "go" instant - BEFORE starting the
        // recorder. The recorder takes ~100-300ms to wake up; reading the clock
        // after that await would wrongly count the warm-up as lateness, so even
        // on-time participants would show a small offset. Capturing it here, on
        // the server's clock, gives a true lead-in: ~0 for on-time participants,
        // the real gap for a late joiner.
        const startOffsetMs = Math.max(0, getServerTime() - data.startedAt);

        // Audio-only sessions use only the lossless PCM path. They never start
        // a MediaRecorder or a screen recorder, so no video is finalized.
        if (audioOnly) {
          setError(null);
          setRecordingState("recording");
          const micTrack = stream.getAudioTracks()[0];
          const pcmRecording =
            await createParticipantRecordingMutation.mutateAsync({
              recordingSessionId: data.sessionId,
              spaceId,
              participantSessionId,
              type: "AUDIO",
              container: "pcm",
              codec: "pcm_s24le",
              sampleRate: data.audioSampleRate,
              channels: 1,
              hasAudio: true,
              hasVideo: false,
              startOffsetMs,
            });
          pcmRecordingIdRef.current = pcmRecording.id;
          await pcmCapture.start({
            audioId: micTrack.getSettings().deviceId,
            sampleRate: data.audioSampleRate === 44100 ? 44100 : 48000,
            noiseSuppression: data.noiseSuppression,
            autoGainControl: data.autoGainControl,
            echoCancellation: recordingEchoCancellationRef.current,
          });
          flushPendingChunks();
          return;
        }

        // Start local recording - populates the combined metadata ref.
        await startLocalRecording(stream, screenStreamRef.current, {
          videoResolution: data.videoResolution,
        });

        const combinedMeta = combinedMetaRef.current;
        const screenMeta = screenMetaRef.current;
        if (!combinedMeta) {
          throw new Error("Recording metadata not available");
        }

        // Capture has begun - flip the UI to "recording" NOW, before the
        // (possibly slow) row-creation calls. Chunks buffer in pendingChunksRef
        // and flush once the recording ids exist below. Clear any earlier
        // "turn on your mic or camera" notice from a parked start that has now
        // resolved (e.g. a late joiner whose video track just landed).
        setError(null);
        setRecordingState("recording");

        // Create the combined master ParticipantRecording. MP3/WAV are extracted
        // from this master on demand at download time, so there's no separate
        // audio recording.
        const combinedRecording =
          await createParticipantRecordingMutation.mutateAsync({
            recordingSessionId: data.sessionId,
            spaceId,
            participantSessionId,
            type: "VIDEO",
            container: combinedMeta.container,
            codec: combinedMeta.codec,
            width: combinedMeta.width,
            height: combinedMeta.height,
            fps: combinedMeta.fps,
            bitrate: combinedMeta.bitrate,
            sampleRate: combinedMeta.sampleRate,
            channels: combinedMeta.channels,
            hasAudio: true,
            hasVideo: true,
            startOffsetMs,
          });

        let screenRecording: { id: string } | null = null;
        if (screenMeta) {
          screenRecording =
            await createParticipantRecordingMutation.mutateAsync({
              recordingSessionId: data.sessionId,
              spaceId,
              participantSessionId,
              type: "VIDEO",
              isScreenShare: true,
              container: screenMeta.container,
              codec: screenMeta.codec,
              width: screenMeta.width,
              height: screenMeta.height,
              fps: screenMeta.fps,
              bitrate: screenMeta.bitrate,
              sampleRate: screenMeta.sampleRate,
              channels: screenMeta.channels,
              hasAudio: screenMeta.hasAudio,
              hasVideo: true,
              startOffsetMs,
            });
        }

        combinedRecordingIdRef.current = combinedRecording.id;
        screenRecordingIdRef.current = screenRecording?.id ?? null;
        setCombinedRecordingId(combinedRecording.id);
        setScreenRecordingId(screenRecording?.id ?? null);

        // Parallel lossless raw-PCM mic track. Only when the captured stream
        // actually has a mic - a camera-only participant has nothing to capture.
        // This is its own ParticipantRecording (type AUDIO, container "pcm") so
        // its sequence numbers can't collide with the combined track's. Set the
        // id BEFORE start() so any early chunk flushes to the right recording; a
        // failure just means this participant has no separate WAV (non-fatal).
        const micTrack = stream.getAudioTracks()[0];
        if (micTrack) {
          try {
            const pcmRecording =
              await createParticipantRecordingMutation.mutateAsync({
                recordingSessionId: data.sessionId,
                spaceId,
                participantSessionId,
                type: "AUDIO",
                // Marks this as the raw-PCM track so finalization wraps it in a
                // WAV instead of treating it as a normal WebM audio master.
                container: "pcm",
                codec: "pcm_s24le",
                sampleRate: data.audioSampleRate,
                channels: 1,
                hasAudio: true,
                hasVideo: false,
                startOffsetMs,
              });
            pcmRecordingIdRef.current = pcmRecording.id;
            await pcmCapture.start({
              audioId: micTrack.getSettings().deviceId,
              sampleRate: data.audioSampleRate === 44100 ? 44100 : 48000,
              noiseSuppression: data.noiseSuppression,
              autoGainControl: data.autoGainControl,
              echoCancellation: recordingEchoCancellationRef.current,
            });
          } catch (pcmErr) {
            console.error(
              "[RecordingManager] PCM capture failed to start (continuing without lossless audio):",
              pcmErr,
            );
            pcmRecordingIdRef.current = null;
          }
        }

        // Flush any chunks that arrived before ids were ready.
        flushPendingChunks();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start recording";
        console.error("[RecordingManager] start failed:", err);
        setError(message);
        setRecordingState("error");
        activeSessionRef.current = data.sessionId;
        pendingRecordingStartRef.current = data;
        try {
          await stopLocalRecording();
        } catch {
          /* ignore */
        }
        try {
          await pcmCapture.stop();
        } catch {
          /* ignore */
        }
        pcmRecordingIdRef.current = null;
      } finally {
        beginningRef.current = false;
      }
    },
    [
      spaceId,
      participantSessionId,
      isLocalRecording,
      startLocalRecording,
      stopLocalRecording,
      createParticipantRecordingMutation,
      flushPendingChunks,
      clearCountdown,
      startSessionClock,
      getServerTime,
      waitUntilSynced,
      pcmCapture,
    ],
  );

  const attachScreenStream = useCallback(
    async (screenStream: MediaStream) => {
      if (
        recordingState !== "recording" ||
        recordingModeRef.current === "AUDIO_ONLY" ||
        !sessionIdRef.current ||
        !spaceRecordingSessionIdRef.current ||
        screenRecordingIdRef.current ||
        screenAttachInFlightRef.current ||
        screenStream.getVideoTracks().length === 0
      ) {
        return;
      }

      screenAttachInFlightRef.current = true;
      try {
        const screenMeta = await attachLocalScreenRecording(screenStream);
        if (!screenMeta) return;
        screenMetaRef.current = screenMeta;

        // Screen share can begin well after the session start, so its own
        // server-time offset places it correctly on the timeline too.
        const screenStartedAt = getServerTime();
        const startOffsetMs = sessionStartedAtRef.current
          ? Math.max(0, screenStartedAt - sessionStartedAtRef.current)
          : 0;

        const screenRecording =
          await createParticipantRecordingRef.current.mutateAsync({
            recordingSessionId: sessionIdRef.current,
            spaceId,
            participantSessionId,
            type: "VIDEO",
            isScreenShare: true,
            container: screenMeta.container,
            codec: screenMeta.codec,
            width: screenMeta.width,
            height: screenMeta.height,
            fps: screenMeta.fps,
            bitrate: screenMeta.bitrate,
            sampleRate: screenMeta.sampleRate,
            channels: screenMeta.channels,
            hasAudio: screenMeta.hasAudio,
            hasVideo: true,
            startOffsetMs,
          });

        screenRecordingIdRef.current = screenRecording.id;
        setScreenRecordingId(screenRecording.id);
        flushPendingChunks();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to attach screen share";
        console.error("[RecordingManager] screen attach failed:", err);
        setError(message);
      } finally {
        screenAttachInFlightRef.current = false;
      }
    },
    [
      recordingState,
      attachLocalScreenRecording,
      flushPendingChunks,
      participantSessionId,
      spaceId,
      getServerTime,
    ],
  );

  // Screen share ended (but the meeting recording continues). Stop the screen
  // recorder, flush its final chunk, and free the slot so a LATER share records
  // as its own track. The stopped recording's id is kept so it gets completed at
  // session stop alongside everything else.
  const detachScreenStream = useCallback(async () => {
    const endedScreenId = screenRecordingIdRef.current;
    if (!endedScreenId) return;
    try {
      await detachLocalScreenRecording();
      flushPendingChunks();
    } catch (err) {
      console.error("[RecordingManager] screen detach failed:", err);
    }
    detachedScreenRecordingIdsRef.current.push(endedScreenId);
    screenRecordingIdRef.current = null;
    screenMetaRef.current = null;
    setScreenRecordingId(null);
  }, [detachLocalScreenRecording, flushPendingChunks]);

  // Handle "recording-started" socket event (fires for EVERY participant).
  // We don't start recording immediately - instead every client runs the same
  // 3-2-1 lead-in so the actual capture begins in sync for everyone.
  const handleRecordingStarted = useCallback(
    (data: RecordingStartedData) => {
      // Ignore duplicate broadcasts for a session we're already handling -
      // otherwise the countdown restarts (3,2,1 … 3 again).
      if (activeSessionRef.current === data.sessionId) return;

      setSessionId(data.sessionId);
      setSpaceRecordingSessionId(data.spaceRecordingSessionId);
      sessionIdRef.current = data.sessionId;
      spaceRecordingSessionIdRef.current = data.spaceRecordingSessionId;
      sessionStartedAtRef.current = data.startedAt;

      activeSessionRef.current = data.sessionId;
      recordingModeRef.current = data.recordingMode;

      const countdownMs = data.countdownMs ?? COUNTDOWN_MS;

      clearCountdown();
      setError(null);

      const serverNow = getServerTime();
      const delayMs =
        data.startedAt > serverNow
          ? Math.min(countdownMs, data.startedAt - serverNow)
          : 0;

      if (delayMs <= 0) {
        void beginRecording(data);
        return;
      }

      isCountingDownRef.current = true;
      setRecordingState("countdown");
      setCountdownValue(Math.max(1, Math.ceil(delayMs / 1000)));

      // Visual tick: 3 → 2 → 1, adjusted for late socket replays.
      countdownIntervalRef.current = setInterval(() => {
        const remainingMs = data.startedAt - getServerTime();
        if (remainingMs <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return;
        }
        setCountdownValue(Math.max(1, Math.ceil(remainingMs / 1000)));
      }, 250);

      // When the lead-in elapses, everyone's recorder starts together.
      countdownTimeoutRef.current = setTimeout(() => {
        void beginRecording(data);
      }, delayMs);
    },
    [beginRecording, clearCountdown, getServerTime],
  );

  // Handle "recording-stopped" socket event
  const handleRecordingStopped = useCallback(async () => {
    // Stopped during the lead-in (before capture began): just cancel cleanly.
    if (isCountingDownRef.current) {
      isCountingDownRef.current = false;
      activeSessionRef.current = null;
      pendingRecordingStartRef.current = null;
      stopSessionClock();
      clearCountdown();
      setRecordingState("complete");
      return;
    }

    if (!isLocalRecording && !pcmRecordingIdRef.current) {
      pendingRecordingStartRef.current = null;
      activeSessionRef.current = null;
      stopSessionClock();
      setError(null);
      setRecordingState("complete");
      return;
    }

    try {
      // Freeze the elapsed timer the instant we start stopping. The remaining
      // work (draining uploads, marking complete) can take seconds and must not
      // keep the clock ticking after the user hit stop.
      stopSessionClock();
      setRecordingState("stopping");
      if (isLocalRecording) await stopLocalRecording();
      // Stop the parallel PCM capture too - stop() flushes its final partial
      // chunk (through onPcmChunk -> enqueueChunk) before closing the context.
      await pcmCapture.stop();

      // Flush stragglers, then wait for the upload queue to drain.
      flushPendingChunks();
      setRecordingState("uploading");
      const drained = await uploader.waitUntilDrained();
      if (!drained) {
        // A straggler chunk never finished uploading. Do NOT bail here: bailing
        // would skip the /complete calls below, leaving this recording stuck at
        // "uploading" forever (expectedSegments never set) so it never finalizes
        // or shows up. Instead mark it complete with whatever DID upload - the
        // finalizer salvages over any gap. This is the difference between a late
        // joiner's track appearing vs. silently vanishing.
        console.warn(
          "[RecordingManager] upload queue didn't fully drain; completing with the segments that uploaded (finalizer salvages the rest)",
        );
      }

      // Mark each recording complete with its final segment count.
      const completions: Promise<unknown>[] = [];
      if (combinedRecordingIdRef.current) {
        completions.push(
          api.post(
            `/recording/participant/${combinedRecordingIdRef.current}/complete`,
            {
              expectedSegments: uploader.getUploadedCount(
                combinedRecordingIdRef.current,
              ),
              participantSessionId,
              spaceId,
            },
          ),
        );
      }
      // Complete the parallel PCM recording (if any) so its WAV gets finalized.
      if (pcmRecordingIdRef.current) {
        completions.push(
          api.post(
            `/recording/participant/${pcmRecordingIdRef.current}/complete`,
            {
              expectedSegments: uploader.getUploadedCount(
                pcmRecordingIdRef.current,
              ),
              participantSessionId,
              spaceId,
            },
          ),
        );
      }
      // Complete every screen recording from this session - the one still
      // sharing (if any) plus any earlier shares that already stopped.
      const allScreenIds = [
        ...detachedScreenRecordingIdsRef.current,
        ...(screenRecordingIdRef.current ? [screenRecordingIdRef.current] : []),
      ];
      for (const screenId of allScreenIds) {
        completions.push(
          api.post(`/recording/participant/${screenId}/complete`, {
            expectedSegments: uploader.getUploadedCount(screenId),
            participantSessionId,
            spaceId,
          }),
        );
      }
      await Promise.allSettled(completions);

      socket?.emit("recording-complete", roomId, {
        participantId: participantSessionId,
        totalSegments:
          (combinedRecordingIdRef.current
            ? uploader.getUploadedCount(combinedRecordingIdRef.current)
            : 0) +
          allScreenIds.reduce(
            (sum, id) => sum + uploader.getUploadedCount(id),
            0,
          ),
      });

      setRecordingState("complete");
      stopSessionClock();

      // Reset ids so a subsequent session starts clean.
      combinedRecordingIdRef.current = null;
      screenRecordingIdRef.current = null;
      pcmRecordingIdRef.current = null;
      detachedScreenRecordingIdsRef.current = [];
      sessionStartedAtRef.current = null;
      activeSessionRef.current = null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to stop recording";
      console.error("[RecordingManager] stop failed:", err);
      setError(message);
      setRecordingState("error");
    }
  }, [
    isLocalRecording,
    stopLocalRecording,
    pcmCapture,
    flushPendingChunks,
    uploader,
    socket,
    roomId,
    participantSessionId,
    spaceId,
    clearCountdown,
    stopSessionClock,
  ]);

  // Finalize THIS participant's own recording on demand - used when leaving the
  // space mid-recording so their captured-so-far footage is flushed, uploaded,
  // and marked complete instead of being abandoned when the tab unmounts. Same
  // work as reacting to the host's stop; a no-op if we aren't recording.
  const finishLocalRecording = useCallback(async () => {
    await handleRecordingStopped();
  }, [handleRecordingStopped]);

  // The stop handler legitimately changes as recording/uploader callbacks get
  // refreshed. The usage heartbeat must not treat that as a reason to recreate
  // its interval - the duration timer alone re-renders this hook every 100ms.
  // Read the latest handler through a ref when a heartbeat exhausts credit.
  const handleRecordingStoppedRef = useRef(handleRecordingStopped);
  handleRecordingStoppedRef.current = handleRecordingStopped;
  const heartbeatInFlightRef = useRef(false);

  // Mid-session encoder failure: the combined codec died after capturing data,
  // so it can't be switched without corrupting the file. Warn (non-fatal) and
  // run the normal stop/save path so everything captured so far is finalized.
  onCombinedEncoderFailedRef.current = (error: Error) => {
    console.warn("[RecordingManager] combined encoder failed mid-session:", error);
    toast.error(
      "Your recording hit an encoder error and was stopped early - everything captured up to that point was saved.",
      8000,
    );
    void handleRecordingStoppedRef.current();
  };

  // Clear any pending countdown timers if the component unmounts mid-lead-in.
  useEffect(
    () => () => {
      clearCountdown();
      stopSessionClock();
    },
    [clearCountdown, stopSessionClock],
  );

  useEffect(() => {
    const active = activeRecordingQuery.data;
    if (!active) return;
    if (activeSessionRef.current === active.id) return;
    if (recordingState !== "idle" && recordingState !== "error") return;

    handleRecordingStarted({
      sessionId: active.id,
      spaceRecordingSessionId: active.spaceRecordingSessionId,
      startedAt: new Date(active.startedAt).getTime() + COUNTDOWN_MS,
      countdownMs: 0,
      videoResolution: active.videoResolution ?? 2160,
      audioSampleRate: active.audioSampleRate ?? 48000,
      noiseSuppression: active.noiseSuppression ?? false,
      autoGainControl: active.autoGainControl ?? false,
      echoCancellation: active.echoCancellation ?? false,
      recordingMode:
        active.recordingMode === "AUDIO_ONLY" ? "AUDIO_ONLY" : "VIDEO_AND_AUDIO",
    });
  }, [activeRecordingQuery.data, handleRecordingStarted, recordingState]);

  useEffect(() => {
    if (activeRecordingQuery.isFetching) return;
    if (activeRecordingQuery.isError) return;
    if (activeRecordingQuery.data) return;
    if (!activeSessionRef.current) return;
    if (getServerTime() - (sessionStartedAtRef.current ?? getServerTime()) < 5000) {
      return;
    }
    if (
      recordingState !== "countdown" &&
      recordingState !== "recording" &&
      recordingState !== "error"
    ) {
      return;
    }

    void handleRecordingStopped();
  }, [
    activeRecordingQuery.data,
    activeRecordingQuery.isError,
    activeRecordingQuery.isFetching,
    handleRecordingStopped,
    recordingState,
    getServerTime,
  ]);

  useEffect(() => {
    const pending = pendingRecordingStartRef.current;
    const stream = streamRef.current;
    if (
      !pending ||
      activeSessionRef.current !== pending.sessionId ||
      !stream ||
      stream.getTracks().length === 0
    ) {
      return;
    }

    void beginRecording(pending);
  }, [beginRecording, streamReadyVersion]);

  // Socket wiring
  useEffect(() => {
    if (!socket) return;

    socket.on("recording-started", handleRecordingStarted);
    socket.on("recording-stopped", handleRecordingStopped);

    return () => {
      socket.off("recording-started", handleRecordingStarted);
      socket.off("recording-stopped", handleRecordingStopped);
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
          // The server already stopped the session; broadcast so every
          // participant stops, uploads, and completes their track now.
          socket?.emit("recording-stop", roomId, sessionId);
          void handleRecordingStoppedRef.current();
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
  }, [
    recordingState,
    isHost,
    sessionId,
    socket,
    roomId,
  ]);

  return {
    recordingState,
    isRecording: recordingState === "recording",
    recordingDurationMs: sessionElapsedMs || recordingDurationMs,
    error,
    stopRequestFailed,
    sessionId,
    spaceRecordingSessionId,
    combinedRecordingId,
    screenRecordingId,
    combinedChunkIndex,
    screenChunkIndex,
    pendingUploads: uploader.pendingCount,
    countdownValue,
    startRecording,
    stopRecording,
    finishLocalRecording,
    setStream,
    setScreenStream,
    attachScreenStream,
    detachScreenStream,
  };
}
