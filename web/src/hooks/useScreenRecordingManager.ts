/**
 * HOOK: useScreenRecordingManager
 *
 * Single-user screen-recorder orchestration (no sockets, no other
 * participants). End-to-end:
 *   1. Create a RecordingSession (source = SCREEN_RECORDER) on the backend.
 *   2. Run a local 3-2-1 lead-in, then start the 3 local recorders.
 *   3. Create one ParticipantRecording row per track (combined/camera/audio).
 *   4. Stream every chunk through useChunkUploader → R2 (screen endpoints).
 *   5. On stop, drain the upload queue, mark each recording complete, and stop
 *      the session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import api from "@/lib/axiosInstance";
import { toast } from "@/lib/toast";
import useChunkUploader from "./useChunkUploader";
import { sendUsageHeartbeat } from "./useUsage";
import useScreenLocalRecording, {
  type ScreenStreams,
  type ScreenTrackType,
} from "./useScreenLocalRecording";
import type { RecordingChunk, RecordingMetadata } from "./useLocalRecording";

export type ScreenRecordingState =
  | "idle"
  | "starting"
  | "countdown"
  | "recording"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

const COUNTDOWN_SECONDS = 3;

const SCREEN_ENDPOINTS = {
  scope: "screen" as const,
  presignPath: "/recording/screen/segment/presign",
  segmentPath: "/recording/screen/segment",
};

interface UseScreenRecordingManagerOptions {
  /** Builds the per-track streams at the moment recording begins. */
  buildStreams: () => ScreenStreams;
  /** User-provided title/description, read when the session is created. */
  getInfo?: () => { title: string; description: string };
  /** Layout + camera PiP config, persisted so finalization can reproduce it. */
  getComposition?: () => Record<string, unknown>;
}

interface UseScreenRecordingManagerReturn {
  recordingState: ScreenRecordingState;
  recordingDurationMs: number;
  countdownValue: number | null;
  pendingUploads: number;
  uploadProgress: number;
  error: string | null;
  toggleRecording: () => void;
}

function generateSessionId(): string {
  return `scr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// combined + camera are VIDEO rows; audio is an AUDIO row.
function recordingPayloadFor(
  trackType: ScreenTrackType,
  meta: RecordingMetadata,
) {
  return {
    type: trackType === "audio" ? ("AUDIO" as const) : ("VIDEO" as const),
    isScreenShare: trackType === "combined",
    container: meta.container,
    codec: meta.codec,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    bitrate: meta.bitrate,
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    hasAudio: meta.hasAudio,
    hasVideo: meta.hasVideo,
  };
}

export default function useScreenRecordingManager({
  buildStreams,
  getInfo,
  getComposition,
}: UseScreenRecordingManagerOptions): UseScreenRecordingManagerReturn {
  const [recordingState, setRecordingState] =
    useState<ScreenRecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  // session client id + backend ids.
  const clientSessionIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const recordingIdsRef = useRef<Partial<Record<ScreenTrackType, string>>>({});
  const metaRef = useRef<Partial<Record<ScreenTrackType, RecordingMetadata>>>({});

  // Chunks that arrived before their recording row id existed.
  const pendingChunksRef = useRef<
    { trackType: ScreenTrackType; chunk: RecordingChunk }[]
  >([]);

  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdown = useCallback(() => {
    if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownTimeoutRef.current = null;
    countdownIntervalRef.current = null;
    setCountdownValue(null);
  }, []);

  const uploader = useChunkUploader(undefined, SCREEN_ENDPOINTS);

  // Drain any chunks left from a previous crashed session on mount.
  // Ref-gated: the uploader object's identity changes with its state, and an
  // every-render resume can race enqueue into double-queuing a chunk.
  const resumedOrphansRef = useRef(false);
  useEffect(() => {
    if (resumedOrphansRef.current) return;
    resumedOrphansRef.current = true;
    void uploader.resumeOrphans();
  }, [uploader]);

  const enqueueChunk = useCallback(
    (trackType: ScreenTrackType, chunk: RecordingChunk) => {
      const recordingId = recordingIdsRef.current[trackType];
      const sessionId = sessionIdRef.current;
      if (!recordingId || !sessionId) {
        pendingChunksRef.current.push({ trackType, chunk });
        return;
      }
      const meta = metaRef.current[trackType];
      void uploader.enqueue({
        // spaceId / participantSessionId are unused by the screen backend
        // (ownership is the session's userId) - sent as placeholders. Both
        // session-id fields carry the DB RecordingSession id so segment rows
        // reference the same id the storage keys use (the client-generated
        // scr_* id is only the session-create idempotency handle).
        spaceId: "",
        spaceRecordingSessionId: sessionId,
        recordingSessionId: sessionId,
        participantRecordingId: recordingId,
        participantSessionId: "",
        trackType,
        sequenceNumber: chunk.sequenceNumber,
        startMs: chunk.startMs,
        durationMs: chunk.durationMs,
        mimeType: meta?.mimeType ?? "application/octet-stream",
        blob: chunk.blob,
      });
    },
    [uploader],
  );

  const flushPendingChunks = useCallback(() => {
    const pending = pendingChunksRef.current;
    pendingChunksRef.current = [];
    for (const { trackType, chunk } of pending) enqueueChunk(trackType, chunk);
  }, [enqueueChunk]);

  const recorder = useScreenLocalRecording({
    onChunkReady: (trackType, chunk) => enqueueChunk(trackType, chunk),
    onRecordingStart: (metadata) => {
      metaRef.current = metadata;
    },
    onError: (err, trackType) => {
      setError(`${trackType}: ${err.message}`);
      setRecordingState("error");
    },
  });

  const {
    startRecording: startLocal,
    stopRecording: stopLocal,
    getMaxTrackSize,
  } = recorder;

  const beginRecording = useCallback(async () => {
    clearCountdown();

    const streams = buildStreams();
    try {
      await startLocal(streams);

      const metadata = metaRef.current;
      const sessionId = sessionIdRef.current;
      if (!sessionId) throw new Error("No recording session");

      // Capture has begun - flip to "recording" immediately; chunks buffer
      // until the rows below are created.
      setRecordingState("recording");

      // Create one ParticipantRecording row per active track.
      const trackTypes = Object.keys(metadata) as ScreenTrackType[];
      await Promise.all(
        trackTypes.map(async (trackType) => {
          const meta = metadata[trackType];
          if (!meta) return;
          const { data } = await api.post("/recording/screen/recording", {
            recordingSessionId: sessionId,
            ...recordingPayloadFor(trackType, meta),
          });
          recordingIdsRef.current[trackType] = data.data.id as string;
        }),
      );

      flushPendingChunks();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start recording";
      console.error("[ScreenRecordingManager] start failed:", err);
      setError(message);
      setRecordingState("error");
      try {
        await stopLocal();
      } catch {
        /* ignore */
      }
    }
  }, [buildStreams, clearCountdown, startLocal, stopLocal, flushPendingChunks]);

  const startRecording = useCallback(async () => {
    try {
      setRecordingState("starting");
      setError(null);
      recordingIdsRef.current = {};
      pendingChunksRef.current = [];

      const clientSessionId = generateSessionId();
      clientSessionIdRef.current = clientSessionId;

      const info = getInfo?.();
      const { data } = await api.post("/recording/screen/session/start", {
        spaceRecordingSessionId: clientSessionId,
        title: info?.title,
        description: info?.description,
        composition: getComposition?.(),
      });
      sessionIdRef.current = data.data.id as string;

      // Local 3-2-1 lead-in.
      setRecordingState("countdown");
      setCountdownValue(COUNTDOWN_SECONDS);
      let remaining = COUNTDOWN_SECONDS;
      countdownIntervalRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return;
        }
        setCountdownValue(remaining);
      }, 1000);

      countdownTimeoutRef.current = setTimeout(() => {
        void beginRecording();
      }, COUNTDOWN_SECONDS * 1000);
    } catch (err) {
      // Out of metered recording credit - show the upgrade CTA, not an error.
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
      const message =
        err instanceof Error ? err.message : "Failed to start recording";
      setError(message);
      setRecordingState("error");
    }
  }, [beginRecording, getInfo, getComposition]);

  // Usage heartbeat while recording: credits metered seconds server-side (a
  // crashed tab still counts what ran), warns near the limit, and reacts to a
  // server-forced stop when credit runs out - captured footage is saved.
  // stopRecording is defined below the effect, so it's reached through a ref.
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const usageWarnedRef = useRef(false);
  useEffect(() => {
    if (recordingState !== "recording" || !sessionIdRef.current) return;
    const sessionId = sessionIdRef.current;
    usageWarnedRef.current = false;

    let cancelled = false;
    const tick = async () => {
      try {
        const usage = await sendUsageHeartbeat(sessionId);
        if (cancelled || !usage) return;

        if (usage.exhausted) {
          toast.error(
            "Recording credit used up - recording stopped. Everything captured was saved. Upgrade to Pro for 20 hours every month.",
            10000,
          );
          void stopRecordingRef.current?.();
          return;
        }

        if (usage.warning && !usageWarnedRef.current) {
          usageWarnedRef.current = true;
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
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [recordingState]);

  const stopRecording = useCallback(async () => {
    // Stopped during the lead-in (before capture began): nothing was recorded,
    // so delete the session outright instead of leaving an empty STOPPED row
    // that would later surface as a FAILED recording in the list.
    if (recordingState === "countdown") {
      clearCountdown();
      if (sessionIdRef.current) {
        await api
          .delete(`/recording/screen/${sessionIdRef.current}`)
          .catch(() => undefined);
        sessionIdRef.current = null;
        clientSessionIdRef.current = null;
      }
      setRecordingState("idle");
      return;
    }

    const sessionId = sessionIdRef.current;
    const stopSession = () =>
      sessionId
        ? api
            .post(`/recording/screen/session/${sessionId}/stop`, {})
            .catch(() => undefined)
        : Promise.resolve(undefined);

    try {
      setRecordingState("stopping");
      await stopLocal();

      flushPendingChunks();
      setRecordingState("uploading");
      let drained = await uploader.waitUntilDrained();
      if (!drained) {
        // Don't fail the whole recording over a slow uplink. Stop the session
        // NOW so usage metering ends, then keep waiting while the queue drains
        // in the background. If chunks never make it, the server's recovery
        // sweep salvages whatever uploaded.
        console.warn(
          "[ScreenRecordingManager] upload queue still draining; stopping session early and waiting",
        );
        await stopSession();
        drained = await uploader.waitUntilDrained(10 * 60 * 1000);
      }

      // Mark each recording complete with its final segment count.
      await Promise.allSettled(
        (Object.entries(recordingIdsRef.current) as [ScreenTrackType, string][]).map(
          ([trackType, recordingId]) => {
            // Report the LARGEST frame size seen, not the one snapshotted at
            // start: a shared surface resizes mid-capture (tab switch, window
            // resize), and finalization pins the master to this geometry.
            const size = getMaxTrackSize(trackType);
            return api.post(
              `/recording/screen/recording/${recordingId}/complete`,
              {
                expectedSegments: uploader.getUploadedCount(recordingId),
                ...(size ? { width: size.width, height: size.height } : {}),
              },
            );
          },
        ),
      );

      await stopSession();

      if (!drained) {
        toast.error(
          "Some parts of the recording are still uploading - it will finish processing automatically.",
          8000,
        );
      }

      setRecordingState("complete");
      recordingIdsRef.current = {};
      sessionIdRef.current = null;
      clientSessionIdRef.current = null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to stop recording";
      console.error("[ScreenRecordingManager] stop failed:", err);
      // Whatever went wrong client-side, the session must not stay ACTIVE
      // (it would keep metering usage until the recovery sweep reaps it).
      await stopSession();
      setError(message);
      setRecordingState("error");
    }
  }, [
    recordingState,
    clearCountdown,
    stopLocal,
    flushPendingChunks,
    uploader,
    getMaxTrackSize,
  ]);
  stopRecordingRef.current = stopRecording;

  const toggleRecording = useCallback(() => {
    // Ignore presses while a transition is mid-flight.
    if (["starting", "countdown", "stopping", "uploading"].includes(recordingState)) {
      return;
    }
    if (recordingState === "recording") {
      void stopRecording();
      return;
    }
    void startRecording();
  }, [recordingState, startRecording, stopRecording]);

  // Clear timers on unmount.
  useEffect(() => () => clearCountdown(), [clearCountdown]);

  // Upload progress across all tracks.
  const totalChunks =
    recorder.chunkCounts.combined +
    recorder.chunkCounts.camera +
    recorder.chunkCounts.audio;
  const uploadedChunks = Math.max(0, totalChunks - uploader.pendingCount);
  const uploadProgress =
    totalChunks > 0 ? Math.round((uploadedChunks / totalChunks) * 100) : 0;

  return {
    recordingState,
    recordingDurationMs: recorder.recordingDurationMs,
    countdownValue,
    pendingUploads: uploader.pendingCount,
    uploadProgress,
    error,
    toggleRecording,
  };
}
