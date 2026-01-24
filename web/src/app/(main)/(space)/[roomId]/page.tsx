"use client";
import React, { useEffect, useState, useCallback } from "react";
import SpaceWrapper from "@/components/space/SpaceWrapper";
import PreJoinScreen from "@/components/space/PreJoinScreen";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import SpaceScreen from "@/components/space/SpaceScreen";
import { useGetMe } from "@/hooks/useUserQuery";
import { useCreateSpace } from "@/hooks/useSpace";
import { useJoinSpace } from "@/hooks/useParticipant";
import usePeer from "@/hooks/usePeer";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import type {
  RecordingState,
  ChunkData,
} from "@/hooks/useRecordingManager";
import type { PreJoinSettings } from "@/types/preJoinTypes";

type SidebarType = "info" | "users" | "chat" | null;

const Room = () => {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: user } = useGetMe();
  const { myId } = usePeer();
  const createSpace = useCreateSpace();
  const roomId = params.roomId as string;
  const isHost = searchParams.get("host") === "true";
  const [createdSpaceId, setCreatedSpaceId] = useState<string | null>(null);
  const joinSpace = useJoinSpace(createdSpaceId || "");
  const [activeSidebar, setActiveSidebar] = useState<SidebarType>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [preJoinSettings, setPreJoinSettings] =
    useState<PreJoinSettings | null>(null);
  const [spaceCreated, setSpaceCreated] = useState(false);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);

  // Recording state (lifted up from SpaceScreen for SpaceWrapper)
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const participantSessionId = getOrCreateSessionId(roomId);

  // Callbacks for SpaceScreen
  const handleRecordingStateChange = useCallback((state: RecordingState) => {
    setRecordingState(state);
  }, []);

  const handleRecordingDurationChange = useCallback((durationMs: number) => {
    setRecordingDurationMs(durationMs);
  }, []);

  // Chunk upload queue to handle retry logic
  const chunkQueueRef = React.useRef<ChunkData[]>([]);
  const isUploadingRef = React.useRef(false);

  // Process chunk upload queue with retry logic
  const processChunkQueue = useCallback(async () => {
    if (isUploadingRef.current || chunkQueueRef.current.length === 0) {
      return;
    }

    isUploadingRef.current = true;

    while (chunkQueueRef.current.length > 0) {
      const chunkData = chunkQueueRef.current[0];
      
      try {
        // Skip if no recording ID yet (shouldn't happen with fixed implementation)
        if (!chunkData.participantRecordingId) {
          console.warn(`[Room] No recording ID for ${chunkData.streamType} chunk, skipping`);
          chunkQueueRef.current.shift();
          continue;
        }

        console.log(`[Room] Processing ${chunkData.streamType} chunk #${chunkData.chunk.sequenceNumber}`);

        // TODO: Replace this with actual upload service implementation
        // Example implementation:
        //
        // 1. Upload blob to storage service (S3, Cloudflare R2, etc.)
        // const uploadResult = await uploadService.uploadChunk({
        //   blob: chunkData.chunk.blob,
        //   fileName: `${chunkData.participantRecordingId}_${chunkData.chunk.sequenceNumber}.webm`,
        //   contentType: chunkData.metadata?.mimeType || 'video/webm',
        // });
        //
        // 2. Create segment entry in database
        // await createSegmentMutation.mutateAsync({
        //   participantRecordingId: chunkData.participantRecordingId,
        //   spaceRecordingSessionId: chunkData.spaceRecordingSessionId,
        //   spaceId: createdSpaceId || '',
        //   participantSessionId: participantSessionId,
        //   sequenceNumber: chunkData.chunk.sequenceNumber,
        //   assetKey: uploadResult.key,
        //   startMs: chunkData.chunk.startMs,
        //   durationMs: chunkData.chunk.durationMs,
        //   sizeBytes: chunkData.chunk.blob.size,
        //   checksum: await calculateChecksum(chunkData.chunk.blob), // optional
        // });

        // For now, just log the chunk info
        console.log(`[Room] ${chunkData.streamType.toUpperCase()} chunk ready:`, {
          streamType: chunkData.streamType,
          sequenceNumber: chunkData.chunk.sequenceNumber,
          size: (chunkData.chunk.blob.size / 1024).toFixed(2) + " KB",
          recordingId: chunkData.participantRecordingId,
          sessionId: chunkData.spaceRecordingSessionId,
          startMs: chunkData.chunk.startMs,
          durationMs: chunkData.chunk.durationMs,
        });

        // Simulate successful upload (remove this when implementing real upload)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Successfully processed, remove from queue
        chunkQueueRef.current.shift();
        
      } catch (error) {
        console.error(`[Room] Failed to upload ${chunkData.streamType} chunk:`, error);
        
        // For now, remove failed chunk from queue to prevent blocking
        // In production, you might want to implement retry logic:
        // - Keep track of retry count
        // - Exponential backoff
        // - Move to failed queue after max retries
        chunkQueueRef.current.shift();
        
        // TODO: Implement proper retry logic
        // if (!chunkData.retryCount) chunkData.retryCount = 0;
        // chunkData.retryCount++;
        // if (chunkData.retryCount < 3) {
        //   // Re-add to end of queue for retry
        //   chunkQueueRef.current.push(chunkData);
        // } else {
        //   console.error(`[Room] Max retries exceeded for chunk #${chunkData.chunk.sequenceNumber}`);
        //   chunkQueueRef.current.shift();
        // }
      }
    }

    isUploadingRef.current = false;
  }, []);

  // Handle chunk ready - add to queue and process
  const handleChunkReady = useCallback((data: ChunkData) => {
    if (!data.participantRecordingId) {
      console.warn(`[Room] Received ${data.streamType} chunk without recording ID, skipping`);
      return;
    }

    // Add to queue
    chunkQueueRef.current.push(data);

    // Process queue
    processChunkQueue();
  }, [processChunkQueue]);

  const toggleSidebar = (sidebarType: SidebarType) => {
    if (activeSidebar === sidebarType) {
      setActiveSidebar(null);
    } else {
      setActiveSidebar(sidebarType);
    }
  };

  const closeSidebar = () => {
    setActiveSidebar(null);
  };

  const handleJoinCall = (settings: PreJoinSettings) => {
    setPreJoinSettings(settings);
    setHasJoined(true);
  };

  // Check if host parameter is present and create space
  useEffect(() => {
    if (isHost && user && myId && !spaceCreated && !isCreatingSpace) {
      setIsCreatingSpace(true);

      createSpace.mutate(
        {
          joinCode: roomId,
          participantSessionId: participantSessionId,
        },
        {
          onSuccess: (spaceData) => {
            console.log("Space created successfully");
            setSpaceCreated(true);
            setCreatedSpaceId(spaceData.id);

            const defaultSettings: PreJoinSettings = {
              videoEnabled: true,
              audioEnabled: true,
              name: user.name || "Host",
              avatar: user.avatar,
            };

            joinSpace.mutate(
              {
                displayName: defaultSettings.name,
                participantSessionId: participantSessionId,
              },
              {
                onSuccess: () => {
                  console.log("Host joined space successfully");
                  setIsCreatingSpace(false);
                  handleJoinCall(defaultSettings);
                  router.replace(`/${roomId}`);
                },
                onError: (error) => {
                  console.error("Failed to join space as host:", error);
                  setIsCreatingSpace(false);
                  handleJoinCall(defaultSettings);
                  router.replace(`/${roomId}`);
                },
              }
            );
          },
          onError: (error) => {
            console.error("Failed to create space:", error);
            setIsCreatingSpace(false);
            router.push("/dashboard/home");
          },
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isHost,
    user,
    myId,
    roomId,
    router,
    createSpace,
    spaceCreated,
    isCreatingSpace,
    participantSessionId,
  ]);

  if (isHost && isCreatingSpace) {
    return (
      <div className="bg-call-background h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!hasJoined && !isHost) {
    return <PreJoinScreen onJoinCall={handleJoinCall} roomId={roomId} />;
  }

  if (hasJoined) {
    return (
      <SpaceWrapper
        activeSidebar={activeSidebar}
        closeSidebar={closeSidebar}
        recordingState={recordingState}
        recordingDurationMs={recordingDurationMs}
      >
        <SpaceScreen
          toggleSidebar={toggleSidebar}
          activeSidebar={activeSidebar}
          preJoinSettings={preJoinSettings}
          onRecordingStateChange={handleRecordingStateChange}
          onRecordingDurationChange={handleRecordingDurationChange}
          onChunkReady={handleChunkReady}
        />
      </SpaceWrapper>
    );
  }

  return (
    <div className="bg-call-background h-screen flex items-center justify-center">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
};

export default Room;
