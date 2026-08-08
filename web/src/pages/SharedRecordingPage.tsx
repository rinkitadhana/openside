/**
 * Public share page (/share/:token).
 *
 * Renders a recording for anyone holding the link - no account required. The
 * token is the only credential, so everything here goes through the public
 * /recording/shared/:token endpoints, which never expose storage keys.
 */

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { FiClock, FiLoader, FiMonitor, FiVideo } from "react-icons/fi";
import { LuDownload, LuPlay } from "react-icons/lu";
import PageTitle from "@/components/shared/PageTitle";
import RecordingComments from "@/components/Dashboard/recordings/RecordingComments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import type { ScreenOutputKind } from "@/hooks/useScreenRecordings";
import {
	fetchSharedOutputUrl,
	fetchSharedFinalOutputDownload,
  useCreateSharedComment,
  useSharedComments,
  useSharedFinalOutputUrl,
  useSharedOutputUrl,
  useSharedRecording,
} from "@/hooks/useSharedRecording";
import { useRealtimeRecordingComments } from "@/hooks/useRealtimeRecordingComments";

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

const formatDuration = (ms?: number | null) => {
  if (!ms || ms <= 0) return "0:00";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

const formatBitrate = (bitrate?: number | null) =>
  bitrate && bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : null;

const SharedPlayer = ({
  token,
  kind,
}: {
  token: string;
  kind: ScreenOutputKind | null;
}) => {
  const [downloading, setDownloading] = useState(false);
  const { data: url } = useSharedOutputUrl(token, kind ?? undefined);

  const handleDownload = async () => {
    if (!kind || downloading) return;
    setDownloading(true);
    try {
      const downloadUrl = await fetchSharedOutputUrl(token, kind, true);
      triggerBrowserDownload(downloadUrl);
    } catch {
      // Download failed; the button simply re-enables.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border bg-primary p-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
        {!kind ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
            <FiVideo className="size-6" />
            <span className="text-sm">Nothing to play yet</span>
          </div>
        ) : url ? (
          <video key={kind} src={url} controls playsInline className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
            <FiLoader className="size-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
      {kind && (
        <div className="flex justify-end px-1 pb-1 pt-3">
          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownload()}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? (
              <FiLoader className="size-4 animate-spin" />
            ) : (
              <LuDownload className="size-4" />
            )}
            {downloading ? "Preparing" : "Download video"}
          </button>
        </div>
      )}
    </div>
  );
};

type SharedSpaceTrack = {
  id: string;
  title: string;
  mimeType: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  isScreenShare: boolean;
  alignedOutputId: string | null;
  cloudOutputId: string | null;
  cloudHasVideo: boolean;
  cloudHasAudio: boolean;
};

const SharedSpacePlayer = ({
  token,
  outputId,
}: {
  token: string;
  outputId: string | null;
}) => {
  const { data: url } = useSharedFinalOutputUrl(token, outputId ?? undefined);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
      {!outputId ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
          <FiVideo className="size-6" />
          <span className="text-sm">Nothing to play yet</span>
        </div>
      ) : url ? (
        <video key={outputId} src={url} controls playsInline className="h-full w-full" />
      ) : (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
          <FiLoader className="size-4 animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
};

const SharedSpaceTrackRow = ({
  token,
  track,
  selected,
  onSelect,
}: {
  token: string;
  track: SharedSpaceTrack;
  selected: boolean;
  onSelect: () => void;
}) => {
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);
  const { data: thumbnailUrl } = useSharedFinalOutputUrl(token, track.id);

  const handleDownload = async (
    event: React.MouseEvent,
    outputId: string,
    format: "mp4" | "mp3" | "wav",
  ) => {
    event.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      let result = await fetchSharedFinalOutputDownload(token, outputId, format);
      let attempts = 0;
      while (!result.ready && !result.error && attempts < 60) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        result = await fetchSharedFinalOutputDownload(token, outputId, format);
        attempts += 1;
      }
      if (result.ready && result.url) {
        triggerBrowserDownload(result.url);
        setOpen(false);
      }
    } finally {
      setDownloading(false);
    }
  };

  type DownloadItem = {
    label: string;
    format: "mp4" | "mp3" | "wav";
    outputId: string;
  };
  const videoItems: DownloadItem[] = track.hasVideo
    ? [
        { label: "Raw video", format: "mp4", outputId: track.id },
        {
          label: "Aligned video",
          format: "mp4",
          outputId: track.alignedOutputId ?? track.id,
        },
      ]
    : [];
  const audioItems: DownloadItem[] = track.hasAudio
    ? [
        { label: "Compressed", format: "mp3", outputId: track.id },
        // Raw (lossless WAV) comes from the mic PCM master on the camera/mic
        // track; a screen share only has the lossy system sound.
        ...(track.isScreenShare
          ? []
          : [
              {
                label: "Raw audio",
                format: "wav" as const,
                outputId: track.id,
              },
            ]),
      ]
    : [];
  // The server pairs each track with its own egress (camera egress on camera
  // rows, screenShare egress on screen rows), so offer it whenever present.
  if (track.cloudOutputId && track.cloudHasVideo) {
    videoItems.push({ label: "Cloud", format: "mp4", outputId: track.cloudOutputId });
  }
  if (track.cloudOutputId && track.cloudHasAudio) {
    audioItems.push({ label: "Cloud", format: "mp3", outputId: track.cloudOutputId });
  }
  const canDownload = videoItems.length > 0 || audioItems.length > 0;
  const specs = [
    formatDuration(track.durationMs),
    track.hasVideo && track.height ? `${track.height}p` : null,
    track.hasVideo && track.fps ? `${track.fps} fps` : null,
    formatBitrate(track.bitrate),
    track.mimeType?.replace("video/", "").replace("audio/", "").toUpperCase() ?? null,
  ].filter(Boolean);

  return (
    <div
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-2.5 py-2 transition-colors ${
        selected
          ? "border-foreground/25 bg-muted"
          : "border-border bg-primary hover:border-foreground/20"
      }`}
    >
      <span className="relative flex aspect-[4/3] h-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border">
        <FiVideo className="size-4 text-foreground/60" />
        {thumbnailUrl && (
          <video
            src={thumbnailUrl}
            muted
            playsInline
            preload="metadata"
            aria-hidden
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (Number.isFinite(video.duration) && video.duration > 0.1) {
                video.currentTime = 0.1;
              }
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {!selected && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
            <LuPlay className="size-4 fill-white text-white" />
          </span>
        )}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {track.title}
        <span className="mt-0.5 block truncate text-xs font-normal text-foreground/45">
          {specs.join(" · ")}
        </span>
      </p>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={downloading || !canDownload}
            onClick={(event) => event.stopPropagation()}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? <FiLoader className="size-4 animate-spin" /> : <LuDownload className="size-4 text-foreground/60" />}
            {downloading ? "Preparing" : "Download"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl border-border bg-background p-1.5">
          {([ ["Video", videoItems], ["Audio", audioItems] ] as const).map(
            ([section, items]) =>
              items.length > 0 && (
                <div key={section}>
                  <p className="px-2 pt-1 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-foreground/40">
                    {section}
                  </p>
                  {items.map((item) => (
                    <button
                      key={`${item.outputId}-${item.label}`}
                      type="button"
                      disabled={downloading}
                      onClick={(event) => void handleDownload(event, item.outputId, item.format)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <LuDownload className="size-3.5 text-foreground/60" />
                      {item.label}
                      <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-foreground/55">
                        {item.format}
                      </span>
                    </button>
                  ))}
                </div>
              ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const SharedRecordingPage = () => {
  const { token = "" } = useParams<{ token: string }>();
  const [selectedSpaceTrackId, setSelectedSpaceTrackId] = useState<string | null>(
    null,
  );
  const { isSignedIn } = useClerkAuth();
  const { data: rec, isLoading, isError } = useSharedRecording(token);
  const { data: comments, isLoading: areCommentsLoading } =
    useSharedComments(token);
  const createComment = useCreateSharedComment(token);
  useRealtimeRecordingComments(token, "shared");

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground/45">
        <FiLoader className="size-5 animate-spin" />
      </div>
    );
  }

  if (isError || !rec) {
    return (
      <>
        <PageTitle title="Recording unavailable" />
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-call-primary ring-1 ring-call-border">
            <FiVideo className="size-7 text-foreground/45" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">
              This link isn't available
            </h1>
            <p className="max-w-sm text-sm text-foreground/55">
              The recording may have been deleted, or its owner turned off
              sharing.
            </p>
          </div>
          <Link
            to="/"
            className="rounded-lg border border-call-border bg-call-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
          >
            Go to Openside
          </Link>
        </div>
      </>
    );
  }

  const spaceTracks = rec.tracks ?? [];
  const screenVideoKind: ScreenOutputKind | null = rec.kinds.includes("both")
    ? "both"
    : rec.kinds.includes("screen")
      ? "screen"
      : null;
  const recTitle = rec.title || "Untitled recording";
  const isProcessing = rec.status === "STOPPED" || rec.status === "PROCESSING";
  const isSpaceRecording = rec.source === "SPACE";
  const showComments = !isSpaceRecording;
  const activeSpaceTrackId =
    selectedSpaceTrackId && spaceTracks.some((track) => track.id === selectedSpaceTrackId)
      ? selectedSpaceTrackId
      : (spaceTracks[0]?.id ?? null);

  return (
    <>
      <PageTitle title={recTitle} />
      {/* Desktop: the viewport is the frame - the left pane scrolls on its own
          and the comments pane runs full height to the bottom. Below lg the
          panes stack and the page scrolls normally. */}
      <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:min-h-0 lg:overflow-hidden">
        <header className="shrink-0 border-b border-call-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link to="/" className="flex items-center gap-2">
              <img
                src="/logo/logo-light.png"
                alt=""
                className="h-6 w-auto select-none dark:hidden"
              />
              <img
                src="/logo/logo-dark.png"
                alt=""
                className="hidden h-6 w-auto select-none dark:block"
              />
              <span className="text-sm font-semibold text-foreground">
                Openside
              </span>
            </Link>
            <Link
              to="/dashboard/screen-recorder"
              className="rounded-lg border border-call-border bg-call-primary px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-70"
            >
              Record your own
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 lg:min-h-0 lg:pb-0">
          <div className="mb-6 shrink-0 border-b border-call-border pb-5 lg:mb-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {recTitle}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground/45">
              <span className="inline-flex items-center gap-1">
                <FiMonitor className="size-3" />
                {isSpaceRecording ? "Space recording" : "Screen recording"}
              </span>
              {rec.ownerName && (
                <>
                  <span>·</span>
                  <span>Shared by {rec.ownerName}</span>
                </>
              )}
              {rec.startedAt && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <FiClock className="size-3" />
                    {formatDateTime(rec.startedAt)}
                  </span>
                </>
              )}
            </p>
            {isSpaceRecording && rec.description && (
              <p className="mt-2 max-w-2xl text-sm text-foreground/60">
                {rec.description}
              </p>
            )}
          </div>

          <div
            className={`grid gap-6 lg:min-h-0 lg:flex-1 lg:gap-0 ${
              showComments ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"
            }`}
          >
            <div
              className={`min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pt-5 ${
                showComments ? "lg:pr-6" : "lg:pr-0"
              }`}
            >
              {isSpaceRecording ? (
                spaceTracks.length === 0 ? (
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-black text-white/60 ring-1 ring-border">
                    {isProcessing ? (
                      <>
                        <FiLoader className="size-6 animate-spin" />
                        <span className="text-sm">This recording is still processing…</span>
                      </>
                    ) : (
                      <>
                        <FiVideo className="size-6" />
                        <span className="text-sm">Nothing to play here yet</span>
                      </>
                    )}
                  </div>
                ) : (
                  <section className="flex flex-col gap-4">
                    <SharedSpacePlayer token={token} outputId={activeSpaceTrackId} />
                    {spaceTracks.length > 0 && (
                      <>
                        <h2 className="text-sm font-semibold text-foreground/80">Tracks</h2>
                        <div className="flex flex-col gap-2">
                          {spaceTracks.map((track) => (
                            <SharedSpaceTrackRow
                              key={track.id}
                              token={token}
                              track={track}
                              selected={track.id === activeSpaceTrackId}
                              onSelect={() => setSelectedSpaceTrackId(track.id)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                )
              ) : !screenVideoKind ? (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-black text-white/60 ring-1 ring-border">
                  {isProcessing ? (
                    <>
                      <FiLoader className="size-6 animate-spin" />
                      <span className="text-sm">
                        This recording is still processing…
                      </span>
                    </>
                  ) : (
                    <>
                      <FiVideo className="size-6" />
                      <span className="text-sm">Nothing to play here yet</span>
                    </>
                  )}
                </div>
              ) : (
                <SharedPlayer token={token} kind={screenVideoKind} />
              )}
            </div>

            {showComments && (
              <div className="min-h-[320px] lg:h-full lg:min-h-0 lg:border-l lg:border-call-border">
                <RecordingComments
                  comments={comments ?? []}
                  isLoading={areCommentsLoading}
                  isPosting={createComment.isPending}
                  // Signed-out visitors have no account to attribute to, so they
                  // name themselves; a signed-in one comments as their account.
                  askForName={!isSignedIn}
                  onSubmit={({ body, authorName }) =>
                    createComment.mutate({ body, authorName })
                  }
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
};

export default SharedRecordingPage;
