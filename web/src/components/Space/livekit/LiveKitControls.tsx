import {
  useLocalParticipant,
  useMediaDeviceSelect,
} from "@livekit/components-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Track } from "livekit-client";
import toast from "react-hot-toast";
import { BsFillTelephoneFill, BsInfoLg } from "react-icons/bs";
import {
  FiChevronDown,
  FiChevronUp,
  FiCheckSquare,
  FiMoon,
  FiSettings,
  FiSmile,
  FiSquare,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { IoChatbubbleOutline, IoHandRightOutline } from "react-icons/io5";
import { Maximize, Minimize, SmilePlus } from "lucide-react";
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
import { useLiveKitReactions } from "../reactions/LiveKitReactionsProvider";

type SidebarType = "info" | "users" | "chat" | null;
type ExitAction = "end-for-all" | null;
type SelectableDeviceKind = "audioinput" | "audiooutput" | "videoinput";

const isPermissionDeniedError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
    : error instanceof Error &&
      (error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError");

const QUICK_REACTIONS = ["👍", "👏", "❤️", "😂", "🎉", "🔥"];
const EXTRA_REACTIONS = [
  "😀",
  "😁",
  "😅",
  "🤣",
  "😊",
  "😍",
  "😘",
  "😎",
  "🤔",
  "😴",
  "😭",
  "😡",
  "🥳",
  "🤩",
  "🙌",
  "👌",
  "✌️",
  "🙏",
  "💪",
  "👋",
  "🤝",
  "🫶",
  "💯",
  "✨",
  "⭐",
  "🌟",
  "🎊",
  "🍾",
  "🚀",
  "🏆",
  "😇",
  "😋",
  "😜",
  "🤗",
  "🤭",
  "🫡",
  "😌",
  "😬",
  "🤤",
  "😮",
  "😱",
  "🥹",
  "😤",
  "🤨",
  "🧠",
  "🫠",
  "🥲",
  "🐐",
  "💥",
  "🎯",
  "✅",
  "❌",
  "📣",
  "💫",
  "🕺",
  "💃",
  "🤘",
  "🫶🏻",
  "🫶🏽",
  "🫶🏿",
];

interface LiveKitControlsProps {
  activeSidebar: SidebarType;
  deafened: boolean;
  isHost: boolean;
  roomCode: string;
  setDeafened: (value: boolean) => void;
  onEndForAll: () => void;
  onLeave: () => void;
  toggleSidebar: (sidebarType: SidebarType) => void;
}

const LiveKitControls = ({
  activeSidebar,
  deafened,
  isHost,
  roomCode,
  setDeafened,
  onEndForAll,
  onLeave,
  toggleSidebar,
}: LiveKitControlsProps) => {
  const [pendingExitAction, setPendingExitAction] = useState<ExitAction>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inputVolume, setInputVolume] = useState(100);
  const [outputVolume, setOutputVolume] = useState(100);
  const [micLevel, setMicLevel] = useState(0);
  const animFrameRef = useRef<number>(null);
  const micGainContextRef = useRef<AudioContext | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const micGainSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const originalMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const processedMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [isReactionMenuOpen, setIsReactionMenuOpen] = useState(false);
  const [optimisticHandRaised, setOptimisticHandRaised] = useState<
    boolean | null
  >(null);
  const [openMediaMenu, setOpenMediaMenu] = useState<"mic" | "cam" | null>(
    null,
  );
  const previousMicEnabledBeforeDeafenRef = useRef<boolean | null>(null);
  const previousInputVolumeBeforeMuteRef = useRef(inputVolume);
  const previousInputVolumeBeforeDeafenRef = useRef(inputVolume);
  const previousOutputVolumeBeforeDeafenRef = useRef(outputVolume);
  const hasHandledInitialMicStateRef = useRef(false);
  const shouldApplyMuteVolumeRuleRef = useRef(false);
  const { resolvedTheme, setTheme } = useTheme();
  const { sendReaction } = useLiveKitReactions();
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
  const attributeHandRaised = localParticipant.attributes.handRaised === "true";
  const isHandRaised =
    optimisticHandRaised === null ? attributeHandRaised : optimisticHandRaised;

  useEffect(() => {
    if (optimisticHandRaised !== null && optimisticHandRaised === attributeHandRaised) {
      setOptimisticHandRaised(null);
    }
  }, [attributeHandRaised, optimisticHandRaised]);

  const toggleMicrophone = async () => {
    shouldApplyMuteVolumeRuleRef.current = true;
    if (deafened) {
      await handleDeafenToggle(false);
      await localParticipant.setMicrophoneEnabled(true);
      return;
    }
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const handleDeviceSelect = async (
    kind: SelectableDeviceKind,
    deviceId: string,
  ) => {
    const options = deviceId === "default" ? undefined : { exact: true };

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

  const toggleHandRaise = async () => {
    const nextValue = !isHandRaised;
    setOptimisticHandRaised(nextValue);

    try {
      await localParticipant.setAttributes({
        handRaised: nextValue ? "true" : "false",
      });
    } catch {
      setOptimisticHandRaised(null);
      toast.error("Unable to update hand raise status.");
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
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    const dataArray = new Uint8Array(64);

    const poll = () => {
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = avg / 255;
        const curved = Math.pow(normalized, 1.5);
        const inputGain = inputVolume / 100;
        // Lower input volume should reduce meter sensitivity and visible waves.
        setMicLevel(Math.min(100, Math.round(curved * 100 * 3 * inputGain)));
      }
      animFrameRef.current = requestAnimationFrame(poll);
    };

    const track = localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (track) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
      animFrameRef.current = requestAnimationFrame(poll);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      source?.disconnect();
      void audioContext?.close();
    };
  }, [inputVolume, localParticipant, isMicrophoneEnabled]);

  useEffect(() => {
    const applyOutputVolume = () => {
      const volume = deafened ? 0 : outputVolume / 100;
      document.querySelectorAll("audio, video").forEach((mediaNode) => {
        if (mediaNode instanceof HTMLMediaElement && !mediaNode.muted) {
          mediaNode.volume = volume;
        }
      });
    };

    applyOutputVolume();

    const observer = new MutationObserver(applyOutputVolume);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [deafened, outputVolume]);

  useEffect(() => {
    let cancelled = false;

    const setupMicGain = async () => {
      const publication = localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const localMicTrack = publication?.track;
      const publishedTrack = localMicTrack?.mediaStreamTrack;

      if (!localMicTrack || !publishedTrack || !isMicrophoneEnabled || deafened) {
        return;
      }

      const isPublishedTrackProcessed =
        !!processedMicTrackRef.current &&
        publishedTrack === processedMicTrackRef.current;
      const sourceTrack =
        isPublishedTrackProcessed && originalMicTrackRef.current
          ? originalMicTrackRef.current
          : publishedTrack;

      const needsRebuild =
        !micGainNodeRef.current ||
        !processedMicTrackRef.current ||
        originalMicTrackRef.current !== sourceTrack;

      if (needsRebuild) {
        micGainSourceRef.current?.disconnect();
        micGainNodeRef.current?.disconnect();
        if (processedMicTrackRef.current) {
          processedMicTrackRef.current.stop();
        }
        void micGainContextRef.current?.close();

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(
          new MediaStream([sourceTrack]),
        );
        const gainNode = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();

        source.connect(gainNode);
        gainNode.connect(destination);

        const processedTrack = destination.stream.getAudioTracks()[0];
        if (!processedTrack) return;

        await localMicTrack.replaceTrack(processedTrack);
        if (cancelled) {
          processedTrack.stop();
          void audioContext.close();
          return;
        }

        await audioContext.resume();
        micGainContextRef.current = audioContext;
        micGainSourceRef.current = source;
        micGainNodeRef.current = gainNode;
        originalMicTrackRef.current = sourceTrack;
        processedMicTrackRef.current = processedTrack;
      }

      if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.value = inputVolume / 100;
      }
    };

    void setupMicGain();

    return () => {
      cancelled = true;
    };
  }, [deafened, inputVolume, isMicrophoneEnabled, localParticipant]);

  useEffect(() => {
    return () => {
      micGainSourceRef.current?.disconnect();
      micGainNodeRef.current?.disconnect();
      if (processedMicTrackRef.current) {
        processedMicTrackRef.current.stop();
      }
      void micGainContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (deafened) {
      if (inputVolume > 0) {
        previousInputVolumeBeforeDeafenRef.current = inputVolume;
      }
      if (inputVolume !== 0) {
        setInputVolume(0);
      }
      return;
    }

    if (!hasHandledInitialMicStateRef.current) {
      hasHandledInitialMicStateRef.current = true;
      return;
    }

    if (!isMicrophoneEnabled) {
      if (!shouldApplyMuteVolumeRuleRef.current) {
        return;
      }
      if (inputVolume > 0) {
        previousInputVolumeBeforeMuteRef.current = inputVolume;
      }
      if (inputVolume !== 0) {
        setInputVolume(0);
      }
      return;
    }

    if (shouldApplyMuteVolumeRuleRef.current && inputVolume === 0) {
      setInputVolume(
        previousInputVolumeBeforeMuteRef.current > 0
          ? previousInputVolumeBeforeMuteRef.current
          : 100,
      );
    }
    shouldApplyMuteVolumeRuleRef.current = false;
  }, [deafened, inputVolume, isMicrophoneEnabled]);

  const handleDeafenToggle = async (checked: boolean) => {
    const shouldDeafen = checked === true;

    playClickSound();
    setDeafened(shouldDeafen);

    if (shouldDeafen) {
      previousMicEnabledBeforeDeafenRef.current = isMicrophoneEnabled;
      previousInputVolumeBeforeDeafenRef.current = inputVolume;
      previousOutputVolumeBeforeDeafenRef.current = outputVolume;

      if (isMicrophoneEnabled) {
        await localParticipant.setMicrophoneEnabled(false);
      }

      setInputVolume(0);
      setOutputVolume(0);
    } else {
      setOutputVolume(previousOutputVolumeBeforeDeafenRef.current);

      if (previousMicEnabledBeforeDeafenRef.current === true) {
        setInputVolume(previousInputVolumeBeforeDeafenRef.current);
        await localParticipant.setMicrophoneEnabled(true);
      } else {
        setInputVolume(0);
      }
      previousMicEnabledBeforeDeafenRef.current = null;
    }

    try {
      await localParticipant.setAttributes({
        deafened: shouldDeafen ? "true" : "false",
      });
    } catch {
      // Ignore attribute update failures; local deafen behavior still applies.
    }
  };

  const handleInputVolumeChange = (value: number) => {
    setInputVolume(value);
  };

  const handleOutputVolumeChange = (value: number) => {
    setOutputVolume(value);
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
    if (defaultDevice) {
      return defaultDevice.deviceId;
    }

    return devices[0]?.deviceId ?? "";
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
  const activeCameraLabel = getDeviceLabel(
    cameraDevices,
    activeCameraDeviceId,
    "Default camera",
  );
  const selectedMicrophoneDeviceId = getSelectedDeviceId(
    microphoneDevices,
    activeMicrophoneDeviceId,
  );
  const selectedSpeakerDeviceId = getSelectedDeviceId(
    speakerDevices,
    activeSpeakerDeviceId,
  );
  const selectedCameraDeviceId = getSelectedDeviceId(
    cameraDevices,
    activeCameraDeviceId,
  );

  const renderVolumeMeter = () => {
    const count = 29;
    const activeCount = Math.round((micLevel / 100) * count);
    return (
      <div className="mt-4 grid grid-cols-[repeat(29,1fr)] gap-0.5">
        {Array.from({ length: count }).map((_, index) => {
          const isActive = index < activeCount;
          const hue = Math.round(52 + (90 * index) / (count - 1));
          return (
            <span
              key={index}
              className={cn("h-5 rounded-full", !isActive && "bg-foreground/15")}
              style={isActive ? { backgroundColor: `hsl(${hue}, 85%, 55%)` } : undefined}
            />
          );
        })}
      </div>
    );
  };

  const renderRangeControl = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    showMeter = false,
    disabled = false,
  ) => (
    <div className={`px-2.5 py-2 ${disabled ? "opacity-55" : ""}`}>
      <p className="text-xs font-normal text-foreground/85">{label}</p>
      <div
        className="relative mt-2"
        style={
          {
            "--volume-ratio": value / 100,
            "--volume-value": value,
          } as CSSProperties
        }
      >
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          disabled={disabled}
          className={`peer volume-slider h-1.5 w-full ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          style={{ "--volume-progress": `${value}%` } as CSSProperties}
        />
        <span
          className="pointer-events-none absolute -top-8 z-50 -translate-x-1/2 translate-y-1.5 scale-90 rounded-lg border border-call-border/80 bg-primary-hover px-2 py-0.5 text-[13px] font-medium tabular-nums text-foreground shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur-sm opacity-0 transition-[opacity,transform] duration-150 ease-out peer-hover:translate-y-0 peer-hover:scale-100 peer-hover:opacity-100 peer-active:translate-y-0 peer-active:scale-100 peer-active:opacity-100"
          style={{ left: "calc(7px + (100% - 14px) * var(--volume-ratio))" }}
        >
          {value}%
          <span className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-[5px] rotate-45 border-r border-b border-call-border/80 bg-primary-hover" />
        </span>
      </div>
      {showMeter && renderVolumeMeter()}
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
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
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
        {((kind === "audioinput" &&
          selectedMicrophoneDeviceId === device.deviceId) ||
          (kind === "audiooutput" &&
            selectedSpeakerDeviceId === device.deviceId) ||
          (kind === "videoinput" &&
            selectedCameraDeviceId === device.deviceId)) ? (
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
      className="w-[250px] rounded-xl border-call-border bg-call-background p-1.5 overflow-visible"
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
          <DropdownMenuRadioGroup value={selectedMicrophoneDeviceId}>
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
            <DropdownMenuRadioGroup value={selectedSpeakerDeviceId}>
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
      {renderRangeControl(
        "Input Volume",
        inputVolume,
        handleInputVolumeChange,
        true,
        deafened || !isMicrophoneEnabled,
      )}
      {renderRangeControl(
        "Output Volume",
        outputVolume,
        handleOutputVolumeChange,
        false,
        deafened,
      )}
      <DropdownMenuSeparator className="mx-2 my-1.5 bg-call-border" />
      <DropdownMenuCheckboxItem
        checked={deafened}
        onCheckedChange={(checked) => void handleDeafenToggle(checked === true)}
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
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="w-[250px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuRadioGroup value={selectedCameraDeviceId}>
            {renderDeviceRadioItems("videoinput", cameraDevices)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator className="mx-2 my-1.5 bg-call-border" />
      <DropdownMenuItem
        onSelect={(event) => event.preventDefault()}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm font-normal"
      >
        <FiSettings className="size-4 text-foreground/60" />
        Video Settings
      </DropdownMenuItem>
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

  const renderReactionsControl = () => (
    <div className="flex flex-col gap-1 items-center">
      <DropdownMenu
        open={isReactionMenuOpen}
        onOpenChange={setIsReactionMenuOpen}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-h-11 w-11 items-center justify-center rounded-xl border border-call-border text-lg font-medium cursor-pointer transition-all duration-200",
              isReactionMenuOpen
                ? "bg-primary-hover"
                : "bg-call-primary hover:bg-primary-hover",
            )}
            onClick={playClickSound}
            aria-label="Reactions"
          >
            <FiSmile />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          collisionPadding={8}
          side="top"
          sideOffset={6}
          className="w-auto border-none bg-transparent p-0 shadow-none"
        >
          <div className="flex items-center gap-1 rounded-xl border border-call-border bg-call-background px-1 py-1">
            {QUICK_REACTIONS.map((emoji) => (
              <DropdownMenuItem
                key={emoji}
                onSelect={(event) => {
                  event.preventDefault();
                  playClickSound();
                  void sendReaction(emoji);
                }}
                className="cursor-pointer rounded-lg px-2 py-1 text-center text-2xl transition-colors hover:bg-primary-hover focus:bg-primary-hover"
              >
                <span className="w-full">{emoji}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                hideChevron
                className="ml-1 flex items-center justify-center cursor-pointer rounded-lg px-2 py-1 text-center text-2xl transition-colors data-[state=open]:bg-primary-hover hover:bg-primary-hover focus:bg-primary-hover"
                aria-label="More emojis"
                title="More emojis"
              >
                <SmilePlus className="size-5" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={8}
                className="w-[320px] rounded-xl border-call-border bg-call-background p-2"
              >
                <div className="grid max-h-[280px] grid-cols-8 gap-1 overflow-y-auto pr-1">
                  {EXTRA_REACTIONS.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      onSelect={(event) => {
                        event.preventDefault();
                        playClickSound();
                        void sendReaction(emoji);
                      }}
                      className="cursor-pointer rounded-lg px-2 py-1 text-center text-2xl transition-colors hover:bg-primary-hover focus:bg-primary-hover"
                    >
                      <span className="w-full">{emoji}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <button
              type="button"
              onClick={() => {
                playClickSound();
                void toggleHandRaise();
              }}
              className={cn(
                "ml-1 flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-200",
                isHandRaised
                  ? "border-blue-400/30 bg-blue-500/30 text-blue-200 hover:bg-blue-500/40"
                  : "border-call-border bg-call-primary text-foreground hover:bg-primary-hover",
              )}
              aria-label={isHandRaised ? "Lower hand" : "Raise hand"}
              title={isHandRaised ? "Lower hand" : "Raise hand"}
            >
              <IoHandRightOutline className="size-5" />
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-[0.675rem] text-foreground/50">React</p>
    </div>
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
      {renderScreenShareControl()}
      {renderReactionsControl()}
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
