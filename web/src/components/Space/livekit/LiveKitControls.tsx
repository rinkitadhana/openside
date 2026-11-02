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
import {
  ConnectionState,
  LocalVideoTrack,
  Track,
  type Participant,
} from "livekit-client";
import {
  BsFillTelephoneFill,
  BsInfoLg,
  BsFillRecordCircleFill,
} from "react-icons/bs";
import {
  FiCheckSquare,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiSettings,
  FiSmile,
  FiSquare,
  FiUploadCloud,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import { FaCircleCheck } from "react-icons/fa6";
import { IoChatbubbleOutline, IoHandRightOutline } from "react-icons/io5";
import {
  Loader2,
  Maximize,
  Minimize,
  ScanFace,
  SmilePlus,
  X,
} from "lucide-react";
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
import { playCallSound, prepareCallSounds } from "@/lib/callSounds";
import { toast } from "@/lib/toast";
import ControlButton from "../controls/ControlButton";
import CallWarningDialog from "../ui/CallWarningDialog";
import { usePresence } from "@/hooks/usePresence";
import { useLiveKitChat } from "../chat/LiveKitChatProvider";
import { useLiveKitReactions } from "../reactions/LiveKitReactionsProvider";
import {
  type ParticipantUpload,
  useRecordingContext,
} from "../recording/RecordingProvider";
import { useStartingMedia } from "./StartingMediaContext";
import { useCameraPreview } from "./CameraPreview";
import { useIsAudioOnlyCall } from "./AudioOnlyMode";
import CallSettingsDialog, { type SettingsTab } from "./CallSettingsDialog";
import { shouldPreviewCamera } from "@/lib/cameraPreviewPreference";
import {
  applyCameraBackground,
  loadCustomImage,
  loadSavedBackground,
} from "@/lib/cameraBackgrounds";

// Screen-share capture options. NOTE: LiveKit's setScreenShareEnabled /
// createScreenTracks do NOT merge the room's screenShareCaptureDefaults - they
// only use the options passed at the call site (audio defaults to false). So we
// must request tab/system audio explicitly here, or a shared video's sound is
// never captured, published, or recorded. Resolution is left to the SDK default
// (1080p30). Chromium-only, and still gated by the picker's "Share audio" box.
const SCREEN_CAPTURE_OPTIONS = { audio: true } as const;

// Locked controls (e.g. while the call connects): hollow, dashed and greyed
// out with no hover, so they clearly read as unavailable rather than "off".
const DISABLED_CONTROL_CLASS =
  "cursor-not-allowed border-dashed border-foreground/20 bg-transparent text-foreground/30 hover:bg-transparent";
const DISABLED_LABEL_CLASS = "text-foreground/30";

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
  usingHeadphones: boolean;
  onHeadphonesChange: (usingHeadphones: boolean) => void;
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
  name,
  avatar,
  thumbnailUrl,
}: {
  name: string;
  avatar: string;
  thumbnailUrl: string | null;
}) => {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
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
        <span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-brand text-sm font-semibold text-white">
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

// Shown above the control bar while a stopped recording uploads and once it has.
// This is upload confirmation only - server-side processing/merging is surfaced
// on the project page, not here. Hosts get a row per participant with their live
// progress; everyone else just sees their own. Ends with a link to the project.
interface Person {
  name: string;
  avatar: string;
}

const savedCardDismissKey = (sessionId: string) =>
  `openside:uploadedCardDismissed:${sessionId}`;

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

const UPLOAD_RING_RADIUS = 12;
const UPLOAD_RING_CIRCUMFERENCE = 2 * Math.PI * UPLOAD_RING_RADIUS;

/**
 * Live upload beside the recording timer: a ring filling with the chunk going
 * up right now (chunks upload while recording, so it climbs to 100 for each in
 * turn), and on hover how far this take's upload is overall.
 */
const LiveUploadStatus = ({
  percent,
  uploaded,
  total,
}: {
  percent: number;
  uploaded: number;
  total: number;
}) => {
  const waiting = Math.max(0, total - uploaded);
  const caughtUp = total > 0 && waiting === 0;
  // More than the one chunk in flight is queued: the uplink is falling behind.
  const behind = waiting > 1;
  const overall = total > 0 ? clampPercent((uploaded / total) * 100) : 0;
  const headline =
    total === 0
      ? "Waiting for the first chunk"
      : caughtUp
        ? "All chunks uploaded"
        : behind
          ? "Upload is catching up"
          : "Uploading as you record";

  return (
    <span
      tabIndex={0}
      aria-label={`${headline}. Current chunk ${percent}%, ${uploaded} of ${total} chunks uploaded.`}
      className="group/upload relative flex cursor-default items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5"
    >
      <span
        className={cn(
          "relative grid size-[28px] shrink-0 place-items-center transition-colors",
          behind ? "text-amber-400" : "text-foreground",
        )}
      >
        <svg
          viewBox="0 0 28 28"
          className="absolute inset-0 size-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="14"
            cy="14"
            r={UPLOAD_RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-20"
          />
          <circle
            cx="14"
            cy="14"
            r={UPLOAD_RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={UPLOAD_RING_CIRCUMFERENCE}
            strokeDashoffset={UPLOAD_RING_CIRCUMFERENCE * (1 - percent / 100)}
            className="transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>
        <FiUploadCloud className="size-[13.5px]" strokeWidth={2.5} />
      </span>
      {/* A hidden "100%" sizes the label, so going 99 -> 100 doesn't shift it. */}
      <span className="grid text-left text-[15px] font-medium tabular-nums text-foreground">
        <span className="invisible col-start-1 row-start-1" aria-hidden="true">
          100%
        </span>
        <span className="col-start-1 row-start-1">{percent}%</span>
      </span>

      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+0.75rem)] left-0 z-[70] flex w-60 translate-y-1 scale-95 flex-col rounded-xl border border-call-border/80 bg-primary-hover p-3 text-left opacity-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur-sm transition-[opacity,transform,visibility] duration-150 ease-out group-hover/upload:visible group-hover/upload:translate-y-0 group-hover/upload:scale-100 group-hover/upload:opacity-100 group-focus/upload:visible group-focus/upload:translate-y-0 group-focus/upload:scale-100 group-focus/upload:opacity-100"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <FiUploadCloud className="size-4 shrink-0 text-foreground/70" />
          {headline}
        </span>
        <span className="mt-3 flex items-center justify-between text-xs text-foreground/60">
          Current chunk
          <span className="font-medium tabular-nums text-foreground">
            {percent}%
          </span>
        </span>
        <span className="mt-1.5 flex items-center justify-between text-xs text-foreground/60">
          Chunks uploaded
          <span className="font-medium tabular-nums text-foreground">
            {uploaded} / {total}
          </span>
        </span>
        <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-500 ease-out",
              caughtUp ? "bg-emerald-500" : "bg-brand",
            )}
            style={{ width: `${overall}%` }}
          />
        </span>
        {behind && (
          <span className="mt-2.5 text-[11px] leading-4 text-foreground/50">
            {waiting - 1} more queued on a slow connection. They keep uploading
            after you stop.
          </span>
        )}
        <span className="absolute left-[20px] top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-[5px] rotate-45 border-b border-r border-call-border/80 bg-primary-hover" />
      </span>
    </span>
  );
};

const SavedSessionCard = ({
  spaceId,
  sessionId,
  onVisit,
  uploadProgress = null,
  participantUploads = null,
}: {
  spaceId: string | undefined;
  sessionId: string | null;
  onVisit: () => void;
  /** Set while this participant's chunks are still uploading (0-100). */
  uploadProgress?: number | null;
  /** Hosts only: other participants' socket-reported uploads by identity. */
  participantUploads?: Record<string, ParticipantUpload> | null;
}) => {
  const isUploading = uploadProgress !== null;
  const percent = clampPercent(uploadProgress ?? 0);
  const allParticipants = useParticipants();
  const showOthers = participantUploads !== null;
  // Pull the current session's per-track thumbnails (early posters from the first
  // chunk). Poll briefly so a thumbnail still generating shows up once ready.
  const { data: sessionsData } = useGetRecordingSessionsBySpace(
    spaceId ?? "",
    !!spaceId,
    3000,
  );
  const session =
    sessionsData?.sessions?.find((s) => s.id === sessionId) ??
    sessionsData?.sessions?.[0];
  const { thumbnailByIdentity, uploadedByIdentity, recordedPeople } =
    useMemo(() => {
      const thumbnails = new Map<string, string>();
      // Fallback for a missed socket update: true once every track is complete.
      const uploaded = new Map<string, boolean>();
      // Who recorded in this take - kept after they leave the call.
      const people = new Map<string, Person>();
      for (const rec of session?.participantRecordings ?? []) {
        const identity = rec.participant?.livekitIdentity;
        if (!identity) continue;
        if (rec.thumbnailUrl) thumbnails.set(identity, rec.thumbnailUrl);
        uploaded.set(
          identity,
          (uploaded.get(identity) ?? true) && rec.isComplete,
        );
        if (!people.has(identity)) {
          people.set(identity, {
            name:
              rec.participant?.user?.name?.trim() ||
              rec.participant?.displayName?.trim() ||
              "Guest",
            avatar: rec.participant?.user?.avatar ?? "",
          });
        }
      }
      return {
        thumbnailByIdentity: thumbnails,
        uploadedByIdentity: uploaded,
        recordedPeople: people,
      };
    }, [session]);

  // Everyone seen in the call while this card is up, so someone who leaves
  // keeps their name and picture even if the session data lacks them.
  const [seenPeople, setSeenPeople] = useState<Record<string, Person>>({});
  useEffect(() => {
    setSeenPeople((previous) => {
      let next = previous;
      for (const participant of allParticipants) {
        const person = {
          name: participant.name?.trim() || "Guest",
          avatar: getParticipantAvatar(participant),
        };
        const known = previous[participant.identity];
        if (known?.name === person.name && known.avatar === person.avatar) {
          continue;
        }
        if (next === previous) next = { ...previous };
        next[participant.identity] = person;
      }
      return next;
    });
  }, [allParticipants]);

  type UploadRow = {
    identity: string;
    person: Person;
    done: boolean;
    progress: number | null;
    /** No longer in the call - their upload continues from their browser. */
    left: boolean;
  };
  const local = allParticipants.find((participant) => participant.isLocal);
  const inCall = new Set(allParticipants.map((participant) => participant.identity));
  const personFor = (identity: string): Person =>
    seenPeople[identity] ??
    recordedPeople.get(identity) ?? { name: "Guest", avatar: "" };

  const rows: UploadRow[] = [];
  if (local) {
    rows.push({
      identity: local.identity,
      person: personFor(local.identity),
      done: !isUploading,
      progress: percent,
      left: false,
    });
  }
  if (showOthers) {
    // In-call order first, then anyone who recorded and has since left.
    const others = [
      ...allParticipants
        .filter((participant) => !participant.isLocal)
        .map((participant) => participant.identity),
      ...Object.keys(participantUploads ?? {}),
      ...recordedPeople.keys(),
    ].filter(
      (identity, index, all) =>
        identity !== local?.identity && all.indexOf(identity) === index,
    );
    for (const identity of others) {
      const reported = participantUploads?.[identity];
      const uploaded = uploadedByIdentity.get(identity);
      // Joined after the recording: no tracks and nothing reported.
      if (!reported && uploaded === undefined) continue;
      rows.push({
        identity,
        person: personFor(identity),
        done: reported?.done === true || uploaded === true,
        progress: reported ? clampPercent(reported.progress) : null,
        left: !inCall.has(identity),
      });
    }
  }
  const allUploaded = rows.every((row) => row.done);

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

  if (dismissed && !isUploading) return null;

  return (
    <div className="relative flex w-[19rem] flex-col gap-3 rounded-2xl border border-call-border bg-call-primary p-3.5">
      {!isUploading && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="absolute right-2.5 top-2.5 rounded-md p-1 text-foreground/40 transition-colors hover:bg-primary-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}

      {/* Header */}
      <p className="pr-6 text-lg font-semibold text-foreground">
        {allUploaded
          ? "Your recording is uploaded"
          : rows.length > 1
            ? "Uploading recordings"
            : "Uploading your recording"}
      </p>

      {/* One row per participant in the recording */}
      <div className="flex flex-col gap-1">
        {rows.map(({ identity, person, done, progress, left }) => {
          return (
            <div
              key={identity}
              className="flex items-center justify-between gap-2 rounded-lg border border-call-border bg-call-background p-1.5 pr-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <ParticipantThumb
                  name={person.name}
                  avatar={person.avatar}
                  thumbnailUrl={thumbnailByIdentity.get(identity) ?? null}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {person.name}
                  </span>
                  <span className="text-xs tabular-nums text-foreground/50">
                    {done
                      ? "Uploaded"
                      : left
                        ? "Left the call · uploading from their browser"
                        : progress === null
                          ? "Uploading…"
                          : `Uploading… ${progress}%`}
                  </span>
                </span>
              </span>
              {!done ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-foreground/50" />
              ) : (
                <FaCircleCheck className="size-4 shrink-0 text-emerald-500" />
              )}
            </div>
          );
        })}
      </div>

      {isUploading ? (
        // Takes the "Go to project" button's slot until the upload finishes.
        <div
          role="status"
          aria-label={`Uploading recording, ${percent}%`}
          className="flex min-h-10 items-center gap-2.5 rounded-xl border border-call-border bg-call-background px-3"
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-foreground/70">
            {percent}%
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onVisit}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
        >
          Go to project
          <FiExternalLink className="size-4" />
        </button>
      )}
    </div>
  );
};

const LiveKitControls = ({
  activeSidebar,
  deafened,
  isHost,
  roomCode,
  setDeafened,
  onEndForAll,
  onLeave,
  toggleSidebar,
  usingHeadphones,
  onHeadphonesChange,
}: LiveKitControlsProps) => {
  const [pendingExitAction, setPendingExitAction] = useState<ExitAction>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outputVolume, setOutputVolume] = useState(100);
  const [micLevel, setMicLevel] = useState(0);
  const animFrameRef = useRef<number>(null);
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
  const previousOutputVolumeBeforeDeafenRef = useRef(outputVolume);
  const { sendReaction } = useLiveKitReactions();
  const recording = useRecordingContext();
  // The start chime plays from the recording manager when the countdown ends.
  const recordingStateForSound = recording.recordingState;

  // Recording failures surface as toasts - never as inline UI in the bar.
  // Each fires once, on the transition into the failed state.
  const previousStopFailedRef = useRef(recording.stopRequestFailed);
  useEffect(() => {
    const previous = previousStopFailedRef.current;
    previousStopFailedRef.current = recording.stopRequestFailed;
    if (recording.stopRequestFailed && !previous) {
      toast.error(
        "Couldn't stop the recording. Press Retry to finish stopping it.",
        6000,
      );
    }
  }, [recording.stopRequestFailed]);
  const previousRecordingErrorStateRef = useRef(recordingStateForSound);
  useEffect(() => {
    const previous = previousRecordingErrorStateRef.current;
    previousRecordingErrorStateRef.current = recordingStateForSound;
    // A failed stop has its own message above.
    if (
      recordingStateForSound === "error" &&
      previous !== "error" &&
      !recording.stopRequestFailed
    ) {
      toast.error("Recording failed. Please try again.", 6000);
    }
  }, [recordingStateForSound, recording.stopRequestFailed]);
  const previousBackendStatusRef = useRef(recording.backendStatus);
  useEffect(() => {
    const previous = previousBackendStatusRef.current;
    previousBackendStatusRef.current = recording.backendStatus;
    if (recording.backendStatus === "FAILED" && previous !== "FAILED") {
      toast.error(
        "Your recording couldn't be processed. Check the project for details.",
        8000,
      );
    }
  }, [recording.backendStatus]);
  const { openCameraPreview, toggleCameraPreview, setCameraAnchor } =
    useCameraPreview();
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
    localParticipant,
  } = useLocalParticipant();
  // Until LiveKit is connected and the pre-join camera/mic are published, show
  // the chosen state and lock the media controls so clicks can't race them.
  const startingMedia = useStartingMedia();
  const connectionState = useConnectionState();
  const isStartingMedia =
    startingMedia !== null || connectionState !== ConnectionState.Connected;
  // Host set the call to audio-only: cameras and screen share stay off.
  const isAudioOnly = useIsAudioOnlyCall();
  const isScreenShareLocked = isStartingMedia || isAudioOnly;
  const showMicOn = startingMedia ? startingMedia.audioOn : isMicrophoneEnabled;
  const showCameraOn = startingMedia ? startingMedia.videoOn : isCameraEnabled;
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
    try {
      if (deafened) {
        // Undeafening plays its own sound; no separate unmute blip.
        await handleDeafenToggle(false);
        await localParticipant.setMicrophoneEnabled(true);
        return;
      }
      const nextEnabled = !isMicrophoneEnabled;
      await localParticipant.setMicrophoneEnabled(nextEnabled);
      playCallSound(nextEnabled ? "micOn" : "micOff");
    } catch {
      // Mirror toggleCamera: unmuting fails when access is blocked or the
      // device is missing - without this the button silently does nothing
      // (exactly what happens after joining with mic permission denied).
      // The control state remains unchanged when media access fails.
    }
  };

  // Straight on, for people who turned the preview off in settings - still
  // with their saved background.
  const turnOnCameraDirectly = async () => {
    try {
      const publication = await localParticipant.setCameraEnabled(true);
      playCallSound("cameraOn");
      const track = publication?.track;
      if (track instanceof LocalVideoTrack) {
        await applyCameraBackground(
          track,
          loadSavedBackground(),
          loadCustomImage(),
        );
      }
    } catch {
      // Access blocked or the device is missing/in use - leave video off.
    }
  };

  const toggleCamera = async () => {
    // Turning on goes through the preview (unless turned off in settings),
    // which publishes on confirm and explains access/device failures itself.
    if (!isCameraEnabled) {
      if (isAudioOnly) return;
      if (shouldPreviewCamera()) toggleCameraPreview();
      else await turnOnCameraDirectly();
      return;
    }
    try {
      await localParticipant.setCameraEnabled(false);
      playCallSound("cameraOff");
    } catch {
      // The control state remains unchanged if the camera can't be stopped.
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

  useEffect(() => {
    // Muted/deafened: nothing is sent, so hard-zero the meter instead of
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
        setMicLevel(Math.min(100, Math.round(curved * 100 * 4)));
      }
      animFrameRef.current = requestAnimationFrame(poll);
    };

    const track = localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track?.mediaStreamTrack;
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

  const handleDeafenToggle = async (checked: boolean) => {
    const shouldDeafen = checked === true;

    playCallSound(shouldDeafen ? "deafen" : "undeafen");
    setDeafened(shouldDeafen);

    if (shouldDeafen) {
      previousMicEnabledBeforeDeafenRef.current = isMicrophoneEnabled;
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

      setOutputVolume(0);
    } else {
      setOutputVolume(previousOutputVolumeBeforeDeafenRef.current);

      if (previousMicEnabledBeforeDeafenRef.current === true) {
        try {
          await localParticipant.setMicrophoneEnabled(true);
        } catch (error) {
          console.error("Unable to restore microphone after undeafen:", error);
        }
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
  const exitDialog = usePresence(pendingExitCopy);

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
      <div className="mt-2 grid grid-cols-[repeat(29,1fr)] gap-0.5">
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
    const isDisabled = isBusy || isStartingMedia;

    const insideLabel = isRecording
      ? "Stop"
      : stopRequestFailed
        ? "Retry"
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
            if (isDisabled) return;
            // Make sure the start chime (and every other sound) is ready.
            prepareCallSounds();
            recording.toggleRecording();
          }}
          disabled={isDisabled}
          className={cn(
            // Fixed width (sized for the longest label, "Starting") so state
            // changes don't resize the button and shift the control bar.
            "flex min-h-11 items-center justify-center gap-2 border px-3.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 md:w-[98px] md:px-1 max-md:min-h-10 max-md:px-2.5",
            isRecording
              ? "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700"
              : "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:border-red-600",
            isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            isStartingMedia && DISABLED_CONTROL_CLASS,
          )}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          <BsFillRecordCircleFill
            className={cn(
              "size-4",
              isStartingMedia ? "text-foreground/30" : "text-white",
              isRecording && !isStartingMedia && "animate-pulse",
            )}
          />
          <span className="max-md:hidden">{insideLabel}</span>
        </button>
        <p
          className={cn(
            "text-[0.675rem] text-foreground/50 max-md:hidden",
            isStartingMedia && DISABLED_LABEL_CLASS,
          )}
        >
          {caption}
        </p>
      </div>
    );
  };

  const renderRecordingIndicator = () => {
    // Only show once capture has actually started - never during "starting" or
    // the synced "countdown" lead-in. After stop, the upload card above the
    // control bar (renderRecordingCard) takes over.
    // Failures are announced as toasts (see the recording-failure effect).
    if (recording.recordingState !== "recording") return null;

    // The uploader reads 100 while idle; before this take's first chunk is up
    // that would claim a finished upload that hasn't started.
    const uploadPercent =
      recording.takeChunks.uploaded === 0 && recording.uploadProgress === 100
        ? 0
        : recording.uploadProgress;

    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <span
          // Fixed width so digit/length changes never shift the rest of the
          // bar. Left-aligned to keep the number anchored in its slot.
          className="inline-block min-w-[3.25rem] text-left text-base font-normal tabular-nums text-foreground"
        >
          {formatRecordingDuration(recording.recordingDurationMs)}
        </span>
        <span className="mx-0.5 h-5 w-px bg-foreground/20" />
        <LiveUploadStatus
          percent={uploadPercent}
          uploaded={recording.takeChunks.uploaded}
          total={recording.takeChunks.total}
        />
      </div>
    );
  };

  // Once the recording has stopped and its chunks have finished uploading, float
  // an upload-confirmation card above the control bar that links to the project
  // page (where server-side processing → ready is surfaced).
  const renderRecordingCard = () => {
    const state = recording.recordingState;
    const isUploading = state === "stopping" || state === "uploading";
    // The project library belongs to the host, so "Go to project" is
    // host-only. Everyone uploads their own tracks, so everyone sees progress;
    // hosts also see everyone else's.
    const isRecordingHost =
      isHost ||
      participantRole === "HOST" ||
      localParticipant.attributes.room_admin === "true";
    const participantUploads = recording.canControl
      ? recording.participantUploads
      : null;

    if (isUploading) {
      return (
        <div className="absolute bottom-full left-1/2 z-20 mb-3 -translate-x-1/2">
          <SavedSessionCard
            spaceId={recording.spaceId}
            sessionId={recording.sessionId}
            onVisit={recording.openRecording}
            uploadProgress={recording.uploadProgress}
            participantUploads={participantUploads}
          />
        </div>
      );
    }
    if (state !== "complete" || !isRecordingHost) return null;
    if (recording.backendStatus === "FAILED") return null;

    return (
      <div className="absolute bottom-full left-1/2 z-20 mb-3 -translate-x-1/2">
        <SavedSessionCard
          spaceId={recording.spaceId}
          sessionId={recording.sessionId}
          onVisit={recording.openRecording}
          participantUploads={participantUploads}
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
            disabled={isStartingMedia}
            className={cn(
              "flex items-center justify-center border border-call-border p-3 rounded-xl text-lg font-medium cursor-pointer transition-all duration-200 hover:bg-muted",
              isOptionsMenuOpen ? "bg-muted" : "bg-primary",
              isStartingMedia && DISABLED_CONTROL_CLASS,
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
          className="min-w-[200px] rounded-xl border-call-border bg-call-background p-1"
        >
          <DropdownMenuItem
            onSelect={toggleFullscreen}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setSettingsTab("general")}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm focus:bg-primary-hover"
          >
            <FiSettings />
            Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p
        className={cn(
          "text-[0.675rem] text-foreground/50 max-md:hidden",
          isStartingMedia && DISABLED_LABEL_CLASS,
        )}
      >
        Options
      </p>
    </div>
  );

  const renderEndControl = () =>
    canEndForAll ? (
      <div className="flex flex-col gap-1 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isStartingMedia}
              className={cn(
                "flex items-center justify-center border border-red-500 bg-red-500 p-2.5 md:p-3 rounded-xl text-lg font-medium text-white cursor-pointer transition-all duration-200 hover:border-red-600 hover:bg-red-600",
                isStartingMedia && DISABLED_CONTROL_CLASS,
              )}
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
        <p
          className={cn(
            "text-[0.675rem] text-foreground/50 max-md:hidden",
            isStartingMedia && DISABLED_LABEL_CLASS,
          )}
        >
          End
        </p>
      </div>
    ) : (
      <ControlButton
        icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
        label="End"
        onClick={onLeave}
        variant="danger"
        disabled={isStartingMedia}
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
      <div
        className={`px-2.5 py-2 ${
          deafened || !isMicrophoneEnabled ? "opacity-55" : ""
        }`}
      >
        <p className="text-xs font-normal text-foreground/85">Input Level</p>
        {renderVolumeMeter()}
      </div>
      {renderRangeControl(
        "Output Volume",
        outputVolume,
        handleOutputVolumeChange,
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
      <DropdownMenuItem
        onSelect={() => setSettingsTab("audio")}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal focus:bg-primary-hover"
      >
        <FiSettings className="size-4" />
        Audio settings
      </DropdownMenuItem>
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
      <DropdownMenuSeparator className="mx-2 my-1.5 bg-call-border" />
      <DropdownMenuItem
        onSelect={openCameraPreview}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal focus:bg-primary-hover"
      >
        <ScanFace className="size-4" />
        Camera preview
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => setSettingsTab("video")}
        className="cursor-pointer rounded-lg px-2.5 py-1.5 pl-2.5 text-sm font-normal focus:bg-primary-hover"
      >
        <FiSettings className="size-4" />
        Video settings
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
    disabled = false,
    disabledReason,
    anchorRef,
  }: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    menu: ReactNode;
    activeLabel: string;
    active: boolean;
    menuId: "mic" | "cam";
    disabled?: boolean;
    disabledReason?: string;
    anchorRef?: (element: HTMLElement | null) => void;
  }) => (
    <div className="flex flex-col gap-1 items-center" title={disabledReason}>
      <div
        ref={anchorRef}
        className={cn(
          "flex items-stretch gap-0.5",
          disabled && "cursor-not-allowed",
        )}
        aria-disabled={disabled}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onClick();
          }}
          className={cn(
            // On phones the device-menu chevron is hidden, so the button takes
            // the full rounding itself.
            "flex min-h-11 w-11 items-center justify-center rounded-l-xl border text-lg font-medium cursor-pointer transition-all duration-200 max-md:min-h-10 max-md:w-10 max-md:rounded-xl",
            disabled
              ? DISABLED_CONTROL_CLASS
              : active
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
              disabled={disabled}
              className={cn(
                "flex min-h-11 w-6 items-center justify-center rounded-r-xl border text-base font-medium cursor-pointer transition-all duration-200 max-md:hidden",
                disabled
                  ? DISABLED_CONTROL_CLASS
                  : active
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
      <p
        className={cn(
          "text-[0.675rem] text-foreground/50 max-md:hidden",
          disabled && DISABLED_LABEL_CLASS,
        )}
      >
        {label}
      </p>
    </div>
  );

  const renderScreenShareControl = () =>
    isScreenShareEnabled ? (
      <div className="flex flex-col gap-1 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isScreenShareLocked}
              className={cn(
                "flex items-center justify-center rounded-xl border border-blue-400/10 bg-blue-400/20 p-3 text-lg font-medium text-blue-400 cursor-pointer transition-all duration-200 hover:bg-blue-400/40",
                isScreenShareLocked && DISABLED_CONTROL_CLASS,
              )}
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
        <p
          className={cn(
            "text-[0.675rem] text-foreground/50 max-md:hidden",
            isScreenShareLocked && DISABLED_LABEL_CLASS,
          )}
        >
          Share
        </p>
      </div>
    ) : (
      <ControlButton
        icon={<LuScreenShare />}
        label="Share"
        onClick={toggleScreenShare}
        disabled={isScreenShareLocked}
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
            disabled={isScreenShareLocked}
            className={cn(
              "flex min-h-11 w-11 items-center justify-center rounded-xl border border-call-border text-lg font-medium cursor-pointer transition-all duration-200 max-md:min-h-10 max-md:w-10",
              isReactionMenuOpen ? "bg-muted" : "bg-primary hover:bg-muted",
              isScreenShareLocked && DISABLED_CONTROL_CLASS,
            )}
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
      <p
        className={cn(
          "text-[0.675rem] text-foreground/50 max-md:hidden",
          isScreenShareLocked && DISABLED_LABEL_CLASS,
        )}
      >
        React
      </p>
    </div>
  );

  const renderPrimaryControls = () => (
    <div className="select-none flex items-center gap-1.5 p-1 md:gap-2.5 md:p-2">
      {renderRecordingControl()}
      {renderSplitMediaControl({
        icon: showMicOn ? <RiMicLine /> : <RiMicOffLine />,
        label: "Mic",
        onClick: toggleMicrophone,
        menu: renderMicDeviceMenu(),
        activeLabel: "Microphone and speaker options",
        active: showMicOn,
        menuId: "mic",
        disabled: isStartingMedia,
      })}
      {renderSplitMediaControl({
        icon: showCameraOn ? <FiVideo /> : <FiVideoOff />,
        label: "Cam",
        onClick: toggleCamera,
        menu: renderCameraDeviceMenu(),
        activeLabel: "Camera options",
        active: showCameraOn,
        menuId: "cam",
        disabled: isStartingMedia || isAudioOnly,
        disabledReason: isAudioOnly
          ? "The host made this call audio-only"
          : undefined,
        anchorRef: setCameraAnchor,
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
        onClick={() => toggleSidebar("info")}
        variant={activeSidebar === "info" ? "active" : "default"}
        disabled={isStartingMedia}
      />
      <ControlButton
        icon={<LuUsers />}
        label="People"
        onClick={() => toggleSidebar("users")}
        variant={activeSidebar === "users" ? "active" : "default"}
        disabled={isStartingMedia}
      />
      <div className="relative">
        <ControlButton
          icon={<IoChatbubbleOutline />}
          label="Chat"
          onClick={() => toggleSidebar("chat")}
          variant={activeSidebar === "chat" ? "active" : "default"}
          disabled={isStartingMedia}
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
        {renderRecordingCard()}
        {renderTimeCode()}
        {/* Absolute centering needs the side groups' width in slack, which only
            exists on wide screens - below lg the bar flows as a normal row. */}
        <div className="lg:absolute lg:left-1/2 lg:-translate-x-1/2">
          {renderPrimaryControls()}
        </div>
        {renderSidebarControls()}
      </div>
      {settingsTab && (
        <CallSettingsDialog
          initialTab={settingsTab}
          roomCode={roomCode}
          isHost={isHost}
          usingHeadphones={usingHeadphones}
          onHeadphonesChange={onHeadphonesChange}
          outputVolume={outputVolume}
          onOutputVolumeChange={handleOutputVolumeChange}
          onTurnOnCamera={() => {
            setSettingsTab(null);
            if (shouldPreviewCamera()) openCameraPreview();
            else void turnOnCameraDirectly();
          }}
          onClose={() => setSettingsTab(null)}
        />
      )}
      {exitDialog.rendered && (
        <CallWarningDialog
          title={exitDialog.rendered.title}
          description={exitDialog.rendered.description}
          confirmLabel={exitDialog.rendered.confirmLabel}
          onCancel={() => setPendingExitAction(null)}
          onConfirm={handleExitConfirm}
          isClosing={exitDialog.isClosing}
        />
      )}
    </>
  );
};

export default LiveKitControls;
