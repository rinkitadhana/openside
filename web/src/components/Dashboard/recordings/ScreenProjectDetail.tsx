import { useEffect, useRef, useState, type Ref } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiCheck,
  FiChevronLeft,
  FiEdit2,
  FiEye,
  FiLoader,
  FiShare2,
  FiTrash2,
  FiVideo,
} from "react-icons/fi";
import { LuDownload } from "react-icons/lu";
import {
  fetchScreenOutputUrl,
  useCreateScreenComment,
  useDeleteRecordingComment,
  useEditRecordingComment,
  useDeleteScreenRecording,
  useUpdateScreenRecording,
  useScreenComments,
  useScreenOutputUrl,
  useScreenRecordings,
  useShareScreenRecording,
  useUnshareScreenRecording,
  type ScreenOutputKind,
  type ScreenRecording,
} from "@/hooks/useScreenRecordings";
import RecordingDescription from "./RecordingDescription";
import { useCommentsRailResizer } from "@/components/shared/CommentsRailResizer";
import RecordingComments, {
  RecordingCommentsSkeleton,
} from "./RecordingComments";
import VideoPlayer, {
  type VideoPlayerHandle,
} from "@/components/shared/VideoPlayer";
import ShareLinkDialog from "@/components/shared/ShareLinkDialog";
import { toast } from "@/lib/toast";
import { backdropMotion, panelMotion, usePresence } from "@/hooks/usePresence";
import { useRealtimeRecordingComments } from "@/hooks/useRealtimeRecordingComments";
import { useGetMe } from "@/hooks/useUserQuery";
import InlineTitle, {
  type InlineTitleHandle,
} from "@/components/shared/InlineTitle";

/** Public URL a share token resolves to (the SharedRecordingPage route). */
const shareUrlFor = (token: string) =>
  `${window.location.origin}/share/${token}`;

const triggerBrowserDownload = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// 754000 -> "12:34"; null when the length isn't known yet.
const formatClock = (ms?: number) => {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

type ProcessingStage = "recording" | "uploading" | "rendering";

const STAGES: { id: ProcessingStage | "ready"; label: string }[] = [
  { id: "recording", label: "Recorded" },
  { id: "uploading", label: "Uploaded" },
  { id: "rendering", label: "Rendered" },
  { id: "ready", label: "Ready" },
];

const STAGE_COPY: Record<ProcessingStage, { title: string; detail: string }> = {
  recording: {
    title: "Still recording",
    detail: "This take is live. It'll start processing once you stop.",
  },
  uploading: {
    title: "Finishing the upload",
    detail: "Sending the last pieces of your recording.",
  },
  rendering: {
    title: "Rendering your video",
    detail: "Putting your screen, camera and audio together.",
  },
};

// The server exposes no finalize progress, so estimate it from the time since
// the take stopped on an easing curve scaled to the take's length (longer
// takes render longer). Capped per stage so the bar never claims completion
// before the video exists.
const estimateProgress = (
  stage: ProcessingStage,
  stoppedAt: string | null,
  lengthMs: number,
  now: number,
) => {
  if (stage === "recording" || !stoppedAt) return 0;
  const elapsed = Math.max(0, now - new Date(stoppedAt).getTime());
  const tau = Math.max(15_000, lengthMs * 0.4);
  const cap = stage === "rendering" ? 0.95 : 0.35;
  return Math.round(Math.min(cap, 1 - Math.exp(-elapsed / tau)) * 100);
};

const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

// Stand-in for the player while the video is still being made: where it's
// at, a progress estimate, and that it's fine to leave.
const ProcessingStagePanel = ({ rec }: { rec: ScreenRecording }) => {
  const now = useNow(1000);
  const stage: ProcessingStage =
    rec.status === "ACTIVE"
      ? "recording"
      : rec.status === "STOPPED"
        ? "uploading"
        : "rendering";
  const stageIndex = STAGES.findIndex((item) => item.id === stage);
  const lengthMs = rec.stoppedAt
    ? new Date(rec.stoppedAt).getTime() - new Date(rec.startedAt).getTime()
    : now - new Date(rec.startedAt).getTime();
  const percent = estimateProgress(stage, rec.stoppedAt, lengthMs, now);
  const length = formatClock(lengthMs);
  const copy = STAGE_COPY[stage];

  return (
    <div className="relative flex aspect-video w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-primary px-6 ring-1 ring-border/50">
      {/* Slow sheen so the panel reads as working, not frozen. */}
      <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-transparent via-foreground/[0.03] to-transparent" />

      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-background ring-1 ring-border/60">
          {stage === "recording" ? (
            <span className="size-3 animate-pulse rounded-full bg-red-500" />
          ) : (
            <FiLoader className="size-6 animate-spin text-fg-muted" />
          )}
        </span>
        <p className="mt-4 text-base font-semibold text-foreground">
          {copy.title}
        </p>
        <p className="mt-1 text-sm text-fg-subtle">{copy.detail}</p>

        {stage !== "recording" && (
          <div className="mt-5 flex w-full items-center gap-3">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground/70 transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.max(4, percent)}%` }}
              />
            </span>
            <span className="w-9 text-right text-xs font-medium tabular-nums text-fg-muted">
              {percent}%
            </span>
          </div>
        )}

        <ol className="mt-6 flex w-full items-center">
          {STAGES.map((item, index) => {
            const isDone = index < stageIndex;
            const isCurrent = index === stageIndex;
            return (
              <li
                key={item.id}
                className="flex flex-1 items-center last:flex-none"
              >
                <span className="flex flex-col items-center gap-1.5">
                  <span
                    className={
                      isDone
                        ? "flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                        : isCurrent
                          ? "flex size-5 items-center justify-center rounded-full ring-2 ring-foreground/70"
                          : "flex size-5 items-center justify-center rounded-full ring-1 ring-border"
                    }
                  >
                    {isDone ? (
                      <FiCheck className="size-3" strokeWidth={3} />
                    ) : isCurrent ? (
                      <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
                    ) : null}
                  </span>
                  <span
                    className={
                      isDone || isCurrent
                        ? "text-[11px] font-medium text-foreground"
                        : "text-[11px] text-fg-subtle"
                    }
                  >
                    {item.label}
                  </span>
                </span>
                {index < STAGES.length - 1 && (
                  <span
                    className={
                      isDone
                        ? "mx-2 mb-5 h-px flex-1 bg-foreground/60"
                        : "mx-2 mb-5 h-px flex-1 bg-border"
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-6 text-xs text-fg-subtle">
          {length && <>{length} long · </>}
          You can leave this page - it keeps going in the background.
        </p>
      </div>
    </div>
  );
};

// The project exposes one finished screen video. Prefer the composed output
// (screen + camera) and fall back to screen-only when no camera was recorded.
const ScreenVideoCard = ({
  rec,
  kind,
  playerRef,
}: {
  rec: ScreenRecording;
  kind: ScreenOutputKind;
  playerRef: Ref<VideoPlayerHandle>;
}) => {
  const [downloading, setDownloading] = useState(false);
  const { data: url } = useScreenOutputUrl(rec.id, kind);
  // The container, read off the stored key (e.g. ".../both.mp4" -> "mp4").
  const fileType = /\.(\w+)$/.exec(rec.outputs?.[kind]?.key ?? "")?.[1];

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const downloadUrl = await fetchScreenOutputUrl(rec.id, kind, true);
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
        {kind === "preview" && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            Preview · not final
          </span>
        )}
      </div>
      {/* The preview is a stand-in - download the final video once it's in. */}
      {kind !== "preview" && (
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
      )}
    </div>
  );
};

/**
 * Share dialog. Opening it mints the link on first use (the mutation is
 * idempotent server-side, so re-opening never invalidates a link already sent).
 * "Stop sharing" revokes it, and any URL already handed out dies at once.
 */
const ShareDialog = ({
  rec,
  onClose,
  isClosing,
}: {
  rec: ScreenRecording;
  onClose: () => void;
  isClosing: boolean;
}) => {
  const share = useShareScreenRecording();
  const unshare = useUnshareScreenRecording();
  const token = rec.shareToken;

  return (
    <ShareLinkDialog
      recordingTitle={rec.title ?? undefined}
      url={token ? shareUrlFor(token) : null}
      accessNote="watch this recording and leave comments"
      isStopping={unshare.isPending}
      onCreate={() =>
        share.mutate(rec.id, {
          onError: () => {
            toast.error("Couldn't create a share link.");
            onClose();
          },
        })
      }
      onStop={() => unshare.mutate(rec.id, { onSuccess: onClose })}
      onClose={onClose}
      isClosing={isClosing}
    />
  );
};

const ScreenProjectDetailSkeleton = () => (
  <div
    aria-label="Loading recording project"
    className="-m-4 flex flex-col lg:h-[calc(100%+2rem)] lg:min-h-0"
  >
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border pl-2 pr-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
        <div className="min-w-0 space-y-1.5">
          <div className="h-4 w-44 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-64 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
      </div>
      {/* Views, Share, Rename, Delete */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="mr-2 h-4 w-16 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
    <div className="grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-0 lg:p-0">
      {/* Video: player + Download */}
      <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border lg:p-6">
        <div className="flex w-full flex-col">
          <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
          <div className="flex items-center justify-end pt-3">
            <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
            <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      </section>

      <aside className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent">
        <RecordingCommentsSkeleton />
      </aside>
    </div>
  </div>
);

const ScreenProjectDetail = ({ sessionId }: { sessionId: string }) => {
  const navigate = useNavigate();
  const titleRef = useRef<InlineTitleHandle>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const railResizer = useCommentsRailResizer();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Keep each dialog mounted through its exit animation.
  const deleteDialog = usePresence(deleteConfirmOpen);
  const shareDialog = usePresence(shareOpen);

  // The list query already carries everything the detail needs (title, status,
  // outputs) and keeps polling while the recording is still processing.
  const { data: recordings, isLoading, isError } = useScreenRecordings();
  const updateRecording = useUpdateScreenRecording();
  const deleteRecording = useDeleteScreenRecording();
  const { data: comments, isLoading: areCommentsLoading } =
    useScreenComments(sessionId);
  const createComment = useCreateScreenComment(sessionId);
  const deleteComment = useDeleteRecordingComment([
    "screen-comments",
    sessionId,
  ]);
  const editComment = useEditRecordingComment(["screen-comments", sessionId]);
  const { data: me } = useGetMe();
  const rec = recordings?.find((recording) => recording.id === sessionId);
  // The owner joins the same verified stream as public viewers when sharing is
  // active, so incoming comments land in this panel without a refresh.
  useRealtimeRecordingComments(rec?.shareToken, "screen", sessionId);

  // Watching it process? Say so when the video lands.
  const prevStatusRef = useRef(rec?.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = rec?.status;
    if (rec?.status === "READY" && prev && prev !== "READY") {
      toast.success("Your recording is ready");
    }
  }, [rec?.status]);

  if (isLoading) return <ScreenProjectDetailSkeleton />;

  if (!rec) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group flex h-9 w-fit items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="rounded-2xl border border-dashed border-border bg-primary/60 px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {isError ? "Couldn't load this recording" : "Recording not found"}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {isError
              ? "Check your connection and try again."
              : "It may have been deleted or you may no longer have access."}
          </p>
        </div>
      </div>
    );
  }

  const outputs = rec.outputs ?? {};
  // Camera-only takes have just the camera video.
  const screenVideoKind: ScreenOutputKind | null = outputs.both?.key
    ? "both"
    : outputs.screen?.key
      ? "screen"
      : outputs.camera?.key
        ? "camera"
        : null;
  const screenVideoOutput = screenVideoKind
    ? rec.outputs?.[screenVideoKind]
    : undefined;
  const recTitle = rec.title || "Untitled recording";
  const isProcessing =
    rec.status === "ACTIVE" ||
    rec.status === "STOPPED" ||
    rec.status === "PROCESSING";
  const isFailed = rec.status === "FAILED" && !screenVideoKind;
  // A quick copy of the capture to watch while the final video renders.
  const showPreview =
    isProcessing && !screenVideoKind && !!outputs.preview?.key;

  const handleDelete = () => {
    // Optimistic: the hook drops it from the cached list right away, so leave
    // for the library immediately and let the request finish in the background
    // (it rolls the card back and toasts if the server rejects it).
    setDeleteConfirmOpen(false);
    navigate("/dashboard/project");
    deleteRecording.mutate(rec.id);
  };

  return (
    <>
      {/* Two-pane on desktop: the page itself never scrolls (it's exactly the
          height of its container), the left pane scrolls on its own, and the
          comments rail runs flush from the header to the bottom edge - hence lg:p-0 on the grid, with each pane owning its own spacing. Below lg
          the panes stack and the page scrolls normally. -m-4 cancels the
          wrapper's p-4 so the header spans edge to edge like the dashboard
          header above it. */}
      <div className="-m-4 flex flex-col lg:h-[calc(100%+2rem)] lg:min-h-0">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border pl-2 pr-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/project")}
              aria-label="Back to all projects"
              title="All projects"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-opacity hover:opacity-80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <FiChevronLeft className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold leading-tight text-foreground">
                <InlineTitle
                  ref={titleRef}
                  value={recTitle}
                  // Optimistic: the hook retitles the cached list instantly.
                  onSave={(next) =>
                    updateRecording.mutate({ sessionId: rec.id, title: next })
                  }
                  className="truncate"
                />
              </h1>
              <p className="flex items-center gap-x-2 truncate text-xs text-fg-subtle">
                {[
                  showPreview
                    ? "Preview · final video processing"
                    : screenVideoKind === "both"
                      ? "Screen + camera"
                      : screenVideoKind === "camera"
                        ? "Camera"
                        : "Screen recording",
                  rec.startedAt &&
                    new Date(rec.startedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
                  screenVideoKind &&
                    formatClock(rec.outputs?.[screenVideoKind]?.durationMs),
                  screenVideoOutput?.width &&
                    screenVideoOutput.height &&
                    `${screenVideoOutput.width}×${screenVideoOutput.height}`,
                  screenVideoOutput?.fps && `${screenVideoOutput.fps} fps`,
                ]
                  .filter(Boolean)
                  .map((part, index) => (
                    <span key={index} className="flex items-center gap-2">
                      {index > 0 && <span aria-hidden>·</span>}
                      {part}
                    </span>
                  ))}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label="Recording actions"
            className="flex shrink-0 items-center gap-2"
          >
            {/* Views only exist once there's a share link to open. */}
            {rec.shareToken && (
              <span className="mr-2 flex h-9 items-center gap-1.5 px-1 text-sm text-fg-muted">
                <FiEye className="size-3.5" />
                {rec.viewCount ?? 0} {rec.viewCount === 1 ? "view" : "views"}
              </span>
            )}
            {screenVideoKind && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-80 cursor-pointer ${
                  rec.shareToken
                    ? "bg-success/10 text-success"
                    : "bg-muted text-foreground"
                }`}
              >
                <FiShare2 className="size-3.5" />
                {rec.shareToken ? "Shared" : "Share"}
              </button>
            )}
            <button
              type="button"
              onClick={() => titleRef.current?.edit()}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-80 cursor-pointer"
            >
              <FiEdit2 className="size-3.5" />
              Rename
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-danger/10 px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/15 cursor-pointer"
            >
              <FiTrash2 className="size-3.5" />
              Delete
            </button>
          </div>
        </header>

        <div
          style={railResizer.gridStyle}
          className="relative grid gap-6 px-6 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_var(--comments-rail-width)] lg:gap-0 lg:p-0"
        >
          {railResizer.handle}
          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border lg:p-6">
            {showPreview ? (
              <section className="flex flex-col gap-3">
                <p className="flex items-start gap-2.5 rounded-xl bg-primary px-3.5 py-3 text-sm text-fg-muted ring-1 ring-border/50">
                  <FiLoader className="mt-0.5 size-4 shrink-0 animate-spin" />
                  <span>
                    <span className="font-medium text-foreground">
                      This is a quick preview, not the final video.
                    </span>{" "}
                    The final video is still being made and will replace this
                    automatically when it's ready.
                  </span>
                </p>
                <ScreenVideoCard
                  rec={rec}
                  kind="preview"
                  playerRef={playerRef}
                />
              </section>
            ) : isProcessing && !screenVideoKind ? (
              <section className="flex flex-col gap-4">
                <ProcessingStagePanel rec={rec} />
              </section>
            ) : isFailed ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/50 bg-primary/60 py-20 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-background text-danger">
                  <FiVideo className="size-6" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Processing failed
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Delete this recording and try again.
                  </p>
                </div>
              </div>
            ) : (
              <section className="flex flex-col gap-4">
                {screenVideoKind ? (
                  <ScreenVideoCard
                    rec={rec}
                    kind={screenVideoKind}
                    playerRef={playerRef}
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-border/50 bg-primary/60 text-sm text-fg-muted">
                    Screen video unavailable
                  </div>
                )}
              </section>
            )}
            <RecordingDescription
              value={rec.description}
              onSave={(next) =>
                updateRecording.mutate({ sessionId: rec.id, description: next })
              }
            />
          </div>
          <div className="min-h-[320px] overflow-hidden rounded-2xl border border-border/50 bg-primary [&>section]:bg-primary lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:[&>section]:bg-transparent">
            <RecordingComments
              comments={comments ?? []}
              isLoading={areCommentsLoading}
              onSubmit={({ body, timestampMs, parentId }) =>
                createComment.mutate({ body, timestampMs, parentId })
              }
              getTimestampMs={() => {
                const seconds = playerRef.current?.getTime();
                return seconds == null ? null : Math.round(seconds * 1000);
              }}
              onSeek={(ms) => playerRef.current?.playFrom(ms / 1000)}
              onEdit={(commentId, body) =>
                editComment.mutate({ commentId, body })
              }
              canEdit={(comment) => !!me && comment.user?.id === me.id}
              onDelete={(commentId) => deleteComment.mutate(commentId)}
              // The recording's owner is viewing, so every comment is theirs to
              // moderate.
              canDelete={() => true}
            />
          </div>
        </div>
      </div>
      {shareDialog.rendered && (
        <ShareDialog
          rec={rec}
          onClose={() => setShareOpen(false)}
          isClosing={shareDialog.isClosing}
        />
      )}
      {deleteDialog.rendered && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm ${backdropMotion(deleteDialog.isClosing)}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-screen-recording-title"
          aria-describedby="delete-screen-recording-description"
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            className={`w-full max-w-[420px] rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 dark:bg-[#0f0f11] ${panelMotion(deleteDialog.isClosing)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-screen-recording-title"
              className="text-base font-semibold text-foreground"
            >
              Delete this recording?
            </h2>
            <p
              id="delete-screen-recording-description"
              className="mt-1.5 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">{recTitle}</span>{" "}
              and its recorded media will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="h-9 rounded-lg bg-muted px-3.5 text-sm font-medium text-foreground transition-opacity hover:opacity-80 cursor-pointer"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="h-9 rounded-lg bg-danger px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 cursor-pointer"
              >
                Delete recording
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ScreenProjectDetail;
