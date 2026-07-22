import {
  ParticipantTile,
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useIsMuted,
  useLocalParticipant,
  useIsSpeaking,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import {
  ConnectionQuality,
  ConnectionState,
  Track,
  type Participant,
} from "livekit-client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Loader2, Mail, MicOff, X } from "lucide-react";
import { FiSend, FiWifiOff } from "react-icons/fi";
import { TbCopy, TbCopyCheck } from "react-icons/tb";
import { IoHandRightOutline } from "react-icons/io5";
import { LuHeadphoneOff, LuWifiHigh } from "react-icons/lu";
import UserAvatar from "../ui/UserAvatar";
import { AudioLinesIcon } from "@/components/shared/ui/audio-lines";
import { useGetMe } from "@/hooks/useUserQuery";
import { useSendSpaceInvite } from "@/hooks/useSpace";
import { toast } from "@/lib/toast";

const getRoleLabel = (attributes?: Record<string, string>) => {
  if (attributes?.role === "HOST") return "(Host)";
  if (attributes?.role === "CO_HOST") return "(Co-host)";
  return null;
};

const getParticipantAvatar = (participant: Participant) => {
  if (participant.attributes.avatar) {
    return participant.attributes.avatar;
  }

  if (!participant.metadata) {
    return "";
  }

  try {
    const metadata = JSON.parse(participant.metadata) as { avatar?: unknown };
    return typeof metadata.avatar === "string" ? metadata.avatar : "";
  } catch {
    return "";
  }
};

const LOCAL_SPEAKING_START_THRESHOLD = 0.025;
const LOCAL_SPEAKING_STOP_THRESHOLD = 0.018;

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const useLocalMicSpeaking = (participant: Participant, isMicMuted: boolean) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  // Bumped whenever the published mediaStreamTrack changes underneath us so
  // the analyser effect re-runs and binds the live track.
  const [trackEpoch, setTrackEpoch] = useState(0);
  const attachedTrackIdRef = useRef<string | null>(null);

  // A mic device switch (and the input-volume pipeline) replaces the published
  // mediaStreamTrack without re-rendering this component, which used to leave
  // the analyser bound to a stopped track - the speaking ring froze off until
  // the next mute/unmute. Poll cheaply and re-attach when the track changes.
  useEffect(() => {
    if (!participant.isLocal || isMicMuted) return;

    const intervalId = window.setInterval(() => {
      const currentTrack = participant.getTrackPublication(
        Track.Source.Microphone
      )?.audioTrack?.mediaStreamTrack;
      const currentId =
        currentTrack && currentTrack.readyState === "live"
          ? currentTrack.id
          : null;
      if (currentId !== attachedTrackIdRef.current) {
        setTrackEpoch((epoch) => epoch + 1);
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [participant, isMicMuted]);

  useEffect(() => {
    const resetSpeaking = () => {
      isSpeakingRef.current = false;
      window.setTimeout(() => setIsSpeaking(false), 0);
    };

    if (!participant.isLocal || isMicMuted) {
      attachedTrackIdRef.current = null;
      resetSpeaking();
      return;
    }

    const publication = participant.getTrackPublication(Track.Source.Microphone);
    const mediaStreamTrack = publication?.audioTrack?.mediaStreamTrack;

    if (!mediaStreamTrack || mediaStreamTrack.readyState !== "live") {
      attachedTrackIdRef.current = null;
      resetSpeaking();
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as WindowWithWebkitAudioContext).webkitAudioContext;

    if (!AudioContextConstructor) return;

    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([mediaStreamTrack])
    );
    let animationFrameId = 0;
    let speakingUntil = 0;

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    attachedTrackIdRef.current = mediaStreamTrack.id;

    const updateSpeaking = (nextIsSpeaking: boolean) => {
      if (isSpeakingRef.current === nextIsSpeaking) return;

      isSpeakingRef.current = nextIsSpeaking;
      setIsSpeaking(nextIsSpeaking);
    };

    const tick = () => {
      analyser.getByteTimeDomainData(samples);

      let sum = 0;
      for (const sample of samples) {
        const centeredSample = (sample - 128) / 128;
        sum += centeredSample * centeredSample;
      }

      const volume = Math.sqrt(sum / samples.length);
      const now = performance.now();

      if (volume > LOCAL_SPEAKING_START_THRESHOLD) {
        speakingUntil = now + 220;
      } else if (volume < LOCAL_SPEAKING_STOP_THRESHOLD && now > speakingUntil) {
        speakingUntil = 0;
      }

      updateSpeaking(now < speakingUntil);
      animationFrameId = requestAnimationFrame(tick);
    };

    void audioContext.resume();
    tick();

    return () => {
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
      attachedTrackIdRef.current = null;
      resetSpeaking();
    };
  }, [isMicMuted, participant, trackEpoch]);

  return isSpeaking;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InvitePanelProps {
  roomCode: string;
  spaceId: string;
  onDismiss: () => void;
}

const InvitePanel = ({ roomCode, spaceId, onDismiss }: InvitePanelProps) => {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const inviteLink = `${window.location.origin}/${roomCode}`;
  const sendInvite = useSendSpaceInvite(spaceId);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (error) {
      console.error("Unable to copy invite link:", error);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleSendInvite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      return;
    }
    try {
      await sendInvite.mutateAsync(trimmed);
      setEmail("");
      toast.success(`Invite sent to ${trimmed}`);
    } catch {
      toast.error("Couldn't send the invite. Please try again.");
    }
  };

  return (
    <div className="relative flex h-full min-h-[180px] flex-col items-center justify-center gap-6 rounded-xl bg-primary p-4 sm:p-8">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 cursor-pointer select-none rounded-full border border-border bg-background p-1.5 transition-all duration-300 hover:bg-primary"
        aria-label="Hide invite panel"
      >
        <X size={17} />
      </button>
      <div className="flex flex-col items-center gap-4 text-center">
        <Link size={36} className="text-foreground" />
        <div className="flex flex-col items-center gap-1">
          <p className="text-base font-semibold text-foreground">
            Invite someone
          </p>
          <p className="text-sm text-foreground/60">
            Share this link or send an email invite
          </p>
        </div>
      </div>
      <div className="flex w-full max-w-[420px] flex-col gap-3">
        {/* Link row */}
        <div className="flex items-stretch gap-2 rounded-xl border border-border bg-muted p-1 pl-3">
          <Link size={18} className="shrink-0 self-center text-foreground/40" />
          <span className="flex flex-1 items-center truncate font-mono text-sm font-light text-foreground/70">
            {inviteLink}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground transition-all duration-150 hover:opacity-80"
          >
            {copied ? <TbCopyCheck size={15} /> : <TbCopy size={15} />}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-foreground/40">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Email row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendInvite();
          }}
          className="flex items-stretch gap-2 rounded-xl border border-border bg-muted p-1 pl-3 transition-colors duration-150"
        >
          <Mail size={18} className="shrink-0 self-center text-foreground/40" />
          <input
            type="email"
            name="invite-panel-email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Invite by email"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
          <button
            type="submit"
            disabled={sendInvite.isPending}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground transition-all duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendInvite.isPending ? "Sending…" : <><FiSend size={14} /><span>Send</span></>}
          </button>
        </form>
      </div>
    </div>
  );
};

interface LiveKitVideoStageProps {
  deafened: boolean;
  isHost: boolean;
  localAvatar?: string;
  /** `${identity}::${source}` of the spotlighted tile, or null for the grid. */
  spotlightKey: string | null;
  onSpotlight: (key: string | null) => void;
  roomCode: string;
  spaceId?: string;
}

const getParticipantSortRank = (participant: Participant) => {
  if (participant.isLocal) return 0;
  if (participant.attributes.role === "HOST") return 1;
  if (participant.attributes.role === "CO_HOST") return 2;
  return 3;
};

const sortTrackRefs = <T extends { participant: Participant }>(trackRefs: T[]) =>
  [...trackRefs].sort((first, second) => {
    const rankDelta =
      getParticipantSortRank(first.participant) -
      getParticipantSortRank(second.participant);

    if (rankDelta !== 0) return rankDelta;

    return (first.participant.name || first.participant.identity).localeCompare(
      second.participant.name || second.participant.identity
    );
  });

// A screen share carries the same participant identity as their camera, so the
// tile key includes the track source to tell the two tiles apart.
const tileKey = (trackRef: { participant: Participant; source: Track.Source }) =>
  `${trackRef.participant.identity}::${trackRef.source}`;

const GRID_GAP_PX = 8; // matches gap-2
const GRID_TILE_ASPECT = 16 / 9;

// Best-fit tile size for the Discord grid: pick the column count that lets every
// 16:9 tile grow as large as possible while the whole block still fits the
// container in BOTH dimensions. Sizing by width alone (the old approach) made
// the rows taller than the container once the tiles wrapped, so `overflow-hidden`
// clipped the tops and bottoms of the videos. Constraining by height too keeps
// every tile fully visible, the way Discord does it.
const computeGridTileWidth = (
  width: number,
  height: number,
  tileCount: number
) => {
  if (width <= 0 || height <= 0 || tileCount <= 0) return 0;

  let bestTileWidth = 0;
  for (let cols = 1; cols <= tileCount; cols++) {
    const rows = Math.ceil(tileCount / cols);
    const widthPerTile = (width - (cols - 1) * GRID_GAP_PX) / cols;
    const heightPerTile = (height - (rows - 1) * GRID_GAP_PX) / rows;
    // How wide a 16:9 tile can be if capped by the available row height.
    const widthFromHeight = heightPerTile * GRID_TILE_ASPECT;
    const tileWidth = Math.min(widthPerTile, widthFromHeight);
    if (tileWidth > bestTileWidth) bestTileWidth = tileWidth;
  }

  // Floor to dodge sub-pixel rounding that could nudge the last row to wrap.
  return Math.floor(bestTileWidth);
};

// Callback-ref based so the observer attaches whenever the measured element
// mounts - the grid div renders conditionally (only with 3+ tiles), so a
// ref captured once at mount would never observe it and the size would stay 0.
const useElementSize = <T extends HTMLElement>() => {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size] as const;
};

const getConnectionQualityWarning = (quality: ConnectionQuality | undefined) => {
  if (quality === ConnectionQuality.Poor) {
    return {
      label: "Network unstable",
      tone: "warning" as const,
      icon: <LuWifiHigh size={20} />,
    };
  }

  if (quality === ConnectionQuality.Lost) {
    return {
      label: "Connection lost",
      tone: "danger" as const,
      icon: <FiWifiOff size={20} />,
    };
  }

  return null;
};

const DEMO_FORCE_CONNECTION_QUALITY: ConnectionQuality | null =
  null;

const LiveKitVideoStage = ({
  deafened,
  isHost,
  localAvatar,
  spotlightKey,
  onSpotlight,
  roomCode,
  spaceId = "",
}: LiveKitVideoStageProps) => {
  const [isInvitePanelHidden, setIsInvitePanelHidden] = useState(false);
  const [gridRef, gridSize] = useElementSize<HTMLDivElement>();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  // ALL active screen shares - LiveKit allows several at once. Each becomes its
  // own equal card in the grid, alongside every camera (a sharer keeps their
  // camera tile - the share is a separate box, not a replacement).
  const screenShareTracks = tracks.filter(
    (trackRef): trackRef is TrackReference =>
      isTrackReference(trackRef) &&
      trackRef.publication.source === Track.Source.ScreenShare
  );
  const cameraTracks = sortTrackRefs(
    tracks.filter((trackRef) => trackRef.source === Track.Source.Camera)
  );
  const remoteParticipantCount = participants.filter(
    (participant) => !participant.isLocal
  ).length;

  // One flat tile list, screen shares first so they read as prominent.
  const tiles = [...screenShareTracks, ...cameraTracks];

  const hasScreenShare = screenShareTracks.length > 0;
  const cameraCount = cameraTracks.length;
  // Discord grid whenever there's a share or 3+ people; otherwise the simple
  // single (1) / left-right (2) view, which has no click-to-spotlight.
  const isDiscordGrid = hasScreenShare || cameraCount >= 3;
  const spotlightTile = isDiscordGrid
    ? tiles.find((trackRef) => tileKey(trackRef) === spotlightKey)
    : undefined;

  const isAlone = remoteParticipantCount === 0;
  const connectionWarning = getConnectionQualityWarning(
    DEMO_FORCE_CONNECTION_QUALITY ?? localParticipant.connectionQuality,
  );
  // LiveKit recovers from network blips by reconnecting in the background;
  // without a visible indicator the call just freezes unexplained.
  const connectionState = useConnectionState();
  const isReconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  const showInvitePanel = isHost && isAlone && !isInvitePanelHidden;

  return (
    <div className="relative h-full min-h-0 flex flex-col gap-2">
      {(isReconnecting || connectionWarning) && (
        <div className="pointer-events-none absolute right-3 top-3 z-30">
          {isReconnecting ? (
            <span
              className="inline-flex size-8 items-center justify-center rounded-full bg-amber-500/50 text-white "
              title="Reconnecting..."
            >
              <Loader2 size={20} className="animate-spin" />
            </span>
          ) : (
            <span
              className={`inline-flex size-8 items-center justify-center rounded-full text-white  ${
                connectionWarning!.tone === "danger"
                  ? "bg-red-500/50"
                  : connectionWarning!.tone === "warning"
                    ? "bg-amber-500/50"
                    : "bg-foreground/40"
              }`}
              title={connectionWarning!.label}
            >
              {connectionWarning!.icon}
            </span>
          )}
        </div>
      )}
      <div className="@container flex-1 min-h-0">
        {spotlightTile ? (
          // Focus mode: the spotlighted tile fills the stage; the rest sit in a
          // scrollable strip along the bottom. Click the big tile to go back.
          <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1">
              <ParticipantFrame
                deafened={deafened}
                localAvatar={localAvatar}
                trackRef={spotlightTile}
                onClick={() => onSpotlight(null)}
              />
            </div>
            <div className="flex shrink-0 justify-center gap-3 overflow-x-auto pb-1">
              {tiles
                .filter((trackRef) => tileKey(trackRef) !== spotlightKey)
                .map((trackRef) => (
                  <div
                    key={tileKey(trackRef)}
                    className="aspect-video h-20 shrink-0 sm:h-28"
                  >
                    <ParticipantFrame
                      deafened={deafened}
                      localAvatar={localAvatar}
                      trackRef={trackRef}
                      onClick={() => onSpotlight(tileKey(trackRef))}
                      fill
                      compact
                    />
                  </div>
                ))}
            </div>
          </div>
        ) : isDiscordGrid ? (
          // Equal cards, centered - an incomplete last row (odd count) sits in
          // the middle rather than hugging the left. Tiles are sized from the
          // measured container so every one fits in both width and height
          // (no clipped tops/bottoms). Every tile is clickable to spotlight it.
          <div
            ref={gridRef}
            className="flex h-full flex-wrap content-center items-center justify-center gap-2 overflow-hidden"
          >
            {(() => {
              const tileWidth = computeGridTileWidth(
                gridSize.width,
                gridSize.height,
                tiles.length
              );
              // Until the first measurement lands, unsized tiles would collapse
              // to each video's intrinsic resolution - skip the frame instead.
              if (tileWidth <= 0) return null;
              return tiles.map((trackRef) => (
                <div
                  key={tileKey(trackRef)}
                  className="aspect-video min-h-0"
                  style={{ width: tileWidth, maxWidth: "100%" }}
                >
                  <ParticipantFrame
                    deafened={deafened}
                    localAvatar={localAvatar}
                    trackRef={trackRef}
                    onClick={() => onSpotlight(tileKey(trackRef))}
                    fill
                  />
                </div>
              ));
            })()}
          </div>
        ) : isAlone ? (
          <div
            className={`grid h-full gap-2 ${
              showInvitePanel
                ? "grid-cols-1 grid-rows-2 @5xl:grid-cols-2 @5xl:grid-rows-1"
                : "grid-cols-1"
            }`}
          >
            {cameraTracks.map((trackRef) => (
              <ParticipantFrame
                deafened={deafened}
                localAvatar={localAvatar}
                key={tileKey(trackRef)}
                trackRef={trackRef}
              />
            ))}
            {showInvitePanel && (
              <InvitePanel
                roomCode={roomCode}
                spaceId={spaceId}
                onDismiss={() => setIsInvitePanelHidden(true)}
              />
            )}
          </div>
        ) : (
          // Exactly two people, no share: one on the left, one on the right
          // (stacks vertically until the frame is comfortably wide).
          <div className="grid h-full gap-2 auto-rows-fr grid-cols-1 @5xl:grid-cols-2">
            {cameraTracks.map((trackRef) => (
              <ParticipantFrame
                deafened={deafened}
                localAvatar={localAvatar}
                key={tileKey(trackRef)}
                trackRef={trackRef}
              />
            ))}
          </div>
        )}
      </div>
      <RoomAudioRenderer />
    </div>
  );
};

interface ParticipantFrameProps {
  deafened: boolean;
  localAvatar?: string;
  trackRef: ReturnType<typeof useTracks>[number];
  /** When set, the tile is clickable to spotlight it (or exit the spotlight). */
  onClick?: () => void;
  /**
   * Fill the parent box edge-to-edge instead of shrinking to the video's own
   * aspect ratio. The Discord-style grid sizes its tiles itself (uniform 16:9
   * boxes), so tiles should fill them rather than each hug a different width.
   */
  fill?: boolean;
  /** Smaller overlays (name pill, mic icon) for the little filmstrip tiles. */
  compact?: boolean;
}

const ParticipantFrame = ({
  deafened,
  localAvatar,
  trackRef,
  onClick,
  fill = false,
  compact = false,
}: ParticipantFrameProps) => {
  const participant = trackRef.participant;
  const isScreenShare = trackRef.source === Track.Source.ScreenShare;
  const { data: localUser } = useGetMe();
  const isMicMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });
  const isCameraMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });
  const liveKitIsSpeaking = useIsSpeaking(participant);
  const localMicIsSpeaking = useLocalMicSpeaking(participant, isMicMuted);
  // The speaking ring / mic state belong to the person, not their screen tile.
  const isSpeaking =
    !isScreenShare &&
    (participant.isLocal ? localMicIsSpeaking : liveKitIsSpeaking);
  const roleLabel = getRoleLabel(participant.attributes);
  const displayName = participant.isLocal ? "You" : participant.name || "Guest";
  const displayLabel = isScreenShare
    ? `${displayName}'s screen`
    : roleLabel
      ? `${displayName} ${roleLabel}`
      : displayName;
  // LiveKit only populates participant attributes/metadata after the connection
  // negotiates, so the local frame has no avatar for a moment after joining or
  // reloading. Fall back to the pre-join avatar (available synchronously at
  // mount) and then the logged-in user's avatar, to avoid briefly showing the
  // initials placeholder on the local tile.
  const avatar =
    getParticipantAvatar(participant) ||
    (participant.isLocal ? localAvatar || localUser?.avatar || "" : "");
  const isHandRaised = participant.attributes.handRaised === "true";
  // A screen share belongs to its presenter, but the hand-raised state should
  // be displayed on the person's camera tile rather than the shared content.
  const showHandRaised = isHandRaised && !isScreenShare;
  const isParticipantDeafened = participant.isLocal
    ? deafened
    : participant.attributes.deafened === "true";
  const shouldShowVideo =
    isTrackReference(trackRef) &&
    (trackRef.source !== Track.Source.Camera ||
      (!isCameraMuted && !trackRef.publication.isMuted));

  // Size the card to the video's real aspect ratio so it hugs the frame - no
  // letterbox bars, and object-cover then fills it without cutting the top or
  // bottom. Falls back to 16:9 until LiveKit reports the track dimensions.
  // In `fill` mode (the Discord grid) the parent already fixes the tile size,
  // so the card fills it edge-to-edge instead.
  const dimensions = isTrackReference(trackRef)
    ? trackRef.publication?.dimensions
    : undefined;
  const aspectRatio =
    !fill && shouldShowVideo && dimensions?.width && dimensions?.height
      ? `${dimensions.width} / ${dimensions.height}`
      : undefined;
  // A shared screen must never be cropped - letterbox it so the whole screen
  // shows. Camera tiles fill the box (object-cover), like Discord.
  const videoObjectFit = isScreenShare ? "!object-contain" : "!object-cover";

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={aspectRatio ? { aspectRatio } : undefined}
      className={`group relative mx-auto min-h-0 overflow-hidden rounded-xl ${
        aspectRatio ? "h-full w-fit max-w-full" : "h-full w-full"
      } ${
        showHandRaised
          ? "bg-blue-500/12"
          : shouldShowVideo
            ? "bg-black"
            : "bg-primary"
      } ${
        onClick
          ? "cursor-pointer"
          : ""
      }`}
    >
      <ParticipantTile
        trackRef={trackRef}
        className={`h-full w-full ${
          showHandRaised
            ? "bg-blue-500/12"
            : shouldShowVideo
              ? "bg-transparent"
              : "bg-primary"
        }`}
      >
        {shouldShowVideo ? (
          <VideoTrack
            trackRef={trackRef as TrackReference}
            className={`h-full w-full ${videoObjectFit}`}
          />
        ) : (
          <UserAvatar name={displayName} avatar={avatar} />
        )}
      </ParticipantTile>
      {isSpeaking && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-3 ring-inset ring-brand dark:ring-2 dark:ring-brand/80" />
      )}
      {!isScreenShare && (
        <div
          className={`pointer-events-none absolute z-20 flex items-center justify-center text-white ${
            compact
              ? "right-1.5 bottom-1.5 min-h-5 min-w-5"
              : "right-2 bottom-2 min-h-8 min-w-8"
          }`}
        >
          {isParticipantDeafened ? (
            <LuHeadphoneOff size={compact ? 13 : 18} />
          ) : isMicMuted ? (
            <MicOff size={compact ? 13 : 18} />
          ) : (
            <AudioLinesIcon
              animated={isSpeaking}
              size={compact ? 14 : 20}
              className="text-white"
            />
          )}
        </div>
      )}
      <div
        className={`pointer-events-none absolute z-20 flex items-center gap-2 ${
          compact ? "left-1.5 bottom-1.5" : "left-2 bottom-2"
        }`}
      >
        <span
          className={`truncate rounded-full font-medium ${
            compact
              ? "max-w-[120px] px-2 py-0.5 text-[11px]"
              : "max-w-[220px] px-3 py-1 text-sm"
          } ${
            showHandRaised
              ? "bg-blue-500/45 text-white"
              : "bg-background/55 text-foreground"
          }`}
        >
          {showHandRaised && (
            <IoHandRightOutline
              className={`inline ${compact ? "mr-1 mb-0.5 size-3" : "mr-1.5 mb-0.5 size-3.5"}`}
            />
          )}
          {displayLabel}
        </span>
      </div>
    </div>
  );
};

export default LiveKitVideoStage;
