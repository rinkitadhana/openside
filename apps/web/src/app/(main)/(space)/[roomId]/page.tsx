"use client";
import React, { useEffect, useState, useCallback } from "react";
import SpaceWrapper from "../components/SpaceWrapper";
import PreJoinScreen from "../components/PreJoinScreen";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import SpaceScreen from "../components/SpaceScreen";
import { useGetMe } from "@/shared/hooks/useUserQuery";
import { useCreateSpace } from "@/shared/hooks/useSpace";
import { useJoinSpace } from "@/shared/hooks/useParticipant";
import usePeer from "@/shared/hooks/usePeer";
import { getOrCreateSessionId } from "@/shared/utils/ParticipantSessionId";
import type {
  RecordingState,
  ChunkData,
} from "@/shared/hooks/useRecordingManager";

type SidebarType = "info" | "users" | "chat" | null;

export interface PreJoinSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
  name: string;
  avatar?: string;
}

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

  // Handle chunk ready - implement your upload logic here
  const handleChunkReady = useCallback((data: ChunkData) => {
    // TODO: Implement your upload service here
    // data.streamType: 'video' | 'audio' | 'combined'
    // data.chunk.blob contains the blob
    // data.chunk.sequenceNumber is the chunk index
    // data.spaceRecordingSessionId identifies the recording session
    // data.participantRecordingId identifies which recording (video/audio/combined)

    console.log(`[Room] ${data.streamType.toUpperCase()} chunk ready:`, {
      streamType: data.streamType,
      sequenceNumber: data.chunk.sequenceNumber,
      size: (data.chunk.blob.size / 1024).toFixed(2) + " KB",
      recordingId: data.participantRecordingId,
      sessionId: data.spaceRecordingSessionId,
    });

    // Example: Upload to different endpoints based on stream type
    // if (data.streamType === 'video') {
    //   uploadToService(data.chunk.blob, 'video', data.participantRecordingId);
    // } else if (data.streamType === 'audio') {
    //   uploadToService(data.chunk.blob, 'audio', data.participantRecordingId);
    // } else if (data.streamType === 'combined') {
    //   uploadToService(data.chunk.blob, 'combined', data.participantRecordingId);
    // }
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
