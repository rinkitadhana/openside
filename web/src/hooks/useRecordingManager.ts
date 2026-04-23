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
import { useSocket } from "@/context/socket";
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

  // Cleanup function for failed recording attempts
  const cleanupFailedRecording = useCallback(
    async (createdRecordingIds: {
      video?: string;
      audio?: string;
      combined?: string;
    }) => {
      console.log("[RecordingManager] Cleaning up failed recording...");

      // Stop local recording if it's running
      if (isLocalRecording) {
        try {
          await stopLocalRecording();
        } catch (err) {
          console.error("Error stopping local recording during cleanup:", err);
        }
      }

      // Clear recording IDs
      if (createdRecordingIds.video) setVideoRecordingId(null);
      if (createdRecordingIds.audio) setAudioRecordingId(null);
      if (createdRecordingIds.combined) setCombinedRecordingId(null);
    },
    [isLocalRecording, stopLocalRecording]
  );

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

      const createdRecordings: {
        video?: string;
        audio?: string;
        combined?: string;
      } = {};

      try {
        // Start local recording (all 3 streams)
        await startLocalRecording(stream);

        // Wait for metadata to be available (with timeout)
        const maxWaitTime = 3000; // 3 seconds
        const startWait = Date.now();
        
        while ((!videoMetadata || !audioMetadata || !combinedMetadata) && 
               (Date.now() - startWait < maxWaitTime)) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Check if we have all metadata
        if (!videoMetadata || !audioMetadata || !combinedMetadata) {
          throw new Error("Recording metadata not available after timeout");
        }

        // Create all 3 ParticipantRecording entries in parallel
        const [videoRecording, audioRecording, combinedRecording] =
          await Promise.all([
            // 1. Video only recording
            createParticipantRecordingMutation.mutateAsync({
              recordingSessionId: data.sessionId,
              spaceId,
              participantSessionId,
              type: "VIDEO",
              container: videoMetadata.container,
              codec: videoMetadata.codec,
              width: videoMetadata.width,
              height: videoMetadata.height,
              fps: videoMetadata.fps,
              bitrate: videoMetadata.bitrate,
              hasAudio: false,
              hasVideo: true,
            }),
            // 2. Audio only recording
            createParticipantRecordingMutation.mutateAsync({
              recordingSessionId: data.sessionId,
              spaceId,
              participantSessionId,
              type: "AUDIO",
              container: audioMetadata.container,
              codec: audioMetadata.codec,
              sampleRate: audioMetadata.sampleRate,
              channels: audioMetadata.channels,
              bitrate: audioMetadata.bitrate,
              hasAudio: true,
              hasVideo: false,
            }),
            // 3. Combined (video + audio) recording
            createParticipantRecordingMutation.mutateAsync({
              recordingSessionId: data.sessionId,
              spaceId,
              participantSessionId,
              type: "VIDEO",
              container: combinedMetadata.container,
              codec: combinedMetadata.codec,
              width: combinedMetadata.width,
              height: combinedMetadata.height,
              fps: combinedMetadata.fps,
              bitrate: combinedMetadata.bitrate,
              sampleRate: combinedMetadata.sampleRate,
              channels: combinedMetadata.channels,
              hasAudio: true,
              hasVideo: true,
            }),
          ]);

        // Store recording IDs
        setVideoRecordingId(videoRecording.id);
        setAudioRecordingId(audioRecording.id);
        setCombinedRecordingId(combinedRecording.id);

        createdRecordings.video = videoRecording.id;
        createdRecordings.audio = audioRecording.id;
        createdRecordings.combined = combinedRecording.id;

        // Only set to recording state after everything is successful
        setRecordingState("recording");

        console.log("[RecordingManager] Successfully started recording with 3 streams:", {
          video: videoRecording.id,
          audio: audioRecording.id,
          combined: combinedRecording.id,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to start recording";
        console.error("[RecordingManager] Error starting recording:", err);
        
        setError(errorMessage);
        setRecordingState("error");

        // Cleanup any partially created recordings
        await cleanupFailedRecording(createdRecordings);
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
      cleanupFailedRecording,
    ]
  );

  // Handle "recording-stopped" socket event
  const handleRecordingStopped = useCallback(async () => {
    if (!isLocalRecording) return;

    try {
      await stopLocalRecording();
      setRecordingState("complete");
      
      console.log("[RecordingManager] Recording stopped successfully");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to stop recording";
      console.error("[RecordingManager] Error stopping recording:", err);
      
      setError(errorMessage);
      setRecordingState("error");
      
      // Attempt cleanup even on error
      try {
        // Clear recording IDs
        setVideoRecordingId(null);
        setAudioRecordingId(null);
        setCombinedRecordingId(null);
      } catch (cleanupErr) {
        console.error("Error during cleanup:", cleanupErr);
      }
    }
  }, [isLocalRecording, stopLocalRecording]);

  // Listen for socket events and handle disconnections
  useEffect(() => {
    if (!socket) return;

    let disconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Handle socket disconnect during recording
    const handleDisconnect = (reason: string) => {
      console.warn("[RecordingManager] Socket disconnected:", reason);
      
      // If we're recording, wait 10 seconds for reconnection
      if (isLocalRecording) {
        console.log("[RecordingManager] Recording in progress, waiting for reconnection...");
        
        disconnectTimeoutId = setTimeout(async () => {
          console.error("[RecordingManager] Connection not restored, stopping recording");
          setError("Connection lost during recording");
          setRecordingState("error");
          
          try {
            await stopLocalRecording();
          } catch (err) {
            console.error("Error stopping recording after disconnect:", err);
          }
        }, 10000); // 10 seconds
      }
    };

    // Handle socket reconnection
    const handleConnect = () => {
      console.log("[RecordingManager] Socket reconnected");
      
      // Clear disconnect timeout if it exists
      if (disconnectTimeoutId) {
        clearTimeout(disconnectTimeoutId);
        disconnectTimeoutId = null;
      }

      // If we were recording before disconnect, continue
      if (isLocalRecording) {
        console.log("[RecordingManager] Continuing recording after reconnection");
      }
    };

    socket.on("recording-started", handleRecordingStarted);
    socket.on("recording-stopped", handleRecordingStopped);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleConnect);

    return () => {
      socket.off("recording-started", handleRecordingStarted);
      socket.off("recording-stopped", handleRecordingStopped);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleConnect);
      
      // Clear timeout on unmount
      if (disconnectTimeoutId) {
        clearTimeout(disconnectTimeoutId);
      }
    };
  }, [socket, handleRecordingStarted, handleRecordingStopped, isLocalRecording, stopLocalRecording]);

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
