import { useMemo, useState } from "react";
import {
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { Track, type Participant as LiveKitParticipant } from "livekit-client";
import { markLocalMediaAction } from "@/lib/localMediaIntent";
import {
  sendMediaRequest,
  type MediaRequestSource,
} from "../livekit/MediaRequests";
import {
  MicOff,
  Loader2,
  MoreVertical,
  Pin,
  PinOff,
  UserMinus,
  Mic,
  ShieldPlus,
  ShieldMinus,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { IoHandRightOutline } from "react-icons/io5";
import { AudioLinesIcon } from "@/components/shared/ui/audio-lines";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import {
  useKickParticipant,
  useStopParticipantTrack,
  useUpdateParticipantRole,
} from "@/hooks/useParticipant";

interface SidebarContentProps {
  isHost: boolean;
  onClose: () => void;
  onSpotlight: (key: string | null) => void;
  spotlightKey: string | null;
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
    <div className="flex shrink-0 items-center gap-1.5 text-foreground">
      <span
        className="flex size-7 items-center justify-center rounded-lg border border-border bg-background"
        title={isCameraMuted ? "Camera off" : "Camera on"}
      >
        {isCameraMuted ? <VideoOff size={15} /> : <Video size={15} />}
      </span>
      <span
        className="flex size-7 items-center justify-center rounded-lg border border-border bg-background"
        title={isMicMuted ? "Microphone off" : "Microphone on"}
      >
        {isMicMuted ? (
          <MicOff size={15} />
        ) : (
          <AudioLinesIcon animated={isSpeaking} size={17} />
        )}
      </span>
    </div>
  );
};

const ParticipantRow = ({
  isHost,
  canPin,
  onSpotlight,
  participant,
  spotlightKey,
  spaceId,
}: {
  isHost: boolean;
  canPin: boolean;
  onSpotlight: (key: string | null) => void;
  participant: LiveKitParticipant;
  spotlightKey: string | null;
  spaceId?: string;
}) => {
  const [pendingTrackSource, setPendingTrackSource] = useState<
    "microphone" | "camera" | null
  >(null);
  const participantId = getParticipantId(participant);
  const stopTrack = useStopParticipantTrack(spaceId || "", participantId);
  const kickParticipant = useKickParticipant(spaceId || "", participantId);
  const updateRole = useUpdateParticipantRole(spaceId || "", participantId);
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const isMicMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });
  const isCameraMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });
  const cameraTileKey = `${participant.identity}::camera`;
  const isPinned = spotlightKey === cameraTileKey;
  // Hosts and co-hosts can moderate; the host can never be moderated.
  const localRole = localParticipant.attributes.role;
  const isModerator =
    isHost || localRole === "HOST" || localRole === "CO_HOST";
  const targetIsHost = participant.attributes.role === "HOST";
  const targetIsCoHost = participant.attributes.role === "CO_HOST";
  const canModerate = isModerator && !participant.isLocal && !targetIsHost;
  // Only the actual host assigns/removes co-hosts.
  const canManageRole = isHost && !participant.isLocal && !targetIsHost;
  const avatar = getParticipantAvatar(participant);
  const displayName = participant.isLocal
    ? "You"
    : participant.name || "Guest";
  const isHandRaised = participant.attributes.handRaised === "true";
  const setLocalMicrophone = async () => {
    markLocalMediaAction();
    try {
      await localParticipant.setMicrophoneEnabled(isMicMuted);
    } catch (error) {
      console.error("Unable to toggle microphone:", error);
    }
  };
  const setLocalCamera = async () => {
    markLocalMediaAction();
    try {
      await localParticipant.setCameraEnabled(isCameraMuted);
    } catch (error) {
      console.error("Unable to toggle camera:", error);
    }
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
        onError: (error) => {
          console.error(`Failed to stop participant ${source}:`, error);
        },
      }
    );
  };

  const isMicActionPending =
    stopTrack.isPending && pendingTrackSource === "microphone";
  const isCameraActionPending =
    stopTrack.isPending && pendingTrackSource === "camera";

  // Remote unmute can't be forced (browser privacy model) - send a request
  // the participant accepts on their side instead.
  const askToTurnOn = async (source: MediaRequestSource) => {
    try {
      await sendMediaRequest(room, participant.identity, source);
    } catch (error) {
      console.error(`Failed to send ${source} request:`, error);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-background px-3 py-2.5">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary text-sm font-semibold">
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
          {isHandRaised && (
            <span
              className="shrink-0 text-blue-500"
              title={`${displayName} raised their hand`}
            >
              <IoHandRightOutline aria-hidden="true" className="size-4" />
            </span>
          )}
        </div>
        <p className="truncate text-xs text-foreground">
          {getRoleLabel(participant)}
        </p>
      </div>

      <ParticipantStatus participant={participant} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-primary text-foreground transition-colors hover:bg-primary hover:text-foreground"
            aria-label={`Options for ${displayName}`}
          >
            <MoreVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[180px] rounded-xl border-border bg-background p-1"
        >
          {canPin && (
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
              onClick={() => onSpotlight(isPinned ? null : cameraTileKey)}
            >
              {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
              {isPinned ? "Unpin user" : "Pin user"}
            </DropdownMenuItem>
          )}

          {participant.isLocal && (
            <>
              <DropdownMenuItem
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                onClick={setLocalMicrophone}
              >
                {isMicMuted ? <Mic size={15} /> : <MicOff size={15} />}
                {isMicMuted ? "Start mic" : "Stop mic"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                onClick={setLocalCamera}
              >
                {isCameraMuted ? <Video size={15} /> : <VideoOff size={15} />}
                {isCameraMuted ? "Start video" : "Stop video"}
              </DropdownMenuItem>
            </>
          )}

          {canManageRole && (
            <>
              <DropdownMenuItem
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() =>
                  updateRole.mutate(
                    { role: targetIsCoHost ? "GUEST" : "CO_HOST" },
                    {
                      onError: (error) => {
                        console.error("Failed to update role:", error);
                      },
                    }
                  )
                }
                disabled={!spaceId || !participantId || updateRole.isPending}
              >
                {updateRole.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : targetIsCoHost ? (
                  <ShieldMinus size={15} />
                ) : (
                  <ShieldPlus size={15} />
                )}
                {updateRole.isPending
                  ? "Updating..."
                  : targetIsCoHost
                    ? "Dismiss co-host"
                    : "Make co-host"}
              </DropdownMenuItem>
            </>
          )}

          {canModerate && (
            <>
              {/* LiveKit can't force a remote UNMUTE (browser privacy model),
                  so a live track gets "Stop" and an off track gets an
                  "Ask to turn on" request the participant accepts on their
                  side - same model as Meet/Zoom. */}
              {isMicMuted ? (
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                  onClick={() => void askToTurnOn("microphone")}
                >
                  <Mic size={15} />
                  Ask to turn on mic
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                  onClick={() => updateParticipantTrack("microphone", true)}
                  disabled={!spaceId || !participantId || stopTrack.isPending}
                >
                  {isMicActionPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <MicOff size={15} />
                  )}
                  {isMicActionPending ? "Stopping mic..." : "Stop mic"}
                </DropdownMenuItem>
              )}
              {isCameraMuted ? (
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                  onClick={() => void askToTurnOn("camera")}
                >
                  <Video size={15} />
                  Ask to turn on camera
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                  onClick={() => updateParticipantTrack("camera", true)}
                  disabled={!spaceId || !participantId || stopTrack.isPending}
                >
                  {isCameraActionPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <VideoOff size={15} />
                  )}
                  {isCameraActionPending ? "Stopping video..." : "Stop video"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() =>
                  kickParticipant.mutate(undefined, {
                    onError: (error) => {
                      console.error("Failed to remove participant:", error);
                    },
                  })
                }
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
  onSpotlight,
  spotlightKey,
  spaceId,
}: SidebarContentProps) => {
  const participants = useParticipants();
  const sortedParticipants = useMemo(
    () => sortParticipants(participants),
    [participants]
  );
  // Spotlight only exists once the stage is a Discord grid (3+ people), so the
  // Pin action is hidden with only two people in the call.
  const canPin = participants.length >= 3;

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Participants ({sortedParticipants.length})
        </h3>
        <button
          onClick={onClose}
          className="select-none p-1.5 rounded-full bg-background hover:bg-primary border border-border cursor-pointer transition-all duration-300"
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
              canPin={canPin}
              onSpotlight={onSpotlight}
              participant={participant}
              spotlightKey={spotlightKey}
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
