import { useState } from "react";
import { FiLoader } from "react-icons/fi";
import {
  LuVideo,
  LuAudioLines,
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
import {
  formatRetentionRemaining,
  retentionExpiryMs,
} from "@/lib/retention";
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

const qualityLabel = (output: FinalOutput) => {
  if (output.height) return `${output.height}p`;
  if (output.width) return `${output.width}w`;
  return "";
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  output.variant === "CLOUD"
    ? "Cloud mix"
    : "Mixed recording";

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
  const stored = output.thumbnailUrl ?? null;
  const avatar = participant?.user?.avatar ?? null;
  const name = participant?.displayName || participant?.user?.name || "";
  const [storedFailed, setStoredFailed] = useState(false);
  const [storedLoaded, setStoredLoaded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const showStored = !!stored && !storedFailed;

  return (
    <span className="relative flex aspect-[4/3] h-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border">
      {showStored ? (
        <>
          {!storedLoaded && (
            <span className="skeleton-shimmer absolute inset-0" />
          )}
          <img
            src={stored}
            alt=""
            loading="lazy"
            onLoad={() => setStoredLoaded(true)}
            onError={() => setStoredFailed(true)}
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              storedLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        </>
      ) : name || avatar ? (
        // Camera-off style: a centered round profile picture, or the person's
        // first initial when they have no picture.
        <span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-brand text-sm font-semibold text-white">
          {avatar && !avatarFailed ? (
            <img
              src={avatar}
              alt=""
              loading="lazy"
              onError={() => setAvatarFailed(true)}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            (name.trim()[0] || "?").toUpperCase()
          )}
        </span>
      ) : (
        <FallbackIcon className="size-5 text-fg-muted" />
      )}

      {/* Selected → a steady now-playing scrim. Playable but idle → a play glyph
          that fades in on row hover to signal the row is clickable. Both use a
          neutral black scrim, no accent colour. */}
      {selected ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45">
          <NowPlayingBars />
        </span>
      ) : (
        canPlay && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
            <LuPlay className="size-4 fill-white text-white" />
          </span>
        )
      )}
    </span>
  );
};

const DownloadItem = ({
  name,
  format,
  description,
  busy,
  disabled,
  onClick,
}: {
  name: string;
  format: string;
  description: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-label={`${name}, ${format}. ${description}`}
    className="group/download relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition hover:bg-primary focus-visible:bg-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
  >
    {busy ? (
      <FiLoader className="size-3.5 animate-spin" />
    ) : (
      <LuDownload className="size-3.5 text-fg-muted" />
    )}
    {name}
    <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-fg-muted">
      {format}
    </span>
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute right-[calc(100%+0.75rem)] top-1/2 z-[70] w-56 -translate-y-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-5 text-popover-foreground opacity-0 shadow-md group-hover/download:visible group-hover/download:opacity-100 group-focus-visible/download:visible group-focus-visible/download:opacity-100"
    >
      {description}
    </span>
  </button>
);

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
  const recordedAt = formatDateTime(output.recordingSession?.startedAt);

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
        description: "High-quality video recorded locally in the participant's browser.",
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
        "Adds black padding when this track started late; otherwise it matches Raw video.",
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
            ? "Uncompressed 24-bit WAV captured from the participant's microphone."
            : "Smaller MP3 version of this track's audio.",
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
      description: "Server-side video backup of this track from the live session.",
      output: cloudOutput,
      format: "mp4",
    });
    if (cloudOutput.hasAudio !== false) {
      audioItems.push({
        id: `${cloudOutput.id}:mp3`,
        name: "Cloud",
        description: "MP3 audio from the server-side backup of this track.",
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
      className={`group flex items-center gap-3 rounded-xl border px-2.5 py-2 transition-colors ${
        selected
          ? "border-fg-faint bg-muted"
          : "border-border bg-primary hover:border-fg-faint"
      } ${canPlay ? "cursor-pointer" : ""}`}
    >
      <RowThumbnail
        output={output}
        fallbackIcon={KindIcon}
        canPlay={canPlay}
        selected={selected}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {title}
        </p>
        {/* Always show the status so users know where the recording stands; on
            a ready track, follow it with the useful stats. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-subtle">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${
              isReady
                ? "text-success"
                : isFailed
                  ? "text-danger"
                  : "text-warning"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                isReady
                  ? "bg-success"
                  : isFailed
                    ? "bg-danger"
                    : "bg-warning"
              }`}
            />
            {statusLabel(output.status)}
          </span>
          {isReady && (
            <>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-fg-faint">·</span>
                <span className="tabular-nums">
                  {formatDuration(output.durationMs)}
                </span>
              </span>
              {hasVideo && qualityLabel(output) && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-fg-faint">·</span>
                  <span className="tabular-nums">{qualityLabel(output)}</span>
                </span>
              )}
              {recordedAt && (
                <span className="hidden items-center gap-1.5 whitespace-nowrap sm:inline-flex">
                  <span className="text-fg-faint">·</span>
                  <span>{recordedAt}</span>
                </span>
              )}
              {deletesIn && (
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                  title="This recording auto-deletes when it reaches your plan's retention window."
                >
                  <span className="text-fg-faint">·</span>
                  <span className="text-warning/80">
                    deletes in {deletesIn}
                  </span>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!canDownload || !!downloading}
            onClick={(event) => event.stopPropagation()}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? (
              <FiLoader className="size-4 animate-spin" />
            ) : (
              <LuDownload className="size-4 text-fg-muted" />
            )}
            {downloading ? "Preparing" : "Download"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-52 overflow-visible rounded-xl border-border bg-background p-1.5"
          style={{ overflow: "visible" }}
        >
          {videoItems.length > 0 && (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-fg-subtle">
                Video
              </p>
              {videoItems.map((item) => (
                <DownloadItem
                  key={item.id}
                  name={item.name}
                  format={item.format}
                  description={item.description}
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
              <p className="px-2 pt-1.5 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-fg-subtle">
                Audio
              </p>
              {audioItems.map((item) => (
                <DownloadItem
                  key={item.id}
                  name={item.name}
                  format={item.format}
                  description={item.description}
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
