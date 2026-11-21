import { useState } from "react";
import { FiLoader } from "react-icons/fi";
import {
  LuVideo,
  LuAudioLines,
  LuChevronDown,
  LuCloud,
  LuLayoutGrid,
  LuDownload,
  LuPlay,
} from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { fetchDownloadUrl } from "@/hooks/useFinalOutputs";
import { useEntitlements } from "@/hooks/useUsage";
import { formatRetentionRemaining, retentionExpiryMs } from "@/lib/retention";
import type { DownloadFormat, FinalOutput } from "@/types/outputTypes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const formatDuration = (ms?: number | null) => {
  if (!ms || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

// "1080p" names the SHORT side, so a portrait 1080x1920 track is 1080p too.
const qualityLabel = (output: FinalOutput) => {
  if (!output.width || !output.height) return "";
  const short = Math.min(output.width, output.height);
  return short >= 2160 ? "4K" : `${short}p`;
};

const triggerBrowserDownload = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

interface OutputCardProps {
  output: FinalOutput;
  /** Optional per-participant LiveKit cloud recording for the same participant. */
  cloudOutput?: FinalOutput;
  /**
   * Optional aligned variant - only exists for participants who joined late. It
   * carries a black lead-in so the track lines up on an editing timeline. When
   * absent, there is no "space", so only the main video download is offered.
   */
  alignedOutput?: FinalOutput;
  /** Set when a participant has multiple segments (e.g. they refreshed/rejoined
   *  mid-recording) - e.g. "Part 2" - so the tracks read as one person. */
  partLabel?: string;
  fallbackTitle?: string;
  /** Click the row to load this track into the player above the list. */
  onSelect?: () => void;
  /** Highlight - this track is the one currently in the player. */
  selected?: boolean;
}

const compositeLabel = (output: FinalOutput) =>
  output.variant === "CLOUD" ? "Cloud mix" : "Mixed recording";

const statusLabel = (status: FinalOutput["status"]) => {
  switch (status) {
    case "READY":
      return "Ready";
    case "PROCESSING":
      return "Processing";
    case "FAILED":
      return "Failed";
    default:
      return "Queued";
  }
};

// Thumbnail order: the stored poster generated at finalize time (instant, no
// video decode) → the participant's profile picture when that's missing/failed
// (audio-only tracks, older recordings, or a fetch error) → the kind icon.
// Three thin bars bobbing to fake an equalizer - the "now playing" marker.
const NowPlayingBars = () => (
  <span className="flex h-3 items-center gap-[3px]" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-[3px] animate-nowplaying rounded-full bg-white"
        style={{ animationDelay: `${i * 160}ms` }}
      />
    ))}
  </span>
);

// Compact row avatar: the participant's picture (or initial) for camera
// tracks, a kind icon for screen shares / composites. Selected shows a
// now-playing scrim; a playable row shows a play glyph on hover.
const RowThumbnail = ({
  output,
  fallbackIcon: FallbackIcon,
  canPlay,
  selected,
}: {
  output: FinalOutput;
  fallbackIcon: typeof LuVideo;
  canPlay?: boolean;
  selected?: boolean;
}) => {
  const participant = output.sourceRecording?.participant;
  const avatar = participant?.user?.avatar ?? null;
  const name = participant?.displayName || participant?.user?.name || "";
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  // A frame of the video itself (the poster made at finalize time) comes
  // first, like the share page's track rows.
  const poster =
    output.hasVideo && output.thumbnailUrl && !posterFailed
      ? output.thumbnailUrl
      : null;
  const showPerson =
    !poster && !output.sourceRecording?.isScreenShare && (!!name || !!avatar);

  return (
    <span
      className={`relative flex size-9 shrink-0 items-center justify-center overflow-hidden ${
        showPerson
          ? "rounded-full bg-muted text-sm font-medium text-foreground"
          : "rounded-lg bg-muted text-fg-muted"
      }`}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          onError={() => setPosterFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : showPerson ? (
        avatar && !avatarFailed ? (
          <img
            src={avatar}
            alt=""
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          (name.trim()[0] || "?").toUpperCase()
        )
      ) : (
        <FallbackIcon className="size-4" />
      )}

      {selected ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
          <NowPlayingBars />
        </span>
      ) : (
        canPlay && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/45 group-hover:opacity-100">
            <LuPlay className="size-3.5 fill-white text-white" />
          </span>
        )
      )}
    </span>
  );
};

type DownloadKind = "video" | "audio" | "cloud";

const DOWNLOAD_KIND_ICON = {
  video: LuVideo,
  audio: LuAudioLines,
  cloud: LuCloud,
} as const;

const DownloadItem = ({
  name,
  format,
  description,
  kind,
  busy,
  disabled,
  onClick,
}: {
  name: string;
  format: string;
  description: string;
  kind: DownloadKind;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => {
  const Icon = DOWNLOAD_KIND_ICON[kind];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${name}, ${format}. ${description}`}
      className="group/download relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
    >
      {busy ? (
        <FiLoader className="size-3.5 shrink-0 animate-spin text-fg-muted" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-fg-muted transition-colors group-hover/download:text-foreground" />
      )}
      <span className="truncate text-sm text-foreground">
        {busy ? "Preparing…" : name}
      </span>
      <span className="ml-auto shrink-0 text-[0.65rem] font-medium uppercase tracking-wide text-fg-subtle">
        {format}
      </span>

      {/* What this download is, beside the menu on hover / keyboard focus. */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-[calc(100%+0.875rem)] top-1/2 z-[70] w-60 -translate-y-1/2 translate-x-1 scale-95 rounded-xl border border-border bg-popover px-3 py-2.5 text-left opacity-0 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.18)] transition-[opacity,transform,visibility] duration-150 ease-out group-hover/download:visible group-hover/download:translate-x-0 group-hover/download:scale-100 group-hover/download:opacity-100 group-focus-visible/download:visible group-focus-visible/download:translate-x-0 group-focus-visible/download:scale-100 group-focus-visible/download:opacity-100"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-popover-foreground">
          <Icon className="size-3.5 text-fg-muted" />
          {name}
          <span className="text-fg-muted">·</span>
          <span className="uppercase text-fg-muted">{format}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-fg-muted">
          {description}
        </span>
        <span className="absolute left-full top-1/2 size-2.5 -translate-x-[5px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-popover" />
      </span>
    </button>
  );
};

const OutputCard = ({
  output,
  cloudOutput,
  alignedOutput,
  partLabel,
  fallbackTitle,
  onSelect,
  selected,
}: OutputCardProps) => {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const isComposite = output.type === "COMPOSITE";
  const hasVideo = !!output.hasVideo;
  const isReady = output.status === "READY";
  const isFailed = output.status === "FAILED";
  const cloudReady = cloudOutput?.status === "READY";
  const alignedReady = alignedOutput?.status === "READY";
  const canDownload = isReady || cloudReady;

  const baseTitle = isComposite
    ? `${compositeLabel(output)} · all participants`
    : output.sourceRecording?.participant?.displayName ||
      output.sourceRecording?.participant?.user?.name ||
      fallbackTitle ||
      (hasVideo ? "Participant · Video + Audio" : "Participant · Audio");
  // Screen-share tracks get a "Screen Share" tag after the name so they're
  // instantly distinguishable from the person's camera track.
  const labelSuffix = [
    output.sourceRecording?.isScreenShare ? "Screen Share" : null,
    partLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = labelSuffix ? `${baseTitle} · ${labelSuffix}` : baseTitle;

  const KindIcon = isComposite
    ? LuLayoutGrid
    : hasVideo
      ? LuVideo
      : LuAudioLines;

  const { data: entitlements } = useEntitlements();
  const deletesIn = formatRetentionRemaining(
    retentionExpiryMs(
      output.recordingSession?.stoppedAt ??
        output.recordingSession?.startedAt ??
        output.createdAt,
      entitlements?.retentionHours,
    ),
  );

  // Flat lists split into Video / Audio.
  const videoFormats: DownloadFormat[] = ["mp4"];
  const audioFormats: DownloadFormat[] = ["wav", "mp3"];

  type DownloadItem = {
    id: string;
    name: string;
    description: string;
    kind: DownloadKind;
    output: FinalOutput;
    format: DownloadFormat;
  };

  const videoItems: DownloadItem[] = [];
  const audioItems: DownloadItem[] = [];

  if (isReady && hasVideo) {
    for (const format of videoFormats) {
      videoItems.push({
        id: `${output.id}:${format}`,
        name: "Raw video",
        description:
          "Full-quality video recorded in the participant's browser.",
        kind: "video",
        output,
        format,
      });
    }
  }
  // Keep the aligned option available on every video track. When no padding is
  // needed, raw is already aligned with the shared timeline, so it is the
  // correct fallback; label that case clearly instead of hiding the option.
  if (isReady && hasVideo) {
    const hasAlignedVariant =
      !!alignedOutput && alignedReady && !!alignedOutput.hasVideo;
    const alignedSource = hasAlignedVariant ? alignedOutput : output;
    videoItems.push({
      id: `${alignedSource.id}:aligned:mp4`,
      name: "Aligned video",
      description:
        "Lines up with the session start, padded if they joined late.",
      kind: "video",
      output: alignedSource,
      format: "mp4",
    });
  }
  const isScreenShare = output.sourceRecording?.isScreenShare === true;
  // Only offer audio downloads when the track actually has an audio stream. A
  // screen share with no captured system audio is video-only, and asking the
  // API to extract mp3/wav from it returns a 400.
  if (isReady && output.hasAudio !== false) {
    // The lossless "Raw audio" (WAV) master is built from the participant's
    // raw-PCM mic capture, which belongs to their camera/mic track. A screen
    // share only carries the (lossy) system sound, so a WAV there would imply a
    // lossless source that doesn't exist - offer only the compressed extract.
    for (const format of audioFormats) {
      if (format === "wav" && isScreenShare) continue;
      audioItems.push({
        id: `${output.id}:${format}`,
        name: format === "wav" ? "Raw audio" : "Compressed",
        description:
          format === "wav"
            ? "Lossless 24-bit WAV from the participant's microphone."
            : "Smaller MP3 of this track's audio.",
        kind: "audio",
        output,
        format,
      });
    }
  }
  // The cloud egress paired with this row by the library: the camera egress on
  // a camera row, the screenShare egress on a screen row. Its mp3 is gated on
  // hasAudio like the local track (an audio-less share's egress has no audio
  // stream to extract).
  if (cloudOutput && cloudReady) {
    videoItems.push({
      id: `${cloudOutput.id}:mp4`,
      name: "Cloud",
      description: "Server-side backup recorded from the live call.",
      kind: "cloud",
      output: cloudOutput,
      format: "mp4",
    });
    if (cloudOutput.hasAudio !== false) {
      audioItems.push({
        id: `${cloudOutput.id}:mp3`,
        name: "Cloud",
        description: "MP3 audio from the server-side backup.",
        kind: "cloud",
        output: cloudOutput,
        format: "mp3",
      });
    }
  }

  const handleDownload = async (
    targetOutput: FinalOutput,
    format: DownloadFormat,
    itemId: string,
  ) => {
    if (targetOutput.status !== "READY" || downloading) return;
    setDownloading(itemId);
    try {
      let res = await fetchDownloadUrl(targetOutput.id, format);
      let attempts = 0;
      // Transcodes (mp4/mp3/wav) may need a moment the first time.
      while (!res.ready && !res.error && attempts < 60) {
        await sleep(2500);
        res = await fetchDownloadUrl(targetOutput.id, format);
        attempts += 1;
      }

      if (res.error) {
        return;
      }
      if (res.ready && res.url) {
        triggerBrowserDownload(res.url);
        setOpen(false);
      }
    } catch {
      // Download failed; the button simply re-enables.
    } finally {
      setDownloading(null);
    }
  };

  const canPlay = isReady && hasVideo && !!onSelect;

  return (
    <div
      onClick={canPlay ? onSelect : undefined}
      aria-pressed={canPlay ? selected : undefined}
      className={`group flex items-center gap-3 px-3.5 py-2.5 transition-colors ${
        selected ? "bg-muted/50" : "hover:bg-muted/30"
      } ${canPlay ? "cursor-pointer" : ""}`}
    >
      <RowThumbnail
        output={output}
        fallbackIcon={KindIcon}
        canPlay={canPlay}
        selected={selected}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {/* Always show the status so users know where the recording stands; on
            a ready track, follow it with the useful stats. */}
        {/* One line: anything that doesn't fit is cut off with "…". */}
        <p className="mt-0.5 truncate text-xs tabular-nums text-fg-subtle">
          {/* Ready tracks lead with their stats; anything else shows its status. */}
          {!isReady && (
            <span className={isFailed ? "text-danger" : ""}>
              {statusLabel(output.status)}
            </span>
          )}
          {isReady && (
            <>
              {[
                output.durationMs ? formatDuration(output.durationMs) : null,
                hasVideo ? qualityLabel(output) : null,
                hasVideo && output.fps ? `${Math.round(output.fps)} fps` : null,
                deletesIn ? `Deletes in ${deletesIn}` : null,
              ]
                .filter(Boolean)
                .map((part, index) => (
                  <span
                    key={part}
                    title={
                      part?.startsWith("Deletes in")
                        ? "This recording auto-deletes when it reaches your plan's retention window."
                        : undefined
                    }
                  >
                    {index > 0 && (
                      <span className="mx-1.5 text-fg-faint">·</span>
                    )}
                    {part}
                  </span>
                ))}
            </>
          )}
        </p>
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!canDownload || !!downloading}
            onClick={(event) => event.stopPropagation()}
            aria-label={downloading ? "Preparing download" : "Download"}
            title={downloading ? "Preparing download" : "Download"}
            className="group/trigger flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand pl-3 pr-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:opacity-90"
          >
            {downloading ? (
              <FiLoader className="size-3.5 animate-spin" />
            ) : (
              <LuDownload className="size-3.5" />
            )}
            {downloading ? "Preparing" : "Download"}
            <LuChevronDown className="size-3.5 text-white/80 transition-transform duration-150 group-data-[state=open]/trigger:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56 rounded-xl border-border bg-primary p-1 shadow-md"
          // The description tooltips sit outside the menu.
          style={{ overflow: "visible" }}
        >
          {videoItems.length > 0 && (
            <>
              <p className="px-2 pt-1.5 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-fg-subtle">
                Video
              </p>
              {videoItems.map((item) => (
                <DownloadItem
                  key={item.id}
                  name={item.name}
                  format={item.format}
                  description={item.description}
                  kind={item.kind}
                  busy={downloading === item.id}
                  disabled={!!downloading}
                  onClick={() =>
                    handleDownload(item.output, item.format, item.id)
                  }
                />
              ))}
            </>
          )}

          {audioItems.length > 0 && (
            <>
              {videoItems.length > 0 && (
                <div className="mx-1 my-1 h-px bg-border/70" />
              )}
              <p className="px-2 pt-1.5 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-fg-subtle">
                Audio
              </p>
              {audioItems.map((item) => (
                <DownloadItem
                  key={item.id}
                  name={item.name}
                  format={item.format}
                  description={item.description}
                  kind={item.kind}
                  busy={downloading === item.id}
                  disabled={!!downloading}
                  onClick={() =>
                    handleDownload(item.output, item.format, item.id)
                  }
                />
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default OutputCard;
