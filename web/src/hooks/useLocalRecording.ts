/**
 * HOOK: useLocalRecording
 *
 * PURPOSE:
 * Records the participant's local camera/mic at the highest available quality
 * as a SINGLE combined track (video + audio) - the master you'd watch - plus
 * any screen shares.
 *
 * Neither a video-only nor an audio-only track is recorded locally. Both are
 * derived server-side from the combined master on demand.
 *
 * PARTS:
 * A MediaRecorder is bound to the exact tracks it started with, and those
 * tracks don't live for the whole meeting: LiveKit STOPS the camera track when
 * the camera is turned off and creates a new one when it's turned back on, and
 * a device switch or background effect swaps tracks too. The combined track is
 * therefore recorded in "parts": whenever the source tracks change, a new
 * recorder starts on the new tracks before the old one stops (so no audio is
 * lost at the seam). Every part's chunks continue one sequence and share one
 * timeline; the server lays the parts out and fills gaps (camera off) with
 * black. An encoder that dies mid-call also just starts a new part on the next
 * codec instead of ending the recording.
 *
 * TIMING:
 * Chunk offsets use performance.now() (monotonic), not Date.now(), so an NTP
 * clock adjustment mid-call can't corrupt the segment timeline used for A/V
 * sync at merge time. They're measured from the recording's `timeOrigin`, on
 * the caller's `clock` - which stands still while the take is paused, so the
 * paused stretch never enters the timeline (the recorders pause with it).
 */

import { useRef, useState, useCallback, useEffect } from "react";
import {
  type MimeCandidate,
  getSupportedAudioMimeTypes,
  getSupportedVideoMimeTypes,
  startRecorderWithFallback,
} from "@/lib/recorderCodecs";

// Recording chunk data
export interface RecordingChunk {
  blob: Blob;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  timestamp: number;
}

/** A chunk plus the container it's in (a later part may use another codec). */
export interface LocalChunk extends RecordingChunk {
  mimeType: string;
}

// Recording metadata
export interface RecordingMetadata {
  container: string;
  codec: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  mimeType: string;
}

// Stream type identifier
export type StreamType = "combined" | "screen";

interface UseLocalRecordingOptions {
  onCombinedChunkReady?: (chunk: LocalChunk) => void;
  onScreenChunkReady?: (shareId: number, chunk: LocalChunk) => void;
  /** A combined recorder part started (the first one included). */
  onCombinedPartStart?: (metadata: RecordingMetadata) => void;
  /** A source track of the running part ended - re-read the live tracks. */
  onCombinedTrackEnded?: () => void;
  /** No recorder could be started for the current tracks, even after retries. */
  onCombinedUnavailable?: (error: Error) => void;
  /** The screen recorder failed; whatever it captured is kept. */
  onScreenError?: (shareId: number, error: Error) => void;
  chunkIntervalMs?: number;
}

interface LocalRecordingStartOptions {
  /** Maximum camera resolution for this recording session, as its short side
   *  (720, 1080, or 2160). */
  videoResolution?: number;
  /** The session's frame rate; the camera is capped to it. */
  targetFps?: number;
  /** Recording-time clock (performance.now() minus paused time). */
  clock?: () => number;
  /** Start paused: no part starts until setPaused(false). */
  paused?: boolean;
}

interface ScreenRecordingResult {
  shareId: number;
  chunkCount: number;
}

interface UseLocalRecordingReturn {
  isRecording: boolean;
  recordingDurationMs: number;
  combinedChunkIndex: number;
  screenChunkIndex: number;
  /** Begin a recording session at `timeOrigin` (a performance.now() instant).
   *  Parts start as tracks are provided via setCombinedStream. */
  startRecording: (
    timeOrigin: number,
    options?: LocalRecordingStartOptions,
  ) => void;
  /** Record these tracks: starts, rotates, or (with no live tracks) pauses the
   *  combined recorder. No-op when the tracks are the ones already recording. */
  setCombinedStream: (stream: MediaStream | null) => Promise<void>;
  /** Track ids the combined recorder is currently bound to. */
  getCombinedTrackIds: () => string[];
  /** Combined chunks emitted so far (= the next sequence number). */
  getCombinedChunkCount: () => number;
  /** Pause or resume every recorder. Track changes while paused are applied
   *  on resume; `rotate` resumes the camera on a fresh part instead (its
   *  footage no longer lines up with the clock). */
  setPaused: (paused: boolean, options?: { rotate?: boolean }) => void;
  attachScreenRecording: (
    screenStream: MediaStream,
  ) => Promise<{ shareId: number; metadata: RecordingMetadata } | null>;
  /** Stop the screen recorder (share ended) and flush its final chunk, so a
   *  later share can attach fresh. */
  detachScreenRecording: () => Promise<ScreenRecordingResult | null>;
  stopRecording: () => Promise<{
    combinedChunks: number;
    screen: ScreenRecordingResult | null;
  }>;
}

/** Retries when no codec at all could start for the current tracks. */
const MAX_FATAL_RETRIES = 3;
const FATAL_RETRY_DELAY_MS = 2000;
/** onstop can fail to fire on a recorder whose encoder crashed. */
const STOP_TIMEOUT_MS = 3000;

function getVideoSettings(stream: MediaStream) {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return {};

  const settings = videoTrack.getSettings();
  return {
    width: settings.width,
    height: settings.height,
    fps: settings.frameRate,
  };
}

function getAudioSettings(stream: MediaStream) {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return {};

  const settings = audioTrack.getSettings();
  return {
    sampleRate: settings.sampleRate,
    channels: settings.channelCount,
  };
}

function videoBitrateFor(width?: number, height?: number): number {
  if (!width || !height) return 4000000;
  const pixels = width * height;
  if (pixels >= 3840 * 2160) return 20000000;
  if (pixels >= 2560 * 1440) return 12000000;
  if (pixels >= 1920 * 1080) return 8000000;
  if (pixels >= 1280 * 720) return 5000000;
  return 4000000;
}

const AUDIO_BITRATE = 128000;

/**
 * Cap the camera at the session's resolution and frame rate (the host's plan
 * limits). This is the call's own track, so it must keep the call's
 * constraints: applyConstraints REPLACES the whole set, and a bare `{ height }`
 * dropped the 16:9 crop and resolution the call asked for - the camera fell
 * back to its raw frame (portrait on an upright phone camera) for the rest of
 * the call. The limit is on the SHORT side, so a portrait camera is capped the
 * same way. Leaves a camera already within both caps untouched. Finalization
 * enforces the same limits on the master, so a track that can't be retuned (a
 * background-effect canvas) still ends up within them.
 */
async function capCamera(
  track: MediaStreamTrack,
  maxShortSide: number | undefined,
  maxFps: number | undefined,
): Promise<void> {
  const { width, height, frameRate } = track.getSettings();
  if (!width || !height) return;
  const shortSide = Math.min(width, height);
  const overSize = !!maxShortSide && shortSide > maxShortSide;
  const overFps = !!maxFps && !!frameRate && frameRate > maxFps + 0.5;
  if (!overSize && !overFps) return;
  const scale = overSize && maxShortSide ? maxShortSide / shortSide : 1;
  const capWidth = Math.round(width * scale);
  const capHeight = Math.round(height * scale);
  try {
    await track.applyConstraints({
      ...track.getConstraints(),
      ...(overSize
        ? {
            width: { ideal: capWidth, max: capWidth },
            height: { ideal: capHeight, max: capHeight },
            aspectRatio: { ideal: width / height },
          }
        : {}),
      ...(maxFps ? { frameRate: { ideal: maxFps, max: maxFps } } : {}),
    });
  } catch (error) {
    // The server still downscales the master; this only saves upload size.
    console.warn("[LocalRecording] couldn't cap the camera:", error);
  }
}

function trackIdsOf(tracks: MediaStreamTrack[]): string {
  return tracks
    .map((track) => track.id)
    .sort()
    .join(",");
}

interface RecorderPart {
  recorder: MediaRecorder | null;
  stream: MediaStream;
  trackIds: string;
  mimeType: string;
  chunkStart: number;
  stopped: boolean;
  /** No codec could start (or the encoder died) - this part produces nothing. */
  dead: boolean;
  removeTrackListeners: () => void;
}

function stopRecorder(recorder: MediaRecorder | null): Promise<void> {
  if (!recorder || recorder.state === "inactive") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    // onstop fires after the final ondataavailable, so the last chunk is
    // captured before we resolve.
    const timeout = setTimeout(done, STOP_TIMEOUT_MS);
    recorder.addEventListener("stop", done, { once: true });
    try {
      recorder.stop();
    } catch {
      done();
    }
  });
}

export default function useLocalRecording(
  options: UseLocalRecordingOptions = {},
): UseLocalRecordingReturn {
  const { chunkIntervalMs = 5000 } = options;
  // Callbacks via a ref: recorder event handlers live far longer than a render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [combinedChunkIndex, setCombinedChunkIndex] = useState(0);
  const [screenChunkIndex, setScreenChunkIndex] = useState(0);

  // Source of truth for "is this session recording" - React state lags, and
  // stale state is what used to leave a recorder running after a failed start.
  const activeRef = useRef(false);
  const timeOriginRef = useRef(0);
  const clockRef = useRef<() => number>(() => performance.now());
  const pausedRef = useRef(false);
  const startOptionsRef = useRef<LocalRecordingStartOptions>({});
  const combinedSequenceRef = useRef(0);
  const partRef = useRef<RecorderPart | null>(null);
  const lastStreamRef = useRef<MediaStream | null>(null);
  // Codecs that died mid-recording in this session; later parts skip them.
  const failedMimesRef = useRef<Set<string>>(new Set());
  const fatalRetriesRef = useRef(0);
  // Every start/rotate/stop runs in order, so two rotations can't interleave.
  const opChainRef = useRef<Promise<void>>(Promise.resolve());

  const screenRef = useRef<{
    recorder: MediaRecorder | null;
    shareId: number;
    sequence: number;
    chunkStart: number;
    mimeType: string;
  } | null>(null);
  const shareCounterRef = useRef(0);

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Update duration every 100ms
  useEffect(() => {
    if (isRecording) {
      durationIntervalRef.current = setInterval(() => {
        setRecordingDurationMs(clockRef.current() - timeOriginRef.current);
      }, 100);
    } else if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [isRecording]);

  const runOp = useCallback((op: () => Promise<void>): Promise<void> => {
    const next = opChainRef.current.then(op).catch((error) => {
      console.error("[Recording] recorder operation failed:", error);
    });
    opChainRef.current = next;
    return next;
  }, []);

  const emitCombined = useCallback((part: RecorderPart, blob: Blob) => {
    const now = clockRef.current();
    const chunk: LocalChunk = {
      blob,
      sequenceNumber: combinedSequenceRef.current,
      startMs: Math.max(0, part.chunkStart - timeOriginRef.current),
      durationMs: now - part.chunkStart,
      timestamp: now,
      mimeType: part.mimeType,
    };
    combinedSequenceRef.current++;
    setCombinedChunkIndex(combinedSequenceRef.current);
    part.chunkStart = now;
    optionsRef.current.onCombinedChunkReady?.(chunk);
  }, []);

  // Forward refs so part handlers can reach the rotation logic defined below.
  const rotateAfterFailureRef = useRef<(part: RecorderPart) => void>(
    () => undefined,
  );
  const retryAfterFatalRef = useRef<(part: RecorderPart, error: Error) => void>(
    () => undefined,
  );

  /** Start a recorder part on `stream`. Returns the part even while the codec
   *  ladder is still settling; a part that can't start at all is marked dead. */
  const startPart = useCallback(
    async (stream: MediaStream): Promise<RecorderPart> => {
      const videoTrack = stream.getVideoTracks()[0];
      const { videoResolution, targetFps } = startOptionsRef.current;
      if (videoTrack && (videoResolution || targetFps)) {
        await capCamera(videoTrack, videoResolution, targetFps);
      }
      const videoSettings = getVideoSettings(stream);
      const audioSettings = getAudioSettings(stream);
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      const videoBitrate = videoBitrateFor(
        videoSettings.width,
        videoSettings.height,
      );

      const ladder = hasVideo
        ? getSupportedVideoMimeTypes()
        : getSupportedAudioMimeTypes();
      const candidates = ladder.filter(
        (candidate) =>
          !candidate.mimeType || !failedMimesRef.current.has(candidate.mimeType),
      );

      const tracks = stream.getTracks();
      const part: RecorderPart = {
        recorder: null,
        stream,
        trackIds: trackIdsOf(tracks),
        mimeType: "",
        chunkStart: clockRef.current(),
        stopped: false,
        dead: false,
        removeTrackListeners: () => undefined,
      };

      // A source track ending (camera turned off, device unplugged) means this
      // part has nothing more to record from it - the caller re-reads the live
      // tracks and rotates.
      const onEnded = () => {
        if (partRef.current === part && !part.stopped) {
          optionsRef.current.onCombinedTrackEnded?.();
        }
      };
      for (const track of tracks) track.addEventListener("ended", onEnded);
      part.removeTrackListeners = () => {
        for (const track of tracks) track.removeEventListener("ended", onEnded);
      };

      const buildMetadata = (
        recorder: MediaRecorder,
        candidate: MimeCandidate,
      ): RecordingMetadata => ({
        container: candidate.container,
        codec: candidate.codec,
        width: videoSettings.width,
        height: videoSettings.height,
        fps: videoSettings.fps,
        bitrate: hasVideo ? videoBitrate : AUDIO_BITRATE,
        sampleRate: audioSettings.sampleRate,
        channels: audioSettings.channels,
        hasAudio,
        hasVideo,
        mimeType: recorder.mimeType || candidate.mimeType,
      });

      let announced = false;
      const started = startRecorderWithFallback({
        stream,
        candidates,
        recorderOptions: hasVideo
          ? { videoBitsPerSecond: videoBitrate, audioBitsPerSecond: AUDIO_BITRATE }
          : { audioBitsPerSecond: AUDIO_BITRATE },
        timesliceMs: chunkIntervalMs,
        handlers: {
          onActiveRecorder: (recorder, candidate) => {
            part.recorder = recorder;
            part.mimeType = recorder.mimeType || candidate.mimeType;
            part.chunkStart = clockRef.current();
            if (!announced) {
              announced = true;
              optionsRef.current.onCombinedPartStart?.(
                buildMetadata(recorder, candidate),
              );
            }
          },
          onFirstData: () => {
            fatalRetriesRef.current = 0;
          },
          onData: (blob) => emitCombined(part, blob),
          onMidSessionFailure: (error) => {
            if (part.stopped) return;
            console.warn("[Recording] encoder failed mid-recording:", error);
            if (part.mimeType) failedMimesRef.current.add(part.mimeType);
            rotateAfterFailureRef.current(part);
          },
          onFatal: (error) => {
            part.dead = true;
            if (part.stopped) return;
            retryAfterFatalRef.current(part, error);
          },
        },
      });
      if (!started) part.dead = true;
      return part;
    },
    [chunkIntervalMs, emitCombined],
  );

  const stopPart = useCallback(async (part: RecorderPart) => {
    part.stopped = true;
    part.removeTrackListeners();
    await stopRecorder(part.recorder);
  }, []);

  const replacePart = useCallback(
    async (stream: MediaStream | null) => {
      // Paused: the change is picked up on resume (a new part would record).
      if (!activeRef.current || pausedRef.current) return;
      const live = (stream?.getTracks() ?? []).filter(
        (track) => track.readyState === "live",
      );
      const ids = trackIdsOf(live);
      const current = partRef.current;
      if (current && current.trackIds === ids) {
        if (!current.dead) return;
        // Same tracks that already exhausted their retries: wait for a change.
        if (fatalRetriesRef.current >= MAX_FATAL_RETRIES) return;
      } else {
        // Different tracks get a fresh set of retries.
        fatalRetriesRef.current = 0;
      }
      if (!current && live.length === 0) return;

      // New part first, then stop the old one: the overlap is trimmed at
      // finalize, a gap would be lost audio.
      const next = live.length > 0 ? await startPart(new MediaStream(live)) : null;
      if (!activeRef.current) {
        if (next) await stopPart(next);
        return;
      }
      // Paused while the new part was starting.
      if (pausedRef.current && next?.recorder?.state === "recording") {
        next.recorder.pause();
      }
      partRef.current = next;
      if (current) await stopPart(current);
      // No codec could even construct (onFatal fired before this part was
      // current, so it couldn't schedule its own retry).
      if (next?.dead && partRef.current === next) {
        retryAfterFatalRef.current(next, new Error("No recorder could start"));
      }
    },
    [startPart, stopPart],
  );

  rotateAfterFailureRef.current = (part: RecorderPart) => {
    void runOp(async () => {
      if (partRef.current !== part || !activeRef.current) return;
      // Same tracks, next codec: force a fresh part.
      part.dead = true;
      await replacePart(part.stream);
    });
  };

  retryAfterFatalRef.current = (part: RecorderPart, error: Error) => {
    if (partRef.current !== part) return;
    if (fatalRetriesRef.current >= MAX_FATAL_RETRIES) {
      console.error("[Recording] no recorder could start for these tracks:", error);
      optionsRef.current.onCombinedUnavailable?.(error);
      return;
    }
    fatalRetriesRef.current += 1;
    setTimeout(() => {
      void runOp(async () => {
        if (partRef.current !== part || !activeRef.current) return;
        // A failed codec isn't necessarily permanent (a busy hardware
        // encoder) - give the whole ladder another go.
        failedMimesRef.current.clear();
        await replacePart(lastStreamRef.current ?? part.stream);
      });
    }, FATAL_RETRY_DELAY_MS);
  };

  const startRecording = useCallback(
    (timeOrigin: number, startOptions: LocalRecordingStartOptions = {}) => {
      if (activeRef.current) return;
      activeRef.current = true;
      timeOriginRef.current = timeOrigin;
      clockRef.current = startOptions.clock ?? (() => performance.now());
      pausedRef.current = startOptions.paused ?? false;
      startOptionsRef.current = startOptions;
      combinedSequenceRef.current = 0;
      failedMimesRef.current = new Set();
      fatalRetriesRef.current = 0;
      partRef.current = null;
      lastStreamRef.current = null;
      setCombinedChunkIndex(0);
      setScreenChunkIndex(0);
      setRecordingDurationMs(0);
      setIsRecording(true);
    },
    [],
  );

  const setCombinedStream = useCallback(
    (stream: MediaStream | null) => {
      lastStreamRef.current = stream;
      return runOp(() => replacePart(stream));
    },
    [runOp, replacePart],
  );

  const getCombinedTrackIds = useCallback(() => {
    const part = partRef.current;
    if (!part) return [];
    return part.trackIds ? part.trackIds.split(",") : [];
  }, []);

  const getCombinedChunkCount = useCallback(
    () => combinedSequenceRef.current,
    [],
  );

  const setPaused = useCallback(
    (paused: boolean, { rotate = false }: { rotate?: boolean } = {}) => {
      if (!activeRef.current || pausedRef.current === paused) return;
      pausedRef.current = paused;
      const part = partRef.current;
      // Left paused and replaced below: a new part starts at the clock's time.
      if (!paused && rotate && part) part.dead = true;
      const recorders = [
        part && !part.dead ? part.recorder : null,
        screenRef.current?.recorder,
      ];
      for (const recorder of recorders) {
        try {
          if (paused && recorder?.state === "recording") {
            // Hand over what's buffered since the last chunk as its own chunk,
            // so it uploads now instead of waiting in the recorder until stop.
            recorder.requestData();
            recorder.pause();
          }
          if (!paused && recorder?.state === "paused") recorder.resume();
        } catch (error) {
          console.warn("[Recording] couldn't pause/resume a recorder:", error);
        }
      }
      // Tracks that changed (or a part that died) while paused.
      if (!paused) void runOp(() => replacePart(lastStreamRef.current));
    },
    [runOp, replacePart],
  );

  const attachScreenRecording = useCallback(
    async (
      screenStream: MediaStream,
    ): Promise<{ shareId: number; metadata: RecordingMetadata } | null> => {
      if (
        !activeRef.current ||
        pausedRef.current ||
        screenStream.getVideoTracks().length === 0
      ) {
        return null;
      }
      if (screenRef.current) return null;

      const shareId = ++shareCounterRef.current;
      const videoSettings = getVideoSettings(screenStream);
      const audioSettings = getAudioSettings(screenStream);
      const bitrate = Math.max(
        videoBitrateFor(videoSettings.width, videoSettings.height),
        8000000,
      );
      const screen = {
        recorder: null as MediaRecorder | null,
        shareId,
        // Each share is its own recording, so its sequence restarts at 0.
        sequence: 0,
        chunkStart: clockRef.current(),
        mimeType: "",
      };
      screenRef.current = screen;
      setScreenChunkIndex(0);

      // Filled in by onActiveRecorder (synchronously, before start()).
      const active: { metadata: RecordingMetadata | null } = { metadata: null };
      const started = startRecorderWithFallback({
        stream: screenStream,
        candidates: getSupportedVideoMimeTypes(),
        recorderOptions: {
          videoBitsPerSecond: bitrate,
          audioBitsPerSecond: AUDIO_BITRATE,
        },
        timesliceMs: chunkIntervalMs,
        handlers: {
          onActiveRecorder: (recorder, candidate) => {
            screen.recorder = recorder;
            screen.mimeType = recorder.mimeType || candidate.mimeType;
            screen.chunkStart = clockRef.current();
            active.metadata = {
              container: candidate.container,
              codec: candidate.codec,
              width: videoSettings.width,
              height: videoSettings.height,
              fps: videoSettings.fps,
              bitrate,
              sampleRate: audioSettings.sampleRate,
              channels: audioSettings.channels,
              hasAudio: screenStream.getAudioTracks().length > 0,
              hasVideo: true,
              mimeType: screen.mimeType,
            };
          },
          onData: (blob) => {
            const now = clockRef.current();
            const chunk: LocalChunk = {
              blob,
              sequenceNumber: screen.sequence,
              startMs: Math.max(0, screen.chunkStart - timeOriginRef.current),
              durationMs: now - screen.chunkStart,
              timestamp: now,
              mimeType: screen.mimeType,
            };
            screen.sequence++;
            if (screenRef.current === screen) setScreenChunkIndex(screen.sequence);
            screen.chunkStart = now;
            optionsRef.current.onScreenChunkReady?.(shareId, chunk);
          },
          onMidSessionFailure: (error) => {
            optionsRef.current.onScreenError?.(shareId, error);
          },
          onFatal: (error) => {
            optionsRef.current.onScreenError?.(shareId, error);
          },
        },
      });

      if (!started || !active.metadata) {
        if (screenRef.current === screen) screenRef.current = null;
        return null;
      }
      console.log("[Recording] Attached screen stream:", active.metadata);
      return { shareId, metadata: active.metadata };
    },
    [chunkIntervalMs],
  );

  const detachScreenRecording =
    useCallback(async (): Promise<ScreenRecordingResult | null> => {
      const screen = screenRef.current;
      if (!screen) return null;
      screenRef.current = null;
      await stopRecorder(screen.recorder);
      return { shareId: screen.shareId, chunkCount: screen.sequence };
    }, []);

  const stopRecording = useCallback(async () => {
    const wasActive = activeRef.current;
    activeRef.current = false;
    const stopped: { screen: ScreenRecordingResult | null } = { screen: null };
    await runOp(async () => {
      const part = partRef.current;
      partRef.current = null;
      const [, screenResult] = await Promise.all([
        part ? stopPart(part) : Promise.resolve(),
        detachScreenRecording(),
      ]);
      stopped.screen = screenResult;
    });
    const { screen } = stopped;
    if (wasActive) {
      console.log("[Recording] Stopped streams:", {
        combinedChunks: combinedSequenceRef.current,
        screen,
      });
    }
    setIsRecording(false);
    return { combinedChunks: combinedSequenceRef.current, screen };
  }, [runOp, stopPart, detachScreenRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      const part = partRef.current;
      partRef.current = null;
      if (part) {
        part.stopped = true;
        part.removeTrackListeners();
        try {
          if (part.recorder?.state !== "inactive") part.recorder?.stop();
        } catch (err) {
          console.error("Error stopping combined recorder on cleanup:", err);
        }
      }
      try {
        const screenRecorder = screenRef.current?.recorder;
        if (screenRecorder && screenRecorder.state !== "inactive") {
          screenRecorder.stop();
        }
      } catch (err) {
        console.error("Error stopping screen recorder on cleanup:", err);
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  return {
    isRecording,
    recordingDurationMs,
    combinedChunkIndex,
    screenChunkIndex,
    startRecording,
    setCombinedStream,
    getCombinedTrackIds,
    getCombinedChunkCount,
    setPaused,
    attachScreenRecording,
    detachScreenRecording,
    stopRecording,
  };
}
