import { useState } from "react";
import { CalendarClock, Copy, Check, Users, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGetUserSpaces, useActivateSpace } from "@/hooks/useSpace";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import { createIntentKey } from "@/pages/RoomPage";
import type { Space } from "@/types/spaceTypes";

const formatWhen = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const UpcomingMeetingCard = ({ space }: { space: Space }) => {
  const navigate = useNavigate();
  const { mutateAsync: activateSpace, isPending } = useActivateSpace();
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${window.location.origin}/${space.joinCode}`;
  const inviteeCount = space.invitees?.length ?? 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is unavailable in some browser contexts.
    }
  };

  const handleStart = async () => {
    try {
      // Flip the meeting to LIVE (provisions the LiveKit room) before entering.
      await activateSpace({
        spaceId: space.id,
        participantSessionId: getOrCreateSessionId(space.joinCode),
      });
      // Reuse the standard host entry path: the now-LIVE space is resumed when
      // RoomPage runs its host create flow.
      sessionStorage.setItem(createIntentKey(space.joinCode), "1");
      navigate(`/${space.joinCode}`);
    } catch {
      // Leave the meeting scheduled when activation fails.
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 shadow-sm shadow-black/5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-foreground dark:text-foreground">
          <CalendarClock size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {space.title || "Untitled recording"}
          </p>
          <div className="flex items-center gap-2 text-xs text-foreground">
            <span>{formatWhen(space.scheduledFor)}</span>
            {inviteeCount > 0 && (
              <span className="flex items-center gap-1">
                <Users size={12} />
                {inviteeCount}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy invite link"
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-primary cursor-pointer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy link"}</span>
        </button>
        <button
          type="button"
          onClick={handleStart}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <Play size={14} />
          {isPending ? "Starting..." : "Start"}
        </button>
      </div>
    </div>
  );
};

const UpcomingMeetingsSection = () => {
  const { data: spaces = [], isLoading } = useGetUserSpaces("hosted");

  const now = Date.now();
  const in30Min = now + 30 * 60 * 1000;

  const upcoming = spaces
    .filter((space) => {
      if (space.status !== "SCHEDULED" || !space.scheduledFor) return false;
      const t = new Date(space.scheduledFor).getTime();
      return t >= now && t <= in30Min;
    })
    .sort((a, b) => {
      const at = a.scheduledFor ? new Date(a.scheduledFor).getTime() : 0;
      const bt = b.scheduledFor ? new Date(b.scheduledFor).getTime() : 0;
      return at - bt;
    });

  // Nothing to show until the user has at least one upcoming meeting.
  if (isLoading || upcoming.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground">
        <CalendarClock size={16} className="text-foreground/60" />
        Upcoming recording sessions
      </h2>
      <div className="flex flex-col gap-2">
        {upcoming.map((space) => (
          <UpcomingMeetingCard key={space.id} space={space} />
        ))}
      </div>
    </section>
  );
};

export default UpcomingMeetingsSection;
