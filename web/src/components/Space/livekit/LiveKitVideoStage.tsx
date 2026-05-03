import { isTrackReference } from "@livekit/components-core";
import {
  ParticipantTile,
  RoomAudioRenderer,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Check, Link } from "lucide-react";

const getRoleLabel = (attributes?: Record<string, string>) => {
  if (attributes?.role === "HOST") return "Host";
  if (attributes?.isGuest === "true") return "Guest";
  return null;
};

const InvitePanel = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [copied, setCopied] = useState(false);
  const inviteLink = `${window.location.origin}/${roomId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full rounded-xl border border-call-border bg-call-primary gap-6 p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <Link size={36} className="text-muted-foreground" />
        <div className="flex flex-col items-center gap-1">
          <p className="text-base font-semibold text-foreground">Invite someone</p>
          <p className="text-sm text-muted-foreground">Share this link to invite others to join</p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-call-background rounded-xl px-3 py-2.5 max-w-[420px] w-full">
        <span className="flex-1 text-sm text-foreground/70 truncate font-mono">{inviteLink}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-call-primary border border-call-border hover:bg-primary-hover transition-all duration-150 text-sm font-medium flex-shrink-0 cursor-pointer"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
};

const LiveKitVideoStage = () => {
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
  const cameraTracks = tracks.filter(
    (trackRef) => trackRef.source === Track.Source.Camera
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

  const isAlone = remoteParticipantCount === 0;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-0">
        {screenShareTrack ? (
          <div className="grid h-full gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
            <ParticipantFrame trackRef={screenShareTrack} focus />
            <div className="grid gap-2 overflow-y-auto content-start">
              {visibleTracks.map((trackRef) => (
                <ParticipantFrame
                  key={`${trackRef.participant.identity}-${trackRef.source}`}
                  trackRef={trackRef}
                />
              ))}
            </div>
          </div>
        ) : isAlone ? (
          <div className="grid h-full gap-2 grid-cols-2">
            {visibleTracks.map((trackRef) => (
              <ParticipantFrame
                key={`${trackRef.participant.identity}-${trackRef.source}`}
                trackRef={trackRef}
              />
            ))}
            <InvitePanel />
          </div>
        ) : (
          <div className="grid h-full gap-2 auto-rows-fr grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {visibleTracks.map((trackRef) => (
              <ParticipantFrame
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
  trackRef: ReturnType<typeof useTracks>[number];
  focus?: boolean;
}

const ParticipantFrame = ({ trackRef, focus = false }: ParticipantFrameProps) => {
  const participant = trackRef.participant;
  const roleLabel = getRoleLabel(participant.attributes);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-call-primary ${
        participant.isSpeaking
          ? "border-purple-400 shadow-[0_0_0_1px_rgba(192,132,252,0.6)]"
          : "border-call-border"
      } ${focus ? "min-h-[360px]" : "min-h-[180px]"}`}
    >
      <ParticipantTile
        trackRef={trackRef}
        className="h-full w-full bg-call-primary"
      />
      <div className="pointer-events-none absolute left-3 bottom-3 flex items-center gap-2">
        <span className="max-w-[220px] truncate rounded-full bg-call-background/80 px-3 py-1 text-sm font-medium text-foreground">
          {participant.isLocal ? "You" : participant.name || "Guest"}
        </span>
        {roleLabel && (
          <span className="rounded-full bg-call-background/80 px-2 py-1 text-xs text-foreground/70">
            {roleLabel}
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-call-background/80 px-2 py-1 text-xs capitalize text-foreground/70">
        {participant.connectionQuality}
      </div>
    </div>
  );
};

export default LiveKitVideoStage;
