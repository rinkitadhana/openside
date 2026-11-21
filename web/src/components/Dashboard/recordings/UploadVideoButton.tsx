import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiUpload } from "react-icons/fi";
import useVideoUpload from "@/hooks/useVideoUpload";
import { usePresence } from "@/hooks/usePresence";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import UploadVideoDialog from "./UploadVideoDialog";

/**
 * Opens the upload dialog (browse or drag and drop), uploads the video as a
 * screen recording, then opens its project page (share link, comments).
 */
const UploadVideoButton = ({
  variant = "outline",
}: {
  variant?: "outline" | "brand";
}) => {
  const navigate = useNavigate();
  const { upload, state, progress } = useVideoUpload();
  const uploading = state === "uploading";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const dialog = usePresence(dialogOpen);

  // Closing the tab mid-upload loses the file.
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const sessionId = await upload(file);
      setDialogOpen(false);
      toast.success("Video uploaded - it'll be ready in a moment.");
      navigate(`/dashboard/project/screen/${sessionId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed.",
        6000,
      );
    } finally {
      setFileName(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label={uploading ? "Uploading video" : "Upload video"}
        className={cn(
          "relative flex size-9 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-md text-sm font-medium transition-opacity hover:opacity-80 sm:w-auto sm:px-3",
          variant === "brand"
            ? "bg-brand text-white"
            : "border border-border bg-muted text-foreground",
        )}
      >
        {/* Upload progress fills the button left to right. */}
        {uploading && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 transition-[width] duration-300",
              variant === "brand" ? "bg-white/15" : "bg-brand/15",
            )}
            style={{ width: `${Math.floor(progress * 100)}%` }}
          />
        )}
        <FiUpload
          size={14}
          className={cn("relative", variant !== "brand" && "text-fg-subtle")}
        />
        {/* Phones: just the icon, like the filter button next to it. */}
        <span className="relative hidden tabular-nums sm:inline">
          {uploading
            ? `Uploading ${Math.floor(progress * 100)}%`
            : "Upload video"}
        </span>
      </button>

      {dialog.rendered && (
        <UploadVideoDialog
          uploading={uploading}
          progress={progress}
          fileName={fileName}
          onFile={(file) => void handleFile(file)}
          onClose={() => setDialogOpen(false)}
          isClosing={dialog.isClosing}
        />
      )}
    </>
  );
};

export default UploadVideoButton;
