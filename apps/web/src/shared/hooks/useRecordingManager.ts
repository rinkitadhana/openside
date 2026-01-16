/**
 * HOOK: useRecordingManager
 *
 * PURPOSE:
 * Orchestrates recording of 3 separate streams per participant:
 * 1. Video only
 * 2. Audio only
 * 3. Video + Audio combined
 *
 * FLOW:
 * 1. Host starts → API call → Socket broadcast
 * 2. All participants start 3 local recordings
 * 3. Chunks emitted every 5 seconds for each stream
 * 4. Host stops → Socket broadcast → all stop
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useSocket } from "@/shared/context/socket";
import useLocalRecording, {
  RecordingChunk,
  RecordingMetadata,
  StreamType,
} from "./useLocalRecording";
import {
  useStartRecordingSession,
  useStopRecordingSession,
  useCreateParticipantRecording,
} from "./useRecording";

export type RecordingState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "complete"
  | "error";

// Chunk data with stream type
export interface ChunkData {
  chunk: RecordingChunk;
  streamType: StreamType; // 'video', 'audio', or 'combined'
  participantRecordingId: string | null;
  spaceRecordingSessionId: string;
  metadata: RecordingMetadata | null;
}

interface RecordingStartedData {
  sessionId: string;
  spaceRecordingSessionId: string;
  startedAt: number;
}

interface UseRecordingManagerOptions {
  spaceId: string;
  participantSessionId: string;
  isHost: boolean;
  roomId: string;
  onChunkReady?: (data: ChunkData) => void;
  onRecordingStart?: (
    videoMeta: RecordingMetadata,
    audioMeta: RecordingMetadata,
    combinedMeta: RecordingMetadata
  ) => void;
  onRecordingStop?: (
    videoChunks: number,
    audioChunks: number,
    combinedChunks: number
  ) => void;
}

interface UseRecordingManagerReturn {
  recordingState: RecordingState;
  isRecording: boolean;
  recordingDurationMs: number;
  error: string | null;
  sessionId: string | null;
  spaceRecordingSessionId: string | null;
  // 3 separate recording IDs
  videoRecordingId: string | null;
  audioRecordingId: string | null;
  combinedRecordingId: string | null;
  // Chunk indices
  videoChunkIndex: number;
  audioChunkIndex: number;
  combinedChunkIndex: number;
  // Metadata
  videoMetadata: RecordingMetadata | null;
  audioMetadata: RecordingMetadata | null;
  combinedMetadata: RecordingMetadata | null;
  startRecording: (stream: MediaStream) => Promise<void>;
  stopRecording: () => Promise<void>;
  setStream: (stream: MediaStream | null) => void;
}

function generateRecordingSessionId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function useRecordingManager(
  options: UseRecordingManagerOptions
): UseRecordingManagerReturn {
  const {
    spaceId,
    participantSessionId,
    isHost,
    roomId,
    onChunkReady,
    onRecordingStart,
    onRecordingStop,
  } = options;

  const socket = useSocket();

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spaceRecordingSessionId, setSpaceRecordingSessionId] = useState<
    string | null
  >(null);
  
  // 3 separate recording IDs
  const [videoRecordingId, setVideoRecordingId] = useState<string | null>(null);
  const [audioRecordingId, setAudioRecordingId] = useState<string | null>(null);
  const [combinedRecordingId, setCombinedRecordingId] = useState<string | null>(
    null
  );

  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);

  const startSessionMutation = useStartRecordingSession();
  const stopSessionMutation = useStopRecordingSession(sessionId || "");
  const createParticipantRecordingMutation = useCreateParticipantRecording();

  // Local recording hook with 3 streams
  const {
    isRecording: isLocalRecording,
    recordingDurationMs,
    videoChunkIndex,
    audioChunkIndex,
    combinedChunkIndex,
    videoMetadata,
    audioMetadata,
    combinedMetadata,
    startRecording: startLocalRecording,
    stopRecording: stopLocalRecording,
  } = useLocalRecording({
    onVideoChunkReady: (chunk) => {
      if (onChunkReady && spaceRecordingSessionId) {
        onChunkReady({
          chunk,
          streamType: "video",
          participantRecordingId: videoRecordingId,
          spaceRecordingSessionId,
          metadata: videoMetadata,
        });
      }
    },
    onAudioChunkReady: (chunk) => {
      if (onChunkReady && spaceRecordingSessionId) {
        onChunkReady({
          chunk,
          streamType: "audio",
          participantRecordingId: audioRecordingId,
          spaceRecordingSessionId,
          metadata: audioMetadata,
        });
      }
    },
    onCombinedChunkReady: (chunk) => {
      if (onChunkReady && spaceRecordingSessionId) {
        onChunkReady({
          chunk,
          streamType: "combined",
          participantRecordingId: combinedRecordingId,
          spaceRecordingSessionId,
          metadata: combinedMetadata,
        });
      }
    },
    onRecordingStart: (videoMeta, audioMeta, combinedMeta) => {
      onRecordingStart?.(videoMeta, audioMeta, combinedMeta);
    },
    onRecordingStop: (videoChunks, audioChunks, combinedChunks) => {
      onRecordingStop?.(videoChunks, audioChunks, combinedChunks);
    },
    onError: (err, streamType) => {
      setError(`${streamType}: ${err.message}`);
      setRecordingState("error");
    },
  });

  const setStream = useCallback((stream: MediaStream | null) => {
    streamRef.current = stream;
  }, []);

  // HOST: Start recording
  const startRecording = useCallback(
    async (stream: MediaStream) => {
      if (!isHost) return;

      try {
        setRecordingState("starting");
        setError(null);

        const newSpaceRecordingSessionId = generateRecordingSessionId();

        const session = await startSessionMutation.mutateAsync({
          spaceId,
          spaceRecordingSessionId: newSpaceRecordingSessionId,
          participantSessionId,
        });

        setSessionId(session.id);
        setSpaceRecordingSessionId(session.spaceRecordingSessionId);
        startTimeRef.current = Date.now();

        socket?.emit("recording-start", roomId, {
          sessionId: session.id,
          spaceRecordingSessionId: session.spaceRecordingSessionId,
          startedAt: Date.now(),
        });

        streamRef.current = stream;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start");
        setRecordingState("error");
        throw err;
      }
    },
    [
      isHost,
      spaceId,
      participantSessionId,
      startSessionMutation,
      socket,
      roomId,
    ]
  );

  // HOST: Stop recording
  const stopRecording = useCallback(async () => {
    if (!isHost || !sessionId) return;

    try {
      setRecordingState("stopping");

      socket?.emit("recording-stop", roomId, sessionId);

      await stopSessionMutation.mutateAsync({
        spaceId,
        participantSessionId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
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

  // Handle "recording-started" socket event
  const handleRecordingStarted = useCallback(
    async (data: RecordingStartedData) => {
      setSessionId(data.sessionId);
      setSpaceRecordingSessionId(data.spaceRecordingSessionId);
      startTimeRef.current = data.startedAt;

      const stream = streamRef.current;
      if (!stream) {
        setError("No media stream available");
        setRecordingState("error");
        return;
      }

      try {
        // Start local recording (all 3 streams)
        await startLocalRecording(stream);
        setRecordingState("recording");

        // Create 3 ParticipantRecording entries in DB
        setTimeout(async () => {
          const videoMeta = videoMetadata;
          const audioMeta = audioMetadata;
          const combinedMeta = combinedMetadata;

          if (!videoMeta || !audioMeta || !combinedMeta) return;

          try {
            // 1. Video only recording
            const videoRecording =
              await createParticipantRecordingMutation.mutateAsync({
                recordingSessionId: data.sessionId,
                spaceId,
                participantSessionId,
                type: "VIDEO",
                container: videoMeta.container,
                codec: videoMeta.codec,
                width: videoMeta.width,
                height: videoMeta.height,
                fps: videoMeta.fps,
                bitrate: videoMeta.bitrate,
                hasAudio: false,
                hasVideo: true,
              });
            setVideoRecordingId(videoRecording.id);

            // 2. Audio only recording
            const audioRecording =
              await createParticipantRecordingMutation.mutateAsync({
                recordingSessionId: data.sessionId,
                spaceId,
                participantSessionId,
                type: "AUDIO",
                container: audioMeta.container,
                codec: audioMeta.codec,
                sampleRate: audioMeta.sampleRate,
                channels: audioMeta.channels,
                bitrate: audioMeta.bitrate,
                hasAudio: true,
                hasVideo: false,
              });
            setAudioRecordingId(audioRecording.id);

            // 3. Combined (video + audio) recording
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
              });
            setCombinedRecordingId(combinedRecording.id);

            console.log("[RecordingManager] Created 3 recordings:", {
              video: videoRecording.id,
              audio: audioRecording.id,
              combined: combinedRecording.id,
            });
          } catch (err) {
            console.error("Failed to create participant recordings:", err);
          }
        }, 200);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start");
        setRecordingState("error");
      }
    },
    [
      spaceId,
      participantSessionId,
      startLocalRecording,
      createParticipantRecordingMutation,
      videoMetadata,
      audioMetadata,
      combinedMetadata,
    ]
  );

  // Handle "recording-stopped" socket event
  const handleRecordingStopped = useCallback(async () => {
    if (!isLocalRecording) return;

    try {
      await stopLocalRecording();
      setRecordingState("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
      setRecordingState("error");
    }
  }, [isLocalRecording, stopLocalRecording]);

  // Listen for socket events
  useEffect(() => {
    if (!socket) return;

    socket.on("recording-started", handleRecordingStarted);
    socket.on("recording-stopped", handleRecordingStopped);

    return () => {
      socket.off("recording-started", handleRecordingStarted);
      socket.off("recording-stopped", handleRecordingStopped);
    };
  }, [socket, handleRecordingStarted, handleRecordingStopped]);

  return {
    recordingState,
    isRecording: recordingState === "recording",
    recordingDurationMs,
    error,
    sessionId,
    spaceRecordingSessionId,
    videoRecordingId,
    audioRecordingId,
    combinedRecordingId,
    videoChunkIndex,
    audioChunkIndex,
    combinedChunkIndex,
    videoMetadata,
    audioMetadata,
    combinedMetadata,
    startRecording,
    stopRecording,
    setStream,
  };
}
