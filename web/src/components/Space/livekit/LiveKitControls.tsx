import {
  useLocalParticipant,
  useMediaDeviceSelect,
} from "@livekit/components-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Track } from "livekit-client";
import toast from "react-hot-toast";
import { BsFillTelephoneFill, BsInfoLg } from "react-icons/bs";
import {
  FiChevronUp,
  FiMaximize2,
  FiMinimize2,
  FiMoon,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { IoChatbubbleOutline } from "react-icons/io5";
import { LuScreenShare, LuUsers } from "react-icons/lu";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { SlOptionsVertical } from "react-icons/sl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import DateComponent from "@/utils/Time";
import playClickSound from "@/utils/ClickSound";
import ControlButton from "../controls/ControlButton";
import CallWarningDialog from "../ui/CallWarningDialog";

type SidebarType = "info" | "users" | "chat" | null;
type ExitAction = "end-for-all" | null;
type SelectableDeviceKind = "audioinput" | "audiooutput" | "videoinput";

const isPermissionDeniedError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
    : error instanceof Error &&
      (error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError");

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
  const {
    devices: microphoneDevices,
    activeDeviceId: activeMicrophoneDeviceId,
    setActiveMediaDevice: setActiveMicrophoneDevice,
  } = useMediaDeviceSelect({ kind: "audioinput" });
  const {
    devices: speakerDevices,
    activeDeviceId: activeSpeakerDeviceId,
    setActiveMediaDevice: setActiveSpeakerDevice,
  } = useMediaDeviceSelect({ kind: "audiooutput" });
  const {
    devices: cameraDevices,
    activeDeviceId: activeCameraDeviceId,
    setActiveMediaDevice: setActiveCameraDevice,
  } = useMediaDeviceSelect({ kind: "videoinput" });
  const canSelectAudioOutput =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  const toggleMicrophone = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const handleDeviceSelect = async (
    kind: SelectableDeviceKind,
    deviceId: string,
  ) => {
    const options = { exact: deviceId !== "default" };

    if (kind === "audioinput") {
      await setActiveMicrophoneDevice(deviceId, options);
      return;
    }

    if (kind === "audiooutput") {
      await setActiveSpeakerDevice(deviceId, options);
      return;
    }

    await setActiveCameraDevice(deviceId, options);
  };

  const toggleScreenShare = async () => {
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;

      toast.error("Unable to start screen share.");
    }
  };

  const startScreenShare = async () => {
    try {
      if (!isScreenShareEnabled) {
        await localParticipant.setScreenShareEnabled(true);
        return;
      }

      const newTracks = await localParticipant.createScreenTracks();
      const newScreenTrack = newTracks.find(
        (track) => track.source === Track.Source.ScreenShare,
      );

      if (!newScreenTrack) {
        throw new Error("No screen share track was selected.");
      }

      const currentScreenPublication = localParticipant.getTrackPublication(
        Track.Source.ScreenShare,
      );
      const previousScreenMediaTrack =
        currentScreenPublication?.track?.mediaStreamTrack;

      if (currentScreenPublication?.track) {
        await currentScreenPublication.track.replaceTrack(
          newScreenTrack.mediaStreamTrack,
        );
        if (previousScreenMediaTrack !== newScreenTrack.mediaStreamTrack) {
          previousScreenMediaTrack?.stop();
        }
      } else {
        await localParticipant.publishTrack(newScreenTrack);
      }

      const newScreenAudioTrack = newTracks.find(
        (track) => track.source === Track.Source.ScreenShareAudio,
      );
      const currentScreenAudioPublication =
        localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      const previousScreenAudioMediaTrack =
        currentScreenAudioPublication?.track?.mediaStreamTrack;

      if (newScreenAudioTrack && currentScreenAudioPublication?.track) {
        await currentScreenAudioPublication.track.replaceTrack(
          newScreenAudioTrack.mediaStreamTrack,
        );
        if (
          previousScreenAudioMediaTrack !== newScreenAudioTrack.mediaStreamTrack
        ) {
          previousScreenAudioMediaTrack?.stop();
        }
      } else if (newScreenAudioTrack) {
        await localParticipant.publishTrack(newScreenAudioTrack);
      } else if (currentScreenAudioPublication?.track) {
        await localParticipant.unpublishTrack(
          currentScreenAudioPublication.track,
        );
      }
    } catch (error) {
      if (isPermissionDeniedError(error)) return;

      toast.error("Unable to start screen share.");
    }
  };

  const stopScreenShare = async () => {
    try {
      await localParticipant.setScreenShareEnabled(false);
    } catch {
      toast.error("Unable to stop screen share.");
    }
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

  const renderDeviceRadioItems = (
    kind: SelectableDeviceKind,
    devices: MediaDeviceInfo[],
  ) => {
    if (devices.length === 0) {
      return (
        <DropdownMenuItem
          disabled
          className="cursor-default rounded-lg px-3 py-2 text-foreground/50"
        >
          No devices found
        </DropdownMenuItem>
      );
    }

    return devices.map((device, index) => (
      <DropdownMenuRadioItem
        key={`${kind}-${device.deviceId || index}`}
        value={device.deviceId}
        onSelect={() => handleDeviceSelect(kind, device.deviceId)}
        className="max-w-[260px] cursor-pointer rounded-lg px-3 py-2 pl-8"
      >
        <span className="truncate">
          {device.label || `Device ${index + 1}`}
        </span>
      </DropdownMenuRadioItem>
    ));
  };

  const renderMicDeviceMenu = () => (
    <DropdownMenuContent
      align="start"
      collisionPadding={8}
      side="top"
      sideOffset={8}
      className="w-[290px] rounded-xl border-call-border bg-call-background p-1.5"
    >
      <DropdownMenuLabel className="px-3 py-2 text-xs font-medium uppercase text-foreground/45">
        Microphone
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={activeMicrophoneDeviceId}>
        {renderDeviceRadioItems("audioinput", microphoneDevices)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="mx-1 bg-call-border" />
      <DropdownMenuLabel className="px-3 py-2 text-xs font-medium uppercase text-foreground/45">
        Speaker
      </DropdownMenuLabel>
      {canSelectAudioOutput ? (
        <DropdownMenuRadioGroup value={activeSpeakerDeviceId}>
          {renderDeviceRadioItems("audiooutput", speakerDevices)}
        </DropdownMenuRadioGroup>
      ) : (
        <DropdownMenuItem
          disabled
          className="cursor-default rounded-lg px-3 py-2 text-foreground/50"
        >
          Speaker selection unsupported
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );

  const renderCameraDeviceMenu = () => (
    <DropdownMenuContent
      align="start"
      collisionPadding={8}
      side="top"
      sideOffset={8}
      className="w-[290px] rounded-xl border-call-border bg-call-background p-1.5"
    >
      <DropdownMenuLabel className="px-3 py-2 text-xs font-medium uppercase text-foreground/45">
        Camera
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={activeCameraDeviceId}>
        {renderDeviceRadioItems("videoinput", cameraDevices)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  );

  const renderSplitMediaControl = ({
    icon,
    label,
    onClick,
    menu,
    activeLabel,
    active,
  }: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    menu: ReactNode;
    activeLabel: string;
    active: boolean;
  }) => (
    <div className="flex flex-col gap-1 items-center">
      <div className="flex items-stretch">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={playClickSound}
              className={cn(
                "flex min-h-11 w-10 items-center justify-center rounded-l-xl border text-base font-medium cursor-pointer transition-all duration-200",
                active
                  ? "border-call-border bg-call-primary hover:bg-primary-hover"
                  : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
              )}
              aria-label={activeLabel}
            >
              <FiChevronUp />
            </button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
        <button
          type="button"
          onClick={() => {
            playClickSound();
            onClick();
          }}
          className={cn(
            "flex min-h-11 w-11 items-center justify-center rounded-r-xl border border-l-0 text-lg font-medium cursor-pointer transition-all duration-200",
            active
              ? "border-call-border bg-call-primary hover:bg-primary-hover"
              : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
          aria-label={label}
        >
          {icon}
        </button>
      </div>
      <p className="text-[0.675rem] text-foreground/50">{label}</p>
    </div>
  );

  const renderScreenShareControl = () =>
    isScreenShareEnabled ? (
      <div className="flex flex-col gap-1 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={playClickSound}
              className="flex items-center justify-center rounded-xl border border-emerald-400/10 bg-emerald-400/20 p-3 text-lg font-medium text-emerald-400 cursor-pointer transition-all duration-200 hover:bg-emerald-400/40"
              aria-label="Screen share options"
            >
              <LuScreenShare />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            side="top"
            sideOffset={8}
            className="min-w-[190px] rounded-xl border-call-border bg-call-background p-1.5"
          >
            <DropdownMenuItem
              onSelect={startScreenShare}
              className="cursor-pointer rounded-lg px-3 py-2"
            >
              Share something else
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={stopScreenShare}
              className="cursor-pointer rounded-lg px-3 py-2"
            >
              Stop sharing
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-[0.675rem] text-foreground/50">Share</p>
      </div>
    ) : (
      <ControlButton
        icon={<LuScreenShare />}
        label="Share"
        onClick={toggleScreenShare}
      />
    );

  const renderPrimaryControls = () => (
    <div className="select-none flex items-center gap-2.5 p-2">
      {renderSplitMediaControl({
        icon: isMicrophoneEnabled ? <RiMicLine /> : <RiMicOffLine />,
        label: "Mic",
        onClick: toggleMicrophone,
        menu: renderMicDeviceMenu(),
        activeLabel: "Microphone and speaker options",
        active: isMicrophoneEnabled,
      })}
      {renderSplitMediaControl({
        icon: isCameraEnabled ? <FiVideo /> : <FiVideoOff />,
        label: "Cam",
        onClick: toggleCamera,
        menu: renderCameraDeviceMenu(),
        activeLabel: "Camera options",
        active: isCameraEnabled,
      })}
      {renderScreenShareControl()}
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
