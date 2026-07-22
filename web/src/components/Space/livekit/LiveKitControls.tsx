import {
  useConnectionState,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
} from "@livekit/components-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { ConnectionState, Track, type Participant } from "livekit-client";
import {
  BsFillTelephoneFill,
  BsInfoLg,
  BsFillRecordCircleFill,
} from "react-icons/bs";
import {
  FiChevronDown,
  FiChevronUp,
  FiCheckSquare,
  FiExternalLink,
  FiUploadCloud,
  FiMoon,
  FiSmile,
  FiSquare,
  FiSun,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { FaCircleCheck } from "react-icons/fa6";
import { IoChatbubbleOutline, IoHandRightOutline } from "react-icons/io5";
import { Maximize, Minimize, SmilePlus, X } from "lucide-react";
import { LuScreenShare, LuScreenShareOff, LuUsers } from "react-icons/lu";
import { MdCallEnd, MdLogout } from "react-icons/md";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { SlOptionsVertical } from "react-icons/sl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useGetRecordingSessionsBySpace } from "@/hooks/useRecording";
import { canSelectAudioOutput, sortMediaDevices } from "@/lib/mediaDevices";
import { markLocalMediaAction } from "@/lib/localMediaIntent";
import playClickSound from "@/utils/ClickSound";
import ControlButton from "../controls/ControlButton";
import CallWarningDialog from "../ui/CallWarningDialog";
import { useLiveKitChat } from "../chat/LiveKitChatProvider";
import { useLiveKitReactions } from "../reactions/LiveKitReactionsProvider";
import { useRecordingContext } from "../recording/RecordingProvider";

// Screen-share capture options. NOTE: LiveKit's setScreenShareEnabled /
// createScreenTracks do NOT merge the room's screenShareCaptureDefaults - they
// only use the options passed at the call site (audio defaults to false). So we
// must request tab/system audio explicitly here, or a shared video's sound is
// never captured, published, or recorded. Resolution is left to the SDK default
// (1080p30). Chromium-only, and still gated by the picker's "Share audio" box.
const SCREEN_CAPTURE_OPTIONS = { audio: true } as const;

const formatRecordingDuration = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

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

const getParticipantAvatar = (participant: Participant): string => {
  if (participant.attributes.avatar) return participant.attributes.avatar;
  if (!participant.metadata) return "";
  try {
    const metadata = JSON.parse(participant.metadata) as { avatar?: unknown };
    return typeof metadata.avatar === "string" ? metadata.avatar : "";
  } catch {
    return "";
  }
};

// A participant's recording thumbnail: the poster extracted from their first
// chunk (ready within seconds of record start). Falls back to their profile
// picture, then their name initial.
const ParticipantThumb = ({
  participant,
  thumbnailUrl,
}: {
  participant: Participant;
  thumbnailUrl: string | null;
}) => {
  const avatar = getParticipantAvatar(participant);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const name = participant.name?.trim() || "Guest";
  const showThumb = !!thumbnailUrl && !thumbFailed;

  return (
    <span className="relative flex aspect-video h-[3.25rem] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-call-border">
      {showThumb ? (
        <img
          src={thumbnailUrl}
          alt=""
          onError={() => setThumbFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        // Camera-off style: a centered round profile picture, or the person's
        // first initial when they have no picture.
        <span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-purple-500 text-sm font-semibold text-white">
          {avatar && !avatarFailed ? (
            <img
              src={avatar}
              alt=""
              onError={() => setAvatarFailed(true)}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </span>
      )}
    </span>
  );
};

// Shown above the control bar once a recording's chunks have finished
// uploading. This is upload confirmation only - server-side processing/merging
// is surfaced on the project page, not here. Lists each participant with a tick,
// plus a button through to the project.
const savedCardDismissKey = (sessionId: string) =>
  `openside:uploadedCardDismissed:${sessionId}`;

const SavedSessionCard = ({
  spaceId,
  sessionId,
  onVisit,
}: {
  spaceId: string | undefined;
  sessionId: string | null;
  onVisit: () => void;
}) => {
  const participants = useParticipants();
  // Pull the current session's per-track thumbnails (early posters from the first
  // chunk). Poll briefly so a thumbnail still generating shows up once ready.
  const { data: sessionsData } = useGetRecordingSessionsBySpace(
    spaceId ?? "",
    !!spaceId,
    3000,
  );
  const thumbnailByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    const session = sessionsData?.sessions?.[0];
    for (const rec of session?.participantRecordings ?? []) {
      const identity = rec.participant?.livekitIdentity;
      if (identity && rec.thumbnailUrl) map.set(identity, rec.thumbnailUrl);
    }
    return map;
  }, [sessionsData]);

  // Dismissal is remembered per session, so once the host closes it with the
  // cross it never comes back - including after a refresh or rejoin.
  const [dismissed, setDismissed] = useState(() => {
    if (!sessionId) return false;
    try {
      return localStorage.getItem(savedCardDismissKey(sessionId)) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!sessionId) return;
    try {
      if (localStorage.getItem(savedCardDismissKey(sessionId)) === "1") {
        setDismissed(true);
      }
    } catch {
      /* ignore storage errors */
    }
  }, [sessionId]);

  const handleDismiss = () => {
    if (sessionId) {
      try {
        localStorage.setItem(savedCardDismissKey(sessionId), "1");
      } catch {
        /* ignore storage errors */
      }
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="relative flex w-[19rem] flex-col gap-3 rounded-2xl border border-call-border bg-call-primary p-3.5">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="absolute right-2.5 top-2.5 rounded-md p-1 text-foreground/40 transition-colors hover:bg-primary-hover hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      {/* Header */}
      <p className="pr-6 text-lg font-semibold text-foreground">
        Your recording is uploaded
      </p>

      {/* One row per participant in the recording */}
      <div className="flex flex-col gap-1">
        {participants.map((participant) => {
          const name = participant.name?.trim() || "Guest";
          return (
            <div
              key={participant.identity}
              className="flex items-center justify-between gap-2 rounded-lg border border-call-border bg-call-background p-1.5 pr-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <ParticipantThumb
                  participant={participant}
                  thumbnailUrl={
                    thumbnailByIdentity.get(participant.identity) ?? null
                  }
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {name}
                  </span>
                  <span className="text-xs text-foreground/50">Uploaded</span>
                </span>
              </span>
              <FaCircleCheck className="size-4 shrink-0 text-emerald-500" />
            </div>
          );
        })}
      </div>

      {/* Go to project */}
      <button
        type="button"
        onClick={onVisit}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
      >
        Go to project
        <FiExternalLink className="size-4" />
      </button>
    </div>
  );
};

const LiveKitControls = ({
  activeSidebar,
  deafened,
  isHost,
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
  // Removes the "ended" listener from the raw capture feeding the gain graph.
  const micSourceEndedCleanupRef = useRef<(() => void) | null>(null);
  // Bumped when the raw capture behind the gain graph dies and is re-acquired,
  // so the pipeline effect re-runs and rebuilds on the replacement track.
  const [micPipelineEpoch, setMicPipelineEpoch] = useState(0);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [isReactionMenuOpen, setIsReactionMenuOpen] = useState(false);
  const [optimisticHandRaised, setOptimisticHandRaised] = useState<
    boolean | null
  >(null);
  const [openMediaMenu, setOpenMediaMenu] = useState<"mic" | "cam" | null>(
    null,
  );
  // Latched on the first open of a mic/cam device menu - see the
  // useMediaDeviceSelect comment below.
  const [hasOpenedMediaMenu, setHasOpenedMediaMenu] = useState(false);
  const previousMicEnabledBeforeDeafenRef = useRef<boolean | null>(null);
  const previousInputVolumeBeforeMuteRef = useRef(inputVolume);
  const previousInputVolumeBeforeDeafenRef = useRef(inputVolume);
  const previousOutputVolumeBeforeDeafenRef = useRef(outputVolume);
  const hasHandledInitialMicStateRef = useRef(false);
  const shouldApplyMuteVolumeRuleRef = useRef(false);
  const { resolvedTheme, setTheme } = useTheme();
  const { sendReaction } = useLiveKitReactions();
  const recording = useRecordingContext();
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
  // requestPermissions: without it the lists come from a permissionless
  // enumerateDevices(), which hides devices / strips labels whenever the user
  // reached the call without granting mic+cam on pre-join (e.g. joined with
  // both off) - the menus then show only one unlabeled entry per kind.
  // Gated on the first device-menu open so those users aren't hit with an
  // unsolicited permission prompt the moment they join; users who already
  // granted access on pre-join get labeled lists either way.
  const {
    devices: rawMicrophoneDevices,
    activeDeviceId: activeMicrophoneDeviceId,
    setActiveMediaDevice: setActiveMicrophoneDevice,
  } = useMediaDeviceSelect({
    kind: "audioinput",
    requestPermissions: hasOpenedMediaMenu,
  });
  const {
    devices: rawSpeakerDevices,
    activeDeviceId: activeSpeakerDeviceId,
    setActiveMediaDevice: setActiveSpeakerDevice,
  } = useMediaDeviceSelect({ kind: "audiooutput" });
  const {
    devices: rawCameraDevices,
    activeDeviceId: activeCameraDeviceId,
    setActiveMediaDevice: setActiveCameraDevice,
  } = useMediaDeviceSelect({
    kind: "videoinput",
    requestPermissions: hasOpenedMediaMenu,
  });
  const microphoneDevices = useMemo(
    () => sortMediaDevices(rawMicrophoneDevices),
    [rawMicrophoneDevices],
  );
  const speakerDevices = useMemo(
    () => sortMediaDevices(rawSpeakerDevices),
    [rawSpeakerDevices],
  );
  const cameraDevices = useMemo(
    () => sortMediaDevices(rawCameraDevices),
    [rawCameraDevices],
  );
  const attributeHandRaised = localParticipant.attributes.handRaised === "true";
  const isHandRaised =
    optimisticHandRaised === null ? attributeHandRaised : optimisticHandRaised;

  // Tell the user when their mic/camera turns off WITHOUT a local action -
  // i.e. a moderator stopped the track (or the device died). Without this the
  // controls just flip off with zero explanation. But when the space is ending
  // the room disconnects and every track flips off at once - that's not a
  // "turned off" event worth toasting, so suppress it while disconnecting.
  const connectionState = useConnectionState();
  const isDisconnecting =
    connectionState === ConnectionState.Disconnected ||
    connectionState === ConnectionState.Reconnecting;

  const prevMicEnabledRef = useRef(isMicrophoneEnabled);
  useEffect(() => {
    prevMicEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled, isDisconnecting]);

  const prevCameraEnabledRef = useRef(isCameraEnabled);
  useEffect(() => {
    prevCameraEnabledRef.current = isCameraEnabled;
  }, [isCameraEnabled, isDisconnecting]);

  // Unread indicator for the Chat sidebar button: count messages from others
  // that arrived while the chat panel was closed (the 4s toast was the only
  // signal before, then nothing).
  const { messages: chatMessages, localSenderId } = useLiveKitChat();
  const isChatOpen = activeSidebar === "chat";
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const seenChatCountRef = useRef(0);
  useEffect(() => {
    if (isChatOpen) {
      seenChatCountRef.current = chatMessages.length;
      setUnreadChatCount(0);
      return;
    }

    setUnreadChatCount(
      chatMessages
        .slice(seenChatCountRef.current)
        .filter((message) => message.senderId !== localSenderId).length,
    );
  }, [chatMessages, isChatOpen, localSenderId]);

  useEffect(() => {
    if (
      optimisticHandRaised !== null &&
      optimisticHandRaised === attributeHandRaised
    ) {
      setOptimisticHandRaised(null);
    }
  }, [attributeHandRaised, optimisticHandRaised]);

  const toggleMicrophone = async () => {
    shouldApplyMuteVolumeRuleRef.current = true;
    markLocalMediaAction();
    try {
      if (deafened) {
        await handleDeafenToggle(false);
        await localParticipant.setMicrophoneEnabled(true);
        return;
      }
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch {
      // Mirror toggleCamera: unmuting fails when access is blocked or the
      // device is missing - without this the button silently does nothing
      // (exactly what happens after joining with mic permission denied).
      // The control state remains unchanged when media access fails.
    }
  };

  const toggleCamera = async () => {
    markLocalMediaAction();
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch {
      // Turning the camera on can fail when access is blocked or the device is
      // missing/in use. Don't surface a full error screen - leave video off and
      // tell the user why. This fires on every attempt, so retrying re-toasts
      // until it's fixed.
      // The control state remains unchanged when media access fails.
    }
  };

  const handleDeviceSelect = async (
    kind: SelectableDeviceKind,
    deviceId: string,
  ) => {
    const setActiveDevice =
      kind === "audioinput"
        ? setActiveMicrophoneDevice
        : kind === "audiooutput"
          ? setActiveSpeakerDevice
          : setActiveCameraDevice;

    // A switch restarts the published track, which can briefly flip the
    // enabled flags - don't let the watcher misread that as a host mute.
    markLocalMediaAction();
    try {
      await setActiveDevice(
        deviceId,
        deviceId === "default" ? undefined : { exact: true },
      );
    } catch {
      // An exact match can fail when the cached id went stale (device
      // unplugged/re-enumerated mid-call). Retry letting the browser pick the
      // closest match instead of failing silently with the menu unchanged.
      try {
        await setActiveDevice(deviceId);
        return;
      } catch (retryError) {
        console.error(`Unable to switch ${kind} device:`, retryError);
      }

    }
  };

  const toggleScreenShare = async () => {
    try {
      await localParticipant.setScreenShareEnabled(
        !isScreenShareEnabled,
        SCREEN_CAPTURE_OPTIONS,
      );
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      // The browser can also reject a cancelled screen-share picker.
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
    }
  };

  const startScreenShare = async () => {
    try {
      if (!isScreenShareEnabled) {
        await localParticipant.setScreenShareEnabled(
          true,
          SCREEN_CAPTURE_OPTIONS,
        );
        return;
      }

      const newTracks = await localParticipant.createScreenTracks(
        SCREEN_CAPTURE_OPTIONS,
      );
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
      // The browser can also reject a cancelled screen-share picker.
    }
  };

  const stopScreenShare = async () => {
    try {
      await localParticipant.setScreenShareEnabled(false);
    } catch {
      // Screen sharing is already stopped or unavailable.
    }
  };

  // Read by the meter loop via a ref so dragging the volume slider doesn't
  // tear down and recreate the whole AudioContext/analyser on every tick.
  const inputVolumeRef = useRef(inputVolume);
  inputVolumeRef.current = inputVolume;

  useEffect(() => {
    // Muted/deafened: the raw capture behind the gain graph keeps producing
    // audio even though nothing is sent, so hard-zero the meter instead of
    // letting it dance.
    if (!isMicrophoneEnabled || deafened) {
      setMicLevel(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    const dataArray = new Uint8Array(64);

    const poll = () => {
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = avg / 255;
        // Gentler curve + higher boost than before so quiet speech still moves
        // the meter visibly.
        const curved = Math.pow(normalized, 1.2);
        const inputGain = inputVolumeRef.current / 100;
        // Lower input volume should reduce meter sensitivity and visible waves.
        setMicLevel(Math.min(100, Math.round(curved * 100 * 4 * inputGain)));
      }
      animFrameRef.current = requestAnimationFrame(poll);
    };

    // The published track is post-gain once the volume pipeline is active, and
    // the meter already simulates the gain via the inputGain factor above - so
    // always tap the raw capture feeding the graph, or the volume applies to
    // the meter twice (50% slider would read as ~25%).
    const publishedTrack = localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track?.mediaStreamTrack;
    const isPublishedTrackProcessed =
      !!processedMicTrackRef.current &&
      publishedTrack === processedMicTrackRef.current;
    const track =
      isPublishedTrackProcessed && originalMicTrackRef.current
        ? originalMicTrackRef.current
        : publishedTrack;
    if (track) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
      animFrameRef.current = requestAnimationFrame(poll);
    } else {
      setMicLevel(0);
    }

    // activeMicrophoneDeviceId: a device switch publishes a brand-new track, so
    // the meter must re-attach to it instead of polling the dead one.
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      source?.disconnect();
      void audioContext?.close();
    };
  }, [
    localParticipant,
    isMicrophoneEnabled,
    deafened,
    activeMicrophoneDeviceId,
  ]);

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

    // Coalesce mutation bursts into one scan per frame. The observer fires for
    // EVERY DOM change in the app (chat, reactions, the layout switch when a
    // screen share starts), and a synchronous full-document query per mutation
    // is enough to make those moments stutter.
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        applyOutputVolume();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [deafened, outputVolume]);

  useEffect(() => {
    let cancelled = false;

    const teardownGraph = () => {
      micSourceEndedCleanupRef.current?.();
      micSourceEndedCleanupRef.current = null;
      micGainSourceRef.current?.disconnect();
      micGainNodeRef.current?.disconnect();
      processedMicTrackRef.current?.stop();
      void micGainContextRef.current?.close();
      micGainContextRef.current = null;
      micGainSourceRef.current = null;
      micGainNodeRef.current = null;
      originalMicTrackRef.current = null;
      processedMicTrackRef.current = null;
    };

    const setupMicGain = async () => {
      const publication = localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const localMicTrack = publication?.track;
      const publishedTrack = localMicTrack?.mediaStreamTrack;

      if (
        !localMicTrack ||
        !publishedTrack ||
        !isMicrophoneEnabled ||
        deafened
      ) {
        return;
      }

      const isPublishedTrackProcessed =
        !!processedMicTrackRef.current &&
        publishedTrack === processedMicTrackRef.current;
      const sourceTrack =
        isPublishedTrackProcessed && originalMicTrackRef.current
          ? originalMicTrackRef.current
          : publishedTrack;

      // At full volume the gain graph is a no-op, so publish the raw capture
      // directly. This matters beyond perf: a WebAudio track never fires
      // "ended" and replaceTrack marks it user-provided, both of which defeat
      // LiveKit's own mic recovery (device unplugged, resume from sleep).
      // Keeping the raw track published whenever possible restores it.
      if (inputVolume >= 100) {
        if (isPublishedTrackProcessed) {
          try {
            // userProvidedTrack: false hands ownership back to LiveKit, so
            // its native ended/sleep recovery applies to the capture again.
            await localMicTrack.replaceTrack(sourceTrack, false);
          } catch (error) {
            // Keep the graph alive so audio keeps flowing through it.
            console.error("Unable to restore raw mic track:", error);
            if (micGainNodeRef.current) {
              micGainNodeRef.current.gain.value = 1;
            }
            return;
          }
          teardownGraph();
        }
        return;
      }

      const needsRebuild =
        !micGainNodeRef.current ||
        !processedMicTrackRef.current ||
        originalMicTrackRef.current !== sourceTrack;

      if (needsRebuild) {
        micSourceEndedCleanupRef.current?.();
        micSourceEndedCleanupRef.current = null;
        micGainSourceRef.current?.disconnect();
        micGainNodeRef.current?.disconnect();
        if (processedMicTrackRef.current) {
          processedMicTrackRef.current.stop();
        }
        // Once the processed track is published, LiveKit no longer knows about
        // the raw capture feeding the gain graph - a device switch stops only
        // the processed track, leaving the previous mic open (indicator on)
        // unless we release it ourselves.
        if (
          originalMicTrackRef.current &&
          originalMicTrackRef.current !== sourceTrack
        ) {
          originalMicTrackRef.current.stop();
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
        if (!processedTrack) {
          void audioContext.close();
          return;
        }

        // Resume BEFORE publishing the processed track: a context that can't
        // run (autoplay policy, device quirk) would replace the real mic with
        // dead silence while the UI still shows the mic as on. If it won't
        // run, keep the raw capture published - volume control is lost but
        // the user stays audible.
        try {
          await audioContext.resume();
        } catch (error) {
          console.error("Mic gain AudioContext failed to resume:", error);
        }
        if (audioContext.state !== "running" || cancelled) {
          processedTrack.stop();
          void audioContext.close();
          return;
        }

        try {
          await localMicTrack.replaceTrack(processedTrack);
        } catch (error) {
          console.error("Unable to publish processed mic track:", error);
          processedTrack.stop();
          void audioContext.close();
          return;
        }
        if (cancelled) {
          // A newer run supersedes this one - put the raw capture back so the
          // published track isn't a stopped processed track (dead silence).
          try {
            await localMicTrack.replaceTrack(sourceTrack);
          } catch {
            // best effort - the newer run will rebuild from whatever is live
          }
          processedTrack.stop();
          void audioContext.close();
          return;
        }

        // The published WebAudio track never ends, so LiveKit can't see the
        // real capture dying (Bluetooth off, mic unplugged) - others would
        // hear silence with the mic still showing as on. Watch the source
        // ourselves, re-acquire, and bump the epoch so this effect rebuilds
        // the graph on the replacement capture.
        const handleSourceEnded = async () => {
          micSourceEndedCleanupRef.current = null;
          try {
            await localMicTrack.restartTrack();
          } catch {
            // The configured device is gone - mirror LiveKit's own fallback
            // and grab the default mic instead.
            try {
              await localMicTrack.restartTrack({ deviceId: "default" });
            } catch (error) {
              console.error("Mic died and could not be restarted:", error);
            }
          }
          setMicPipelineEpoch((value) => value + 1);
        };
        sourceTrack.addEventListener("ended", handleSourceEnded);
        micSourceEndedCleanupRef.current = () => {
          sourceTrack.removeEventListener("ended", handleSourceEnded);
        };

        // Resume the graph if the browser suspends it mid-call (sleep/wake,
        // audio route change) - a suspended context publishes pure silence.
        audioContext.onstatechange = () => {
          if (audioContext.state === "suspended") {
            audioContext.resume().catch((error) => {
              console.error("Mic gain AudioContext stuck suspended:", error);
            });
          }
        };

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

    setupMicGain().catch((error) => {
      console.error("Mic volume pipeline failed:", error);
    });

    // activeMicrophoneDeviceId: switching mics restarts the published track
    // with a raw capture from the new device, detaching the gain chain.
    // micPipelineEpoch: the raw capture died and was re-acquired. Re-run so
    // input volume keeps applying to the capture actually in use.
    return () => {
      cancelled = true;
    };
  }, [
    deafened,
    inputVolume,
    isMicrophoneEnabled,
    localParticipant,
    activeMicrophoneDeviceId,
    micPipelineEpoch,
  ]);

  useEffect(() => {
    return () => {
      micSourceEndedCleanupRef.current?.();
      micSourceEndedCleanupRef.current = null;
      micGainSourceRef.current?.disconnect();
      micGainNodeRef.current?.disconnect();
      if (processedMicTrackRef.current) {
        processedMicTrackRef.current.stop();
      }
      // Release the raw capture behind the gain graph too - LiveKit only ever
      // stops the processed track it was handed.
      if (originalMicTrackRef.current) {
        originalMicTrackRef.current.stop();
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
    markLocalMediaAction();
    setDeafened(shouldDeafen);

    if (shouldDeafen) {
      previousMicEnabledBeforeDeafenRef.current = isMicrophoneEnabled;
      previousInputVolumeBeforeDeafenRef.current = inputVolume;
      previousOutputVolumeBeforeDeafenRef.current = outputVolume;

      if (isMicrophoneEnabled) {
        try {
          await localParticipant.setMicrophoneEnabled(false);
        } catch (error) {
          // Keep deafening even if the mute call fails - output volume still
          // goes to zero, which is the part the user asked for.
          console.error("Unable to mute microphone while deafening:", error);
        }
      }

      setInputVolume(0);
      setOutputVolume(0);
    } else {
      setOutputVolume(previousOutputVolumeBeforeDeafenRef.current);

      if (previousMicEnabledBeforeDeafenRef.current === true) {
        setInputVolume(previousInputVolumeBeforeDeafenRef.current);
        try {
          await localParticipant.setMicrophoneEnabled(true);
        } catch (error) {
          console.error("Unable to restore microphone after undeafen:", error);
        }
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
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      // Some browsers (iOS Safari) don't support element fullscreen.
    }
  };

  const exitDialogCopy = {
    "end-for-all": {
      title: "End for everyone?",
      description:
        "This will end the call for every participant and close the room.",
      confirmLabel: "End for all",
    },
  };

  const handleExitConfirm = async () => {
    const action = pendingExitAction;
    setPendingExitAction(null);

    if (action === "end-for-all") {
      if (
        recording.canControl &&
        (recording.recordingState === "starting" ||
          recording.recordingState === "countdown" ||
          recording.recordingState === "recording")
      ) {
        await recording.stopRecording();
      }
      onEndForAll();
    }
  };

  const pendingExitCopy = pendingExitAction
    ? exitDialogCopy[pendingExitAction]
    : null;

  const handleSendReaction = (emoji: string) => {
    sendReaction(emoji).catch(() => {
    });
  };

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

    return (
      device?.label || defaultDevice?.label || devices[0]?.label || fallback
    );
  };

  const getSelectedDeviceId = (
    devices: MediaDeviceInfo[],
    activeDeviceId: string,
  ) => {
    if (devices.some((device) => device.deviceId === activeDeviceId)) {
      return activeDeviceId;
    }

    const defaultDevice = devices.find(
      (device) => device.deviceId === "default",
    );
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
              className={cn(
                "h-5 rounded-full",
                !isActive && "bg-foreground/15",
              )}
              style={
                isActive
                  ? { backgroundColor: `hsl(${hue}, 85%, 55%)` }
                  : undefined
              }
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
    // On phones there's no room in the bar, so the indicator floats above it
    // as a pill (and disappears entirely while idle via empty:hidden).
    <div className="ml-2 flex items-center gap-4 max-md:absolute max-md:bottom-full max-md:left-2 max-md:z-20 max-md:mb-2 max-md:ml-0 max-md:rounded-full max-md:bg-call-background/90 max-md:px-3 max-md:py-1.5 max-md:empty:hidden">
      {renderRecordingIndicator()}
    </div>
  );

  const renderRecordingControl = () => {
    if (!recording.canControl) return null;

    const state = recording.recordingState;
    const stopRequestFailed = recording.stopRequestFailed;
    const isCountdown = state === "countdown";
    const isBusy =
      state === "starting" ||
      state === "countdown" ||
      state === "stopping" ||
      state === "uploading";
    const isRecording = state === "recording";

    const insideLabel = isRecording
      ? "Stop"
      : stopRequestFailed
        ? "Retry stop"
      : isCountdown
        ? "Starting"
        : state === "starting"
          ? "Starting"
          : state === "stopping"
            ? "Saving"
            : state === "uploading"
              ? "Saving"
              : "Record";

    const caption = isRecording
      ? "Stop"
      : stopRequestFailed
        ? "Finish stopping"
      : isCountdown
        ? "Get ready"
        : isBusy
          ? insideLabel
          : "Start";

    return (
      <div className="flex flex-col gap-1 items-center">
        <button
          type="button"
          onClick={() => {
            if (isBusy) return;
            playClickSound();
            recording.toggleRecording();
          }}
          disabled={isBusy}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 border px-3.5 rounded-xl text-sm font-medium transition-all duration-200 max-md:min-h-10 max-md:px-2.5",
            isRecording
              ? "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700"
              : "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:border-red-600",
            isBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          )}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          <BsFillRecordCircleFill
            className={cn("size-4 text-white", isRecording && "animate-pulse")}
          />
          <span className="max-md:hidden">{insideLabel}</span>
        </button>
        <p className="text-[0.675rem] text-foreground/50 max-md:hidden">
          {caption}
        </p>
      </div>
    );
  };

  const renderRecordingIndicator = () => {
    // Only show once capture has actually started - never during "starting" or
    // the synced "countdown" lead-in.
    const state = recording.recordingState;
    if (
      state !== "recording" &&
      state !== "uploading" &&
      state !== "stopping" &&
      state !== "complete"
    ) {
      return null;
    }
    const backendStatus = recording.backendStatus;

    // Final drain phase (after stop) shows the upload progress %.
    const isFinalizing = state === "uploading" || state === "stopping";
    // Show the upload indicator for the whole recording, from the very start -
    // it reads 0% until the first chunk is produced/uploaded.
    const showUpload = state === "recording" || isFinalizing;

    if (state === "complete") {
      if (backendStatus === "FAILED") {
        return (
          <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 ring-1 ring-red-500/20">
            Recording failed
          </span>
        );
      }

      // Saving is done - the "Visit project" CTA above the control bar
      // (renderSavedCta) carries the ready/processing state, so nothing here.
      return null;
    }

    return (
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          <span
            className={cn(
              // Fixed width so digit/length changes never shift the rest of the
              // bar. Left-aligned to keep the number anchored in its slot.
              "inline-block min-w-[3.25rem] text-left text-base font-normal tabular-nums text-foreground",
              // Blink the timer while the recording is being saved after stop.
              isFinalizing && "animate-pulse",
            )}
          >
            {formatRecordingDuration(recording.recordingDurationMs)}
          </span>
          {showUpload && (
            <>
              <span className="mx-1 h-5 w-px bg-foreground/30" />
              <span
                className="flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground"
                title={`Uploading ${recording.uploadProgress}%`}
                aria-label={`Uploading ${recording.uploadProgress}%`}
              >
                <FiUploadCloud className="size-[1.125rem]" />
                <span className="inline-block min-w-[2.5rem] text-left">
                  {recording.uploadProgress}%
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  // Once the recording has stopped and its chunks have finished uploading, float
  // an upload-confirmation card above the control bar that links to the project
  // page (where server-side processing → ready is surfaced).
  const renderSavedCta = () => {
    // The project library belongs to the host, so this card is host-only.
    const isRecordingHost =
      isHost ||
      participantRole === "HOST" ||
      localParticipant.attributes.room_admin === "true";
    if (!isRecordingHost) return null;
    if (recording.recordingState !== "complete") return null;

    return (
      <div className="absolute bottom-full left-1/2 z-20 mb-3 -translate-x-1/2">
        <SavedSessionCard
          spaceId={recording.spaceId}
          sessionId={recording.sessionId}
          onVisit={recording.openRecording}
        />
      </div>
    );
  };

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
              "flex items-center justify-center border border-call-border p-3 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 hover:bg-muted",
              isOptionsMenuOpen ? "bg-muted" : "bg-primary",
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
          sideOffset={8}
          className="min-w-[160px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuItem
            onSelect={toggleTheme}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
          >
            {resolvedTheme === "dark" ? <FiSun /> : <FiMoon />}
            Switch theme
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={toggleFullscreen}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-[0.675rem] text-foreground/50 max-md:hidden">Options</p>
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
              className="flex items-center justify-center border border-red-500 bg-red-500 p-2.5 md:p-3 rounded-xl text-lg font-medium text-white cursor-pointer transition-all duration-200 hover:border-red-600 hover:bg-red-600"
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
            className="min-w-[145px] rounded-xl border-call-border bg-call-background p-1"
          >
            <DropdownMenuItem
              onSelect={handleLeaveSelect}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
            >
              <MdLogout />
              Leave call
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setPendingExitAction("end-for-all")}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm text-red-400 focus:bg-red-400/10 focus:text-red-400 [&_svg]:!text-red-400"
            >
              <MdCallEnd />
              End for all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-[0.675rem] text-foreground/50 max-md:hidden">End</p>
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
        className="max-w-[250px] cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal focus:bg-primary-hover [&>span:first-child]:hidden"
      >
        {(kind === "audioinput" &&
          selectedMicrophoneDeviceId === device.deviceId) ||
        (kind === "audiooutput" &&
          selectedSpeakerDeviceId === device.deviceId) ||
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

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 focus:bg-primary-hover data-[state=open]:bg-primary-hover">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-normal text-foreground">Output Device</p>
            <p className="mt-0.5 truncate text-[0.7rem] text-foreground/55">
              {activeSpeakerLabel}
            </p>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
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
        {deafened ? (
          <FiCheckSquare className="size-4" />
        ) : (
          <FiSquare className="size-4" />
        )}
        Deafen
      </DropdownMenuCheckboxItem>
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
            // On phones the device-menu chevron is hidden, so the button takes
            // the full rounding itself.
            "flex min-h-11 w-11 items-center justify-center rounded-l-xl border text-lg font-medium cursor-pointer transition-all duration-200 max-md:min-h-10 max-md:w-10 max-md:rounded-xl",
            active
              ? "border-call-border bg-primary hover:bg-muted"
              : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
          aria-label={label}
        >
          {icon}
        </button>
        <DropdownMenu
          open={openMediaMenu === menuId}
          onOpenChange={(open) => {
            if (open) setHasOpenedMediaMenu(true);
            setOpenMediaMenu(open ? menuId : null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={playClickSound}
              className={cn(
                "flex min-h-11 w-6 items-center justify-center rounded-r-xl border text-base font-medium cursor-pointer transition-all duration-200 max-md:hidden",
                active
                  ? openMediaMenu === menuId
                    ? "border-call-border bg-muted"
                    : "border-call-border bg-primary hover:bg-muted"
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
      <p className="text-[0.675rem] text-foreground/50 max-md:hidden">{label}</p>
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
            sideOffset={8}
            className="min-w-[180px] rounded-xl border-call-border bg-call-background p-1"
          >
            <DropdownMenuItem
              onSelect={startScreenShare}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
            >
              <LuScreenShare />
              Share something else
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={stopScreenShare}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm !text-red-400 focus:!bg-red-400/10 focus:!text-red-400 [&_svg]:!text-red-400"
            >
              <LuScreenShareOff />
              Stop sharing
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-[0.675rem] text-foreground/50 max-md:hidden">Share</p>
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
              "flex min-h-11 w-11 items-center justify-center rounded-xl border border-call-border text-lg font-medium cursor-pointer transition-all duration-200 max-md:min-h-10 max-md:w-10",
              isReactionMenuOpen ? "bg-muted" : "bg-primary hover:bg-muted",
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
          sideOffset={8}
          className="w-auto border-none bg-transparent p-0 shadow-none"
        >
          <div className="flex items-center gap-0 rounded-xl border border-call-border bg-call-background px-1 py-1">
            {QUICK_REACTIONS.map((emoji) => (
              <DropdownMenuItem
                key={emoji}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSendReaction(emoji);
                }}
                className="cursor-pointer rounded-lg px-2.5 py-1 text-center text-[22px] transition-colors hover:bg-primary-hover focus:bg-primary-hover"
              >
                <span className="w-full">{emoji}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex self-stretch items-center justify-center cursor-pointer rounded-lg px-2.5 py-1 text-center text-[22px] transition-colors data-[state=open]:bg-primary-hover hover:bg-primary-hover focus:bg-primary-hover"
                  aria-label="More emojis"
                  title="More emojis"
                >
                  <SmilePlus className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                collisionPadding={8}
                side="top"
                sideOffset={8}
                className="w-[320px] rounded-xl border-call-border bg-call-background p-2"
              >
                <div className="grid max-h-[280px] grid-cols-8 gap-1 overflow-y-auto pr-1">
                  {EXTRA_REACTIONS.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      onSelect={(event) => {
                        event.preventDefault();
                        handleSendReaction(emoji);
                      }}
                      className="flex items-center justify-center cursor-pointer rounded-lg px-2.5 py-1 text-center text-2xl transition-colors hover:bg-primary-hover focus:bg-primary-hover"
                    >
                      <span>{emoji}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={() => {
                playClickSound();
                void toggleHandRaise();
              }}
              className={cn(
                "ml-1 flex h-10 w-10 items-center justify-center rounded-lg border cursor-pointer transition-all duration-200",
                isHandRaised
                  ? "border-blue-400/30 bg-blue-500/30 text-foreground hover:bg-blue-500/40"
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
      <p className="text-[0.675rem] text-foreground/50 max-md:hidden">React</p>
    </div>
  );

  const renderPrimaryControls = () => (
    <div className="select-none flex items-center gap-1.5 p-1 md:gap-2.5 md:p-2">
      {renderRecordingControl()}
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
      {/* Screen share is effectively unsupported in phone browsers, and the
          theme/fullscreen options are non-essential - both give up their slot
          on small screens so the core controls fit. */}
      <div className="max-md:hidden">{renderScreenShareControl()}</div>
      {renderReactionsControl()}
      <div className="max-md:hidden">{renderOptionsControl()}</div>
      <div className="h-8 border-r border-primary-border mx-1 mb-4.5 max-md:hidden" />
      {renderEndControl()}
    </div>
  );

  const renderSidebarControls = () => (
    <div className="flex items-center gap-1.5 md:gap-2 select-none">
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
      <div className="relative">
        <ControlButton
          icon={<IoChatbubbleOutline />}
          label="Chat"
          sound={false}
          onClick={() => toggleSidebar("chat")}
          variant={activeSidebar === "chat" ? "active" : "default"}
        />
        {unreadChatCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[0.65rem] font-semibold text-white">
            {unreadChatCount > 9 ? "9+" : unreadChatCount}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="relative mt-0 flex w-full items-center justify-between rounded-2xl bg-call-background px-2 py-1.5 max-md:flex-wrap max-md:gap-1 md:px-3 md:py-2">
        {renderSavedCta()}
        {renderTimeCode()}
        {/* Absolute centering needs the side groups' width in slack, which only
            exists on wide screens - below lg the bar flows as a normal row. */}
        <div className="lg:absolute lg:left-1/2 lg:-translate-x-1/2">
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
