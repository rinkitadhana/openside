import { isTrackReference } from "@livekit/components-core";
import {
  ParticipantTile,
  RoomAudioRenderer,
  VideoTrack,
  useIsMuted,
  useLocalParticipant,
  useIsSpeaking,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { ConnectionQuality, Track, type Participant } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link, MicOff, X } from "lucide-react";
import { FiWifiOff } from "react-icons/fi";
import { IoHandRightOutline } from "react-icons/io5";
import { LuHeadphoneOff, LuWifiHigh } from "react-icons/lu";
import UserAvatar from "../ui/UserAvatar";
import { AudioLinesIcon } from "@/components/shared/ui/audio-lines";

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

  useEffect(() => {
    const resetSpeaking = () => {
      isSpeakingRef.current = false;
      window.setTimeout(() => setIsSpeaking(false), 0);
    };

    if (!participant.isLocal || isMicMuted) {
      resetSpeaking();
      return;
    }

    const publication = participant.getTrackPublication(Track.Source.Microphone);
    const mediaStreamTrack = publication?.audioTrack?.mediaStreamTrack;

    if (!mediaStreamTrack || mediaStreamTrack.readyState !== "live") {
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
      resetSpeaking();
    };
  }, [isMicMuted, participant]);

  return isSpeaking;
};

interface InvitePanelProps {
  roomCode: string;
  onDismiss: () => void;
}

const InvitePanel = ({ roomCode, onDismiss }: InvitePanelProps) => {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${window.location.origin}/${roomCode}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex h-full min-h-[180px] flex-col items-center justify-center gap-6 rounded-xl border border-call-border bg-call-primary p-8">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 select-none rounded-full border border-call-border bg-call-background p-1.5 transition-all duration-300 hover:bg-primary-hover"
        aria-label="Hide invite panel"
      >
        <X size={17} />
      </button>
      <div className="flex flex-col items-center gap-4 text-center">
        <Link size={36} className="text-muted-foreground" />
        <div className="flex flex-col items-center gap-1">
          <p className="text-base font-semibold text-foreground">
            Invite someone
          </p>
          <p className="text-sm text-muted-foreground">
            Share this link to invite others to join
          </p>
        </div>
      </div>
      <div className="flex w-full max-w-[420px] items-center gap-2 rounded-lg bg-call-background px-3 py-2.5">
        <span className="flex-1 truncate font-mono text-sm font-light text-foreground/70">
          {inviteLink}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-call-border bg-call-primary px-3 py-1.5 text-sm font-medium transition-all duration-150 hover:bg-primary-hover"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
};

interface LiveKitVideoStageProps {
  deafened: boolean;
  isHost: boolean;
  pinnedParticipantIdentity: string | null;
  roomCode: string;
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

const getParticipantGridClassName = (trackCount: number) => {
  if (trackCount <= 2) {
    return "grid-cols-1 md:grid-cols-2";
  }

  if (trackCount <= 4) {
    return "grid-cols-1 md:grid-cols-2 xl:grid-cols-2";
  }

  return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
};

const getConnectionQualityWarning = (quality: ConnectionQuality | undefined) => {
  if (quality === ConnectionQuality.Poor) {
    return {
      label: "Network unstable",
      tone: "warning" as const,
      icon: <LuWifiHigh size={16} />,
    };
  }

  if (quality === ConnectionQuality.Lost) {
    return {
      label: "Connection lost",
      tone: "danger" as const,
      icon: <FiWifiOff size={16} />,
    };
  }

  if (quality === ConnectionQuality.Unknown) {
    return {
      label: "Checking network quality...",
      tone: "muted" as const,
      icon: null,
    };
  }

  return null;
};

const DEMO_FORCE_CONNECTION_QUALITY: ConnectionQuality | null =
  null;

const LiveKitVideoStage = ({
  deafened,
  isHost,
  pinnedParticipantIdentity,
  roomCode,
}: LiveKitVideoStageProps) => {
  const [isInvitePanelHidden, setIsInvitePanelHidden] = useState(false);
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const screenShareTrack = tracks.find(
    (trackRef) =>
      isTrackReference(trackRef) &&
      trackRef.publication.source === Track.Source.ScreenShare
  );
  const cameraTracks = sortTrackRefs(
    tracks.filter((trackRef) => trackRef.source === Track.Source.Camera)
  );
  const remoteParticipantCount = participants.filter(
    (participant) => !participant.isLocal
  ).length;

  const visibleTracks = screenShareTrack
    ? cameraTracks.filter(
        (trackRef) =>
          trackRef.participant.identity !== screenShareTrack.participant.identity
      )
    : cameraTracks;
  const pinnedTrack = !screenShareTrack
    ? visibleTracks.find(
        (trackRef) => trackRef.participant.identity === pinnedParticipantIdentity
      )
    : undefined;
  const secondaryTracks = pinnedTrack
    ? visibleTracks.filter(
        (trackRef) => trackRef.participant.identity !== pinnedTrack.participant.identity
      )
    : visibleTracks;

  const isAlone = remoteParticipantCount === 0;
  const connectionWarning = getConnectionQualityWarning(
    DEMO_FORCE_CONNECTION_QUALITY ?? localParticipant.connectionQuality,
  );

  const showInvitePanel = isHost && isAlone && !isInvitePanelHidden;

  return (
    <div className="relative h-full min-h-0 flex flex-col gap-2">
      {connectionWarning && (
        <div className="pointer-events-none absolute right-2 top-2 z-30">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-normal text-white ${
              connectionWarning.tone === "danger"
                ? "bg-red-500/70"
                : connectionWarning.tone === "warning"
                  ? "bg-amber-500/70"
                  : "bg-foreground/55"
            }`}
          >
            {connectionWarning.icon}
            {connectionWarning.label}
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {screenShareTrack || pinnedTrack ? (
          <div className="grid h-full gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
            <ParticipantFrame
              deafened={deafened}
              trackRef={screenShareTrack || pinnedTrack!}
              focus
            />
            <div className="grid gap-2 overflow-y-auto content-start">
              {secondaryTracks.map((trackRef) => (
                <ParticipantFrame
                  deafened={deafened}
                  key={`${trackRef.participant.identity}-${trackRef.source}`}
                  trackRef={trackRef}
                />
              ))}
            </div>
          </div>
        ) : isAlone ? (
          <div
            className={`grid h-full gap-2 ${
              showInvitePanel ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {visibleTracks.map((trackRef) => (
              <ParticipantFrame
                deafened={deafened}
                key={`${trackRef.participant.identity}-${trackRef.source}`}
                trackRef={trackRef}
              />
            ))}
            {showInvitePanel && (
              <InvitePanel
                roomCode={roomCode}
                onDismiss={() => setIsInvitePanelHidden(true)}
              />
            )}
          </div>
        ) : (
          <div
            className={`grid h-full gap-2 auto-rows-fr ${getParticipantGridClassName(
              visibleTracks.length
            )}`}
          >
            {visibleTracks.map((trackRef) => (
              <ParticipantFrame
                deafened={deafened}
                key={`${trackRef.participant.identity}-${trackRef.source}`}
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
  trackRef: ReturnType<typeof useTracks>[number];
  focus?: boolean;
}

const ParticipantFrame = ({
  deafened,
  trackRef,
  focus = false,
}: ParticipantFrameProps) => {
  const participant = trackRef.participant;
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
  const isSpeaking = participant.isLocal ? localMicIsSpeaking : liveKitIsSpeaking;
  const roleLabel = getRoleLabel(participant.attributes);
  const displayName = participant.isLocal ? "You" : participant.name || "Guest";
  const displayLabel = roleLabel ? `${displayName} ${roleLabel}` : displayName;
  const avatar = getParticipantAvatar(participant);
  const isHandRaised = participant.attributes.handRaised === "true";
  const isParticipantDeafened = participant.isLocal
    ? deafened
    : participant.attributes.deafened === "true";
  const shouldShowVideo =
    isTrackReference(trackRef) &&
    (trackRef.source !== Track.Source.Camera ||
      (!isCameraMuted && !trackRef.publication.isMuted));

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border ${
        isHandRaised
          ? "border-blue-400/60 bg-blue-500/12"
          : "border-call-border bg-call-primary"
      } ${focus ? "min-h-[360px]" : "min-h-[180px]"}`}
    >
      <ParticipantTile
        trackRef={trackRef}
        className={`h-full w-full ${isHandRaised ? "bg-blue-500/12" : "bg-call-primary"}`}
      >
        {shouldShowVideo ? (
          <div className={`flex h-full w-full items-center justify-center ${isHandRaised ? "bg-blue-500/12" : "bg-call-primary"}`}>
            <VideoTrack
              trackRef={trackRef}
              className="aspect-video h-full max-h-full w-auto max-w-[min(100%,1664px)] !object-cover"
            />
          </div>
        ) : (
          <UserAvatar name={displayName} avatar={avatar} />
        )}
      </ParticipantTile>
      {isSpeaking && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-3 ring-inset ring-purple-400 dark:ring-2 dark:ring-purple-400/80" />
      )}
      <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex min-h-8 min-w-8 items-center justify-center text-white">
        {isParticipantDeafened ? (
          <LuHeadphoneOff size={18} />
        ) : isMicMuted ? (
          <MicOff size={18} />
        ) : (
          <AudioLinesIcon
            animated={isSpeaking}
            size={20}
            className="text-white"
          />
        )}
      </div>
      <div className="pointer-events-none absolute left-2 bottom-2 z-20 flex items-center gap-2">
        <span
          className={`max-w-[220px] truncate rounded-full px-3 py-1 text-sm font-medium ${
            isHandRaised
              ? "bg-blue-500/45 text-white"
              : "bg-call-background/55 text-foreground"
          }`}
        >
          {isHandRaised && <IoHandRightOutline className="mr-1.5 mb-0.5 inline size-3.5" />}
          {displayLabel}
        </span>
      </div>
    </div>
  );
};

export default LiveKitVideoStage;
