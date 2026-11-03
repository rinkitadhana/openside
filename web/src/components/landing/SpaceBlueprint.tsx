import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Smile,
  MoreVertical,
  Info,
  Users,
  MessageCircle,
  Square,
  Link2,
  SendHorizontal,
  X,
  Maximize,
  Settings,
} from "lucide-react";
import { MdCallEnd } from "react-icons/md";
import { FaXTwitter } from "react-icons/fa6";

// Playable mock of the in-call Space screen for the landing hero. Mirrors the
// LiveKitVideoStage + LiveKitControls look, and the controls (record, mic,
// camera, share, reactions, leave, and the sidebars)
// drive local dummy state - no LiveKit or real media involved.

const YOU = {
  name: "Joe Rogan",
  image: "/img/hero/joe.webp",
  avatar: "/img/hero/joe-avatar.webp",
};
const GUEST = {
  name: "Elon Musk",
  image: "/img/hero/elon.webp",
  avatar: "/img/hero/elon-avatar.webp",
};

const REACTION_EMOJIS = ["👏", "🔥", "😂", "❤️", "🎉"];

const formatDuration = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
};

type Reaction = { id: number; emoji: string; left: number };

// Name pill with the participant's mic state, bottom-left of a tile, plus a
// separate role pill (e.g. "Host") like the real call.
const NameTag = ({
  name,
  role,
  muted,
  compact,
}: {
  name: string;
  role?: string;
  muted?: boolean;
  compact?: boolean;
}) => {
  const pill = `rounded-md bg-background/70 font-medium backdrop-blur-sm ${
    compact ? "px-1 py-px text-[8px]" : "px-1.5 py-0.5 text-[10px]"
  }`;

  return (
    <div
      className={`absolute flex items-center gap-1 ${
        compact ? "bottom-1 left-1" : "bottom-2 left-2"
      }`}
    >
      <span className={`flex items-center gap-1 ${pill}`}>
        {muted === undefined ? null : muted ? (
          <MicOff className="size-2.5 text-red-400" />
        ) : (
          <Mic className="size-2.5" />
        )}
        {name}
      </span>
      {role && <span className={pill}>{role}</span>}
    </div>
  );
};

const Tile = ({
  name,
  label = name,
  role,
  image,
  avatar = image,
  muted,
  cameraOff,
  compact,
}: {
  name: string;
  /** Shown on the name pill, e.g. "Joe Rogan (You)". */
  label?: string;
  role?: string;
  image: string;
  /** Profile picture shown while the camera is off; defaults to `image`. */
  avatar?: string;
  muted: boolean;
  cameraOff?: boolean;
  compact?: boolean;
}) => (
  <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-primary">
    {cameraOff ? (
      // Camera off: the profile picture over a blurred copy of itself, like
      // UserAvatar in the real call.
      <>
        <img
          src={avatar}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl"
        />
        <div className="absolute inset-0 bg-black/50" />
        <img
          src={avatar}
          alt={name}
          className={`relative aspect-square rounded-full object-cover ${
            compact ? "w-[38%]" : "w-[28%] max-w-[120px]"
          }`}
        />
      </>
    ) : (
      <img src={image} alt={name} className="h-full w-full object-cover" />
    )}
    <NameTag name={label} role={role} muted={muted} compact={compact} />
  </div>
);

// What "Share" puts on stage: a plug for the maker's X account.
const SharedScreen = () => (
  <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-black p-2 md:p-6">
    <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl border border-border bg-background px-6 py-3 text-center md:gap-3 md:py-8">
      <img
        src="/img/hero/gruz.webp"
        alt="Gruz"
        className="size-12 rounded-full border border-border object-cover md:size-20"
      />
      <div className="flex flex-col gap-0.5">
        <p className="font-bricolage text-base font-semibold md:text-xl">
          Follow Gruz on X
        </p>
        <p className="text-xs text-foreground/60 md:text-sm">@damngruz</p>
      </div>
      <a
        href="https://x.com/damngruz"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-1.5 text-sm font-semibold md:py-2 text-background transition-opacity hover:opacity-85"
      >
        <FaXTwitter className="size-3.5" />
        Follow
      </a>
    </div>
    <NameTag name="Your screen" />
  </div>
);

type SidebarType = "info" | "users" | "chat";

const SIDEBAR_TITLES: Record<SidebarType, string> = {
  info: "Space Details",
  users: "Participants (2)",
  chat: "Chat",
};

type ChatMessage = { id: number; mine: boolean; text: string };

const INVITE_LINK = "openside.pro/K7XHM";

const SEED_MESSAGES: ChatMessage[] = [
  { id: 0, mine: false, text: "Mic check, can you hear me ok?" },
  { id: 1, mine: true, text: "Loud and clear. We're recording." },
];

// Small round profile picture used in the sidebars.
const Avatar = ({ src, name }: { src: string; name: string }) => (
  <img
    src={src}
    alt={name}
    className="size-7 shrink-0 rounded-full border border-border object-cover"
  />
);

// Docked panel to the right of the stage, like the real call's sidebars.
const SidebarPanel = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div className="flex h-full w-[38%] max-w-[260px] shrink-0 flex-col rounded-xl border border-border bg-primary p-3 text-left">
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold">{title}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="cursor-pointer rounded-full border border-border bg-background p-1 transition-colors hover:bg-muted"
      >
        <X className="size-3" />
      </button>
    </div>
    <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
  </div>
);

const InfoPanel = () => {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">Episode #2231</p>
        <p className="text-[11px] leading-relaxed text-foreground/60">
          Rockets, AI, and everything in between with Elon Musk.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2">
        <Avatar src={YOU.avatar} name={YOU.name} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">{YOU.name}</span>
          <span className="text-[10px] text-foreground/60">Host</span>
        </div>
      </div>
      <div className="border-t border-border" />
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1 text-[11px] font-medium">
          <Link2 className="size-3" />
          Invite link
        </span>
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background p-1 pl-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/70">
            {INVITE_LINK}
          </span>
          <button
            type="button"
            onClick={copyLink}
            className="shrink-0 cursor-pointer rounded-md bg-muted px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
};

const UsersPanel = ({ micOn }: { micOn: boolean }) => (
  <div className="flex flex-col gap-1.5">
    {[
      {
        ...YOU,
        src: YOU.avatar,
        label: `${YOU.name} (You)`,
        role: "Host",
        muted: !micOn,
      },
      {
        ...GUEST,
        src: GUEST.avatar,
        label: GUEST.name,
        role: "Guest",
        muted: false,
      },
    ].map((person) => (
      <div
        key={person.name}
        className="flex items-center gap-2 rounded-lg bg-background px-2 py-1.5"
      >
        <Avatar src={person.src} name={person.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium">{person.label}</span>
          <span className="text-[10px] text-foreground/60">{person.role}</span>
        </div>
        {person.muted ? (
          <MicOff className="size-3.5 shrink-0 text-red-400" />
        ) : (
          <Mic className="size-3.5 shrink-0 text-foreground/60" />
        )}
      </div>
    ))}
  </div>
);

const ChatPanel = ({
  messages,
  onSend,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}) => {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  return (
    <>
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end gap-1.5 ${message.mine ? "flex-row-reverse" : ""}`}
          >
            <Avatar
              src={message.mine ? YOU.avatar : GUEST.avatar}
              name={message.mine ? YOU.name : GUEST.name}
            />
            <p
              className={`max-w-[78%] break-words rounded-lg bg-muted px-2 py-1.5 text-[11px] leading-4 ${
                message.mine ? "rounded-br-sm" : "rounded-bl-sm"
              }`}
            >
              {message.text}
            </p>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onSend(text);
          setDraft("");
        }}
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-border bg-background py-1 pl-2 pr-1"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send a message"
          aria-label="Chat message"
          className="min-w-0 flex-1 select-text bg-transparent text-[11px] outline-none placeholder:text-foreground/40"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send message"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-brand text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal className="size-3" />
        </button>
      </form>
    </>
  );
};

const MENU_ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:bg-primary-hover";

// The "Options" menu from the real call. It opens, but its items are just
// for show.
const OptionsMenu = () => (
  <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button
        type="button"
        aria-label="More options"
        title="More options"
        className="hidden size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-primary transition-colors duration-200 hover:bg-muted data-[state=open]:bg-muted sm:flex sm:size-9"
      >
        <MoreVertical className="size-4" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="z-50 min-w-[180px] rounded-xl border border-call-border bg-call-background p-1 text-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2"
      >
        <DropdownMenu.Item className={MENU_ITEM_CLASS}>
          <Maximize className="size-4" />
          Fullscreen
        </DropdownMenu.Item>
        <DropdownMenu.Item className={MENU_ITEM_CLASS}>
          <Settings className="size-4" />
          Settings
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

const CtrlIcon = ({
  children,
  label,
  tone = "default",
  pressed,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  tone?: "default" | "active" | "off" | "sharing" | "danger";
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}) => {
  const tones = {
    default: `border-border bg-primary ${onClick ? "hover:bg-muted" : ""}`,
    active: "border-border bg-muted",
    off: "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
    sharing:
      "border-blue-400/10 bg-blue-400/20 text-blue-400 hover:bg-blue-400/40",
    danger:
      "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:border-red-600",
  };
  const classes = `flex size-8 items-center justify-center rounded-lg border transition-colors duration-200 sm:size-9 ${tones[tone]} ${className}`;

  // Controls without a demo stay plain markup, so they don't look clickable.
  if (!onClick) {
    return (
      <div aria-hidden className={classes}>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`${classes} cursor-pointer`}
    >
      {children}
    </button>
  );
};

const SpaceBlueprint = () => {
  const [isRecording, setIsRecording] = useState(true);
  // Recording timer starts at 0 when the page is visited and ticks up.
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [hasLeft, setHasLeft] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [sidebar, setSidebar] = useState<SidebarType | null>(null);
  const [messages, setMessages] = useState(SEED_MESSAGES);

  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const toggleRecording = () => {
    // A new take starts its timer from zero, like the real recorder.
    if (!isRecording) setElapsed(0);
    setIsRecording((value) => !value);
  };

  const sendReaction = () => {
    setReactions((current) => [
      ...current,
      {
        id: reactionCount,
        emoji: REACTION_EMOJIS[reactionCount % REACTION_EMOJIS.length],
        // Spread consecutive reactions across the left of the stage.
        left: 3 + ((reactionCount * 12) % 36),
      },
    ]);
    setReactionCount((value) => value + 1);
  };

  const leaveCall = () => {
    setHasLeft(true);
    setIsRecording(false);
    setIsSharing(false);
    setReactions([]);
    setSidebar(null);
  };

  const toggleSidebar = (type: SidebarType) =>
    setSidebar((current) => (current === type ? null : type));

  const sendMessage = (text: string) =>
    setMessages((current) => [
      ...current,
      { id: current.length, mine: true, text },
    ]);

  const rejoinCall = () => {
    setHasLeft(false);
    setMicOn(true);
    setCameraOn(true);
  };

  const youTile = (compact?: boolean) => (
    <Tile
      {...YOU}
      label={`${YOU.name} (You)`}
      role="Host"
      muted={!micOn}
      cameraOff={!cameraOn}
      compact={compact}
    />
  );
  const guestTile = (compact?: boolean) => (
    <Tile {...GUEST} muted={false} compact={compact} />
  );

  return (
    <div className="flex h-full w-full select-none flex-col gap-2 p-2 text-foreground">
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Stage */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {hasLeft ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-primary text-center">
              <p className="font-bricolage text-lg font-semibold sm:text-2xl">
                You left the call
              </p>
              <p className="max-w-xs px-4 text-xs text-foreground/60 sm:text-sm">
                Your separate tracks keep uploading in the background.
              </p>
              <button
                type="button"
                onClick={rejoinCall}
                className="mt-1 cursor-pointer rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Rejoin
              </button>
            </div>
          ) : isSharing ? (
            // Like the real stage's focus mode: the share fills the stage and
            // the cameras sit in a strip below it.
            <div className="flex h-full flex-col gap-2">
              <div className="min-h-0 flex-1">
                <SharedScreen />
              </div>
              <div className="flex shrink-0 justify-center gap-2">
                <div className="aspect-video h-16 sm:h-24">{youTile(true)}</div>
                <div className="aspect-video h-16 sm:h-24">
                  {guestTile(true)}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid h-full grid-cols-1 gap-2 sm:grid-cols-2">
              {youTile()}
              {guestTile()}
            </div>
          )}

          {/* Reactions float up from the bottom of the stage. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
            {reactions.map((reaction) => (
              <div
                key={reaction.id}
                className="absolute bottom-10 flex flex-col items-center gap-1 [animation:space-reaction-float_2.4s_cubic-bezier(0.2,0.6,0.2,1)_forwards]"
                style={{ left: `${reaction.left}%` }}
                onAnimationEnd={() =>
                  setReactions((current) =>
                    current.filter((item) => item.id !== reaction.id),
                  )
                }
              >
                <span className="text-3xl leading-none sm:text-4xl">
                  {reaction.emoji}
                </span>
                <span className="rounded-full bg-blue-500/55 px-2 py-0.5 text-[10px] font-medium text-white">
                  {YOU.name} (You)
                </span>
              </div>
            ))}
          </div>
        </div>

        {sidebar && (
          <SidebarPanel
            title={SIDEBAR_TITLES[sidebar]}
            onClose={() => setSidebar(null)}
          >
            {sidebar === "info" ? (
              <InfoPanel />
            ) : sidebar === "users" ? (
              <UsersPanel micOn={micOn} />
            ) : (
              <ChatPanel messages={messages} onSend={sendMessage} />
            )}
          </SidebarPanel>
        )}
      </div>

      {/* Control bar */}
      <div className="relative flex items-center justify-center rounded-xl bg-call-background px-3 py-2 sm:justify-between">
        {/* Timecode, only while recording. The wrapper stays so the sidebar
            controls keep their place on the right. */}
        <div className="hidden items-center gap-1.5 sm:flex">
          {isRecording && (
            <>
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              <span className="text-xs font-medium tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </>
          )}
        </div>

        {/* Primary controls */}
        <div className="flex items-center gap-1.5 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={hasLeft}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className={`flex h-8 w-[74px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 ${
              isRecording
                ? "border-red-600 bg-red-600 hover:border-red-700 hover:bg-red-700"
                : "border-red-500 bg-red-500 hover:border-red-600 hover:bg-red-600"
            }`}
          >
            {isRecording ? (
              <Square className="size-3 fill-white" />
            ) : (
              <span className="size-3 shrink-0 rounded-full bg-white" />
            )}
            {isRecording ? "Stop" : "Record"}
          </button>
          <CtrlIcon
            label={micOn ? "Mute microphone" : "Unmute microphone"}
            tone={micOn ? "default" : "off"}
            pressed={!micOn}
            onClick={hasLeft ? undefined : () => setMicOn((value) => !value)}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </CtrlIcon>
          <CtrlIcon
            label={cameraOn ? "Turn camera off" : "Turn camera on"}
            tone={cameraOn ? "default" : "off"}
            pressed={!cameraOn}
            onClick={hasLeft ? undefined : () => setCameraOn((value) => !value)}
          >
            {cameraOn ? (
              <Video className="size-4" />
            ) : (
              <VideoOff className="size-4" />
            )}
          </CtrlIcon>
          <CtrlIcon
            label={isSharing ? "Stop sharing" : "Share screen"}
            tone={isSharing ? "sharing" : "default"}
            pressed={isSharing}
            onClick={
              hasLeft ? undefined : () => setIsSharing((value) => !value)
            }
          >
            <MonitorUp className="size-4" />
          </CtrlIcon>
          <CtrlIcon
            label="Send a reaction"
            onClick={hasLeft ? undefined : sendReaction}
            className="hidden sm:flex"
          >
            <Smile className="size-4" />
          </CtrlIcon>
          <OptionsMenu />
          <div className="mx-1 hidden h-6 border-l border-border sm:block" />
          <CtrlIcon
            label={hasLeft ? "Rejoin call" : "Leave call"}
            tone="danger"
            onClick={hasLeft ? rejoinCall : leaveCall}
          >
            <MdCallEnd className="size-4" />
          </CtrlIcon>
        </div>

        {/* Sidebar controls */}
        <div className="hidden items-center gap-1.5 sm:flex">
          {(
            [
              { type: "info", label: "Info", Icon: Info },
              { type: "users", label: "Participants", Icon: Users },
              { type: "chat", label: "Chat", Icon: MessageCircle },
            ] as const
          ).map(({ type, label, Icon }) => (
            <CtrlIcon
              key={type}
              label={label}
              tone={sidebar === type ? "active" : "default"}
              pressed={sidebar === type}
              onClick={hasLeft ? undefined : () => toggleSidebar(type)}
            >
              <Icon className="size-4" />
            </CtrlIcon>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SpaceBlueprint;
