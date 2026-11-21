import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronDown } from "react-icons/fi";
import {
  useScreenOutputUrl,
  type ScreenOutputKind,
  type ScreenRecording,
} from "@/hooks/useScreenRecordings";
import { useEntitlements } from "@/hooks/useUsage";
import { cn } from "@/lib/utils";
import { formatRetentionRemaining, retentionExpiryMs } from "@/lib/retention";
import { capturePoster, getCachedPoster } from "@/lib/posterCache";
import ProcessingThumbnail from "./ProcessingThumbnail";

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric" });
};

// "screenAligned" is intentionally omitted: the backend points it at the same
// file as "screen", so it would show a duplicate entry. Preference order picks
// the combined "both" first, then screen, then camera.
const KIND_ORDER: ScreenOutputKind[] = ["both", "screen", "camera"];
const RECORDINGS_PER_PAGE = 8;

// Poster frame for a screen recording, preferring the combined screen+camera
// output, then screen, then camera. Seeks a little in to skip a black intro.
const ScreenThumbnail = ({ rec }: { rec: ScreenRecording }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const outputs = rec.outputs ?? {};
  const kind = KIND_ORDER.find((k) => outputs[k]?.key);
  const posterKey = `screen:${rec.id}:${kind ?? ""}`;
  const { data: url, isError } = useScreenOutputUrl(rec.id, kind);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const [poster, setPoster] = useState<string | null>(() =>
    getCachedPoster(posterKey),
  );
  // A frame (poster or seeked video) is on screen - fades in over the shimmer.
  const [frameShown, setFrameShown] = useState(false);
  const failed = isError || loadFailed;
  const showVideo = !poster && !!kind && !failed && !!url;

  // Retry without CORS if the CORS-mode load fails, so the video still shows.
  const handleError = () => {
    if (!corsBlocked) setCorsBlocked(true);
    else setLoadFailed(true);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    } catch {
      // ignore - some streams don't allow seeking before play
    }
  };

  const handleSeeked = () => {
    setFrameShown(true);
    // A no-CORS frame can't be read back, so it isn't cached as a poster.
    if (!corsBlocked && videoRef.current) {
      setPoster(capturePoster(posterKey, videoRef.current));
    }
  };

  // Same as the meeting project cards: a shimmer until the frame has loaded,
  // then the frame fades in; plain gray when there's nothing to show.
  const frameClass = cn(
    "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
    frameShown ? "opacity-100" : "opacity-0",
  );
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
      {!!kind && !failed && !frameShown && (
        <div className="skeleton-shimmer absolute inset-0 h-full w-full" />
      )}
      {poster ? (
        <img
          src={poster}
          alt=""
          onLoad={() => setFrameShown(true)}
          className={frameClass}
        />
      ) : showVideo ? (
        <video
          key={corsBlocked ? "no-cors" : "cors"}
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="metadata"
          crossOrigin={corsBlocked ? undefined : "anonymous"}
          onLoadedMetadata={handleLoadedMetadata}
          onSeeked={handleSeeked}
          onError={handleError}
          className={frameClass}
        />
      ) : null}
    </div>
  );
};

// Library card - mirrors the space ProjectCard: the whole card opens the
// recording's project page (rename/delete live there, not on the card).
// `compact` (the dashboard's recent list) hides the retention note.
export const ScreenRecordingCard = ({
  rec,
  compact = false,
}: {
  rec: ScreenRecording;
  compact?: boolean;
}) => {
  const navigate = useNavigate();
  const { data: entitlements } = useEntitlements();

  const startedAt = rec.startedAt || rec.createdAt;
  const open = () => navigate(`/dashboard/project/screen/${rec.id}`);
  const remaining =
    !compact && rec.status === "READY"
      ? formatRetentionRemaining(
          retentionExpiryMs(
            rec.stoppedAt ?? startedAt,
            entitlements?.retentionHours ?? null,
          ),
        )
      : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className="flex cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border border-border bg-primary p-3 dark:border-border/50 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <div className="relative w-full">
        {rec.status === "READY" ? (
          <ScreenThumbnail rec={rec} />
        ) : (
          <ProcessingThumbnail failed={rec.status === "FAILED"} />
        )}
      </div>

      <div className="flex items-end justify-between gap-2 px-1 pb-1">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {rec.title || "Untitled recording"}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-subtle">
            <span className="whitespace-nowrap">
              {rec.uploaded ? "Uploaded video" : "Screen recording"}
            </span>
            {startedAt && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span>·</span>
                <span>{formatDate(startedAt)}</span>
              </span>
            )}
            {remaining && (
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap"
                title="Recordings auto-delete when they reach your plan's retention window."
              >
                <span>·</span>
                <span>deletes in {remaining}</span>
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

const ScreenRecordingCardSkeleton = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-primary p-3 dark:border-border/50">
    <div className="skeleton-shimmer aspect-video rounded-lg" />
    <div className="space-y-2 px-1 pb-1">
      <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
      <div className="skeleton-shimmer h-3 w-1/2 rounded" />
    </div>
  </div>
);

const ScreenRecordingsSection = ({
  recordings,
  isLoading = false,
  title = "Screen recordings",
}: {
  recordings: ScreenRecording[];
  isLoading?: boolean;
  title?: string;
}) => {
  const [visibleCount, setVisibleCount] = useState(RECORDINGS_PER_PAGE);
  if (!isLoading && recordings.length === 0) return null;

  const visibleRecordings = recordings.slice(0, visibleCount);
  const remainingRecordings = Math.max(
    0,
    recordings.length - visibleRecordings.length,
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <ScreenRecordingCardSkeleton key={index} />
            ))
          : visibleRecordings.map((rec) => (
              <ScreenRecordingCard key={rec.id} rec={rec} />
            ))}
      </div>
      {!isLoading && remainingRecordings > 0 && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((count) =>
                Math.min(count + RECORDINGS_PER_PAGE, recordings.length),
              )
            }
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-primary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Show more
            <span className="text-fg-subtle">({remainingRecordings} more)</span>
            <FiChevronDown size={14} />
          </button>
        </div>
      )}
    </section>
  );
};

export default ScreenRecordingsSection;
