import { useEffect, useRef, useState } from "react";
import SpaceWrapper from "@/components/Space/SpaceWrapper";
import PreJoinScreen from "@/components/Space/PreJoinScreen";
import LiveKitSpaceScreen from "@/components/Space/LiveKitSpaceScreen";
import { useGetMe } from "@/hooks/useUserQuery";
import { useCreateSpace } from "@/hooks/useSpace";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import type { RecordingState } from "@/hooks/useRecordingManager";
import type { PreJoinSettings } from "@/types/preJoinTypes";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

type SidebarType = "info" | "users" | "chat" | null;

const hostJoinSettingsKey = (joinCode: string) =>
  `HOST_JOIN_SETTINGS_${joinCode}`;

const RoomPage = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: user } = useGetMe();
  const createSpace = useCreateSpace();
  const roomId = params.roomId as string;
  const isHost = searchParams.get("host") === "true";
  const [activeSidebar, setActiveSidebar] = useState<SidebarType>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [preJoinSettings, setPreJoinSettings] =
    useState<PreJoinSettings | null>(null);
  const hasJoinSettings = hasJoined && !!preJoinSettings?.livekit;
  const [spaceCreated, setSpaceCreated] = useState(false);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const hasStartedCreateRef = useRef(false);

  const [recordingState] = useState<RecordingState>("idle");
  const [recordingDurationMs] = useState(0);

  const participantSessionId = getOrCreateSessionId(roomId);

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

  const renderSpace = () => (
    <SpaceWrapper
      activeSidebar={activeSidebar}
      closeSidebar={closeSidebar}
      recordingState={recordingState}
      recordingDurationMs={recordingDurationMs}
    >
      <LiveKitSpaceScreen
        toggleSidebar={toggleSidebar}
        activeSidebar={activeSidebar}
        preJoinSettings={preJoinSettings}
      />
    </SpaceWrapper>
  );

  useEffect(() => {
    const cachedSettings = sessionStorage.getItem(hostJoinSettingsKey(roomId));
    if (!cachedSettings) return;

    try {
      handleJoinCall(JSON.parse(cachedSettings) as PreJoinSettings);
    } catch {
      sessionStorage.removeItem(hostJoinSettingsKey(roomId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (
      isHost &&
      user &&
      !spaceCreated &&
      !isCreatingSpace &&
      !hasStartedCreateRef.current
    ) {
      hasStartedCreateRef.current = true;
      setIsCreatingSpace(true);

      const startHostSpace = async () => {
        try {
          const spaceData = await createSpace.mutateAsync({
            joinCode: roomId,
            participantSessionId,
          });

          if (!spaceData?.joinCode) {
            console.error(
              "Create space returned an invalid response:",
              spaceData
            );
            navigate("/dashboard/home");
            return;
          }

          console.log("Space created successfully");
          setSpaceCreated(true);

          const defaultSettings: PreJoinSettings = {
            videoEnabled: true,
            audioEnabled: true,
            name: user.name || "Host",
            avatar: user.avatar,
            livekit: spaceData.livekit,
          };

          try {
            sessionStorage.setItem(
              hostJoinSettingsKey(spaceData.joinCode),
              JSON.stringify(defaultSettings)
            );
          } catch (error) {
            console.warn("Unable to cache host join settings:", error);
          }
          setIsCreatingSpace(false);
          handleJoinCall(defaultSettings);

          navigate(`/${spaceData.joinCode}`, { replace: true });
        } catch (error) {
          console.error("Failed to create space:", error);
          hasStartedCreateRef.current = false;
          navigate("/dashboard/home");
        } finally {
          setIsCreatingSpace(false);
        }
      };

      void startHostSpace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isHost,
    user,
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

  if (hasJoinSettings) {
    return renderSpace();
  }

  if (!isHost) {
    return <PreJoinScreen onJoinCall={handleJoinCall} roomId={roomId} />;
  }

  return (
    <div className="bg-call-background h-screen flex items-center justify-center">
      <div className="text-sm text-foreground/70">
        Unable to finish joining the new space. Please return to the dashboard
        and try again.
      </div>
    </div>
  );
};

export default RoomPage;
