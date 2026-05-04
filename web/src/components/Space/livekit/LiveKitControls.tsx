import { useLocalParticipant } from "@livekit/components-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { BsFillTelephoneFill, BsInfoLg } from "react-icons/bs";
import {
  FiMaximize2,
  FiMinimize2,
  FiMoon,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { IoChatbubbleOutline } from "react-icons/io5";
import { LuScreenShare, LuScreenShareOff, LuUsers } from "react-icons/lu";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { SlOptionsVertical } from "react-icons/sl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import DateComponent from "@/utils/Time";
import playClickSound from "@/utils/ClickSound";
import ControlButton from "../controls/ControlButton";
import CallWarningDialog from "../ui/CallWarningDialog";

type SidebarType = "info" | "users" | "chat" | null;
type ExitAction = "end-for-all" | null;

interface LiveKitControlsProps {
  activeSidebar: SidebarType;
  isHost: boolean;
  roomCode: string;
  onEndForAll: () => void;
  onLeave: () => void;
  toggleSidebar: (sidebarType: SidebarType) => void;
}

const LiveKitControls = ({
  activeSidebar,
  isHost,
  roomCode,
  onEndForAll,
  onLeave,
  toggleSidebar,
}: LiveKitControlsProps) => {
  const [pendingExitAction, setPendingExitAction] = useState<ExitAction>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
    localParticipant,
  } = useLocalParticipant();
  const participantRole = localParticipant.attributes.role;
  const canEndForAll =
    isHost ||
    localParticipant.attributes.room_admin === "true" ||
    participantRole === "HOST" ||
    participantRole === "CO_HOST";

  const toggleMicrophone = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const toggleScreenShare = async () => {
    await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await document.documentElement.requestFullscreen();
  };

  const exitDialogCopy = {
    "end-for-all": {
      title: "End for everyone?",
      description:
        "This will end the call for every participant and close the room.",
      confirmLabel: "End for all",
    },
  };

  const handleExitConfirm = () => {
    const action = pendingExitAction;
    setPendingExitAction(null);

    if (action === "end-for-all") {
      onEndForAll();
    }
  };

  const pendingExitCopy = pendingExitAction
    ? exitDialogCopy[pendingExitAction]
    : null;

  const handleLeaveSelect = () => {
    onLeave();
  };

  const renderTimeCode = () => (
    <div className="ml-2 flex items-center gap-4">
      <DateComponent className="text-base font-normal text-foreground" />
      <span className="h-5 w-px bg-foreground/45" />
      <span className="text-base font-normal text-foreground">{roomCode}</span>
    </div>
  );

  const renderOptionsControl = () => (
    <div className="flex flex-col gap-1 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={playClickSound}
            className="flex items-center justify-center border border-call-border bg-call-primary p-3 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 hover:bg-primary-hover"
            aria-label="Call options"
          >
            <SlOptionsVertical />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          side="top"
          sideOffset={8}
          className="min-w-[170px] rounded-xl border-call-border bg-call-background p-1.5"
        >
          <DropdownMenuItem
            onSelect={toggleTheme}
            className="cursor-pointer rounded-lg px-3 py-2"
          >
            {resolvedTheme === "dark" ? <FiSun /> : <FiMoon />}
            Switch theme
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={toggleFullscreen}
            className="cursor-pointer rounded-lg px-3 py-2"
          >
            {isFullscreen ? <FiMinimize2 /> : <FiMaximize2 />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-[0.675rem] text-foreground/50">Options</p>
    </div>
  );

  const renderEndControl = () =>
    canEndForAll ? (
      <div className="flex flex-col gap-1 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={playClickSound}
              className="flex items-center justify-center border border-red-400/10 bg-red-400/20 p-3 rounded-xl text-lg font-medium text-red-400 cursor-pointer transition-all duration-200 hover:bg-red-400/40"
              aria-label="End call options"
            >
              <BsFillTelephoneFill className="-rotate-[225deg]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            side="top"
            sideOffset={8}
            className="min-w-[150px] rounded-xl border-call-border bg-call-background p-1.5"
          >
            <DropdownMenuItem
              onSelect={handleLeaveSelect}
              className="cursor-pointer rounded-lg px-3 py-2"
            >
              Leave call
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setPendingExitAction("end-for-all")}
              variant="destructive"
              className="cursor-pointer rounded-lg px-3 py-2"
            >
              End for all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-[0.675rem] text-foreground/50">End</p>
      </div>
    ) : (
      <ControlButton
        icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
        label="End"
        onClick={onLeave}
        variant="danger"
      />
    );

  const renderPrimaryControls = () => (
    <div className="select-none flex items-center gap-2.5 p-2">
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
      {renderOptionsControl()}
      <div className="h-8 border-r border-primary-border mx-1 mb-4.5" />
      {renderEndControl()}
    </div>
  );

  const renderSidebarControls = () => (
    <div className="flex items-center gap-2 select-none">
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
  );

  return (
    <>
      <div className="relative flex w-full justify-between items-center">
        {renderTimeCode()}
        <div className="absolute left-1/2 -translate-x-1/2">
          {renderPrimaryControls()}
        </div>
        {renderSidebarControls()}
      </div>
      {pendingExitCopy && (
        <CallWarningDialog
          title={pendingExitCopy.title}
          description={pendingExitCopy.description}
          confirmLabel={pendingExitCopy.confirmLabel}
          onCancel={() => setPendingExitAction(null)}
          onConfirm={handleExitConfirm}
        />
      )}
    </>
  );
};

export default LiveKitControls;
