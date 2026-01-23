import {
  BsFillRecordCircleFill,
  BsFillTelephoneFill,
  BsInfoLg,
  BsStopCircleFill,
} from "react-icons/bs";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { FiVideo, FiVideoOff } from "react-icons/fi";
import { LuLayoutDashboard, LuScreenShare, LuUsers } from "react-icons/lu";
import { RxSpeakerLoud, RxSpeakerOff } from "react-icons/rx";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import DateComponent from "@/utils/Time";
import { IoChatbubbleOutline } from "react-icons/io5";
import ControlButton from "./controls/ControlButton";
import type { RecordingState } from "@/hooks/useRecordingManager";

type SidebarType = "info" | "users" | "chat" | null;

interface ControlsProps {
  muted: boolean;
  playing: boolean;
  toggleAudio: () => void;
  toggleVideo: () => void;
  leaveRoom: () => void;
  speakerMuted: boolean;
  toggleSpeaker: () => void;
  toggleSidebar: (sidebarType: SidebarType) => void;
  activeSidebar: SidebarType;
  // Recording props
  isHost?: boolean;
  recordingState?: RecordingState;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
}

const VideoCallControls = (props: ControlsProps) => {
  const {
    muted,
    playing,
    toggleAudio,
    toggleVideo,
    leaveRoom,
    speakerMuted,
    toggleSpeaker,
    toggleSidebar,
    activeSidebar,
    // Recording props
    isHost = false,
    recordingState = "idle",
    onStartRecording,
    onStopRecording,
  } = props;

  // Determine recording button state
  const isRecording = recordingState === "recording";
  const isLoading =
    recordingState === "starting" || recordingState === "stopping";
  const canRecord =
    isHost &&
    (recordingState === "idle" ||
      recordingState === "complete" ||
      recordingState === "error");
  const canStop = isHost && isRecording;

  // Handle recording button click
  const handleRecordingClick = () => {
    if (isLoading) return;

    if (canRecord && onStartRecording) {
      onStartRecording();
    } else if (canStop && onStopRecording) {
      onStopRecording();
    }
  };

  // Get button label and icon based on state
  const getRecordingButton = () => {
    if (isLoading) {
      return {
        icon: <AiOutlineLoading3Quarters className="text-base animate-spin" />,
        label: recordingState === "starting" ? "Starting" : "Stopping",
        iconText: recordingState === "starting" ? "Starting..." : "Stopping...",
        variant: "record" as const,
        disabled: true,
      };
    }

    if (isRecording) {
      return {
        icon: <BsStopCircleFill className="text-base" />,
        label: "Stop",
        iconText: "Stop",
        variant: "stop" as const,
        disabled: !isHost,
      };
    }

    return {
      icon: <BsFillRecordCircleFill className="text-base" />,
      label: "Record",
      iconText: "Record",
      variant: "record" as const,
      disabled: !isHost,
    };
  };

  const recordingButton = getRecordingButton();

  return (
    <div className="relative flex w-full justify-between items-center">
      <div>
        <DateComponent className="" />
      </div>
      <div className="select-none flex items-center gap-2.5 p-2 absolute left-1/2 -translate-x-1/2">
        <RecordButton
          icon={recordingButton.icon}
          label={recordingButton.label}
          iconText={recordingButton.iconText}
          variant={recordingButton.variant}
          disabled={recordingButton.disabled}
          onClick={handleRecordingClick}
          isHost={isHost}
        />
        <ControlButton
          icon={muted ? <RiMicOffLine /> : <RiMicLine />}
          label="Mic"
          onClick={toggleAudio}
        />
        <ControlButton
          icon={playing ? <FiVideo /> : <FiVideoOff />}
          label="Cam"
          onClick={toggleVideo}
        />
        <ControlButton
          icon={speakerMuted ? <RxSpeakerOff /> : <RxSpeakerLoud />}
          label="Speaker"
          onClick={toggleSpeaker}
        />
        <ControlButton icon={<LuScreenShare />} label="Share" />
        <div className="h-8 border-r border-primary-border mx-1 mb-4.5" />
        <ControlButton
          icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
          label="Leave"
          onClick={leaveRoom}
          variant="danger"
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

/**
 * Custom Record Button component with special styling for record/stop states
 */
interface RecordButtonProps {
  icon: React.ReactNode;
  label: string;
  iconText: string;
  variant: "record" | "stop";
  disabled: boolean;
  onClick: () => void;
  isHost: boolean;
}

const RecordButton = ({
  icon,
  label,
  iconText,
  variant,
  disabled,
  onClick,
  isHost,
}: RecordButtonProps) => {
  const getVariantClasses = () => {
    if (disabled && !isHost) {
      return "bg-gray-500/50 text-gray-300 cursor-not-allowed";
    }
    if (disabled) {
      return "bg-gray-500/50 text-white cursor-wait";
    }
    if (variant === "stop") {
      return "bg-red-600 text-white hover:bg-red-700";
    }
    return "bg-red-500 text-white hover:bg-red-600";
  };

  return (
    <div className="flex flex-col gap-1 items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex gap-1.5 items-center justify-center rounded-xl font-medium text-sm py-3 px-4 cursor-pointer transition-all duration-200 ${getVariantClasses()}`}
        title={!isHost ? "Only host can control recording" : undefined}
      >
        {icon}
        <span>{iconText}</span>
      </button>
      <p className="text-[0.675rem] text-foreground/50">{label}</p>
    </div>
  );
};

export default VideoCallControls;
