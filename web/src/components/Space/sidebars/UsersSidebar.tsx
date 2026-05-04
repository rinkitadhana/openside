import { useMemo, useState } from "react";
import {
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react";
import { Track, type Participant as LiveKitParticipant } from "livekit-client";
import {
  MicOff,
  Loader2,
  MoreVertical,
  Pin,
  PinOff,
  UserMinus,
  Mic,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { AudioLinesIcon } from "@/components/shared/ui/audio-lines";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import {
  useKickParticipant,
  useStopParticipantTrack,
} from "@/hooks/useParticipant";

interface SidebarContentProps {
  isHost: boolean;
  onClose: () => void;
  onPinParticipant: (identity: string | null) => void;
  pinnedParticipantIdentity: string | null;
  spaceId?: string;
}

const getRoleLabel = (participant: LiveKitParticipant) => {
  if (participant.attributes.role === "HOST") return "Host";
  if (participant.attributes.role === "CO_HOST") return "Co-host";
  return participant.attributes.isGuest === "true" ? "Guest" : "Participant";
};

const getParticipantId = (participant: LiveKitParticipant) =>
  participant.attributes.spaceParticipantId || "";

const getParticipantAvatar = (participant: LiveKitParticipant) => {
  if (participant.attributes.avatar) return participant.attributes.avatar;

  if (!participant.metadata) return "";

  try {
    const metadata = JSON.parse(participant.metadata) as { avatar?: unknown };
    return typeof metadata.avatar === "string" ? metadata.avatar : "";
  } catch {
    return "";
  }
};

const sortParticipants = (participants: LiveKitParticipant[]) =>
  [...participants].sort((first, second) => {
    const getRank = (participant: LiveKitParticipant) => {
      if (participant.isLocal) return 0;
      if (participant.attributes.role === "HOST") return 1;
      if (participant.attributes.role === "CO_HOST") return 2;
      return 3;
    };

    const rankDelta = getRank(first) - getRank(second);
    if (rankDelta !== 0) return rankDelta;

    return (first.name || first.identity).localeCompare(
      second.name || second.identity
    );
  });

const ParticipantStatus = ({
  participant,
}: {
  participant: LiveKitParticipant;
}) => {
  const isMicMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });
  const isCameraMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });
  const isSpeaking = useIsSpeaking(participant);

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <span
        className={`flex size-7 items-center justify-center rounded-lg border border-call-border ${
          !isMicMuted && isSpeaking
            ? "bg-primary/15 text-primary"
            : "bg-call-background"
        }`}
        title={isMicMuted ? "Microphone off" : "Microphone on"}
      >
        {isMicMuted ? (
          <MicOff size={15} />
        ) : (
          <AudioLinesIcon animated={isSpeaking} size={17} />
        )}
      </span>
      {isCameraMuted && (
        <span
          className="flex size-7 items-center justify-center rounded-lg border border-call-border bg-call-background"
          title="Camera off"
        >
          <VideoOff size={15} />
        </span>
      )}
    </div>
  );
};

const ParticipantRow = ({
  isHost,
  onPinParticipant,
  participant,
  pinnedParticipantIdentity,
  spaceId,
}: {
  isHost: boolean;
  onPinParticipant: (identity: string | null) => void;
  participant: LiveKitParticipant;
  pinnedParticipantIdentity: string | null;
  spaceId?: string;
}) => {
  const [pendingTrackSource, setPendingTrackSource] = useState<
    "microphone" | "camera" | null
  >(null);
  const participantId = getParticipantId(participant);
  const stopTrack = useStopParticipantTrack(spaceId || "", participantId);
  const kickParticipant = useKickParticipant(spaceId || "", participantId);
  const { localParticipant } = useLocalParticipant();
  const isMicMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });
  const isCameraMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });
  const isPinned = pinnedParticipantIdentity === participant.identity;
  const canModerate =
    isHost && !participant.isLocal && participant.attributes.role !== "HOST";
  const avatar = getParticipantAvatar(participant);
  const displayName = participant.isLocal
    ? "You"
    : participant.name || "Guest";
  const setLocalMicrophone = async () => {
    await localParticipant.setMicrophoneEnabled(isMicMuted);
  };
  const setLocalCamera = async () => {
    await localParticipant.setCameraEnabled(isCameraMuted);
  };
  const updateParticipantTrack = (
    source: "microphone" | "camera",
    muted: boolean
  ) => {
    setPendingTrackSource(source);
    stopTrack.mutate(
      { source, muted },
      {
        onSettled: () => setPendingTrackSource(null),
      }
    );
  };

  const isMicActionPending =
    stopTrack.isPending && pendingTrackSource === "microphone";
  const isCameraActionPending =
    stopTrack.isPending && pendingTrackSource === "camera";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-call-border bg-call-background px-3 py-2.5">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-call-primary text-sm font-semibold">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          displayName.charAt(0).toUpperCase()
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </p>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {getRoleLabel(participant)}
        </p>
      </div>

      <ParticipantStatus participant={participant} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-call-border bg-call-primary text-muted-foreground transition-colors hover:bg-primary-hover hover:text-foreground"
            aria-label={`Options for ${displayName}`}
          >
            <MoreVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[180px] border-call-border bg-call-background"
        >
          <DropdownMenuItem
            onClick={() =>
              onPinParticipant(isPinned ? null : participant.identity)
            }
          >
            {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
            {isPinned ? "Unpin user" : "Pin user"}
          </DropdownMenuItem>

          {participant.isLocal && (
            <>
              <DropdownMenuSeparator className="bg-call-border" />
              <DropdownMenuItem onClick={setLocalMicrophone}>
                {isMicMuted ? <Mic size={15} /> : <MicOff size={15} />}
                {isMicMuted ? "Start mic" : "Stop mic"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={setLocalCamera}>
                {isCameraMuted ? <Video size={15} /> : <VideoOff size={15} />}
                {isCameraMuted ? "Start video" : "Stop video"}
              </DropdownMenuItem>
            </>
          )}

          {canModerate && (
            <>
              <DropdownMenuSeparator className="bg-call-border" />
              <DropdownMenuItem
                onClick={() =>
                  updateParticipantTrack("microphone", !isMicMuted)
                }
                disabled={!spaceId || !participantId || stopTrack.isPending}
              >
                {isMicActionPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : isMicMuted ? (
                  <Mic size={15} />
                ) : (
                  <MicOff size={15} />
                )}
                {isMicActionPending
                  ? isMicMuted
                    ? "Starting mic..."
                    : "Stopping mic..."
                  : isMicMuted
                    ? "Start mic"
                    : "Stop mic"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => updateParticipantTrack("camera", !isCameraMuted)}
                disabled={!spaceId || !participantId || stopTrack.isPending}
              >
                {isCameraActionPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : isCameraMuted ? (
                  <Video size={15} />
                ) : (
                  <VideoOff size={15} />
                )}
                {isCameraActionPending
                  ? isCameraMuted
                    ? "Starting video..."
                    : "Stopping video..."
                  : isCameraMuted
                    ? "Start video"
                    : "Stop video"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => kickParticipant.mutate()}
                disabled={!spaceId || !participantId || kickParticipant.isPending}
              >
                <UserMinus size={15} />
                Remove participant
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const UsersSidebar = ({
  isHost,
  onClose,
  onPinParticipant,
  pinnedParticipantIdentity,
  spaceId,
}: SidebarContentProps) => {
  const participants = useParticipants();
  const sortedParticipants = useMemo(
    () => sortParticipants(participants),
    [participants]
  );

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Participants</h3>
          <p className="text-xs text-muted-foreground">
            {sortedParticipants.length} in call
          </p>
        </div>
        <button
          onClick={onClose}
          className="select-none p-1.5 rounded-full bg-call-background hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
        >
          <X size={17} />
        </button>
      </div>

      <div className="my-6 flex-1 space-y-2 overflow-y-auto pr-1">
        {sortedParticipants.length > 0 ? (
          sortedParticipants.map((participant) => (
            <ParticipantRow
              key={participant.identity}
              isHost={isHost}
              onPinParticipant={onPinParticipant}
              participant={participant}
              pinnedParticipantIdentity={pinnedParticipantIdentity}
              spaceId={spaceId}
            />
          ))
        ) : (
          <div className="text-sm text-secondary-text text-center">
            No people yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default UsersSidebar;
