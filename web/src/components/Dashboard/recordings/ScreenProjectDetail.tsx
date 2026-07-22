import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronLeft,
  FiCheck,
  FiCopy,
  FiEdit2,
  FiLink,
  FiLoader,
  FiMonitor,
  FiShare2,
  FiTrash2,
  FiVideo,
} from "react-icons/fi";
import { LuDownload, LuLayoutGrid, LuMonitor, LuPlay, LuVideo } from "react-icons/lu";
import {
  fetchScreenOutputUrl,
  useCreateScreenComment,
  useDeleteScreenComment,
  useDeleteScreenRecording,
  useRenameScreenRecording,
  useScreenComments,
  useScreenOutputUrl,
  useScreenRecordings,
  useShareScreenRecording,
  useUnshareScreenRecording,
  type ScreenOutputKind,
  type ScreenRecording,
} from "@/hooks/useScreenRecordings";
import { useEntitlements } from "@/hooks/useUsage";
import { formatRetentionRemaining, retentionExpiryMs } from "@/lib/retention";
import RecordingComments from "./RecordingComments";
import { useRealtimeRecordingComments } from "@/hooks/useRealtimeRecordingComments";

/** Public URL a share token resolves to (the SharedRecordingPage route). */
export const shareUrlFor = (token: string) =>
  `${window.location.origin}/share/${token}`;

const KIND_LABEL: Record<ScreenOutputKind, string> = {
  both: "Screen + Camera",
  screen: "Screen",
  screenAligned: "Aligned screen",
  camera: "Camera",
};
// "screenAligned" is intentionally omitted: the backend points it at the same
// file as "screen", so it would show a duplicate track.
const KIND_ORDER: ScreenOutputKind[] = ["both", "screen", "camera"];

const KIND_ICON: Record<ScreenOutputKind, typeof LuVideo> = {
  both: LuLayoutGrid,
  screen: LuMonitor,
  screenAligned: LuMonitor,
  camera: LuVideo,
};

const formatDay = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

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

const formatDuration = (ms?: number | null) => {
  if (!ms || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const triggerBrowserDownload = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// Small player above the track list, same shell as the space TrackPlayer. The
// output plays in its native format (mp4 for CFR masters, webm for legacy).
const ScreenTrackPlayer = ({
  sessionId,
  kind,
}: {
  sessionId: string;
  kind: ScreenOutputKind | null;
}) => {
  const { data: url } = useScreenOutputUrl(sessionId, kind ?? undefined);
  return (
    <div className="relative aspect-video w-full max-w-2xl self-start overflow-hidden rounded-lg bg-black ring-1 ring-border">
      {!kind ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
          <FiVideo className="size-6" />
          <span className="text-sm">Select a track to play it here</span>
        </div>
      ) : url ? (
        <video key={kind} src={url} controls playsInline className="h-full w-full" />
      ) : (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
          <FiLoader className="size-4 animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
};

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

// One output track row - mirrors the space OutputCard: thumbnail with a play
// affordance, title + stats line, and a Download button on the right.
const ScreenTrackRow = ({
  rec,
  kind,
  selected,
  onSelect,
}: {
  rec: ScreenRecording;
  kind: ScreenOutputKind;
  selected: boolean;
  onSelect: () => void;
}) => {
  const [downloading, setDownloading] = useState(false);
  const { data: thumbnailUrl } = useScreenOutputUrl(rec.id, kind);
  const KindIcon = KIND_ICON[kind];
  const durationMs = rec.outputs?.[kind]?.durationMs;
  const recordedAt = formatDateTime(rec.startedAt || rec.createdAt);

  const { data: entitlements } = useEntitlements();
  const deletesIn = formatRetentionRemaining(
    retentionExpiryMs(
      rec.stoppedAt ?? rec.startedAt ?? rec.createdAt,
      entitlements?.retentionHours,
    ),
  );

  const handleDownload = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await fetchScreenOutputUrl(rec.id, kind, true);
      triggerBrowserDownload(url);
    } catch {
      // Download failed; the button simply re-enables.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors ${
        selected
          ? "border-foreground/25 bg-muted"
          : "border-border bg-primary hover:border-foreground/20"
      }`}
    >
      <span className="relative flex aspect-[4/3] h-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted ring-1 ring-border">
        <KindIcon className="size-5 text-foreground/60" />
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
        {selected ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <NowPlayingBars />
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
            <LuPlay className="size-4 fill-white text-white" />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {KIND_LABEL[kind]}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-foreground/45">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-emerald-500">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Ready
          </span>
          {!!durationMs && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-foreground/25">·</span>
              <span className="tabular-nums">{formatDuration(durationMs)}</span>
            </span>
          )}
          {recordedAt && (
            <span className="hidden items-center gap-1.5 whitespace-nowrap sm:inline-flex">
              <span className="text-foreground/25">·</span>
              <span>{recordedAt}</span>
            </span>
          )}
          {deletesIn && (
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
              title="This recording auto-deletes when it reaches your plan's retention window."
            >
              <span className="text-foreground/25">·</span>
              <span className="text-amber-500/80">deletes in {deletesIn}</span>
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={downloading}
        onClick={(event) => void handleDownload(event)}
        className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {downloading ? (
          <FiLoader className="size-4 animate-spin" />
        ) : (
          <LuDownload className="size-4 text-foreground/60" />
        )}
        {downloading ? "Preparing" : "Download"}
      </button>
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
}: {
  rec: ScreenRecording;
  onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const share = useShareScreenRecording();
  const unshare = useUnshareScreenRecording();
  const token = rec.shareToken;
  const url = token ? shareUrlFor(token) : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked - the input is selectable so it can be copied by hand.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-recording-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-xl border border-border bg-background p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="share-recording-title"
          className="text-lg font-semibold text-foreground"
        >
          Share this recording
        </h2>
        <p className="mt-2 text-sm leading-6 text-foreground/60">
          {token
            ? "Anyone with this link can watch this recording and leave comments. No account needed."
            : "Create a link that lets anyone watch this recording and leave comments. No account needed."}
        </p>

        {token ? (
          <>
            <div className="mt-4 flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-primary px-3 py-2 text-sm text-foreground/80 outline-none"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-semibold text-background transition-opacity hover:opacity-85"
              >
                {copied ? (
                  <FiCheck className="size-4" />
                ) : (
                  <FiCopy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-6 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => unshare.mutate(rec.id)}
                disabled={unshare.isPending}
                className="flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unshare.isPending && (
                  <FiLoader className="size-4 animate-spin" />
                )}
                Stop sharing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => share.mutate(rec.id)}
              disabled={share.isPending}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {share.isPending ? (
                <FiLoader className="size-4 animate-spin" />
              ) : (
                <FiLink className="size-4" />
              )}
              Create link
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ScreenProjectDetailSkeleton = () => (
  <div
    aria-label="Loading recording project"
    className="flex flex-col gap-6 p-2 lg:h-full lg:min-h-0 lg:gap-0 lg:pb-0"
  >
    <div className="h-9 w-28 animate-pulse rounded-md bg-foreground/10" />
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-call-border pb-6 lg:mb-0 lg:mt-6">
      <div className="min-w-0 space-y-2">
        <div className="h-6 w-52 animate-pulse rounded bg-foreground/10" />
        <div className="h-3 w-36 animate-pulse rounded bg-foreground/10" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="h-9 w-24 animate-pulse rounded-md bg-foreground/10" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-foreground/10" />
      </div>
    </div>
    <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-0">
      <section className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-6 lg:pt-5">
        <div className="aspect-video w-full max-w-2xl animate-pulse rounded-lg bg-foreground/10" />
        <div className="h-4 w-16 animate-pulse rounded bg-foreground/10" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-lg border border-border bg-primary px-2.5 py-1.5"
            >
              <div className="aspect-[4/3] h-14 shrink-0 animate-pulse rounded bg-foreground/10" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-foreground/10" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="flex min-h-[320px] flex-col gap-4 border-t border-call-border p-3 lg:min-h-0 lg:border-t-0 lg:border-l">
        <div className="h-4 w-20 animate-pulse rounded bg-foreground/10" />
        <div className="flex flex-1 flex-col gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-2.5">
              <div className="size-7 shrink-0 animate-pulse rounded-full bg-foreground/10" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3 w-24 animate-pulse rounded bg-foreground/10" />
                <div className="h-3 w-full animate-pulse rounded bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-call-border pt-3">
          <div className="h-20 animate-pulse rounded-md bg-foreground/10" />
          <div className="mt-2 h-9 animate-pulse rounded-md bg-foreground/10" />
        </div>
      </aside>
    </div>
  </div>
);

const ScreenProjectDetail = ({ sessionId }: { sessionId: string }) => {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedKind, setSelectedKind] = useState<ScreenOutputKind | null>(
    null,
  );

  // The list query already carries everything the detail needs (title, status,
  // outputs) and keeps polling while the recording is still processing.
  const { data: recordings, isLoading, isError } = useScreenRecordings();
  const renameRecording = useRenameScreenRecording();
  const deleteRecording = useDeleteScreenRecording();
  const { data: comments, isLoading: areCommentsLoading } =
    useScreenComments(sessionId);
  const createComment = useCreateScreenComment(sessionId);
  const deleteComment = useDeleteScreenComment(sessionId);
  const rec = recordings?.find((recording) => recording.id === sessionId);
  // The owner joins the same verified stream as public viewers when sharing is
  // active, so incoming comments land in this panel without a refresh.
  useRealtimeRecordingComments(rec?.shareToken, "screen", sessionId);

  if (isLoading) return <ScreenProjectDetailSkeleton />;

  if (!rec) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group flex h-9 w-fit items-center gap-2 rounded-md border border-call-border bg-call-primary px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="rounded-xl border border-dashed border-call-border bg-call-primary/40 px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {isError ? "Couldn't load this recording" : "Recording not found"}
          </p>
          <p className="mt-1 text-xs text-foreground/45">
            {isError
              ? "Check your connection and try again."
              : "It may have been deleted or you may no longer have access."}
          </p>
        </div>
      </div>
    );
  }

  const outputs = rec.outputs ?? {};
  const kinds = KIND_ORDER.filter((kind) => outputs[kind]?.key);
  const activeKind =
    selectedKind && kinds.includes(selectedKind)
      ? selectedKind
      : (kinds[0] ?? null);
  const recTitle = rec.title || "Untitled recording";
  const isProcessing =
    rec.status === "STOPPED" || rec.status === "PROCESSING";
  const isFailed = rec.status === "FAILED" && kinds.length === 0;

  const openRename = () => {
    setTitle(recTitle);
    setRenaming(true);
  };

  const submitRename = () => {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === recTitle) return;
    // Optimistic: the hook retitles the cached list instantly.
    renameRecording.mutate({ sessionId: rec.id, title: next });
  };

  const handleDelete = () => {
    deleteRecording.mutate(rec.id);
    setDeleteConfirmOpen(false);
    navigate("/dashboard/project");
  };

  return (
    <>
      {/* Two-pane on desktop: the page itself never scrolls (it's exactly the
          height of its container), the left pane scrolls on its own, and the
          comments rail runs flush from the header to the bottom edge - hence
          lg:gap-0 + lg:pb-0, with each pane owning its own spacing. Below lg
          the panes stack and the page scrolls normally. */}
      <div className="flex flex-col gap-6 p-2 lg:h-full lg:min-h-0 lg:gap-0 lg:pb-0">
        <button
          type="button"
          onClick={() => navigate("/dashboard/project")}
          className="group flex h-9 w-fit shrink-0 items-center gap-2 rounded-md border border-call-border bg-call-primary px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 lg:mb-6"
        >
          <FiChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </button>
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-call-border pb-6">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {recTitle}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground/45">
              <span className="inline-flex items-center gap-1">
                <FiMonitor className="size-3" />
                Screen recording
              </span>
              {rec.startedAt && (
                <>
                  <span>·</span>
                  <span>Recorded {formatDay(rec.startedAt)}</span>
                </>
              )}
            </p>
          </div>
          <div
            role="group"
            aria-label="Recording actions"
            className="flex shrink-0 items-center gap-2"
          >
            <button
              type="button"
              onClick={openRename}
              className="flex h-9 items-center gap-1.5 rounded-md border border-call-border bg-call-primary px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
            >
              <FiEdit2 className="size-4" />
              Rename
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 ${
                rec.shareToken
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-call-border bg-call-primary text-foreground"
              }`}
            >
              <FiShare2 className="size-4" />
              {rec.shareToken ? "Shared" : "Share"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteRecording.isPending}
              className="flex h-9 items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 px-3 text-sm font-medium text-red-500 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteRecording.isPending ? (
                <FiLoader className="size-4 animate-spin" />
              ) : (
                <FiTrash2 className="size-4" />
              )}
              Delete
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-0">
          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-6 lg:pt-5">
            {isProcessing && kinds.length === 0 ? (
              <section className="flex flex-col gap-4">
                <div className="relative flex aspect-video w-full max-w-2xl flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-black text-white/60 ring-1 ring-border">
                  <FiLoader className="size-6 animate-spin" />
                  <span className="text-sm">Processing your recording…</span>
                  <span className="px-6 text-center text-xs text-white/40">
                    Tracks become playable as they finish. You can leave this
                    page and it keeps going.
                  </span>
                </div>
              </section>
            ) : isFailed ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-call-border bg-call-primary/40 py-20 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-call-background text-red-400">
                  <FiVideo className="size-6" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Processing failed
                  </p>
                  <p className="text-xs text-foreground/45">
                    Delete this recording and try again.
                  </p>
                </div>
              </div>
            ) : (
              <section className="flex flex-col gap-4">
                <ScreenTrackPlayer sessionId={rec.id} kind={activeKind} />
                <h3 className="text-sm font-semibold text-foreground/80">
                  Tracks
                </h3>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {kinds.map((kind) => (
                    <ScreenTrackRow
                      key={kind}
                      rec={rec}
                      kind={kind}
                      selected={kind === activeKind}
                      onSelect={() => setSelectedKind(kind)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="min-h-[320px] lg:h-full lg:min-h-0 lg:border-l lg:border-call-border">
            <RecordingComments
              comments={comments ?? []}
              isLoading={areCommentsLoading}
              isPosting={createComment.isPending}
              onSubmit={({ body }) => createComment.mutate(body)}
              onDelete={(commentId) => deleteComment.mutate(commentId)}
              // The recording's owner is viewing, so every comment is theirs to
              // moderate.
              canDelete={() => true}
            />
          </div>
        </div>
      </div>
      {shareOpen && <ShareDialog rec={rec} onClose={() => setShareOpen(false)} />}
      {renaming && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setRenaming(false)}
        >
          <div
            className="w-full max-w-[380px] rounded-lg border border-border bg-background p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-foreground">
              Rename recording
            </h2>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
                if (event.key === "Escape") setRenaming(false);
              }}
              maxLength={120}
              placeholder="Recording name"
              className="mt-4 w-full rounded-md border border-border bg-primary px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={!title.trim()}
                className="rounded-md bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-screen-recording-title"
          aria-describedby="delete-screen-recording-description"
          onClick={() => {
            if (!deleteRecording.isPending) setDeleteConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-[420px] rounded-xl border border-border bg-background p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-screen-recording-title"
              className="text-lg font-semibold text-foreground"
            >
              Delete this recording?
            </h2>
            <p
              id="delete-screen-recording-description"
              className="mt-2 text-sm leading-6 text-foreground/60"
            >
              <span className="font-medium text-foreground">{recTitle}</span>{" "}
              and all of its tracks will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteRecording.isPending}
                className="rounded-md border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteRecording.isPending}
                className="rounded-md bg-red-500 px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
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
