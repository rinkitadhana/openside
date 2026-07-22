/**
 * HOOK: useLocalRecording
 *
 * PURPOSE:
 * Records the participant's local camera/mic at the highest available quality
 * as a SINGLE combined track (video + audio) - the master you'd watch.
 *
 * Neither a video-only nor an audio-only track is recorded locally. Both are
 * derived server-side from the combined master on demand (video-only during
 * finalization; MP3/WAV are extracted at download time with `ffmpeg -vn`). This
 * avoids extra simultaneous encodes + uploads on the participant's machine, and
 * a separate audio stream would be wasted for the majority who never download
 * audio-only.
 *
 * TIMING:
 * Chunk offsets use performance.now() (monotonic), not Date.now(), so an NTP
 * clock adjustment mid-call can't corrupt the segment timeline used for A/V
 * sync at merge time.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import {
  type MimeCandidate,
  firstSupportedVideoMime,
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
  onCombinedChunkReady?: (chunk: RecordingChunk) => void;
  onScreenChunkReady?: (chunk: RecordingChunk) => void;
  onRecordingStart?: (
    combinedMetadata: RecordingMetadata,
    screenMetadata?: RecordingMetadata,
  ) => void;
  onRecordingStop?: (combinedChunks: number, screenChunks: number) => void;
  onError?: (error: Error, streamType: StreamType) => void;
  /** The combined encoder failed AFTER capturing data. The codec can't be
   *  switched mid-stream, so the caller should finalize/SAVE what was captured
   *  and surface a non-fatal warning (losing the tail beats losing everything). */
  onCombinedEncoderFailedMidSession?: (error: Error) => void;
  chunkIntervalMs?: number;
}

export interface LocalRecordingStartOptions {
  /** Maximum camera height for this recording session (720, 1080, or 2160). */
  videoResolution?: number;
  /** Audio-only sessions never instantiate MediaRecorder video/screen capture. */
  audioOnly?: boolean;
}

interface UseLocalRecordingReturn {
  isRecording: boolean;
  recordingDurationMs: number;
  combinedChunkIndex: number;
  screenChunkIndex: number;
  combinedMetadata: RecordingMetadata | null;
  screenMetadata: RecordingMetadata | null;
  startRecording: (
    stream: MediaStream,
    screenStream?: MediaStream | null,
    options?: LocalRecordingStartOptions,
  ) => Promise<void>;
  attachScreenRecording: (
    screenStream: MediaStream,
  ) => Promise<RecordingMetadata | null>;
  /** Stop just the screen recorder (share ended) and flush its final chunk, so
   *  a later share can attach fresh. Resolves once the recorder has stopped. */
  detachScreenRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

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

function buildScreenMetadata(
  screenStream: MediaStream,
  recorder: MediaRecorder,
  videoBitrate: number,
  audioBitrate: number,
  mimeType: MimeCandidate,
): RecordingMetadata {
  const screenSettings = getVideoSettings(screenStream);
  const screenAudioSettings = getAudioSettings(screenStream);

  return {
    container: mimeType.container,
    codec: mimeType.codec,
    width: screenSettings.width,
    height: screenSettings.height,
    fps: screenSettings.fps,
    bitrate: Math.max(videoBitrate, 8000000),
    sampleRate: screenAudioSettings.sampleRate,
    channels: screenAudioSettings.channels,
    hasAudio: screenStream.getAudioTracks().length > 0,
    hasVideo: true,
    mimeType: recorder.mimeType,
  };
}

export default function useLocalRecording(
  options: UseLocalRecordingOptions = {},
): UseLocalRecordingReturn {
  const {
    onCombinedChunkReady,
    onScreenChunkReady,
    onRecordingStart,
    onRecordingStop,
    onError,
    onCombinedEncoderFailedMidSession,
    chunkIntervalMs = 5000,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [combinedChunkIndex, setCombinedChunkIndex] = useState(0);
  const [screenChunkIndex, setScreenChunkIndex] = useState(0);
  const [combinedMetadata, setCombinedMetadata] =
    useState<RecordingMetadata | null>(null);
  const [screenMetadata, setScreenMetadata] =
    useState<RecordingMetadata | null>(null);

  // Refs for the MediaRecorders (combined master + optional screen share)
  const combinedRecorderRef = useRef<MediaRecorder | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);

  // Timing refs (monotonic - performance.now())
  const startTimeRef = useRef<number>(0);
  const combinedChunkStartTimeRef = useRef<number>(0);
  const screenChunkStartTimeRef = useRef<number>(0);
  const combinedSequenceRef = useRef<number>(0);
  const screenSequenceRef = useRef<number>(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const currentVideoBitrateRef = useRef(4000000);
  const currentAudioBitrateRef = useRef(128000);

  // Update duration every 100ms
  useEffect(() => {
    if (isRecording) {
      durationIntervalRef.current = setInterval(() => {
        setRecordingDurationMs(performance.now() - startTimeRef.current);
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

  const attachScreenRecording = useCallback(
    async (screenStream: MediaStream): Promise<RecordingMetadata | null> => {
      if (!isRecording || screenStream.getVideoTracks().length === 0) {
        return null;
      }

      if (screenRecorderRef.current?.state === "recording") {
        return screenMetadata;
      }

      // Each screen share is its own ParticipantRecording, so restart the
      // sequence at 0 - a second share must not continue the first's numbering.
      screenSequenceRef.current = 0;
      setScreenChunkIndex(0);

      // Secondary screen-share track uses the improved (H.264-first) ladder's
      // preferred codec; the full runtime fallback loop is reserved for the
      // combined master (see startRecording).
      const screenMimeType = firstSupportedVideoMime();
      const screenRecorder = new MediaRecorder(screenStream, {
        mimeType: screenMimeType.mimeType || undefined,
        videoBitsPerSecond: Math.max(currentVideoBitrateRef.current, 8000000),
        audioBitsPerSecond: currentAudioBitrateRef.current,
      });

      const screenMeta = buildScreenMetadata(
        screenStream,
        screenRecorder,
        currentVideoBitrateRef.current,
        currentAudioBitrateRef.current,
        screenMimeType,
      );

      screenRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          const now = performance.now();
          const chunk: RecordingChunk = {
            blob: event.data,
            sequenceNumber: screenSequenceRef.current,
            startMs: screenChunkStartTimeRef.current - startTimeRef.current,
            durationMs: now - screenChunkStartTimeRef.current,
            timestamp: now,
          };
          screenSequenceRef.current++;
          setScreenChunkIndex(screenSequenceRef.current);
          screenChunkStartTimeRef.current = now;
          onScreenChunkReady?.(chunk);
        }
      };

      screenRecorder.onerror = () => {
        onError?.(new Error("Screen MediaRecorder error"), "screen");
      };

      screenRecorderRef.current = screenRecorder;
      screenChunkStartTimeRef.current = performance.now();
      setScreenMetadata(screenMeta);
      screenRecorder.start(chunkIntervalMs);

      console.log("[Recording] Attached screen stream:", screenMeta);
      return screenMeta;
    },
    [
      isRecording,
      screenMetadata,
      chunkIntervalMs,
      onScreenChunkReady,
      onError,
    ],
  );

  const detachScreenRecording = useCallback(async (): Promise<void> => {
    const screenRecorder = screenRecorderRef.current;
    if (!screenRecorder || screenRecorder.state === "inactive") {
      screenRecorderRef.current = null;
      return;
    }
    await new Promise<void>((resolve) => {
      // onstop fires after the final ondataavailable, so the last chunk is
      // captured before we resolve.
      screenRecorder.onstop = () => resolve();
      try {
        screenRecorder.stop();
      } catch {
        resolve();
      }
    });
    screenRecorderRef.current = null;
    setScreenMetadata(null);
  }, []);

  const startRecording = useCallback(
    async (
      stream: MediaStream,
      screenStream?: MediaStream | null,
      startOptions: LocalRecordingStartOptions = {},
    ) => {
      if (isRecording) return;

      if (startOptions.audioOnly) return;

      try {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && startOptions.videoResolution) {
          await videoTrack
            .applyConstraints({ height: { max: startOptions.videoResolution } })
            .catch(() => undefined);
        }
        const videoSettings = getVideoSettings(stream);
        const audioSettings = getAudioSettings(stream);

        // Calculate bitrate based on resolution
        let videoBitrate = 4000000;
        if (videoSettings.width && videoSettings.height) {
          const pixels = videoSettings.width * videoSettings.height;
          if (pixels >= 3840 * 2160) videoBitrate = 20000000;
          else if (pixels >= 2560 * 1440) videoBitrate = 12000000;
          else if (pixels >= 1920 * 1080) videoBitrate = 8000000;
          else if (pixels >= 1280 * 720) videoBitrate = 5000000;
        }

        const audioBitrate = 128000;
        currentVideoBitrateRef.current = videoBitrate;
        currentAudioBitrateRef.current = audioBitrate;

        // Base combined metadata; codec/container/mimeType are filled in by the
        // fallback helper once the ACTIVE codec is known (it may fall back from
        // the preferred one at runtime).
        const combinedMetaBase = {
          width: videoSettings.width,
          height: videoSettings.height,
          fps: videoSettings.fps,
          bitrate: videoBitrate,
          sampleRate: audioSettings.sampleRate,
          channels: audioSettings.channels,
          hasAudio: true,
          hasVideo: true,
        } as const;

        // Reset timing/sequence state BEFORE the combined recorder starts (the
        // fallback helper starts it synchronously).
        combinedSequenceRef.current = 0;
        screenSequenceRef.current = 0;
        startTimeRef.current = performance.now();
        combinedChunkStartTimeRef.current = startTimeRef.current;
        screenChunkStartTimeRef.current = startTimeRef.current;
        setCombinedChunkIndex(0);
        setScreenChunkIndex(0);
        setRecordingDurationMs(0);

        // ===============================================
        // COMBINED (VIDEO + AUDIO) RECORDER - the master.
        // MP3/WAV are extracted from this on demand at download time; no
        // separate audio-only recorder is needed. Started with automatic codec
        // fallback: isTypeSupported can lie, so if the preferred codec throws
        // EncodingError before any data, we transparently drop to the next.
        // ===============================================
        let combinedMeta: RecordingMetadata | null = null;

        const combinedStarted = startRecorderWithFallback({
          stream,
          candidates: getSupportedVideoMimeTypes(),
          recorderOptions: {
            videoBitsPerSecond: videoBitrate,
            audioBitsPerSecond: audioBitrate,
          },
          timesliceMs: chunkIntervalMs,
          handlers: {
            onActiveRecorder: (recorder, candidate) => {
              combinedRecorderRef.current = recorder;
              combinedMeta = {
                ...combinedMetaBase,
                container: candidate.container,
                codec: candidate.codec,
                mimeType: recorder.mimeType,
              };
              setCombinedMetadata(combinedMeta);
            },
            onData: (blob) => {
              const now = performance.now();
              const chunk: RecordingChunk = {
                blob,
                sequenceNumber: combinedSequenceRef.current,
                startMs: combinedChunkStartTimeRef.current - startTimeRef.current,
                durationMs: now - combinedChunkStartTimeRef.current,
                timestamp: now,
              };
              combinedSequenceRef.current++;
              setCombinedChunkIndex(combinedSequenceRef.current);
              combinedChunkStartTimeRef.current = now;
              onCombinedChunkReady?.(chunk);
            },
            onMidSessionFailure: (error) => {
              // Codec died after capturing data - can't switch without corrupting
              // the file. Let the manager finalize/save what was captured.
              onCombinedEncoderFailedMidSession?.(error);
            },
            onFatal: (error) => {
              onError?.(error, "combined");
            },
          },
        });

        if (!combinedStarted || !combinedMeta) {
          throw new Error("Failed to start the combined recorder");
        }
        const startedCombinedMeta: RecordingMetadata = combinedMeta;

        // ===============================================
        // SCREEN SHARE RECORDER (optional). Uses the preferred (H.264-first)
        // codec; the full fallback loop is reserved for the combined master.
        // ===============================================
        let screenMeta: RecordingMetadata | undefined;
        let screenRecorder: MediaRecorder | null = null;
        const shouldRecordScreen =
          screenStream && screenStream.getVideoTracks().length > 0;

        if (shouldRecordScreen && screenStream) {
          const screenMimeType = firstSupportedVideoMime();
          screenRecorder = new MediaRecorder(screenStream, {
            mimeType: screenMimeType.mimeType || undefined,
            videoBitsPerSecond: Math.max(videoBitrate, 8000000),
            audioBitsPerSecond: audioBitrate,
          });

          screenMeta = buildScreenMetadata(
            screenStream,
            screenRecorder,
            videoBitrate,
            audioBitrate,
            screenMimeType,
          );
          setScreenMetadata(screenMeta);

          screenRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              const now = performance.now();
              const chunk: RecordingChunk = {
                blob: event.data,
                sequenceNumber: screenSequenceRef.current,
                startMs: screenChunkStartTimeRef.current - startTimeRef.current,
                durationMs: now - screenChunkStartTimeRef.current,
                timestamp: now,
              };
              screenSequenceRef.current++;
              setScreenChunkIndex(screenSequenceRef.current);
              screenChunkStartTimeRef.current = now;
              onScreenChunkReady?.(chunk);
            }
          };

          screenRecorder.onerror = () => {
            onError?.(new Error("Screen MediaRecorder error"), "screen");
          };

          screenRecorderRef.current = screenRecorder;
          screenRecorder.start(chunkIntervalMs);
        } else {
          screenRecorderRef.current = null;
          setScreenMetadata(null);
        }

        setIsRecording(true);

        console.log(
          "[Recording] Started combined stream:",
          startedCombinedMeta,
        );

        onRecordingStart?.(startedCombinedMeta, screenMeta);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Failed to start recording");

        console.error("[Recording] Error starting recording:", err);

        // Cleanup: Stop any recorders that might have been started
        try {
          if (combinedRecorderRef.current?.state === "recording") {
            combinedRecorderRef.current.stop();
          }
        } catch (cleanupErr) {
          console.error(
            "Error stopping combined recorder during cleanup:",
            cleanupErr,
          );
        }
        try {
          if (screenRecorderRef.current?.state === "recording") {
            screenRecorderRef.current.stop();
          }
        } catch (cleanupErr) {
          console.error(
            "Error stopping screen recorder during cleanup:",
            cleanupErr,
          );
        }

        // Clear refs
        combinedRecorderRef.current = null;
        screenRecorderRef.current = null;

        // Notify error
        onError?.(err, "combined");
        throw err;
      }
    },
    [
      isRecording,
      chunkIntervalMs,
      onCombinedChunkReady,
      onScreenChunkReady,
      onRecordingStart,
      onError,
      onCombinedEncoderFailedMidSession,
    ],
  );

  const stopRecording = useCallback(async (): Promise<void> => {
    return new Promise((resolve) => {
      const combinedRecorder = combinedRecorderRef.current;
      const screenRecorder = screenRecorderRef.current;

      if (!combinedRecorder || !isRecording) {
        resolve();
        return;
      }

      const recorders = [combinedRecorder, screenRecorder].filter(
        (recorder): recorder is MediaRecorder =>
          !!recorder && recorder.state !== "inactive",
      );
      if (recorders.length === 0) {
        resolve();
        return;
      }

      let stoppedCount = 0;
      const checkAllStopped = () => {
        stoppedCount++;
        if (stoppedCount === recorders.length) {
          const combinedChunks = combinedSequenceRef.current;
          const screenChunks = screenSequenceRef.current;

          setIsRecording(false);
          combinedRecorderRef.current = null;
          screenRecorderRef.current = null;

          console.log("[Recording] Stopped streams:", {
            combinedChunks,
            screenChunks,
          });

          onRecordingStop?.(combinedChunks, screenChunks);
          resolve();
        }
      };

      combinedRecorder.onstop = checkAllStopped;
      const activeScreenRecorder =
        screenRecorder?.state !== "inactive" ? screenRecorder : null;
      if (activeScreenRecorder) {
        activeScreenRecorder.onstop = checkAllStopped;
      }

      if (combinedRecorder.state !== "inactive") combinedRecorder.stop();
      activeScreenRecorder?.stop();
    });
  }, [isRecording, onRecordingStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (combinedRecorderRef.current?.state !== "inactive") {
          combinedRecorderRef.current?.stop();
        }
      } catch (err) {
        console.error("Error stopping combined recorder on cleanup:", err);
      }
      try {
        if (screenRecorderRef.current?.state !== "inactive") {
          screenRecorderRef.current?.stop();
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
    combinedMetadata,
    screenMetadata,
    startRecording,
    stopRecording,
    attachScreenRecording,
    detachScreenRecording,
  };
}
