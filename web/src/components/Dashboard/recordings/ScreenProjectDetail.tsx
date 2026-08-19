import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronLeft,
  FiCheck,
  FiCopy,
  FiEdit2,
  FiLink,
  FiLoader,
  FiMoreHorizontal,
  FiShare2,
  FiTrash2,
  FiVideo,
} from "react-icons/fi";
import { LuDownload } from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
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
import RecordingComments from "./RecordingComments";
import { useRealtimeRecordingComments } from "@/hooks/useRealtimeRecordingComments";

/** Public URL a share token resolves to (the SharedRecordingPage route). */
export const shareUrlFor = (token: string) =>
  `${window.location.origin}/share/${token}`;

const formatDay = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

const triggerBrowserDownload = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// The project exposes one finished screen video. Prefer the composed output
// (screen + camera) and fall back to screen-only when no camera was recorded.
const ScreenVideoCard = ({
  rec,
  kind,
  onShare,
}: {
  rec: ScreenRecording;
  kind: ScreenOutputKind;
  onShare: () => void;
}) => {
  const [downloading, setDownloading] = useState(false);
  const { data: url } = useScreenOutputUrl(rec.id, kind);

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
    <div className="w-full self-start overflow-hidden rounded-2xl border border-border bg-primary p-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
        {url ? (
          <video src={url} controls playsInline className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
            <FiLoader className="size-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-1 pb-1 pt-3">
        <button
          type="button"
          onClick={onShare}
          className={`flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
            rec.shareToken
              ? "border-success/25 bg-success/10 text-success"
              : "border-border bg-background text-foreground"
          }`}
        >
          <FiShare2 className="size-4" />
          {rec.shareToken ? "Shared" : "Share"}
        </button>
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
        className="w-full max-w-[460px] rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-fg-muted ring-1 ring-border">
          <FiLink className="size-4.5" />
        </span>
        <h2
          id="share-recording-title"
          className="mt-3 text-lg font-semibold text-foreground"
        >
          Share this recording
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-fg-muted">
          {token
            ? "Anyone with this link can watch this recording and leave comments. No account needed."
            : "Create a link that lets anyone watch this recording and leave comments. No account needed."}
        </p>

        {token ? (
          <>
            <div className="mt-4 flex items-center gap-1.5 rounded-lg border border-border bg-primary p-1.5 pl-3">
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent text-sm text-fg-muted outline-none"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
                  copied
                    ? "bg-success/10 text-success"
                    : "bg-foreground text-background hover:opacity-85"
                }`}
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
                className="flex items-center gap-1.5 rounded-lg border border-danger/25 bg-danger/10 px-3.5 py-2 text-sm font-medium text-danger transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unshare.isPending && (
                  <FiLoader className="size-4 animate-spin" />
                )}
                Stop sharing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
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
              className="rounded-lg border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => share.mutate(rec.id)}
              disabled={share.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
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
    className="flex flex-col gap-6 px-2 pb-2 pt-0 lg:h-full lg:min-h-0 lg:gap-0 lg:pb-0"
  >
    <div className="-mx-6 -mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-3 lg:mb-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="size-8 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 w-px bg-border" />
        <div className="min-w-0 space-y-2">
          <div className="h-6 w-52 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-36 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="size-9 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
    <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pt-5">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
        <div className="flex justify-end gap-2 rounded-xl bg-primary px-1 py-2">
          <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
      </section>

      <aside className="flex min-h-[320px] flex-col gap-4 rounded-2xl border border-border bg-primary p-3 lg:my-5 lg:min-h-0">
        <div className="h-4 w-20 animate-pulse rounded-md bg-muted" />
        <div className="flex flex-1 flex-col gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-2.5">
              <div className="size-7 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3 w-24 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-full animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3">
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
          <div className="mt-2 h-9 animate-pulse rounded-lg bg-muted" />
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
  const screenVideoKind: ScreenOutputKind | null = outputs.both?.key
    ? "both"
    : outputs.screen?.key
      ? "screen"
      : null;
  const recTitle = rec.title || "Untitled recording";
  const isProcessing =
    rec.status === "STOPPED" || rec.status === "PROCESSING";
  const isFailed = rec.status === "FAILED" && !screenVideoKind;

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
          comments rail runs flush from the header to the bottom edge - hence
          lg:gap-0 + lg:pb-0, with each pane owning its own spacing. Below lg
          the panes stack and the page scrolls normally. */}
      <div className="flex flex-col gap-6 px-2 pb-2 pt-0 lg:h-full lg:min-h-0 lg:gap-0 lg:pb-0">
        <header className="-mx-6 -mt-4 flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard/project")}
              aria-label="Back to all projects"
              title="All projects"
              className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-fg-muted hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <FiChevronLeft className="size-4" />
            </button>
            <span className="h-8 w-px shrink-0 bg-border" aria-hidden />
            <div className="min-w-0 space-y-1">
              <h1 className="truncate text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">
                {recTitle}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
                <span>Screen recording</span>
                {rec.startedAt && (
                  <>
                    <span>·</span>
                    <span>Recorded {formatDay(rec.startedAt)}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label="Recording actions"
            className="flex shrink-0 items-center gap-2"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Recording options"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-fg-muted hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                >
                  <FiMoreHorizontal className="size-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={openRename}>
                  <FiEdit2 />
                  Rename recording
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setDeleteConfirmOpen(true)}
                  className="text-danger focus:bg-danger/10 focus:text-danger [&_svg]:!text-danger"
                >
                  <FiTrash2 />
                  Delete recording
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pt-5">
            {isProcessing && !screenVideoKind ? (
              <section className="flex flex-col gap-4">
                <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-black text-white/60 ring-1 ring-border">
                  <FiLoader className="size-6 animate-spin" />
                  <span className="text-sm">Processing your recording…</span>
                  <span className="px-6 text-center text-xs text-white/40">
                    Your screen video will be ready shortly. You can leave this
                    page while it finishes.
                  </span>
                </div>
              </section>
            ) : isFailed ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-primary/60 py-20 text-center">
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
                    onShare={() => setShareOpen(true)}
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-border bg-primary/60 text-sm text-fg-muted">
                    Screen video unavailable
                  </div>
                )}
              </section>
            )}
          </div>
          <div className="min-h-[320px] overflow-hidden rounded-2xl border border-border bg-primary [&>section]:bg-primary lg:my-5 lg:min-h-0">
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
            className="w-full max-w-[380px] rounded-xl border border-border bg-background p-5 shadow-2xl"
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
              className="mt-4 w-full rounded-lg border border-border bg-primary px-3 py-2 text-sm text-foreground outline-none focus:border-fg-faint"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-lg border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={!title.trim()}
                className="rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
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
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-2xl border border-border bg-background p-6 shadow-2xl"
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
              className="mt-2 text-sm leading-6 text-fg-muted"
            >
              <span className="font-medium text-foreground">{recTitle}</span>{" "}
              and its recorded media will be permanently deleted. This action
              cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="rounded-lg border border-border bg-primary px-3.5 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-danger px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85"
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
