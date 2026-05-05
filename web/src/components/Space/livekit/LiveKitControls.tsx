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
  FiChevronDown,
  FiChevronUp,
  FiCheckSquare,
  FiMaximize2,
  FiMinimize2,
  FiMoon,
  FiSettings,
  FiSquare,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { IoChatbubbleOutline } from "react-icons/io5";
import { LuScreenShare, LuScreenShareOff, LuUsers } from "react-icons/lu";
import { MdCallEnd, MdLogout } from "react-icons/md";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { SlOptionsVertical } from "react-icons/sl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  const [inputVolume, setInputVolume] = useState(100);
  const [outputVolume, setOutputVolume] = useState(50);
  const [deafened, setDeafened] = useState(false);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [openMediaMenu, setOpenMediaMenu] = useState<"mic" | "cam" | null>(
    null,
  );
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

  const getDeviceLabel = (
    devices: MediaDeviceInfo[],
    activeDeviceId: string,
    fallback: string,
  ) => {
    const device = devices.find((item) => item.deviceId === activeDeviceId);

    return device?.label || devices[0]?.label || fallback;
  };

  const activeMicrophoneLabel = getDeviceLabel(
    microphoneDevices,
    activeMicrophoneDeviceId,
    "Default microphone",
  );
  const activeSpeakerLabel = getDeviceLabel(
    speakerDevices,
    activeSpeakerDeviceId,
    "Default speaker",
  );

  const renderVolumeMeter = (value: number) => (
    <div className="mt-2 grid grid-cols-[repeat(20,1fr)] gap-0.5">
      {Array.from({ length: 20 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "h-4 rounded-full",
            index < Math.round((value / 100) * 20)
              ? "bg-indigo-400"
              : "bg-foreground/15",
          )}
        />
      ))}
    </div>
  );

  const renderRangeControl = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    showMeter = false,
  ) => (
    <div className="px-2.5 py-2">
      <p className="text-xs font-normal text-foreground/85">{label}</p>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-1 w-full cursor-pointer accent-indigo-400"
      />
      {showMeter && renderVolumeMeter(value)}
    </div>
  );

  const renderTimeCode = () => (
    <div className="ml-2 flex items-center gap-4">
      <DateComponent className="text-base font-normal text-foreground" />
      <span className="h-5 w-px bg-foreground/45" />
      <span className="text-base font-normal text-foreground">{roomCode}</span>
    </div>
  );

  const renderOptionsControl = () => (
    <div className="flex flex-col gap-1 items-center">
      <DropdownMenu
        open={isOptionsMenuOpen}
        onOpenChange={setIsOptionsMenuOpen}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={playClickSound}
            className={cn(
              "flex items-center justify-center border border-call-border p-3 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 hover:bg-primary-hover",
              isOptionsMenuOpen ? "bg-primary-hover" : "bg-call-primary",
            )}
            aria-label="Call options"
          >
            <SlOptionsVertical />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          side="top"
          sideOffset={6}
          className="min-w-[160px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuItem
            onSelect={toggleTheme}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
          >
            {resolvedTheme === "dark" ? <FiSun /> : <FiMoon />}
            Switch theme
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={toggleFullscreen}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
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
              className="flex items-center justify-center border border-[#dc362e] bg-[#dc362e] p-3 rounded-xl text-lg font-medium text-white cursor-pointer transition-all duration-200 hover:border-[rgba(220,54,46,0.8)] hover:bg-[rgba(220,54,46,0.8)]"
              aria-label="End call options"
            >
              <BsFillTelephoneFill className="-rotate-[225deg]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            side="top"
            sideOffset={6}
            className="min-w-[145px] rounded-xl border-call-border bg-call-background p-1"
          >
            <DropdownMenuItem
              onSelect={handleLeaveSelect}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
            >
              <MdLogout />
              Leave call
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setPendingExitAction("end-for-all")}
              variant="destructive"
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
            >
              <MdCallEnd />
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
        onSelect={(event) => {
          event.preventDefault();
          void handleDeviceSelect(kind, device.deviceId);
        }}
        className="max-w-[250px] cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal [&>span:first-child]:hidden"
      >
        {((kind === "audioinput" && activeMicrophoneDeviceId === device.deviceId) ||
          (kind === "audiooutput" && activeSpeakerDeviceId === device.deviceId) ||
          (kind === "videoinput" && activeCameraDeviceId === device.deviceId)) ? (
          <FiCheckSquare className="size-4" />
        ) : (
          <FiSquare className="size-4" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {device.label || `Device ${index + 1}`}
        </span>
      </DropdownMenuRadioItem>
    ));
  };

  const renderMicDeviceMenu = () => (
    <DropdownMenuContent
      align="start"
      alignOffset={-46}
      collisionPadding={8}
      side="top"
      sideOffset={6}
      className="w-[250px] rounded-xl border-call-border bg-call-background p-1.5"
    >
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 focus:bg-primary-hover data-[state=open]:bg-primary-hover">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-normal text-foreground">
              Input Device
            </p>
            <p className="mt-0.5 truncate text-[0.7rem] text-foreground/55">
              {activeMicrophoneLabel}
            </p>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="w-[250px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuRadioGroup value={activeMicrophoneDeviceId}>
            {renderDeviceRadioItems("audioinput", microphoneDevices)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 focus:bg-primary-hover data-[state=open]:bg-primary-hover">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-normal text-foreground">
              Output Device
            </p>
            <p className="mt-0.5 truncate text-[0.7rem] text-foreground/55">
              {activeSpeakerLabel}
            </p>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="w-[250px] rounded-xl border-call-border bg-call-background p-1"
        >
          {canSelectAudioOutput ? (
            <DropdownMenuRadioGroup value={activeSpeakerDeviceId}>
              {renderDeviceRadioItems("audiooutput", speakerDevices)}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuItem
              disabled
              className="cursor-default rounded-lg px-2 py-1.5 text-xs text-foreground/50"
            >
              Speaker selection unsupported
            </DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator className="mx-2 my-1.5 bg-call-border" />
      {renderRangeControl("Input Volume", inputVolume, setInputVolume, true)}
      {renderRangeControl("Output Volume", outputVolume, setOutputVolume)}
      <DropdownMenuSeparator className="mx-2 my-1.5 bg-call-border" />
      <DropdownMenuCheckboxItem
        checked={deafened}
        onCheckedChange={(checked) => setDeafened(checked === true)}
        onSelect={(event) => event.preventDefault()}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal [&>span]:hidden"
      >
        {deafened ? <FiCheckSquare className="size-4" /> : <FiSquare className="size-4" />}
        Deafen
      </DropdownMenuCheckboxItem>
      <DropdownMenuItem
        onSelect={(event) => event.preventDefault()}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm font-normal"
      >
        <FiSettings className="size-4 text-foreground/60" />
        Voice Settings
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const renderCameraDeviceMenu = () => (
    <DropdownMenuContent
      align="start"
      alignOffset={-46}
      collisionPadding={8}
      side="top"
      sideOffset={6}
      className="w-[260px] rounded-xl border-call-border bg-call-background p-1"
    >
      <DropdownMenuLabel className="px-2.5 py-1.5 text-[0.65rem] font-medium uppercase text-foreground/45">
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
    menuId,
  }: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    menu: ReactNode;
    activeLabel: string;
    active: boolean;
    menuId: "mic" | "cam";
  }) => (
    <div className="flex flex-col gap-1 items-center">
      <div className="flex items-stretch gap-0.5">
        <button
          type="button"
          onClick={() => {
            playClickSound();
            onClick();
          }}
          className={cn(
            "flex min-h-11 w-11 items-center justify-center rounded-l-xl border text-lg font-medium cursor-pointer transition-all duration-200",
            active
              ? "border-call-border bg-call-primary hover:bg-primary-hover"
              : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
          aria-label={label}
        >
          {icon}
        </button>
        <DropdownMenu
          open={openMediaMenu === menuId}
          onOpenChange={(open) => setOpenMediaMenu(open ? menuId : null)}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={playClickSound}
              className={cn(
                "flex min-h-11 w-6 items-center justify-center rounded-r-xl border text-base font-medium cursor-pointer transition-all duration-200",
                active
                  ? openMediaMenu === menuId
                    ? "border-call-border bg-primary-hover"
                    : "border-call-border bg-call-primary hover:bg-primary-hover"
                  : openMediaMenu === menuId
                    ? "border-red-400/10 bg-red-400/40 text-red-400"
                    : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
              )}
              aria-label={activeLabel}
            >
              {openMediaMenu === menuId ? <FiChevronUp /> : <FiChevronDown />}
            </button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
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
              className="flex items-center justify-center rounded-xl border border-blue-400/10 bg-blue-400/20 p-3 text-lg font-medium text-blue-400 cursor-pointer transition-all duration-200 hover:bg-blue-400/40"
              aria-label="Screen share options"
            >
              <LuScreenShare />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            side="top"
            sideOffset={6}
            className="min-w-[180px] rounded-xl border-call-border bg-call-background p-1"
          >
            <DropdownMenuItem
              onSelect={startScreenShare}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
            >
              <LuScreenShare />
              Share something else
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={stopScreenShare}
              variant="destructive"
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm text-red-400 focus:bg-red-400/10 focus:text-red-400"
            >
              <LuScreenShareOff className="text-red-400" />
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
        sound={false}
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
        menuId: "mic",
      })}
      {renderSplitMediaControl({
        icon: isCameraEnabled ? <FiVideo /> : <FiVideoOff />,
        label: "Cam",
        onClick: toggleCamera,
        menu: renderCameraDeviceMenu(),
        activeLabel: "Camera options",
        active: isCameraEnabled,
        menuId: "cam",
      })}
      {renderOptionsControl()}
      {renderScreenShareControl()}
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
