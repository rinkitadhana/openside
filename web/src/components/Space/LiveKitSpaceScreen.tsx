import { useEffect, useMemo, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import {
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  type RoomOptions,
} from "livekit-client";
import toast from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { useEndSpace, useGetSpaceByJoinCode } from "@/hooks/useSpace";
import { useLeaveSpace } from "@/hooks/useParticipant";
import { useGetMe } from "@/hooks/useUserQuery";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import type { PreJoinSettings } from "@/types/preJoinTypes";
import LiveKitControls from "./livekit/LiveKitControls";
import LiveKitVideoStage from "./livekit/LiveKitVideoStage";
import { LiveKitChatProvider } from "./chat/LiveKitChatProvider";
import ChatSidebar from "./sidebars/ChatSidebar";
import InfoSidebar from "./sidebars/InfoSidebar";
import UsersSidebar from "./sidebars/UsersSidebar";
import CallWarningDialog from "./ui/CallWarningDialog";

type SidebarType = "info" | "users" | "chat" | null;

interface LiveKitSpaceScreenProps {
  activeSidebar: SidebarType;
  preJoinSettings: PreJoinSettings | null;
  toggleSidebar: (sidebarType: SidebarType) => void;
}

const LiveKitSpaceScreen = ({
  activeSidebar,
  preJoinSettings,
  toggleSidebar,
}: LiveKitSpaceScreenProps) => {
  const navigate = useNavigate();
  const params = useParams();
  const roomCode = params.roomId as string;
  const participantSessionId = getOrCreateSessionId(roomCode);
  const { data: user } = useGetMe();
  const { data: spaceData } = useGetSpaceByJoinCode(roomCode);
  const leaveSpace = useLeaveSpace(spaceData?.id || "");
  const endSpace = useEndSpace();
  const [connectionReady, setConnectionReady] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [disconnectWarning, setDisconnectWarning] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [pinnedParticipantIdentity, setPinnedParticipantIdentity] = useState<
    string | null
  >(null);
  const [deafened, setDeafened] = useState(false);

  const livekit = preJoinSettings?.livekit;
  const isHost = !!user && !!spaceData && user.id === spaceData.host?.id;

  const roomOptions = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
    }),
    [],
  );

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  useEffect(() => {
    let cancelled = false;

    const prepareConnection = async () => {
      if (!livekit?.url) return;

      try {
        await room.prepareConnection(livekit.url, livekit.token);
        if (!cancelled) {
          setConnectionReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Unable to prepare LiveKit connection.",
          );
        }
      }
    };

    prepareConnection();

    return () => {
      cancelled = true;
    };
  }, [livekit?.token, livekit?.url, room]);

  const handleLeave = () => {
    if (spaceData?.id) {
      leaveSpace.mutate(
        { participantSessionId },
        {
          onSettled: () => {
            room.disconnect();
            navigate("/dashboard/home");
          },
        },
      );
      return;
    }

    room.disconnect();
    navigate("/dashboard/home");
  };

  const handleEndForAll = () => {
    if (!spaceData?.id) return;

    endSpace.mutate(spaceData.id, {
      onSettled: () => {
        room.disconnect();
        navigate("/dashboard/home");
      },
    });
  };

  const renderSidebarContent = () => {
    switch (activeSidebar) {
      case "info":
        return <InfoSidebar onClose={() => toggleSidebar(null)} />;
      case "users":
        return (
          <UsersSidebar
            isHost={isHost}
            onClose={() => toggleSidebar(null)}
            onPinParticipant={setPinnedParticipantIdentity}
            pinnedParticipantIdentity={pinnedParticipantIdentity}
            spaceId={spaceData?.id}
          />
        );
      case "chat":
        return <ChatSidebar onClose={() => toggleSidebar(null)} />;
      default:
        return null;
    }
  };

  if (!livekit) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-call-border bg-call-primary text-sm text-foreground/70">
        Missing LiveKit join token. Please rejoin the room.
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
        {connectionError}
      </div>
    );
  }

  const connectOptions = {
    maxRetries: 5,
    peerConnectionTimeout: 60000,
  };

  return (
    <LiveKitRoom
      room={room}
      serverUrl={livekit.url}
      token={livekit.token}
      connect={connectionReady}
      audio={preJoinSettings?.audioEnabled ?? true}
      video={preJoinSettings?.videoEnabled ?? true}
      connectOptions={connectOptions}
      onDisconnected={(reason) => {
        if (
          reason === DisconnectReason.DUPLICATE_IDENTITY ||
          reason === DisconnectReason.PARTICIPANT_REMOVED ||
          reason === DisconnectReason.ROOM_DELETED
        ) {
          const message =
            reason === DisconnectReason.DUPLICATE_IDENTITY
              ? {
                  title: "Call disconnected",
                  description:
                    "This session was disconnected because the same participant joined from another tab or device.",
                }
              : {
                  title: "Call ended",
                  description:
                    "The room is no longer available. You can return to the dashboard.",
                };

          setDisconnectWarning(message);
        }
      }}
      onError={(error) => {
        if (error.name === "NotAllowedError") return;

        setConnectionError(error.message);
      }}
      onMediaDeviceFailure={(error, kind) => {
        if (error === MediaDeviceFailure.PermissionDenied) {
          return;
        }

        toast.error(`Unable to access ${kind || "media device"}.`);
      }}
      className="flex h-full flex-col gap-2 bg-call-background"
    >
      <LiveKitChatProvider>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <LiveKitVideoStage
              deafened={deafened}
              isHost={isHost}
              pinnedParticipantIdentity={pinnedParticipantIdentity}
              roomCode={roomCode}
            />
          </div>
          {activeSidebar && (
            <div className="ml-2 flex h-full shrink-0 items-center justify-center">
              <div className="flex h-full w-[350px] flex-col items-stretch justify-start overflow-hidden rounded-2xl border border-call-border bg-call-primary">
                {renderSidebarContent()}
              </div>
            </div>
          )}
        </div>
      </LiveKitChatProvider>
      <div className="shrink-0">
        <LiveKitControls
          activeSidebar={activeSidebar}
          deafened={deafened}
          isHost={isHost}
          roomCode={roomCode}
          setDeafened={setDeafened}
          onEndForAll={handleEndForAll}
          onLeave={handleLeave}
          toggleSidebar={toggleSidebar}
        />
      </div>
      {disconnectWarning && (
        <CallWarningDialog
          title={disconnectWarning.title}
          description={disconnectWarning.description}
          confirmLabel="Go to dashboard"
          confirmVariant="default"
          onConfirm={() => navigate("/dashboard/home")}
        />
      )}
    </LiveKitRoom>
  );
};

export default LiveKitSpaceScreen;
