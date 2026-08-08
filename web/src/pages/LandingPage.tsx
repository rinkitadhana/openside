import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AudioLines,
  Check,
  Code2,
  Download,
  EyeOff,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Mic,
  Monitor,
  Server,
  Share2,
  ShieldCheck,
  UploadCloud,
  Video,
} from "lucide-react";

import { BsFillRecordCircleFill, BsFillTelephoneFill } from "react-icons/bs";
import { FaGithub } from "react-icons/fa";
import { FiUploadCloud, FiVideo } from "react-icons/fi";
import { LuScreenShare } from "react-icons/lu";
import { RiMicLine } from "react-icons/ri";

import PageTitle from "@/components/shared/PageTitle";
import SpaceBlueprint from "@/components/landing/SpaceBlueprint";
import GithubStarButton from "@/components/landing/GithubStarButton";
import {
  HeaderAuthCTA,
  PricingCTA,
  StartRecordingCTA,
} from "@/components/landing/LandingAuthCTA";
import AuthModal, { type AuthMode } from "@/components/auth/AuthModal";

// Snappy easeOutExpo curve so things decelerate cleanly instead of drifting.
const EASE = [0.16, 1, 0.3, 1] as const;

const features = [
  {
    icon: Mic,
    title: "High-quality local recording",
    description:
      "Recording happens locally in your browser, so bad internet never lowers quality. If your connection drops, the file uploads later.",
  },
  {
    icon: Layers,
    title: "Tracks, downloads, and backup",
    description:
      "You get separate audio and video files for each person. Download them as MP4, MP3, or WAV, and turn on cloud backup.",
  },
  {
    icon: Monitor,
    title: "Screen recorder",
    description:
      "A Loom-like way to record quick demos, tutorials, and updates. Capture what you need, then share it with a single link.",
  },
  {
    icon: Share2,
    title: "Share links and comments",
    description:
      "Send each recording with its own link. People can leave comments on it, and you can disable or replace that link any time you want.",
  },
];

const faqs = [
  {
    question: "Is Openside free to use?",
    answer:
      "Openside is open source and free to self-host. Bring your own LiveKit and Cloudflare R2 storage and pay only for the infrastructure you use; managed demo and paid plans are also available.",
  },
  {
    question: "How does Openside work?",
    answer:
      "Create a recording space, invite participants with a link, and record from your browsers. When you finish, Openside processes the files into a mixed recording and separate participant tracks that you can download or share.",
  },
  {
    question: "What happens if someone's internet connection is unstable?",
    answer:
      "Openside records each person's audio and video in their browser, rather than relying on a compressed live stream. A brief connection drop will not lower the quality of footage already captured; it uploads when the connection returns.",
  },
  {
    question: "Will I get separate tracks for every participant?",
    answer:
      "Yes. Multi-person recordings include separate audio and video tracks for each participant, alongside a mixed recording for quick review and sharing.",
  },
  {
    question: "Can I download and share my recordings?",
    answer:
      "Yes. Download video as MP4 or WebM and audio as MP3 or WAV. You can also create a share link so viewers can watch the recording in their browser, then disable or replace that link whenever you need to.",
  },
];

const recordingPoints = [
  {
    icon: Lock,
    title: "Recorded on your device",
    description:
      "Your audio and video are captured right in your browser and saved in small chunks as you record.",
  },
  {
    icon: UploadCloud,
    title: "Sent straight to storage",
    description:
      "Each chunk uploads directly to storage over an encrypted connection, instead of streaming through our servers.",
  },
  {
    icon: Share2,
    title: "Private until you share",
    description:
      "Recordings are private by default. You create a share link only when you want to, and can switch it off anytime.",
  },
  {
    icon: ShieldCheck,
    title: "Delete whenever you want",
    description:
      "Remove any recording at any time. It's gone from storage, not just hidden from view.",
  },
];

const selfHostPoints = [
  {
    icon: Server,
    title: "Run it on your own infra",
    description:
      "Connect your own LiveKit and Cloudflare R2, and recordings are stored entirely on infrastructure you control.",
  },
  {
    icon: KeyRound,
    title: "Your keys are encrypted",
    description:
      "The API keys you add are encrypted with AES-256-GCM before they're stored, so they're never saved in plain text.",
  },
  {
    icon: EyeOff,
    title: "Keys are never read back",
    description:
      "Once saved, your keys are masked everywhere. The app only ever shows you a hidden preview, never the full value.",
  },
  {
    icon: Code2,
    title: "Open source and auditable",
    description:
      "Every line of Openside is public, so you can check for yourself exactly how your data and keys are handled.",
  },
];

const pricingPlans = [
  {
    name: "Self-host",
    price: "Free",
    priceSuffix: "",
    description:
      "Unlimited and free when you run it on your own LiveKit and R2 keys.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "Unlimited recording",
      "Unlimited participants",
      "Unlimited retention",
      "No watermark",
      "Separate participant tracks",
      "Cloud backup",
      "Screen recorder",
    ],
    cta: "Get started",
    featured: false,
  },
  {
    name: "Pro",
    price: "$8.99",
    priceSuffix: "/mo",
    description:
      "Managed infrastructure with zero setup. Just hit record and we handle the rest.",
    features: [
      "Up to 4K recording",
      "48kHz audio",
      "20 hours of recording per month",
      "Up to 5 participants",
      "30-day recording retention",
      "No watermark",
      "Separate participant tracks",
      "Cloud backup",
      "Screen recorder",
    ],
    cta: "Start with Pro",
    featured: true,
  },
  {
    name: "Demo",
    price: "Free",
    priceSuffix: "",
    description:
      "Try Openside instantly, no keys or setup required.",
    features: [
      "720p recording",
      "44.1kHz audio",
      "15 minutes of recording",
      "Up to 2 participants",
      "48-hour retention",
      "Includes watermark",
      "Separate participant tracks",
      "Screen recorder",
      "No setup required",
    ],
    cta: "Try the demo",
    featured: false,
  },
];

// The marketing site intentionally has a fixed light palette, independent of
// the theme selected elsewhere in the app.
const landingLightTheme: CSSProperties & Record<`--${string}`, string> = {
  "--background": "#ffffff",
  "--foreground": "#131313",
  "--primary": "#f0f0f0",
  "--muted": "#e2e2e2",
  "--brand": "#c7d4ff",
  "--border": "#dcdcdc",
  "--selection-background": "#131313",
  "--selection-text": "#ffffff",
};

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const riseVariants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: EASE },
  },
};

const boxVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.8, ease: EASE },
  },
};

// A single Space-style control: a bordered rounded button with a small caption
// underneath, matching the app's ControlButton look (light landing palette).
const ControlPill = ({
  icon,
  label,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  className?: string;
}) => (
  <div
    className={`flex items-center justify-center rounded-lg border border-border bg-primary p-2 text-base text-foreground ${className}`}
    aria-label={label}
  >
    {icon}
  </div>
);

// A mock of the Space bottom control bar, used half-cut in the recording card.
// The record button switches to "Stop" and dips on press, driven by the demo.
const SpaceControlBar = ({
  recordLabel = "Record",
  recording = false,
  pressed = false,
}: {
  recordLabel?: string;
  recording?: boolean;
  pressed?: boolean;
}) => (
  <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-background p-1.5 shadow-[0_14px_38px_rgba(0,0,0,0.16)]">
    <motion.div
      animate={{ scale: pressed ? 0.93 : 1 }}
      transition={{ duration: 0.12, ease: EASE }}
      className={`flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium text-white ${
        recording
          ? "border-red-600 bg-red-600"
          : "border-red-500 bg-red-500"
      }`}
    >
      <BsFillRecordCircleFill
        className={`size-3.5 ${recording ? "animate-pulse" : ""}`}
      />
      <span>{recordLabel}</span>
    </motion.div>

    <ControlPill icon={<RiMicLine />} label="Mic" />
    <ControlPill icon={<FiVideo />} label="Cam" />
    <ControlPill icon={<LuScreenShare />} label="Screen" />

    <div className="h-7 w-px bg-border" />

    <ControlPill
      icon={<BsFillTelephoneFill className="-rotate-[225deg]" />}
      label="End"
      className="border-red-500 bg-red-500 text-white"
    />
  </div>
);

// Cursor tip target: the bottom-right of the Record button, relative to the
// control-bar wrapper.
const REC = { x: 74, y: 30 };

// Auto-playing demo for the "High-quality local recording" card: the cursor
// clicks Record → a quick 3·2·1 countdown → the button flips to Stop, a timer
// counts up (bottom-left) and an uploading badge appears (middle) — then loops.
const LocalRecordingDemo = () => {
  const [phase, setPhase] = useState<"idle" | "click" | "count" | "record">(
    "idle",
  );
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];
    const push = (t: ReturnType<typeof setTimeout>) => timers.push(t);
    const clearAll = () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      timers.length = 0;
      intervals.length = 0;
    };

    const cycle = () => {
      if (cancelled) return;
      setPhase("idle");
      setCount(3);
      setElapsed(0);
      setPct(0);

      // Cursor glides in, then presses Record.
      push(
        setTimeout(() => {
          setPhase("click");
          push(
            setTimeout(() => {
              // Quick 3 · 2 · 1 countdown.
              setPhase("count");
              setCount(3);
              push(setTimeout(() => setCount(2), 450));
              push(setTimeout(() => setCount(1), 900));
              push(
                setTimeout(() => {
                  // Recording: timer runs, upload progresses.
                  setPhase("record");
                  const start = Date.now();
                  const iv = setInterval(() => {
                    setElapsed(Math.floor((Date.now() - start) / 1000));
                    setPct((p) => Math.min(100, p + 5));
                  }, 260);
                  intervals.push(iv);
                  // Hold, then loop.
                  push(
                    setTimeout(() => {
                      clearAll();
                      cycle();
                    }, 4600),
                  );
                }, 1350),
              );
            }, 280),
          );
        }, 1000),
      );
    };

    cycle();
    return () => {
      cancelled = true;
      clearAll();
    };
  }, []);

  const recording = phase === "record";
  const recordLabel = phase === "count" || recording ? "Stop" : "Record";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <>
      {/* 4K badge, top-right. */}
      <div className="absolute right-3.5 top-3.5 flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] backdrop-blur-md">
        <span className="text-base font-semibold leading-none tracking-tight text-[#131313]">
          4K
        </span>
        <span className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[#131313]/45">
          UHD
        </span>
      </div>


      {/* Middle: the 3·2·1 starter countdown (red, rounded), then the uploading
          badge once recording is underway. */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        {phase === "count" && (
          <motion.div
            key={count}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex size-14 items-center justify-center rounded-full bg-red-500 text-3xl font-medium tabular-nums text-white shadow-[0_6px_20px_rgba(239,68,68,0.3)]"
          >
            {count}
          </motion.div>
        )}
        {recording && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center gap-2 rounded-lg bg-white/85 px-4 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.1)] ring-1 ring-black/5 backdrop-blur-md"
          >
            <FiUploadCloud className="size-4 text-[#131313]/70" />
            <span className="text-sm font-medium text-[#131313]">Uploading</span>
            <span className="text-sm font-semibold tabular-nums text-[#3b5bfd]">
              {pct}%
            </span>
          </motion.div>
        )}
      </div>

      {/* Bottom row: the timer (left) and the control bar (right), vertically
          aligned; the bar is half-cut off the right, with the clicking cursor. */}
      <div className="absolute inset-x-0 bottom-4 flex items-center">
        {/* Timer stays put, showing 00:00 until recording starts. */}
        <span className="flex h-11 -translate-x-[20%] items-center rounded-xl bg-white/75 pl-8 pr-5 text-sm font-medium tabular-nums text-[#131313] shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] backdrop-blur-md">
          {mm}:{ss}
        </span>
        <div className="relative ml-auto translate-x-[26%]">
          <SpaceControlBar
            recordLabel={recordLabel}
            recording={recording}
            pressed={phase === "click"}
          />
          <motion.div
            className="pointer-events-none absolute left-0 top-0 z-20"
            initial={{ x: REC.x, y: REC.y + 58, scale: 1, opacity: 0 }}
            animate={{
              x: REC.x,
              y: phase === "count" || recording ? REC.y + 28 : REC.y,
              scale: phase === "click" ? 0.82 : 1,
              opacity: phase === "idle" || phase === "click" ? 1 : 0,
            }}
            transition={{
              duration: phase === "click" ? 0.12 : 0.5,
              ease: EASE,
            }}
          >
            <CursorArrow />
          </motion.div>
        </div>
      </div>
    </>
  );
};

// Live, code-only demo for the "Tracks, downloads, and backup" feature: the tail
// end of a track list, with a working Download menu that reveals the formats we
// actually offer (MP4 video, MP3/WAV audio).
const downloadOptions = [
  { group: "Video", name: "Raw video", format: "MP4", icon: Video },
  { group: "Video", name: "Aligned video", format: "MP4", icon: Video },
  { group: "Video", name: "Cloud", format: "MP4", icon: Video },
  { group: "Audio", name: "Compressed", format: "MP3", icon: AudioLines },
  { group: "Audio", name: "Raw audio", format: "WAV", icon: AudioLines },
  { group: "Audio", name: "Cloud", format: "MP3", icon: AudioLines },
] as const;

// A macOS-style arrow pointer, drawn inline so the demos stay code-only.
const CursorArrow = () => (
  <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3 2.2 L3 14.3 L6.4 11 L8.6 15.6 L10.8 14.6 L8.6 10 L13.2 10 Z"
      fill="#131313"
      stroke="#ffffff"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

// Where the fingertip should land: the middle of the Download button.
const BTN = { x: 298, y: 92 };

// Auto-playing, code-only demo for the "Tracks, downloads, and backup" feature.
// A cursor glides in and clicks Download, the track list slides aside, and the
// menu of formats we actually offer scales into the middle — then it loops.
const TrackDownloadDemo = () => {
  const [phase, setPhase] = useState<"idle" | "point" | "click" | "open">(
    "idle",
  );

  useEffect(() => {
    // Duration each phase is held before advancing; then it wraps and repeats.
    const timeline: { phase: typeof phase; ms: number }[] = [
      { phase: "idle", ms: 900 },
      { phase: "point", ms: 450 },
      { phase: "click", ms: 260 },
      { phase: "open", ms: 2400 },
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      setPhase(timeline[i].phase);
      timer = setTimeout(() => {
        i = (i + 1) % timeline.length;
        run();
      }, timeline[i].ms);
    };
    run();
    return () => clearTimeout(timer);
  }, []);

  const isOpen = phase === "open";
  const isClicking = phase === "click";

  return (
    <div className="relative w-full max-w-[21.5rem]">
      {/* The track list — slides aside and dims when the menu opens. */}
      <motion.div
        animate={
          isOpen
            ? { x: -58, scale: 0.9, opacity: 0.5 }
            : { x: 0, scale: 1, opacity: 1 }
        }
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="flex items-center gap-2.5 rounded-lg border border-[#e6e6e6] bg-[#ffffff] px-2.5 py-2 opacity-45">
          <span className="flex aspect-[4/3] h-9 items-center justify-center rounded-md bg-[#eaeaea]">
            <AudioLines className="size-4 text-[#131313]/50" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="h-2 w-24 rounded-full bg-[#e2e2e2]" />
            <div className="mt-1.5 h-2 w-16 rounded-full bg-[#ececec]" />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-[#dcdcdc] bg-[#ffffff] px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
          <span className="flex aspect-[4/3] h-9 items-center justify-center rounded-md bg-[#eaeaea]">
            <Video className="size-4 text-[#131313]/60" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[#131313]">Alex</p>
            <p className="mt-0.5 text-[0.7rem] text-[#131313]/45">
              Ready · 2:14 · 2160p
            </p>
          </div>
          <motion.span
            animate={{ scale: isClicking ? 0.9 : 1 }}
            transition={{ duration: 0.12, ease: EASE }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#dcdcdc] bg-[#ffffff] px-2.5 py-1.5 text-xs font-medium text-[#131313]"
          >
            <Download className="size-3.5 text-[#131313]/60" />
            Download
          </motion.span>
        </div>

        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-[#e6e6e6] bg-[#ffffff] px-2.5 py-2 opacity-45">
          <span className="flex aspect-[4/3] h-9 items-center justify-center rounded-md bg-[#eaeaea]">
            <Monitor className="size-4 text-[#131313]/50" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="h-2 w-20 rounded-full bg-[#e2e2e2]" />
            <div className="mt-1.5 h-2 w-14 rounded-full bg-[#ececec]" />
          </div>
        </div>
      </motion.div>

      {/* The download menu — scales into the middle when the list moves aside. */}
      <motion.div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        animate={{ opacity: isOpen ? 1 : 0, scale: isOpen ? 1 : 0.92 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <div className="w-44 rounded-xl border border-[#dcdcdc] bg-[#ffffff] p-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
          {downloadOptions.map((opt, i) => {
            const OptIcon = opt.icon;
            const isFirstOfGroup =
              i === 0 || downloadOptions[i - 1].group !== opt.group;
            return (
              <div key={`${opt.name}-${opt.format}`}>
                {isFirstOfGroup && (
                  <p className="px-2 pt-1 pb-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[#131313]/40">
                    {opt.group}
                  </p>
                )}
                <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#131313]">
                  <OptIcon className="size-3.5 text-[#131313]/55" />
                  {opt.name}
                  <span className="ml-auto rounded-md bg-[#eaeaea] px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[#131313]/55">
                    {opt.format}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* The pointer: glides to the button, presses, then fades as the menu opens. */}
      <motion.div
        className="pointer-events-none absolute left-0 top-0 z-10"
        initial={{ x: BTN.x, y: BTN.y + 46, scale: 1, opacity: 0 }}
        animate={{
          x: BTN.x,
          y: isOpen ? BTN.y + 24 : BTN.y,
          scale: isClicking ? 0.82 : 1,
          opacity: isOpen ? 0 : 1,
        }}
        transition={{ duration: isClicking ? 0.12 : 0.5, ease: EASE }}
      >
        <CursorArrow />
      </motion.div>
    </div>
  );
};

// Waypoints the cursor visits across the recorded screen (content-area coords).
const SCREEN_POINTS = [
  { x: 58, y: 44 },
  { x: 196, y: 84 },
];

// Live, code-only demo for the "Screen recorder" feature: a browser window being
// recorded Loom-style — a REC timer, a camera bubble, and a cursor that moves
// around the screen leaving click ripples.
const ScreenRecorderDemo = () => {
  const [idx, setIdx] = useState(0);
  const [clicking, setClicking] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tv = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000) % 60),
      500,
    );
    return () => clearInterval(tv);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const step = (i: number) => {
      if (cancelled) return;
      setIdx(i);
      setClicking(false);
      timers.push(
        setTimeout(() => {
          setClicking(true);
          timers.push(
            setTimeout(() => step((i + 1) % SCREEN_POINTS.length), 700),
          );
        }, 1150),
      );
    };
    step(0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const target = SCREEN_POINTS[idx];
  const ss = String(elapsed).padStart(2, "0");

  return (
    <div className="w-full max-w-[22rem] overflow-hidden rounded-xl border border-[#dcdcdc] bg-white shadow-[0_10px_34px_rgba(0,0,0,0.14)]">
      {/* Window title bar. */}
      <div className="flex items-center gap-1.5 border-b border-[#ececec] px-3 py-2">
        <span className="size-2 rounded-full bg-[#ff5f57]" />
        <span className="size-2 rounded-full bg-[#febc2e]" />
        <span className="size-2 rounded-full bg-[#28c840]" />
        <div className="ml-2 h-3 w-32 rounded-full bg-[#f0f0f0]" />
      </div>

      {/* Recorded screen content. */}
      <div className="relative aspect-[16/9] bg-gradient-to-br from-[#eef2ff] to-[#dbe4ff]">
        {/* Faux page content. */}
        <div className="absolute left-4 top-4 space-y-2">
          <div className="h-2.5 w-28 rounded-full bg-white/70" />
          <div className="h-2 w-40 rounded-full bg-white/50" />
          <div className="h-2 w-36 rounded-full bg-white/50" />
        </div>

        {/* REC indicator + timer. */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-white/85 px-2 py-1 text-[0.65rem] font-medium text-[#131313] shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/5 backdrop-blur-md">
          <motion.span
            className="size-1.5 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
          REC 00:{ss}
        </div>

        {/* Click ripple at the current waypoint. */}
        <motion.span
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#131313]/15"
          style={{ left: target.x, top: target.y }}
          animate={
            clicking
              ? { scale: [0, 2.4], opacity: [0.5, 0] }
              : { scale: 0, opacity: 0 }
          }
          transition={{ duration: 0.6, ease: "easeOut" }}
        />

        {/* Moving cursor. */}
        <motion.div
          className="pointer-events-none absolute left-0 top-0 z-10"
          animate={{ x: target.x, y: target.y, scale: clicking ? 0.82 : 1 }}
          transition={{ duration: clicking ? 0.12 : 0.8, ease: EASE }}
        >
          <CursorArrow />
        </motion.div>

        {/* Presenter camera, shown as a square video box on the right. */}
        <div className="absolute bottom-2 right-2 flex size-16 items-center justify-center overflow-hidden rounded-lg bg-white/85 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/5 backdrop-blur-md">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#935ac9] to-[#5b6cff] text-xs font-semibold text-white">
            R
          </span>
        </div>
      </div>
    </div>
  );
};

// The comments that pop in one after another in the share demo.
const SHARE_COMMENTS = [
  { name: "Maya", text: "This looks so clean 🔥", color: "#935ac9" },
  { name: "Sam", text: "Love it, shipping today 🚀", color: "#0d9488" },
  { name: "Alex", text: "Great walkthrough 👏", color: "#2563eb" },
];

// Cursor tip target over the Share button, relative to the card.
const COPY = { x: 320, y: 14 };

// Live, code-only demo for the "Share links and comments" feature: a cursor
// shares the link, then people leave comments on the shared recording.
const CommentsDemo = () => {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [cursorGone, setCursorGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const push = (fn: () => void, ms: number) =>
      timers.push(setTimeout(fn, ms));
    const run = () => {
      if (cancelled) return;
      setCopied(false);
      setVisible(0);
      setPressing(false);
      setCursorGone(false);
      push(() => setPressing(true), 900);
      push(() => setPressing(false), 1050);
      push(() => {
        setCopied(true);
        setCursorGone(true);
      }, 1080);
      push(() => setVisible(1), 1550);
      push(() => setVisible(2), 2100);
      push(() => setVisible(3), 2650);
      push(run, 5200);
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="relative w-full max-w-[23rem]">
      {/* Share link row with a Share button. */}
      <div className="relative flex items-center gap-2 rounded-xl border border-[#dcdcdc] bg-white px-3 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
        <Link2 className="size-4 shrink-0 text-[#131313]/45" />
        <span className="flex-1 truncate text-xs text-[#131313]/70">
          openside.to/r/9f2k
        </span>
        <motion.span
          animate={{ scale: pressing ? 0.92 : 1 }}
          transition={{ duration: 0.12, ease: EASE }}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[0.7rem] font-medium ${
            copied
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-[#131313] text-white"
          }`}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Shared
            </>
          ) : (
            <>
              <Share2 className="size-3" />
              Share
            </>
          )}
        </motion.span>

        {/* Cursor pressing the Copy button. */}
        <motion.div
          className="pointer-events-none absolute left-0 top-0 z-10"
          initial={{ x: COPY.x, y: COPY.y + 52, scale: 1, opacity: 0 }}
          animate={{
            x: COPY.x,
            y: cursorGone ? COPY.y + 24 : COPY.y,
            scale: pressing ? 0.82 : 1,
            opacity: cursorGone ? 0 : 1,
          }}
          transition={{ duration: pressing ? 0.12 : 0.5, ease: EASE }}
        >
          <CursorArrow />
        </motion.div>
      </div>

      {/* Comments, floating directly under the link. */}
      <div className="mt-2.5 space-y-1.5">
        {SHARE_COMMENTS.slice(0, visible).map((c) => (
            <motion.div
              key={c.name}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex items-center gap-2 rounded-xl border border-[#ececec] bg-white px-2.5 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold text-white"
                style={{ backgroundColor: c.color }}
              >
                {c.name[0]}
              </span>
              <div className="min-w-0">
                <p className="text-[0.7rem] font-semibold leading-tight text-[#131313]">
                  {c.name}
                </p>
                <p className="truncate text-[0.7rem] leading-tight text-[#131313]/60">
                  {c.text}
                </p>
              </div>
            </motion.div>
          ))}
      </div>
    </div>
  );
};

const LandingPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Stable so the memoized auth CTAs don't re-render on every page render.
  const openAuth = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  // Surface the email-verification confirmation that used to live on /auth.
  useEffect(() => {
    if (searchParams.get("verified") === "email") {
      const next = new URLSearchParams(searchParams);
      next.delete("verified");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div
      className="min-h-screen bg-[#ffffff] text-[#131313]"
      style={landingLightTheme}
    >
      <PageTitle
        title="Home"
        description="Openside. Record, meet, and create together."
      />
      <main className="relative flex min-h-screen flex-col items-center justify-start overflow-hidden bg-[#ffffff] px-4 pt-24 sm:px-6 sm:pt-28">
        <div className="absolute inset-0 z-0 bg-[url('/img/landing/hero-bg.jpg')] bg-cover bg-bottom" />

        <header className="absolute inset-x-0 top-0 z-20">
          <nav className="mx-auto grid max-w-5xl grid-cols-[1fr_auto_1fr] items-center px-4 py-3 sm:px-0">
            <Link to="/" className="flex items-center gap-2 justify-self-start">
              <img
                src="/logo/logo-dark.png"
                className="h-full w-[24px] select-none"
                alt="Openside"
              />
              <span className="text-lg font-bold uppercase text-white">
                Openside
              </span>
            </Link>

            <nav
              aria-label="Landing page navigation"
              className="hidden items-center gap-2 justify-self-center text-sm font-medium text-white/80 md:flex"
            >
              <a
                href="#features"
                className="rounded-full px-3 py-2 transition-colors hover:bg-white/10 hover:text-white"
              >
                Features
              </a>
              <a
                href="#privacy"
                className="rounded-full px-3 py-2 transition-colors hover:bg-white/10 hover:text-white"
              >
                Privacy
              </a>
              <a
                href="#pricing"
                className="rounded-full px-3 py-2 transition-colors hover:bg-white/10 hover:text-white"
              >
                Pricing
              </a>
            </nav>

            <div className="flex items-center justify-self-end gap-1.5 sm:gap-2">
              <span className="hidden sm:inline-flex">
                <GithubStarButton />
              </span>
              <HeaderAuthCTA onOpenAuth={openAuth} />
            </div>
          </nav>
        </header>

        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="relative z-10 flex w-full max-w-5xl flex-col items-start gap-3 pt-6 pb-20 text-left sm:pt-8"
        >
          <motion.h1
            variants={riseVariants}
            className="font-bricolage max-w-4xl text-3xl font-semibold leading-[1.2] text-white sm:text-[2.5rem]"
          >
            Record high quality podcasts, interviews, and videos right from your
            browser
          </motion.h1>

          <motion.p
            variants={riseVariants}
            className="max-w-xl text-sm font-normal text-white/80 sm:text-base"
          >
            Studio-quality recording, open-source at its core. Self-host it free
            or let us handle the infra.
          </motion.p>

          <motion.div
            variants={riseVariants}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <StartRecordingCTA
              onOpenAuth={openAuth}
              className="flex select-none items-center gap-2 rounded-full bg-white px-4.5 py-2.5 text-sm font-semibold text-[#131313] transition-colors hover:bg-white/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
            />
            <a
              href="https://github.com/rinkitadhana/openside"
              target="_blank"
              rel="noopener noreferrer"
              className="flex select-none cursor-pointer items-center gap-2 rounded-full bg-[#131313] px-4.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#131313]/90"
            >
              <FaGithub className="size-4" />
              Star on GitHub
            </a>
          </motion.div>

          <div className="relative mt-8 w-full">
            <motion.div
              variants={boxVariants}
              className="relative z-10 aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_12px_rgba(0,0,0,0.18),0_0_45px_rgba(0,0,0,0.08),0_0_90px_rgba(0,0,0,0.05)] sm:aspect-video"
            >
              <SpaceBlueprint />
            </motion.div>
          </div>
        </motion.section>
      </main>

      <section
        id="features"
        className="bg-[#ffffff] px-4 py-20 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="max-w-xl"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={riseVariants}
          >
            <p className="text-sm font-medium text-[#131313]/60">Features</p>
            <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-[#131313] sm:text-3xl">
              Record, download, and share in one place.
            </h2>
            <p className="mt-3 text-base leading-7 text-[#131313]/70">
              From capture to sharing, Openside handles the whole workflow so you
              can focus on the recording itself.
            </p>
          </motion.div>

          <motion.div
            className="mt-10 grid gap-6 sm:grid-cols-2"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={containerVariants}
          >
            {features.map(({ icon: Icon, title, description }) => (
              <motion.article
                key={title}
                variants={riseVariants}
                className="flex flex-col rounded-2xl border border-[#dcdcdc] bg-[#ffffff] p-6"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-[#eaeaea] text-[#131313]">
                  <Icon className="size-5" />
                </div>
                <h3 className="font-bricolage mt-5 text-lg font-semibold tracking-tight text-[#131313]">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#131313]/65">
                  {description}
                </p>
                <div
                  className={`relative mt-6 flex aspect-[16/10] w-full items-center justify-center rounded-xl bg-gradient-to-br from-[#dbe4ff] via-[#eef2ff] to-[#c7d4ff] px-5 ${
                    title === "High-quality local recording"
                      ? "overflow-hidden"
                      : ""
                  }`}
                >
                  {title === "High-quality local recording" && (
                    <LocalRecordingDemo />
                  )}
                  {title === "Tracks, downloads, and backup" && (
                    <TrackDownloadDemo />
                  )}
                  {title === "Screen recorder" && <ScreenRecorderDemo />}
                  {title === "Share links and comments" && <CommentsDemo />}
                </div>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      <section id="privacy" className="bg-[#ffffff] px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="max-w-xl"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={riseVariants}
          >
            <p className="text-sm font-medium text-[#131313]/60">Privacy</p>
            <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-[#131313] sm:text-3xl">
              Your recordings stay yours.
            </h2>
            <p className="mt-3 text-base leading-7 text-[#131313]/70">
              Two things matter here: keeping your recordings safe, and letting
              you run the whole thing yourself. Here is how each works.
            </p>
          </motion.div>

          <motion.div
            className="mt-12 grid gap-6 lg:grid-cols-2"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={containerVariants}
          >
            <motion.div
              variants={riseVariants}
              className="rounded-2xl border border-[#dcdcdc] bg-[#ffffff] p-6 sm:p-8"
            >
              <h3 className="font-bricolage text-lg font-semibold tracking-tight text-[#131313]">
                Your recordings
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#131313]/60">
                From the moment you hit record to the moment you share.
              </p>
              <ul className="mt-6 space-y-6">
                {recordingPoints.map(({ icon: Icon, title, description }) => (
                  <li key={title} className="flex gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#c7d4ff]/45 text-[#42508a]">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h4 className="font-bricolage text-base font-medium text-[#131313]">
                        {title}
                      </h4>
                      <p className="mt-1 text-sm leading-6 text-[#131313]/65">
                        {description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              variants={riseVariants}
              className="rounded-2xl border border-[#dcdcdc] bg-[#ffffff] p-6 sm:p-8"
            >
              <h3 className="font-bricolage text-lg font-semibold tracking-tight text-[#131313]">
                Self-hosting and keys
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#131313]/60">
                Run Openside on your own infrastructure, with your own keys.
              </p>
              <ul className="mt-6 space-y-6">
                {selfHostPoints.map(({ icon: Icon, title, description }) => (
                  <li key={title} className="flex gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#c7d4ff]/45 text-[#42508a]">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h4 className="font-bricolage text-base font-medium text-[#131313]">
                        {title}
                      </h4>
                      <p className="mt-1 text-sm leading-6 text-[#131313]/65">
                        {description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section
        id="pricing"
        className="bg-[#ffffff] px-4 py-20 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="max-w-xl"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={riseVariants}
          >
            <p className="text-sm font-medium text-[#131313]/60">Pricing</p>
            <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-[#131313] sm:text-3xl">
              Simple pricing that scales with you.
            </h2>
            <p className="mt-3 text-base leading-7 text-[#131313]/70">
              Self-host it for free, or let us handle the infrastructure. No
              hidden fees, cancel anytime.
            </p>
          </motion.div>

          <motion.div
            className="mt-10 grid gap-6 md:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={containerVariants}
          >
            {pricingPlans.map((plan) => (
              <motion.div
                key={plan.name}
                variants={riseVariants}
                className={`flex flex-col rounded-2xl border p-6 text-[#131313] ${
                  plan.featured
                    ? "border-[#c7d4ff] bg-[#eef2ff] shadow-[0_12px_34px_rgba(66,80,138,0.14)] ring-1 ring-[#c7d4ff]"
                    : "border-[#dcdcdc] bg-[#ffffff]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bricolage text-lg font-semibold tracking-tight">
                    {plan.name}
                  </h3>
                  {plan.featured && (
                    <span className="rounded-full bg-[#c7d4ff] px-2.5 py-1 text-xs font-medium text-[#1f2547]">
                      Popular
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {plan.price}
                  </span>
                  {plan.priceSuffix && (
                    <span className="text-sm text-[#131313]/55">
                      {plan.priceSuffix}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm leading-6 text-[#131313]/65">
                  {plan.description}
                </p>

                <ul className="mt-6 mb-8 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <Check
                        className={`mt-0.5 size-4 shrink-0 ${
                          plan.featured ? "text-[#42508a]" : "text-[#131313]"
                        }`}
                      />
                      <span className="text-[#131313]/75">{feature}</span>
                    </li>
                  ))}
                </ul>

                <PricingCTA
                  label={plan.cta}
                  featured={plan.featured}
                  isPro={plan.name === "Pro"}
                  onOpenAuth={openAuth}
                  className={`mt-auto w-full cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium text-[#ffffff] transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                    plan.featured
                      ? "bg-[#42508a] hover:bg-[#42508a]/90"
                      : "bg-[#131313] hover:bg-[#131313]/90"
                  }`}
                />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section id="faq" className="bg-[#ffffff] px-4 py-20 sm:px-6">
        <motion.div
          className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] md:gap-16"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
        >
          <motion.div variants={riseVariants}>
            <p className="text-sm font-medium text-[#131313]/60">
              FAQ
            </p>
            <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-[#131313] sm:text-3xl">
              Everything you need to know before you record.
            </h2>
          </motion.div>

          <motion.div
            variants={riseVariants}
            className="divide-y divide-[#dcdcdc] border-y border-[#dcdcdc]"
          >
            {faqs.map(({ question, answer }, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={question} className="py-5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="group flex w-full cursor-pointer items-center justify-between gap-4 text-left text-base font-medium text-[#131313] transition-colors hover:text-[#42508a]"
                  >
                    {question}
                    <span
                      className={`text-xl font-normal text-[#131313]/55 transition-[transform,color] duration-300 group-hover:text-[#42508a] ${
                        isOpen ? "rotate-45" : ""
                      }`}
                    >
                      +
                    </span>
                  </button>
                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      isOpen
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="max-w-xl pt-3 text-sm leading-6 text-[#131313]/65">
                        {answer}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </motion.div>
      </section>

      <footer className="border-t border-[#dcdcdc] bg-[#ffffff] px-4 py-10 sm:px-6">
        <motion.div
          className="mx-auto flex max-w-5xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          variants={riseVariants}
        >
          <div>
            <Link to="/" className="flex items-center gap-2">
              <img
                src="/logo/logo-light.png"
                className="w-5 select-none"
                alt="Openside"
              />
              <span className="text-base font-bold uppercase">
                Openside
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-6 text-[#131313]/60">
              Open-source, self-hostable recording studio for podcasts,
              meetings, and interviews.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#131313]/65 sm:justify-end">
            <a href="#features" className="hover:text-[#131313]">
              Features
            </a>
            <a href="#privacy" className="hover:text-[#131313]">
              Privacy
            </a>
            <a href="#pricing" className="hover:text-[#131313]">
              Pricing
            </a>
            <a
              href="https://x.com/damngruz"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#131313]"
            >
              Contact us
            </a>
            <a
              href="https://github.com/rinkitadhana/openside"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#131313]"
            >
              GitHub
            </a>
          </div>
        </motion.div>
        <div className="mx-auto mt-8 max-w-5xl border-t border-[#dcdcdc] pt-5 text-xs text-[#131313]/50">
          © {new Date().getFullYear()} Openside. Open source under the MIT
          License.
        </div>
      </footer>

      <AuthModal
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => setAuthOpen(false)}
        forceLight
      />
    </div>
  );
};

export default LandingPage;
