import { useEffect, useRef, useState } from "react";
import { FiUploadCloud, FiX } from "react-icons/fi";
import { backdropMotion, panelMotion } from "@/hooks/usePresence";
import { UPLOAD_ACCEPT } from "@/hooks/useVideoUpload";
import { cn } from "@/lib/utils";

/**
 * Pick a video by browsing or by dropping it on the drop zone. While an
 * upload runs it shows the file and progress; closing the dialog doesn't stop
 * the upload (the toolbar button keeps showing progress).
 */
const UploadVideoDialog = ({
  uploading,
  progress,
  fileName,
  onFile,
  onClose,
  isClosing = false,
}: {
  uploading: boolean;
  progress: number;
  fileName: string | null;
  onFile: (file: File) => void;
  onClose: () => void;
  /** Playing the exit animation (see usePresence). */
  isClosing?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/leave fire for every child; count them so the highlight doesn't flicker.
  const dragDepth = useRef(0);
  const percent = Math.floor(progress * 100);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = () => {
    if (!uploading) inputRef.current?.click();
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm ${backdropMotion(isClosing)}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-dialog-title"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-[480px] rounded-2xl border border-border/50 bg-[#f9f9fb] p-5 dark:bg-[#0f0f11] ${panelMotion(isClosing)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="upload-dialog-title"
              className="text-base font-semibold text-foreground"
            >
              Upload a video
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              It gets a share link and comments, just like a recording.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-muted hover:text-foreground"
          >
            <FiX size={16} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />

        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-disabled={uploading}
          onClick={pick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pick();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (uploading) return;
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            if (uploading) return;
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className={cn(
            "mt-5 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:border-brand",
            uploading
              ? "cursor-default border-border/50 bg-primary"
              : dragging
                ? "cursor-copy border-brand bg-brand/10"
                : "cursor-pointer border-border bg-primary hover:border-fg-faint hover:bg-muted/50",
          )}
        >
          <span
            className={cn(
              "flex size-11 items-center justify-center rounded-xl ring-1 transition-colors",
              dragging
                ? "bg-brand text-white ring-brand"
                : "bg-muted text-fg-subtle ring-border",
            )}
          >
            <FiUploadCloud size={20} />
          </span>

          {uploading ? (
            <div className="w-full max-w-[280px] space-y-2">
              <p className="truncate text-sm font-medium text-foreground">
                {fileName ?? "Uploading"}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-xs tabular-nums text-fg-muted">
                Uploading {percent}% - keep this tab open
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {dragging ? "Drop to upload" : "Drag and drop a video here"}
              </p>
              <p className="text-xs text-fg-subtle">
                MP4, MOV, WebM or MKV, up to 5 GB
              </p>
            </div>
          )}

          {!uploading && !dragging && (
            <span className="mt-1 h-9 rounded-lg bg-brand px-4 text-sm font-semibold leading-9 text-white transition-[filter] hover:brightness-110">
              Browse files
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadVideoDialog;
