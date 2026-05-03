import {
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { BsFillTelephoneFill, BsInfoLg } from "react-icons/bs";
import { FiVideo, FiVideoOff } from "react-icons/fi";
import { IoChatbubbleOutline } from "react-icons/io5";
import { LuLayoutDashboard, LuScreenShare, LuScreenShareOff, LuUsers } from "react-icons/lu";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import DateComponent from "@/utils/Time";
import ControlButton from "../controls/ControlButton";

type SidebarType = "info" | "users" | "chat" | null;

interface LiveKitControlsProps {
  activeSidebar: SidebarType;
  isHost: boolean;
  onEndForAll: () => void;
  onLeave: () => void;
  toggleSidebar: (sidebarType: SidebarType) => void;
}

const LiveKitControls = ({
  activeSidebar,
  isHost,
  onEndForAll,
  onLeave,
  toggleSidebar,
}: LiveKitControlsProps) => {
  const room = useRoomContext();
  const connectionState = useConnectionState(room);
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
    localParticipant,
  } = useLocalParticipant();

  const toggleMicrophone = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const toggleScreenShare = async () => {
    await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
  };

  const handleLeave = () => {
    const message = isHost
      ? "Leave this call? Use End for all if you want to close the room for everyone."
      : "Leave this call?";

    if (window.confirm(message)) {
      onLeave();
    }
  };

  const handleEndForAll = () => {
    if (window.confirm("End this room for everyone?")) {
      onEndForAll();
    }
  };

  return (
    <div className="relative flex w-full justify-between items-center">
      <div className="flex items-center gap-3">
        <DateComponent className="" />
        <span className="text-xs text-foreground/50 capitalize">
          {connectionState}
        </span>
      </div>

      <div className="select-none flex items-center gap-2.5 p-2 absolute left-1/2 -translate-x-1/2">
        <ControlButton
          icon={isMicrophoneEnabled ? <RiMicLine /> : <RiMicOffLine />}
          label="Mic"
          onClick={toggleMicrophone}
        />
        <ControlButton
          icon={isCameraEnabled ? <FiVideo /> : <FiVideoOff />}
          label="Cam"
          onClick={toggleCamera}
        />
        <ControlButton
          icon={isScreenShareEnabled ? <LuScreenShareOff /> : <LuScreenShare />}
          label="Share"
          onClick={toggleScreenShare}
        />
        <div className="h-8 border-r border-primary-border mx-1 mb-4.5" />
        {isHost && (
          <ControlButton
            icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
            label="End all"
            onClick={handleEndForAll}
            variant="danger"
          />
        )}
        <ControlButton
          icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
          label="Leave"
          onClick={handleLeave}
          variant={isHost ? "default" : "danger"}
        />
      </div>

      <div className="flex items-center gap-2 select-none">
        <ControlButton icon={<LuLayoutDashboard />} label="Layout" />
        <ControlButton
          icon={<BsInfoLg />}
          label="Info"
          sound={false}
          onClick={() => toggleSidebar("info")}
          variant={activeSidebar === "info" ? "active" : "default"}
        />
        <ControlButton
          icon={<LuUsers />}
          label="People"
          sound={false}
          onClick={() => toggleSidebar("users")}
          variant={activeSidebar === "users" ? "active" : "default"}
        />
        <ControlButton
          icon={<IoChatbubbleOutline />}
          label="Chat"
          sound={false}
          onClick={() => toggleSidebar("chat")}
          variant={activeSidebar === "chat" ? "active" : "default"}
        />
      </div>
    </div>
  );
};

export default LiveKitControls;
