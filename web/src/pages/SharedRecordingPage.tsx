/**
 * Public share page (/share/:token).
 *
 * Renders a recording for anyone holding the link - no account required. The
 * token is the only credential, so everything here goes through the public
 * /recording/shared/:token endpoints, which never expose storage keys.
 */

import { useRef, useState, type Ref } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { FiLoader, FiVideo } from "react-icons/fi";
import { LuChevronDown, LuDownload, LuPlay } from "react-icons/lu";
import PageTitle from "@/components/shared/PageTitle";
import RecordingDescription from "@/components/Dashboard/recordings/RecordingDescription";
import { useCommentsRailResizer } from "@/components/shared/CommentsRailResizer";
import RecordingComments, {
  RecordingCommentsSkeleton,
} from "@/components/Dashboard/recordings/RecordingComments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import {
  useDeleteRecordingComment,
  useEditRecordingComment,
  type RecordingComment,
  type ScreenOutputKind,
} from "@/hooks/useScreenRecordings";
import { useGetMe } from "@/hooks/useUserQuery";
import {
  fetchSharedOutputUrl,
  fetchSharedFinalOutputDownload,
  useCreateSharedComment,
  useRecordSharedView,
  useSharedComments,
  useSharedFinalOutputUrl,
  useSharedOutputUrl,
  useSharedRecording,
} from "@/hooks/useSharedRecording";
import { useRealtimeRecordingComments } from "@/hooks/useRealtimeRecordingComments";
import VideoPlayer, {
  type VideoPlayerHandle,
} from "@/components/shared/VideoPlayer";

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
  fileType,
  playerRef,
}: {
  token: string;
  kind: ScreenOutputKind;
  fileType: string | null;
  playerRef: Ref<VideoPlayerHandle>;
}) => {
  const [downloading, setDownloading] = useState(false);
  const { data: url } = useSharedOutputUrl(token, kind);

  const handleDownload = async () => {
    if (downloading) return;
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
    <div className="flex w-full flex-col self-start">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border/50">
        {url ? (
          <VideoPlayer key={url} ref={playerRef} src={url} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
            <FiLoader className="size-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
      <div className="flex items-center justify-end pt-3">
        <button
          type="button"
          disabled={downloading}
          onClick={() => void handleDownload()}
          className="flex h-9 items-center gap-2 rounded-lg bg-brand pl-3 pr-1.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 cursor-pointer"
        >
          {downloading ? (
            <FiLoader className="size-4 animate-spin" />
          ) : (
            <LuDownload className="size-4" />
          )}
          {downloading ? "Preparing…" : "Download"}
          {fileType && (
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
              {fileType}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

/** A black 16:9 frame with a message, for a take with nothing to play yet. */
const EmptyPlayer = ({ processing }: { processing: boolean }) => (
  <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-black text-white/60 ring-1 ring-border/50">
    {processing ? (
      <FiLoader className="size-6 animate-spin" />
    ) : (
      <FiVideo className="size-6" />
    )}
    <span className="text-sm">
      {processing
        ? "This recording is still processing…"
        : "Nothing to play here yet"}
    </span>
  </div>
);

/** Top bar: Openside branding and a nudge to record your own. */
const SiteHeader = () => (
  <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
    <Link
      to="/"
      className="flex items-center gap-2 transition-opacity hover:opacity-80"
    >
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
      <span className="text-sm font-semibold text-foreground">Openside</span>
    </Link>
    <Link
      to="/dashboard/screen-recorder"
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
    >
      <FiVideo className="size-3.5" />
      <span className="max-sm:hidden">Record your own</span>
      <span className="sm:hidden">Record</span>
    </Link>
  </header>
);

/** Second bar: what this recording is (title and details). */
const RecordingHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

/** Same frame as the page: header, video + Download, comments rail. */
const SharedRecordingSkeleton = () => (
  <div
    aria-label="Loading recording"
    className="flex min-h-screen flex-col bg-[#f9f9fb] dark:bg-[#0f0f11] lg:h-screen lg:min-h-0 lg:overflow-hidden"
  >
    <SiteHeader />
    <RecordingHeader>
      <div className="space-y-1.5">
        <div className="h-4 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-64 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
    </RecordingHeader>
    <div className="grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-0 lg:p-0">
      <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border lg:p-6">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
        <div className="flex items-center justify-end pt-3">
          <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
          <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded-md bg-muted" />
        </div>
      </section>
      <aside className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent">
        <RecordingCommentsSkeleton />
      </aside>
    </div>
  </div>
);

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
  playerRef,
}: {
  token: string;
  outputId: string | null;
  playerRef: Ref<VideoPlayerHandle>;
}) => {
  const { data: url } = useSharedFinalOutputUrl(token, outputId ?? undefined);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border/50">
      {!outputId ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
          <FiVideo className="size-6" />
          <span className="text-sm">Nothing to play yet</span>
        </div>
      ) : url ? (
        <VideoPlayer key={url} ref={playerRef} src={url} />
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
      let result = await fetchSharedFinalOutputDownload(
        token,
        outputId,
        format,
      );
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
    videoItems.push({
      label: "Cloud",
      format: "mp4",
      outputId: track.cloudOutputId,
    });
  }
  if (track.cloudOutputId && track.cloudHasAudio) {
    audioItems.push({
      label: "Cloud",
      format: "mp3",
      outputId: track.cloudOutputId,
    });
  }
  const canDownload = videoItems.length > 0 || audioItems.length > 0;
  const specs = [
    track.durationMs ? formatDuration(track.durationMs) : null,
    // "1080p" names the short side, so a portrait 1080x1920 track is 1080p.
    track.hasVideo && track.width && track.height
      ? Math.min(track.width, track.height) >= 2160
        ? "4K"
        : `${Math.min(track.width, track.height)}p`
      : null,
    track.hasVideo && track.fps ? `${track.fps} fps` : null,
    formatBitrate(track.bitrate),
    track.mimeType?.replace("video/", "").replace("audio/", "").toUpperCase() ??
      null,
  ].filter(Boolean);

  return (
    <div
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors ${
        selected ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
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
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {track.title}
        <span className="mt-0.5 block truncate text-xs font-normal text-fg-subtle">
          {specs.join(" · ")}
        </span>
      </p>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={downloading || !canDownload}
            onClick={(event) => event.stopPropagation()}
            className="group/trigger flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-muted pl-3 pr-2 text-xs font-medium text-foreground transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:opacity-80 cursor-pointer"
          >
            {downloading ? (
              <FiLoader className="size-3.5 animate-spin" />
            ) : (
              <LuDownload className="size-3.5" />
            )}
            {downloading ? "Preparing" : "Download"}
            <LuChevronDown className="size-3.5 text-fg-muted transition-transform duration-150 group-data-[state=open]/trigger:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-52 rounded-xl border-border bg-background p-1.5"
        >
          {(
            [
              ["Video", videoItems],
              ["Audio", audioItems],
            ] as const
          ).map(
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
                      onClick={(event) =>
                        void handleDownload(event, item.outputId, item.format)
                      }
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
  const [selectedSpaceTrackId, setSelectedSpaceTrackId] = useState<
    string | null
  >(null);
  const { isSignedIn } = useClerkAuth();
  const playerRef = useRef<VideoPlayerHandle>(null);
  // The rail beside the video: comments for a screen recording, tracks for a
  // Space recording. Each remembers its own width.
  const commentsRail = useCommentsRailResizer();
  const tracksRail = useCommentsRailResizer({
    storageKey: "openside:tracks-rail-width",
    label: "Resize tracks",
    defaultWidth: 560,
    minWidth: 380,
    maxWidth: 900,
  });
  const { data: rec, isLoading, isError } = useSharedRecording(token);
  const { data: comments, isLoading: areCommentsLoading } =
    useSharedComments(token);
  const createComment = useCreateSharedComment(token);
  const editComment = useEditRecordingComment(["shared-comments", token]);
  const deleteComment = useDeleteRecordingComment(["shared-comments", token]);
  const { data: me } = useGetMe();
  const isOwnComment = (comment: RecordingComment) =>
    !!me && comment.user?.id === me.id;
  useRealtimeRecordingComments(token, "shared");
  useRecordSharedView(token, !!rec);

  if (isLoading) return <SharedRecordingSkeleton />;

  if (isError || !rec) {
    return (
      <>
        <PageTitle title="Recording unavailable" />
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <FiVideo className="size-7 text-fg-muted" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">
              This link isn't available
            </h1>
            <p className="max-w-sm text-sm text-fg-muted">
              The recording may have been deleted, or its owner turned off
              sharing.
            </p>
          </div>
          <Link
            to="/"
            className="flex h-9 items-center rounded-lg bg-brand px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Go to Openside
          </Link>
        </div>
      </>
    );
  }

  const spaceTracks = rec.tracks ?? [];
  // Camera-only takes have just the camera video.
  const screenVideoKind: ScreenOutputKind | null = rec.kinds.includes("both")
    ? "both"
    : rec.kinds.includes("screen")
      ? "screen"
      : rec.kinds.includes("camera")
        ? "camera"
        : null;
  const recTitle = rec.title || "Untitled recording";
  const isProcessing = rec.status === "STOPPED" || rec.status === "PROCESSING";
  const isSpaceRecording = rec.source === "SPACE";
  const railResizer = isSpaceRecording ? tracksRail : commentsRail;
  const activeSpaceTrackId =
    selectedSpaceTrackId &&
    spaceTracks.some((track) => track.id === selectedSpaceTrackId)
      ? selectedSpaceTrackId
      : (spaceTracks[0]?.id ?? null);

  const screenOutput = screenVideoKind ? rec.outputs?.[screenVideoKind] : null;
  const meta = [
    isSpaceRecording
      ? "Space recording"
      : screenVideoKind === "both"
        ? "Screen + camera"
        : screenVideoKind === "camera"
          ? "Camera"
          : "Screen recording",
    rec.ownerName && `by ${rec.ownerName}`,
    formatDateTime(rec.startedAt),
    screenOutput?.durationMs && formatDuration(screenOutput.durationMs),
    screenOutput?.width &&
      screenOutput.height &&
      `${screenOutput.width}×${screenOutput.height}`,
    screenOutput?.fps && `${screenOutput.fps} fps`,
  ].filter(Boolean);

  return (
    <>
      <PageTitle title={recTitle} />
      {/* Desktop: the viewport is the frame - the left pane scrolls on its own
          and the comments rail runs full height from the headers to the bottom.
          Below lg the panes stack and the page scrolls normally. */}
      <div className="flex min-h-screen flex-col bg-[#f9f9fb] dark:bg-[#0f0f11] lg:h-screen lg:min-h-0 lg:overflow-hidden">
        <SiteHeader />
        <RecordingHeader>
          <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground">
            {recTitle}
          </h1>
          <p className="flex items-center gap-x-2 truncate text-xs text-fg-subtle">
            {meta.map((part, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden>·</span>}
                {part}
              </span>
            ))}
          </p>
        </RecordingHeader>

        <div
          style={railResizer.gridStyle}
          className="relative grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_var(--comments-rail-width)] lg:gap-0 lg:p-0"
        >
          {railResizer.handle}
          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border lg:p-6">
            {isSpaceRecording ? (
              spaceTracks.length === 0 ? (
                <EmptyPlayer processing={isProcessing} />
              ) : (
                <SharedSpacePlayer
                  token={token}
                  outputId={activeSpaceTrackId}
                  playerRef={playerRef}
                />
              )
            ) : screenVideoKind ? (
              <SharedPlayer
                token={token}
                kind={screenVideoKind}
                fileType={screenOutput?.fileType ?? null}
                playerRef={playerRef}
              />
            ) : (
              <EmptyPlayer processing={isProcessing} />
            )}
            <RecordingDescription value={rec.description} />
          </div>

          {isSpaceRecording && (
            // Tracks of this recording, full height beside the player.
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary lg:rounded-none lg:border-0 lg:bg-transparent">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
                <h2 className="text-sm font-semibold text-foreground">
                  Tracks
                </h2>
              </div>
              {spaceTracks.length === 0 ? (
                <p className="px-4 py-6 text-sm text-fg-subtle">
                  {isProcessing
                    ? "Tracks appear here as they finish."
                    : "No tracks to show."}
                </p>
              ) : (
                <div className="flex min-w-0 flex-col divide-y divide-border/50 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[&>*:last-child]:border-b lg:[&>*:last-child]:border-border/50">
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
              )}
            </aside>
          )}

          {!isSpaceRecording && (
            <div className="min-h-[320px] overflow-hidden rounded-2xl border border-border/50 bg-primary [&>section]:bg-primary lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:[&>section]:bg-transparent">
              <RecordingComments
                comments={comments ?? []}
                isLoading={areCommentsLoading}
                // Signed-out visitors have no account to attribute to, so they
                // name themselves; a signed-in one comments as their account.
                askForName={!isSignedIn}
                onSubmit={({ body, authorName, timestampMs, parentId }) =>
                  createComment.mutate({
                    body,
                    authorName,
                    timestampMs,
                    parentId,
                  })
                }
                getTimestampMs={() => {
                  const seconds = playerRef.current?.getTime();
                  return seconds == null ? null : Math.round(seconds * 1000);
                }}
                onSeek={(ms) => playerRef.current?.playFrom(ms / 1000)}
                // Signed-in visitors can edit or remove their own comments.
                onEdit={(commentId, body) =>
                  editComment.mutate({ commentId, body })
                }
                canEdit={isOwnComment}
                onDelete={(commentId) => deleteComment.mutate(commentId)}
                canDelete={isOwnComment}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SharedRecordingPage;
