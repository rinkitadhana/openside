/**
 * HOOK: useLocalRecording
 *
 * PURPOSE:
 * Records 3 separate streams from the user's camera/mic:
 * 1. Video only
 * 2. Audio only
 * 3. Video + Audio combined
 *
 * WHY 3 STREAMS?
 * - Video only: For video editing without audio interference
 * - Audio only: For audio replacement, overdubbing, editing
 * - Combined: For quick access, already synced
 */

import { useRef, useState, useCallback, useEffect } from "react";

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
export type StreamType = "video" | "audio" | "combined";

interface UseLocalRecordingOptions {
  onVideoChunkReady?: (chunk: RecordingChunk) => void;
  onAudioChunkReady?: (chunk: RecordingChunk) => void;
  onCombinedChunkReady?: (chunk: RecordingChunk) => void;
  onRecordingStart?: (
    videoMetadata: RecordingMetadata,
    audioMetadata: RecordingMetadata,
    combinedMetadata: RecordingMetadata
  ) => void;
  onRecordingStop?: (
    videoChunks: number,
    audioChunks: number,
    combinedChunks: number
  ) => void;
  onError?: (error: Error, streamType: StreamType) => void;
  chunkIntervalMs?: number;
}

interface UseLocalRecordingReturn {
  isRecording: boolean;
  recordingDurationMs: number;
  videoChunkIndex: number;
  audioChunkIndex: number;
  combinedChunkIndex: number;
  videoMetadata: RecordingMetadata | null;
  audioMetadata: RecordingMetadata | null;
  combinedMetadata: RecordingMetadata | null;
  startRecording: (stream: MediaStream) => Promise<void>;
  stopRecording: () => Promise<void>;
}

// Get best supported MIME type for video
function getBestVideoMimeType(): {
  mimeType: string;
  codec: string;
  container: string;
} {
  const types = [
    { mimeType: "video/webm;codecs=vp9", codec: "vp9", container: "webm" },
    { mimeType: "video/webm;codecs=vp8", codec: "vp8", container: "webm" },
    { mimeType: "video/mp4;codecs=h264", codec: "h264", container: "mp4" },
    { mimeType: "video/webm", codec: "vp8", container: "webm" },
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }
  return { mimeType: "", codec: "unknown", container: "webm" };
}

// Get best supported MIME type for audio
function getBestAudioMimeType(): {
  mimeType: string;
  codec: string;
  container: string;
} {
  const types = [
    { mimeType: "audio/webm;codecs=opus", codec: "opus", container: "webm" },
    { mimeType: "audio/webm", codec: "opus", container: "webm" },
    { mimeType: "audio/mp4", codec: "aac", container: "mp4" },
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }
  return { mimeType: "", codec: "unknown", container: "webm" };
}

// Get best supported MIME type for combined
function getBestCombinedMimeType(): {
  mimeType: string;
  codec: string;
  container: string;
} {
  const types = [
    { mimeType: "video/webm;codecs=vp9,opus", codec: "vp9", container: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", codec: "vp8", container: "webm" },
    { mimeType: "video/mp4;codecs=h264,aac", codec: "h264", container: "mp4" },
    { mimeType: "video/webm", codec: "vp8", container: "webm" },
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }
  return { mimeType: "", codec: "unknown", container: "webm" };
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

export default function useLocalRecording(
  options: UseLocalRecordingOptions = {}
): UseLocalRecordingReturn {
  const {
    onVideoChunkReady,
    onAudioChunkReady,
    onCombinedChunkReady,
    onRecordingStart,
    onRecordingStop,
    onError,
    chunkIntervalMs = 5000,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [videoChunkIndex, setVideoChunkIndex] = useState(0);
  const [audioChunkIndex, setAudioChunkIndex] = useState(0);
  const [combinedChunkIndex, setCombinedChunkIndex] = useState(0);
  const [videoMetadata, setVideoMetadata] = useState<RecordingMetadata | null>(
    null
  );
  const [audioMetadata, setAudioMetadata] = useState<RecordingMetadata | null>(
    null
  );
  const [combinedMetadata, setCombinedMetadata] =
    useState<RecordingMetadata | null>(null);

  // Refs for the 3 MediaRecorders
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const combinedRecorderRef = useRef<MediaRecorder | null>(null);

  // Timing refs
  const startTimeRef = useRef<number>(0);
  const videoChunkStartTimeRef = useRef<number>(0);
  const audioChunkStartTimeRef = useRef<number>(0);
  const combinedChunkStartTimeRef = useRef<number>(0);
  const videoSequenceRef = useRef<number>(0);
  const audioSequenceRef = useRef<number>(0);
  const combinedSequenceRef = useRef<number>(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  // Update duration every 100ms
  useEffect(() => {
    if (isRecording) {
      durationIntervalRef.current = setInterval(() => {
        setRecordingDurationMs(Date.now() - startTimeRef.current);
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

  const startRecording = useCallback(
    async (stream: MediaStream) => {
      if (isRecording) return;

      try {
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

        // ===============================================
        // 1. VIDEO ONLY RECORDER
        // ===============================================
        const videoStream = new MediaStream(stream.getVideoTracks());
        const videoMimeType = getBestVideoMimeType();

        const videoRecorder = new MediaRecorder(videoStream, {
          mimeType: videoMimeType.mimeType || undefined,
          videoBitsPerSecond: videoBitrate,
        });

        const videoMeta: RecordingMetadata = {
          container: videoMimeType.container,
          codec: videoMimeType.codec,
          width: videoSettings.width,
          height: videoSettings.height,
          fps: videoSettings.fps,
          bitrate: videoBitrate,
          hasAudio: false,
          hasVideo: true,
          mimeType: videoRecorder.mimeType,
        };
        setVideoMetadata(videoMeta);

        videoRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            const now = Date.now();
            const chunk: RecordingChunk = {
              blob: event.data,
              sequenceNumber: videoSequenceRef.current,
              startMs: videoChunkStartTimeRef.current - startTimeRef.current,
              durationMs: now - videoChunkStartTimeRef.current,
              timestamp: now,
            };
            videoSequenceRef.current++;
            setVideoChunkIndex(videoSequenceRef.current);
            videoChunkStartTimeRef.current = now;
            onVideoChunkReady?.(chunk);
          }
        };

        videoRecorder.onerror = () => {
          onError?.(new Error("Video MediaRecorder error"), "video");
        };

        // ===============================================
        // 2. AUDIO ONLY RECORDER
        // ===============================================
        const audioStream = new MediaStream(stream.getAudioTracks());
        const audioMimeType = getBestAudioMimeType();

        const audioRecorder = new MediaRecorder(audioStream, {
          mimeType: audioMimeType.mimeType || undefined,
          audioBitsPerSecond: audioBitrate,
        });

        const audioMeta: RecordingMetadata = {
          container: audioMimeType.container,
          codec: audioMimeType.codec,
          sampleRate: audioSettings.sampleRate,
          channels: audioSettings.channels,
          bitrate: audioBitrate,
          hasAudio: true,
          hasVideo: false,
          mimeType: audioRecorder.mimeType,
        };
        setAudioMetadata(audioMeta);

        audioRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            const now = Date.now();
            const chunk: RecordingChunk = {
              blob: event.data,
              sequenceNumber: audioSequenceRef.current,
              startMs: audioChunkStartTimeRef.current - startTimeRef.current,
              durationMs: now - audioChunkStartTimeRef.current,
              timestamp: now,
            };
            audioSequenceRef.current++;
            setAudioChunkIndex(audioSequenceRef.current);
            audioChunkStartTimeRef.current = now;
            onAudioChunkReady?.(chunk);
          }
        };

        audioRecorder.onerror = () => {
          onError?.(new Error("Audio MediaRecorder error"), "audio");
        };

        // ===============================================
        // 3. COMBINED (VIDEO + AUDIO) RECORDER
        // ===============================================
        const combinedMimeType = getBestCombinedMimeType();

        const combinedRecorder = new MediaRecorder(stream, {
          mimeType: combinedMimeType.mimeType || undefined,
          videoBitsPerSecond: videoBitrate,
          audioBitsPerSecond: audioBitrate,
        });

        const combinedMeta: RecordingMetadata = {
          container: combinedMimeType.container,
          codec: combinedMimeType.codec,
          width: videoSettings.width,
          height: videoSettings.height,
          fps: videoSettings.fps,
          bitrate: videoBitrate,
          sampleRate: audioSettings.sampleRate,
          channels: audioSettings.channels,
          hasAudio: true,
          hasVideo: true,
          mimeType: combinedRecorder.mimeType,
        };
        setCombinedMetadata(combinedMeta);

        combinedRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            const now = Date.now();
            const chunk: RecordingChunk = {
              blob: event.data,
              sequenceNumber: combinedSequenceRef.current,
              startMs:
                combinedChunkStartTimeRef.current - startTimeRef.current,
              durationMs: now - combinedChunkStartTimeRef.current,
              timestamp: now,
            };
            combinedSequenceRef.current++;
            setCombinedChunkIndex(combinedSequenceRef.current);
            combinedChunkStartTimeRef.current = now;
            onCombinedChunkReady?.(chunk);
          }
        };

        combinedRecorder.onerror = () => {
          onError?.(new Error("Combined MediaRecorder error"), "combined");
        };

        // Store recorders
        videoRecorderRef.current = videoRecorder;
        audioRecorderRef.current = audioRecorder;
        combinedRecorderRef.current = combinedRecorder;

        // Reset state
        videoSequenceRef.current = 0;
        audioSequenceRef.current = 0;
        combinedSequenceRef.current = 0;
        startTimeRef.current = Date.now();
        videoChunkStartTimeRef.current = Date.now();
        audioChunkStartTimeRef.current = Date.now();
        combinedChunkStartTimeRef.current = Date.now();
        setVideoChunkIndex(0);
        setAudioChunkIndex(0);
        setCombinedChunkIndex(0);
        setRecordingDurationMs(0);

        // Start all 3 recorders
        videoRecorder.start(chunkIntervalMs);
        audioRecorder.start(chunkIntervalMs);
        combinedRecorder.start(chunkIntervalMs);

        setIsRecording(true);

        console.log("[Recording] Started 3 streams:", {
          video: videoMeta,
          audio: audioMeta,
          combined: combinedMeta,
        });

        onRecordingStart?.(videoMeta, audioMeta, combinedMeta);
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error("Failed to start recording");
        
        console.error("[Recording] Error starting recording:", err);
        
        // Cleanup: Stop any recorders that might have been started
        try {
          if (videoRecorderRef.current?.state === "recording") {
            videoRecorderRef.current.stop();
          }
        } catch (cleanupErr) {
          console.error("Error stopping video recorder during cleanup:", cleanupErr);
        }

        try {
          if (audioRecorderRef.current?.state === "recording") {
            audioRecorderRef.current.stop();
          }
        } catch (cleanupErr) {
          console.error("Error stopping audio recorder during cleanup:", cleanupErr);
        }

        try {
          if (combinedRecorderRef.current?.state === "recording") {
            combinedRecorderRef.current.stop();
          }
        } catch (cleanupErr) {
          console.error("Error stopping combined recorder during cleanup:", cleanupErr);
        }

        // Clear refs
        videoRecorderRef.current = null;
        audioRecorderRef.current = null;
        combinedRecorderRef.current = null;

        // Notify error
        onError?.(err, "combined");
        throw err;
      }
    },
    [
      isRecording,
      chunkIntervalMs,
      onVideoChunkReady,
      onAudioChunkReady,
      onCombinedChunkReady,
      onRecordingStart,
      onError,
    ]
  );

  const stopRecording = useCallback(async (): Promise<void> => {
    return new Promise((resolve) => {
      const videoRecorder = videoRecorderRef.current;
      const audioRecorder = audioRecorderRef.current;
      const combinedRecorder = combinedRecorderRef.current;

      if (!videoRecorder || !audioRecorder || !combinedRecorder || !isRecording) {
        resolve();
        return;
      }

      let stoppedCount = 0;
      const checkAllStopped = () => {
        stoppedCount++;
        if (stoppedCount === 3) {
          const videoChunks = videoSequenceRef.current;
          const audioChunks = audioSequenceRef.current;
          const combinedChunks = combinedSequenceRef.current;

          setIsRecording(false);
          videoRecorderRef.current = null;
          audioRecorderRef.current = null;
          combinedRecorderRef.current = null;

          console.log("[Recording] Stopped all 3 streams:", {
            videoChunks,
            audioChunks,
            combinedChunks,
          });

          onRecordingStop?.(videoChunks, audioChunks, combinedChunks);
          resolve();
        }
      };

      videoRecorder.onstop = checkAllStopped;
      audioRecorder.onstop = checkAllStopped;
      combinedRecorder.onstop = checkAllStopped;

      videoRecorder.stop();
      audioRecorder.stop();
      combinedRecorder.stop();
    });
  }, [isRecording, onRecordingStop]);

  // Cleanup on unmount or when recording state changes unexpectedly
  useEffect(() => {
    return () => {
      // Stop all recorders safely
      try {
        if (videoRecorderRef.current?.state !== "inactive") {
          videoRecorderRef.current?.stop();
        }
      } catch (err) {
        console.error("Error stopping video recorder on cleanup:", err);
      }

      try {
        if (audioRecorderRef.current?.state !== "inactive") {
          audioRecorderRef.current?.stop();
        }
      } catch (err) {
        console.error("Error stopping audio recorder on cleanup:", err);
      }

      try {
        if (combinedRecorderRef.current?.state !== "inactive") {
          combinedRecorderRef.current?.stop();
        }
      } catch (err) {
        console.error("Error stopping combined recorder on cleanup:", err);
      }

      // Clear duration interval
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  return {
    isRecording,
    recordingDurationMs,
    videoChunkIndex,
    audioChunkIndex,
    combinedChunkIndex,
    videoMetadata,
    audioMetadata,
    combinedMetadata,
    startRecording,
    stopRecording,
  };
}
