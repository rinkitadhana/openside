import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiClock, FiLoader, FiMonitor } from "react-icons/fi";
import {
  useScreenOutputUrl,
  type ScreenOutputKind,
  type ScreenRecording,
} from "@/hooks/useScreenRecordings";
import { cn } from "@/lib/utils";
import { capturePoster, getCachedPoster } from "@/lib/posterCache";

const formatDate = (value?: string | null) => {
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

// "screenAligned" is intentionally omitted: the backend points it at the same
// file as "screen", so it would show a duplicate entry. Preference order picks
// the combined "both" first, then screen, then camera.
const KIND_ORDER: ScreenOutputKind[] = ["both", "screen", "camera"];
const RECORDINGS_PER_PAGE = 8;

const StatusBadge = ({ status }: { status: ScreenRecording["status"] }) => {
  if (status === "READY") return null;
  const processing = status === "PROCESSING" || status === "STOPPED";
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-medium",
        processing
          ? "bg-warning/15 text-warning"
          : "bg-danger/15 text-danger",
      )}
    >
      {processing ? (
        <>
          <FiLoader className="size-3 animate-spin" />
          Processing
        </>
      ) : (
        "Failed"
      )}
    </span>
  );
};

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
    if (videoRef.current) setPoster(capturePoster(posterKey, videoRef.current));
  };

  // Plain gray + icon underneath; the poster/video paints on top once ready. The
  // same state covers loading, failure, and "no thumbnail" - nothing flashes.
  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted">
      <FiMonitor className="size-8 text-fg-faint" />
      {poster ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
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
          onSeeked={corsBlocked ? undefined : handleSeeked}
          onError={handleError}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </div>
  );
};

// Library card - mirrors the space ProjectCard: the whole card opens the
// recording's project page, where playback, downloads, rename, and delete live.
const ScreenRecordingCard = ({ rec }: { rec: ScreenRecording }) => {
  const navigate = useNavigate();
  const recordedAt = formatDate(rec.startedAt || rec.createdAt);

  return (
    <button
      type="button"
      onClick={() => navigate(`/dashboard/project/screen/${rec.id}`)}
      className="flex flex-col gap-3 rounded-xl border border-border bg-primary p-3 text-left transition-colors hover:border-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <div className="relative w-full">
        <ScreenThumbnail rec={rec} />
        {rec.status !== "READY" && (
          <div className="absolute right-2 top-2">
            <StatusBadge status={rec.status} />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-1 px-1 pb-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {rec.title || "Untitled recording"}
        </p>
        {recordedAt && (
          <p className="flex items-center gap-1 text-xs text-fg-subtle">
            <FiClock className="size-3" />
            Recorded {recordedAt}
          </p>
        )}
      </div>
    </button>
  );
};

const ScreenRecordingCardSkeleton = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-primary p-3">
    <div className="aspect-video animate-pulse rounded-lg bg-muted" />
    <div className="space-y-2 px-1 pb-1">
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const ScreenRecordingsSection = ({
  recordings,
  isLoading = false,
}: {
  recordings: ScreenRecording[];
  isLoading?: boolean;
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
        <h2 className="text-sm font-semibold text-foreground">
          Screen recordings
        </h2>
        {!isLoading && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[0.7rem] font-medium text-fg-muted ring-1 ring-border">
            {recordings.length}
          </span>
        )}
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
            className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
          >
            Show more
            <span className="ml-1.5 text-fg-subtle">
              ({remainingRecordings} more)
            </span>
          </button>
        </div>
      )}
    </section>
  );
};

export default ScreenRecordingsSection;
