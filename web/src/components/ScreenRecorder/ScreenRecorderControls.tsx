import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { BsFillTelephoneFill, BsInfoLg, BsFillRecordCircleFill } from "react-icons/bs";
import {
  FiChevronDown,
  FiChevronUp,
  FiCheckSquare,
  FiMoon,
  FiSquare,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { Maximize, Minimize } from "lucide-react";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { SlOptionsVertical } from "react-icons/sl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { Square, Monitor, Camera, PictureInPicture2, LayoutTemplate } from "lucide-react";
import { FiUploadCloud } from "react-icons/fi";
import { cn } from "@/lib/utils";
import { sortMediaDevices } from "@/lib/mediaDevices";
import { markLocalMediaAction } from "@/lib/localMediaIntent";
import playClickSound from "@/utils/ClickSound";
import ControlButton from "../Space/controls/ControlButton";
import {
  useScreenRecordingContext,
  type ScreenRecorderLayout,
} from "./ScreenRecordingProvider";
import { useLocalMedia } from "./LocalMediaProvider";

const LAYOUT_OPTIONS: {
  value: ScreenRecorderLayout;
  label: string;
  icon: ReactNode;
}[] = [
  { value: "screen", label: "Screen only", icon: <Monitor size={16} /> },
  { value: "camera", label: "Camera only", icon: <Camera size={16} /> },
  {
    value: "screen-camera",
    label: "Screen + camera",
    icon: <PictureInPicture2 size={16} />,
  },
];

const formatDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

type SelectableDeviceKind = "audioinput" | "videoinput";

interface ScreenRecorderControlsProps {
  onExit: () => void;
}

const ScreenRecorderControls = ({ onExit }: ScreenRecorderControlsProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [openMediaMenu, setOpenMediaMenu] = useState<"mic" | "cam" | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
    toggleCamera: toggleCameraMedia,
    toggleMicrophone: toggleMicrophoneMedia,
    stopScreenShare: stopScreenShareMedia,
    microphoneDevices: rawMicrophoneDevices,
    cameraDevices: rawCameraDevices,
    activeMicrophoneId: activeMicrophoneDeviceId,
    activeCameraId: activeCameraDeviceId,
    selectMicrophone,
    selectCamera,
    ensureDevicePermissions,
    stopAll,
  } = useLocalMedia();
  const {
    recordingState,
    recordingDurationMs,
    uploadProgress,
    isActive,
    toggleRecording: toggleRecordingState,
    info,
    setInfo,
    layout,
    setLayout,
  } = useScreenRecordingContext();
  const [infoDraft, setInfoDraft] = useState(info);

  // A layout can only be recorded once every video source it displays is live.
  // The microphone remains optional for all layouts.
  const isLayoutReady =
    layout === "screen"
      ? isScreenShareEnabled
      : layout === "camera"
        ? isCameraEnabled
        : isScreenShareEnabled && isCameraEnabled;

  const microphoneDevices = sortMediaDevices(rawMicrophoneDevices);
  const cameraDevices = sortMediaDevices(rawCameraDevices);

  const toggleMicrophone = async () => {
    markLocalMediaAction();
    try {
      await toggleMicrophoneMedia();
    } catch {
      // The control state remains unchanged when media access fails.
    }
  };

  const toggleCamera = async () => {
    markLocalMediaAction();
    try {
      await toggleCameraMedia();
    } catch {
      // The control state remains unchanged when media access fails.
    }
  };

  const handleDeviceSelect = async (
    kind: SelectableDeviceKind,
    deviceId: string,
  ) => {
    markLocalMediaAction();
    try {
      if (kind === "audioinput") await selectMicrophone(deviceId);
      else await selectCamera(deviceId);
    } catch {
      // Keep the previously selected device if switching fails.
    }
  };

  // Switching layout also turns off the source that the new layout hides, so we
  // never keep (or record) a stream the user can no longer see/control.
  const handleLayoutChange = (next: ScreenRecorderLayout) => {
    if (next === "screen" && isCameraEnabled) void toggleCameraMedia();
    if (next === "camera" && isScreenShareEnabled) void stopScreenShareMedia();
    setLayout(next);
  };

  // End → turn EVERYTHING off (recording, camera, mic, screen share) and go to
  // the dashboard. If a recording was running, it still finishes uploading in
  // the background (providers are app-level); stopping tracks flushes the last
  // chunk.
  const handleExit = () => {
    if (isActive) toggleRecordingState();
    stopAll();
    onExit();
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
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be blocked by the browser.
    }
  };

  const getDeviceLabel = (
    devices: MediaDeviceInfo[],
    activeDeviceId: string,
    fallback: string,
  ) => {
    const device = devices.find((item) => item.deviceId === activeDeviceId);
    const defaultDevice = devices.find((item) => item.deviceId === "default");
    return device?.label || defaultDevice?.label || devices[0]?.label || fallback;
  };

  const getSelectedDeviceId = (
    devices: MediaDeviceInfo[],
    activeDeviceId: string,
  ) => {
    if (devices.some((device) => device.deviceId === activeDeviceId)) {
      return activeDeviceId;
    }
    const defaultDevice = devices.find((device) => device.deviceId === "default");
    if (defaultDevice) return defaultDevice.deviceId;
    return devices[0]?.deviceId ?? "";
  };

  const activeMicrophoneLabel = getDeviceLabel(
    microphoneDevices,
    activeMicrophoneDeviceId,
    "Default microphone",
  );
  const activeCameraLabel = getDeviceLabel(
    cameraDevices,
    activeCameraDeviceId,
    "Default camera",
  );
  const selectedMicrophoneDeviceId = getSelectedDeviceId(
    microphoneDevices,
    activeMicrophoneDeviceId,
  );
  const selectedCameraDeviceId = getSelectedDeviceId(
    cameraDevices,
    activeCameraDeviceId,
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
        {(kind === "audioinput" &&
          selectedMicrophoneDeviceId === device.deviceId) ||
        (kind === "videoinput" &&
          selectedCameraDeviceId === device.deviceId) ? (
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
      sideOffset={8}
      className="w-[250px] rounded-xl border-call-border bg-call-background p-1.5 overflow-visible"
    >
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 focus:bg-primary-hover data-[state=open]:bg-primary-hover">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-normal text-foreground">Input Device</p>
            <p className="mt-0.5 truncate text-[0.7rem] text-foreground/55">
              {activeMicrophoneLabel}
            </p>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={12}
          collisionPadding={8}
          className="w-[250px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuRadioGroup value={selectedMicrophoneDeviceId}>
            {renderDeviceRadioItems("audioinput", microphoneDevices)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  );

  const renderCameraDeviceMenu = () => (
    <DropdownMenuContent
      align="start"
      alignOffset={-46}
      collisionPadding={8}
      side="top"
      sideOffset={8}
      className="w-[250px] rounded-xl border-call-border bg-call-background p-1.5 overflow-visible"
    >
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 focus:bg-primary-hover data-[state=open]:bg-primary-hover">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-normal text-foreground">Camera</p>
            <p className="mt-0.5 truncate text-[0.7rem] text-foreground/55">
              {activeCameraLabel}
            </p>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={12}
          collisionPadding={8}
          className="w-[250px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuRadioGroup value={selectedCameraDeviceId}>
            {renderDeviceRadioItems("videoinput", cameraDevices)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
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
    disabled = false,
  }: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    menu: ReactNode;
    activeLabel: string;
    active: boolean;
    menuId: "mic" | "cam";
    disabled?: boolean;
  }) => (
    <div
      className={cn(
        "flex flex-col gap-1 items-center",
        disabled && "opacity-50",
      )}
    >
      <div className="flex items-stretch gap-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            playClickSound();
            onClick();
          }}
          className={cn(
            "flex min-h-11 w-11 items-center justify-center rounded-l-xl border text-lg font-medium transition-all duration-200",
            disabled
              ? "cursor-not-allowed border-call-border bg-primary"
              : active
                ? "cursor-pointer border-call-border bg-primary hover:bg-muted"
                : "cursor-pointer border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
          aria-label={label}
        >
          {icon}
        </button>
        <DropdownMenu
          open={openMediaMenu === menuId}
          onOpenChange={(open) => {
            if (disabled) return;
            if (open) ensureDevicePermissions();
            setOpenMediaMenu(open ? menuId : null);
          }}
        >
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              disabled={disabled}
              onClick={playClickSound}
              className={cn(
                "flex min-h-11 w-6 items-center justify-center rounded-r-xl border text-base font-medium transition-all duration-200",
                disabled
                  ? "cursor-not-allowed border-call-border bg-primary"
                  : active
                    ? openMediaMenu === menuId
                      ? "cursor-pointer border-call-border bg-muted"
                      : "cursor-pointer border-call-border bg-primary hover:bg-muted"
                    : openMediaMenu === menuId
                      ? "cursor-pointer border-red-400/10 bg-red-400/40 text-red-400"
                      : "cursor-pointer border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
              )}
              aria-label={activeLabel}
            >
              {openMediaMenu === menuId ? <FiChevronUp /> : <FiChevronDown />}
            </button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
    </div>
  );

  const renderLayoutControl = () => {
    return (
      <div className="flex flex-col gap-1 items-center">
        <DropdownMenu
          open={isLayoutMenuOpen}
          onOpenChange={(open) => {
            if (isActive) return; // locked while recording
            setIsLayoutMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger asChild disabled={isActive}>
            <button
              type="button"
              disabled={isActive}
              onClick={playClickSound}
              className={cn(
                "flex items-center justify-center border border-call-border p-3 rounded-xl text-lg font-medium transition-all duration-200",
                isActive
                  ? "cursor-not-allowed bg-primary opacity-50"
                  : cn(
                      "cursor-pointer hover:bg-muted",
                      isLayoutMenuOpen ? "bg-muted" : "bg-primary",
                    ),
              )}
              aria-label="Layout"
            >
              <LayoutTemplate size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            side="top"
            sideOffset={8}
            className="flex min-w-[180px] flex-col gap-1 rounded-xl border-call-border bg-call-background p-1"
          >
            {LAYOUT_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => handleLayoutChange(option.value)}
                className={cn(
                  "cursor-pointer rounded-lg px-2.5 py-1.5 text-sm",
                  option.value === layout && "bg-primary-hover",
                )}
              >
                {option.icon}
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const renderOptionsControl = () => (
    <div className="flex flex-col gap-1 items-center">
      <DropdownMenu open={isOptionsMenuOpen} onOpenChange={setIsOptionsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={playClickSound}
            className={cn(
              "flex items-center justify-center border border-call-border p-3 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 hover:bg-muted",
              isOptionsMenuOpen ? "bg-muted" : "bg-primary",
            )}
            aria-label="Options"
          >
            <SlOptionsVertical />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          side="top"
          sideOffset={8}
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
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setInfoDraft(info);
              setIsInfoModalOpen(true);
            }}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
          >
            <BsInfoLg size={16} />
            Info
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const renderRecordControl = () => {
    const isRecording = recordingState === "recording";
    const isBusy =
      recordingState === "starting" ||
      recordingState === "countdown" ||
      recordingState === "stopping" ||
      recordingState === "uploading";
    // Never disable an active recording solely because a source was turned off:
    // the user must always be able to stop it. Before starting, however, every
    // source required by the selected layout must be on.
    const isStartDisabled = !isRecording && (!isLayoutReady || isBusy);
    const unavailableReason =
      layout === "screen"
        ? "Turn on screen sharing to record"
        : layout === "camera"
          ? "Turn on the camera to record"
          : "Turn on screen sharing and the camera to record";

    let caption = "Record";
    if (recordingState === "countdown" || recordingState === "starting")
      caption = "Starting…";
    else if (recordingState === "stopping") caption = "Saving…";
    else if (recordingState === "uploading") caption = `Uploading ${uploadProgress}%`;
    else if (isRecording) caption = `Recording ${formatDuration(recordingDurationMs)}`;

    return (
      <div className="flex flex-col gap-1 items-center">
        <button
          type="button"
          disabled={isStartDisabled}
          onClick={() => {
            playClickSound();
            if (!isRecording && !isLayoutReady) {
              return;
            }
            toggleRecordingState();
          }}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-all duration-200",
            isRecording
              ? "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700"
              : isStartDisabled
                ? "cursor-not-allowed border-call-border bg-muted text-foreground/45"
                : "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:border-red-600",
          )}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          title={!isRecording && !isLayoutReady ? unavailableReason : undefined}
        >
          {recordingState === "uploading" ? (
            <FiUploadCloud className="size-4 animate-pulse text-white" />
          ) : isRecording ? (
            <Square className="size-4 fill-white text-white" />
          ) : (
            <BsFillRecordCircleFill className="size-4 text-white" />
          )}
          <span className="tabular-nums">{caption}</span>
        </button>
      </div>
    );
  };

  const renderPrimaryControls = () => (
    <div className="select-none flex items-center gap-2.5 rounded-2xl bg-call-background p-2">
      {renderRecordControl()}
      {renderSplitMediaControl({
        icon: isMicrophoneEnabled ? <RiMicLine /> : <RiMicOffLine />,
        label: "Mic",
        onClick: toggleMicrophone,
        menu: renderMicDeviceMenu(),
        activeLabel: "Microphone options",
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
        disabled: layout === "screen",
      })}
      {renderLayoutControl()}
      {renderOptionsControl()}
      <div className="h-8 border-r border-primary-border mx-1" />
      <ControlButton
        icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
        label="Exit"
        showLabel={false}
        onClick={handleExit}
        variant="danger"
      />
    </div>
  );

  const renderInfoModal = () =>
    isInfoModalOpen && (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
        onClick={() => setIsInfoModalOpen(false)}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-call-border bg-call-background p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-foreground">
            Recording details
          </h2>
          <p className="mt-1 text-sm text-foreground/55">
            Saved with this recording.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Title</label>
              <input
                type="text"
                value={infoDraft.title}
                onChange={(e) =>
                  setInfoDraft((d) => ({ ...d, title: e.target.value }))
                }
                placeholder="Untitled recording"
                className="rounded-xl border border-call-border bg-primary px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                value={infoDraft.description}
                onChange={(e) =>
                  setInfoDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="What's this recording about?"
                rows={4}
                className="resize-none rounded-xl border border-call-border bg-primary px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
              />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsInfoModalOpen(false)}
              className="rounded-xl border border-call-border bg-call-primary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setInfo(infoDraft);
                setIsInfoModalOpen(false);
              }}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="relative mt-0 flex w-full items-center justify-center px-3 py-2">
      {renderPrimaryControls()}
      {renderInfoModal()}
    </div>
  );
};

export default ScreenRecorderControls;
