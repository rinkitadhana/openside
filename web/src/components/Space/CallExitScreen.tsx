import { LogOut, PhoneOff, SearchX, Users } from "lucide-react";

export type CallExitReason =
  | "left"
  | "ended"
  | "removed"
  | "duplicate"
  | "notfound"
  | "full";

interface CallExitScreenProps {
  reason: CallExitReason;
  onRejoin: () => void;
  onDashboard: () => void;
}

const exitContent: Record<
  CallExitReason,
  { title: string; description: string; canRejoin: boolean }
> = {
  left: {
    title: "You left the recording session",
    description:
      "You've left the session. You can rejoin or head back to your dashboard.",
    canRejoin: true,
  },
  ended: {
    title: "Recording session ended",
    description: "This recording session has ended. Thanks for joining!",
    canRejoin: false,
  },
  removed: {
    title: "Removed from session",
    description: "You were removed from this recording session by a host.",
    canRejoin: false,
  },
  duplicate: {
    title: "Disconnected",
    description:
      "You joined this recording session from another tab or device, so this session was disconnected.",
    canRejoin: true,
  },
  notfound: {
    title: "Recording session not found",
    description:
      "This recording session doesn't exist or has already ended. Head back to your dashboard to start or join another.",
    canRejoin: false,
  },
  full: {
    title: "Recording session is full",
    description:
      "This session has reached the maximum number of participants for the host's plan. Try again when someone leaves, or ask the host to upgrade their plan for more seats.",
    canRejoin: true,
  },
};

const CallExitScreen = ({
  reason,
  onRejoin,
  onDashboard,
}: CallExitScreenProps) => {
  const { title, description, canRejoin } = exitContent[reason];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary text-foreground">
        {reason === "left" ? (
          <LogOut size={28} />
        ) : reason === "notfound" ? (
          <SearchX size={28} />
        ) : reason === "full" ? (
          <Users size={28} />
        ) : (
          <PhoneOff size={28} />
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="max-w-sm text-sm text-foreground">{description}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {canRejoin && (
          <button
            type="button"
            onClick={onRejoin}
            className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-text transition-colors duration-200 hover:bg-primary/90"
          >
            Rejoin
          </button>
        )}
        <button
          type="button"
          onClick={onDashboard}
          className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-primary"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
};

export default CallExitScreen;
