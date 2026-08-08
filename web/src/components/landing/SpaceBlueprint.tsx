import { useEffect, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  MonitorUp,
  Smile,
  MoreVertical,
  Info,
  Users,
  MessageCircle,
  Square,
} from "lucide-react";
import { MdCallEnd } from "react-icons/md";

// Static, non-interactive mock of the in-call Space screen - purely a visual
// showcase for the landing hero. Mirrors the LiveKitVideoStage +
// LiveKitControls without any of the LiveKit/runtime wiring.

const PARTICIPANTS = [
  { name: "Joe Rogan", image: "/img/hero/joe.jpg", muted: false },
  { name: "Elon Musk", image: "/img/hero/elon.jpg", muted: false },
];

const formatDuration = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
};

type Participant = {
  name: string;
  muted: boolean;
  art?: string;
  image?: string;
};

const Tile = ({ name, art, image, muted }: Participant) => (
  <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-border bg-primary">
    {image ? (
      <img
        src={image}
        alt={name}
        className="h-full w-full object-cover"
      />
    ) : (
      <pre className="font-mono text-base text-muted-foreground sm:text-xl">
        {art}
      </pre>
    )}
    <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
      {muted ? (
        <MicOff className="size-2.5 text-red-400" />
      ) : (
        <Mic className="size-2.5" />
      )}
      {name}
    </div>
  </div>
);

const CtrlIcon = ({
  children,
  active,
  danger,
  className = "",
}: {
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  className?: string;
}) => (
  <div
    className={`flex size-8 items-center justify-center rounded-lg border sm:size-9 ${
      danger
        ? "border-red-500 bg-red-500 text-white"
        : active
          ? "border-border bg-muted"
          : "border-border bg-primary"
    } ${className}`}
  >
    {children}
  </div>
);

const SpaceBlueprint = () => {
  // Recording timer starts at 0 when the page is visited and ticks up.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none flex h-full w-full select-none flex-col gap-2 p-2 text-foreground">
      {/* Video grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        {PARTICIPANTS.map((participant) => (
          <Tile key={participant.name} {...participant} />
        ))}
      </div>

      {/* Control bar */}
      <div className="relative flex items-center justify-center rounded-xl bg-call-background px-3 py-2 sm:justify-between">
        {/* Timecode */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
          <span className="text-xs font-medium tabular-nums">
            {formatDuration(elapsed)}
          </span>
        </div>

        {/* Primary controls */}
        <div className="flex items-center gap-1.5 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <div className="flex h-8 items-center gap-1.5 rounded-lg border border-red-500 bg-red-500 px-2.5 text-xs font-medium text-white sm:h-9 sm:px-3">
            <Square className="size-3 fill-white" />
            Stop
          </div>
          <CtrlIcon>
            <Mic className="size-4" />
          </CtrlIcon>
          <CtrlIcon>
            <Video className="size-4" />
          </CtrlIcon>
          <CtrlIcon>
            <MonitorUp className="size-4" />
          </CtrlIcon>
          <CtrlIcon className="hidden sm:flex">
            <Smile className="size-4" />
          </CtrlIcon>
          <CtrlIcon className="hidden sm:flex">
            <MoreVertical className="size-4" />
          </CtrlIcon>
          <div className="mx-1 hidden h-6 border-l border-border sm:block" />
          <CtrlIcon danger>
            <MdCallEnd className="size-4" />
          </CtrlIcon>
        </div>

        {/* Sidebar controls */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <CtrlIcon>
            <Info className="size-4" />
          </CtrlIcon>
          <CtrlIcon>
            <Users className="size-4" />
          </CtrlIcon>
          <CtrlIcon active>
            <MessageCircle className="size-4" />
          </CtrlIcon>
        </div>
      </div>
    </div>
  );
};

export default SpaceBlueprint;
