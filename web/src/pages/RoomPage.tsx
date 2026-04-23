import React, { useEffect, useState, useCallback } from "react";
import SpaceWrapper from "@/components/Space/SpaceWrapper";
import PreJoinScreen from "@/components/Space/PreJoinScreen";
import SpaceScreen from "@/components/Space/SpaceScreen";
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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

type SidebarType = "info" | "users" | "chat" | null;

const RoomPage = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const participantSessionId = getOrCreateSessionId(roomId);

  const handleRecordingStateChange = useCallback((state: RecordingState) => {
    setRecordingState(state);
  }, []);

  const handleRecordingDurationChange = useCallback((durationMs: number) => {
    setRecordingDurationMs(durationMs);
  }, []);

  const chunkQueueRef = React.useRef<ChunkData[]>([]);
  const isUploadingRef = React.useRef(false);

  const processChunkQueue = useCallback(async () => {
    if (isUploadingRef.current || chunkQueueRef.current.length === 0) {
      return;
    }

    isUploadingRef.current = true;

    while (chunkQueueRef.current.length > 0) {
      const chunkData = chunkQueueRef.current[0];

      try {
        if (!chunkData.participantRecordingId) {
          console.warn(
            `[Room] No recording ID for ${chunkData.streamType} chunk, skipping`
          );
          chunkQueueRef.current.shift();
          continue;
        }

        console.log(
          `[Room] Processing ${chunkData.streamType} chunk #${chunkData.chunk.sequenceNumber}`
        );

        console.log(`[Room] ${chunkData.streamType.toUpperCase()} chunk ready:`, {
          streamType: chunkData.streamType,
          sequenceNumber: chunkData.chunk.sequenceNumber,
          size: (chunkData.chunk.blob.size / 1024).toFixed(2) + " KB",
          recordingId: chunkData.participantRecordingId,
          sessionId: chunkData.spaceRecordingSessionId,
          startMs: chunkData.chunk.startMs,
          durationMs: chunkData.chunk.durationMs,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        chunkQueueRef.current.shift();
      } catch (error) {
        console.error(
          `[Room] Failed to upload ${chunkData.streamType} chunk:`,
          error
        );

        chunkQueueRef.current.shift();
      }
    }

    isUploadingRef.current = false;
  }, []);

  const handleChunkReady = useCallback(
    (data: ChunkData) => {
      if (!data.participantRecordingId) {
        console.warn(
          `[Room] Received ${data.streamType} chunk without recording ID, skipping`
        );
        return;
      }

      chunkQueueRef.current.push(data);
      processChunkQueue();
    },
    [processChunkQueue]
  );

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

  useEffect(() => {
    if (isHost && user && myId && !spaceCreated && !isCreatingSpace) {
      setIsCreatingSpace(true);

      createSpace.mutate(
        {
          joinCode: roomId,
          participantSessionId,
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
                participantSessionId,
              },
              {
                onSuccess: () => {
                  console.log("Host joined space successfully");
                  setIsCreatingSpace(false);
                  handleJoinCall(defaultSettings);
                  navigate(`/${roomId}`, { replace: true });
                },
                onError: (error) => {
                  console.error("Failed to join space as host:", error);
                  setIsCreatingSpace(false);
                  handleJoinCall(defaultSettings);
                  navigate(`/${roomId}`, { replace: true });
                },
              }
            );
          },
          onError: (error) => {
            console.error("Failed to create space:", error);
            setIsCreatingSpace(false);
            navigate("/dashboard/home");
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
    navigate,
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

export default RoomPage;
