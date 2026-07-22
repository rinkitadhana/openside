/**
 * Comment panel for a recording. Presentational: the owner's project page and
 * the public share page both render this, passing their own data + submit
 * handler (the two talk to different endpoints).
 *
 * Anonymous share-link visitors have no account, so they type a display name
 * once; it's remembered locally so they don't retype it on every comment.
 */

import { useEffect, useState } from "react";
import { FiLoader, FiMessageSquare, FiTrash2 } from "react-icons/fi";
import type { RecordingComment } from "@/hooks/useScreenRecordings";

const GUEST_NAME_KEY = "openside:guest-comment-name";

export const readGuestName = (): string => {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

const rememberGuestName = (name: string) => {
  try {
    localStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    // Private mode / storage disabled - the name just won't persist.
  }
};

const formatWhen = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const Avatar = ({ comment }: { comment: RecordingComment }) => {
  const [failed, setFailed] = useState(false);
  const avatar = comment.user?.avatar;
  const initial = (comment.authorName.trim()[0] || "?").toUpperCase();

  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-xs font-semibold text-white">
      {avatar && !failed ? (
        <img
          src={avatar}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
};

interface RecordingCommentsProps {
  comments: RecordingComment[];
  isLoading?: boolean;
  isPosting?: boolean;
  /** Anonymous visitors (share page, signed out) must name themselves. */
  askForName?: boolean;
  onSubmit: (input: { body: string; authorName?: string }) => void;
  onDelete?: (commentId: string) => void;
  /** Which comments show a delete affordance (own comment, or owner moderating). */
  canDelete?: (comment: RecordingComment) => boolean;
}

const RecordingComments = ({
  comments,
  isLoading = false,
  isPosting = false,
  askForName = false,
  onSubmit,
  onDelete,
  canDelete,
}: RecordingCommentsProps) => {
  const [body, setBody] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (askForName) setName(readGuestName());
  }, [askForName]);

  const trimmedBody = body.trim();
  const trimmedName = name.trim();
  const canPost =
    !!trimmedBody && (!askForName || !!trimmedName) && !isPosting;

  const submit = () => {
    if (!canPost) return;
    if (askForName) rememberGuestName(trimmedName);
    onSubmit({
      body: trimmedBody,
      authorName: askForName ? trimmedName : undefined,
    });
    setBody("");
  };

  return (
    // Plain background, no card chrome: this is a full-height rail flush to the
    // header and the bottom, so the surrounding layout owns any divider.
    <section className="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Comments</h3>
        {!isLoading && comments.length > 0 && (
          <span className="rounded-full bg-call-primary px-2 py-0.5 text-[0.7rem] font-medium text-foreground/55 ring-1 ring-call-border">
            {comments.length}
          </span>
        )}
      </div>

      <div className="flex min-h-[120px] flex-1 flex-col gap-3 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-foreground/45">
            <FiLoader className="size-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-call-background text-foreground/40">
              <FiMessageSquare className="size-4" />
            </span>
            <p className="text-xs text-foreground/45">
              No comments yet. Start the conversation.
            </p>
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="group flex items-start gap-2.5">
              <Avatar comment={comment} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-semibold text-foreground">
                    {comment.authorName}
                  </span>
                  <span className="shrink-0 text-[0.7rem] text-foreground/40">
                    {formatWhen(comment.createdAt)}
                  </span>
                  {onDelete && canDelete?.(comment) && (
                    <button
                      type="button"
                      onClick={() => onDelete(comment.id)}
                      title="Delete comment"
                      className="ml-auto shrink-0 text-foreground/30 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <FiTrash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/75">
                  {comment.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-call-border pt-3">
        {askForName && (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Your name"
            className="w-full rounded-md border border-border bg-primary px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-foreground/30"
          />
        )}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter posts; Shift+Enter starts a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          maxLength={2000}
          placeholder="Add a comment…"
          className="w-full resize-none rounded-md border border-border bg-primary px-2.5 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canPost}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPosting && <FiLoader className="size-4 animate-spin" />}
          {isPosting ? "Posting…" : "Comment"}
        </button>
      </div>
    </section>
  );
};

export default RecordingComments;
