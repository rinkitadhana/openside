import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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

type SidebarType = "info" | "users" | "chat" | null;

export interface PreJoinSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
  name: string;
  avatar?: string;
}

const SpacePage = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: user } = useGetMe();
  const { myId } = usePeer();
  const createSpace = useCreateSpace();
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

  const participantSessionId = getOrCreateSessionId(roomId || "");

  // Callbacks for SpaceScreen
  const handleRecordingStateChange = useCallback((state: RecordingState) => {
    setRecordingState(state);
  }, []);

  const handleRecordingDurationChange = useCallback((durationMs: number) => {
    setRecordingDurationMs(durationMs);
  }, []);

  // Handle chunk ready - implement your upload logic here
  const handleChunkReady = useCallback((data: ChunkData) => {
    console.log(`[Room] ${data.streamType.toUpperCase()} chunk ready:`, {
      streamType: data.streamType,
      sequenceNumber: data.chunk.sequenceNumber,
      size: (data.chunk.blob.size / 1024).toFixed(2) + " KB",
      recordingId: data.participantRecordingId,
      sessionId: data.spaceRecordingSessionId,
    });
  }, []);

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
          joinCode: roomId || "",
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
                  navigate(`/space/${roomId}`, { replace: true });
                },
                onError: (error) => {
                  console.error("Failed to join space as host:", error);
                  setIsCreatingSpace(false);
                  handleJoinCall(defaultSettings);
                  navigate(`/space/${roomId}`, { replace: true });
                },
              }
            );
          },
          onError: (error) => {
            console.error("Failed to create space:", error);
            setIsCreatingSpace(false);
            navigate("/dashboard");
          },
        }
      );
    }
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
    joinSpace,
  ]);

  if (isHost && isCreatingSpace) {
    return (
      <div className="bg-call-background h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!hasJoined && !isHost) {
    return <PreJoinScreen onJoinCall={handleJoinCall} roomId={roomId || ""} />;
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

export default SpacePage;
