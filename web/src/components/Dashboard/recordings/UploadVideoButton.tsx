import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FiUpload } from "react-icons/fi";
import useVideoUpload, { UPLOAD_ACCEPT } from "@/hooks/useVideoUpload";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Pick a video file and upload it as a screen recording; opens its project
 * page (share link, comments) once the upload is in and processing.
 */
const UploadVideoButton = ({
  variant = "outline",
}: {
  variant?: "outline" | "brand";
}) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, state, progress } = useVideoUpload();
  const uploading = state === "uploading";

  // Closing the tab mid-upload loses the file.
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const sessionId = await upload(file);
      toast.success("Video uploaded - it'll be ready in a moment.");
      navigate(`/dashboard/project/screen/${sessionId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed.",
        6000,
      );
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        aria-label={uploading ? "Uploading video" : "Upload video"}
        className={cn(
          "flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-default",
          variant === "brand"
            ? "bg-brand text-white hover:opacity-90"
            : "border border-border/50 bg-primary text-foreground hover:bg-muted",
        )}
      >
        <FiUpload
          size={14}
          className={variant === "brand" ? "" : "text-fg-subtle"}
        />
        <span className="tabular-nums">
          {uploading
            ? `Uploading ${Math.floor(progress * 100)}%`
            : "Upload video"}
        </span>
      </button>
    </>
  );
};

export default UploadVideoButton;
