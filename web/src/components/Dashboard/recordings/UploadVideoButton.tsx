import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiUpload } from "react-icons/fi";
import { Crown } from "lucide-react";
import useVideoUpload from "@/hooks/useVideoUpload";
import { usePresence } from "@/hooks/usePresence";
import { useUsage } from "@/hooks/useUsage";
import PricingModal from "@/components/Dashboard/PricingModal";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import UploadVideoDialog from "./UploadVideoDialog";

/**
 * Opens the upload dialog (browse or drag and drop), uploads the video as a
 * screen recording, then opens its project page (share link, comments).
 * Pro and self-host only: free (demo) users get the plan picker instead. The
 * server enforces this too (UPLOAD_REQUIRES_PRO).
 */
const UploadVideoButton = ({
  variant = "outline",
  alwaysShowLabel = false,
}: {
  variant?: "outline" | "brand";
  /** Keep the text on phones too (otherwise icon-only below sm). */
  alwaysShowLabel?: boolean;
}) => {
  const navigate = useNavigate();
  const { upload, state, progress } = useVideoUpload();
  const uploading = state === "uploading";
  const { data: usage } = useUsage();
  const locked = usage?.plan === "demo";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
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
        onClick={() => (locked ? setPricingOpen(true) : setDialogOpen(true))}
        aria-label={
          uploading
            ? "Uploading video"
            : locked
              ? "Upload video (Pro)"
              : "Upload video"
        }
        title={locked ? "Uploading videos is on Pro and self-host" : undefined}
        className={cn(
          "relative flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-md text-sm font-medium transition-opacity hover:opacity-80",
          alwaysShowLabel ? "px-3" : "w-9 sm:w-auto sm:px-3",
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
        <span
          className={cn(
            "relative tabular-nums",
            alwaysShowLabel ? "inline" : "hidden sm:inline",
          )}
        >
          {uploading
            ? `Uploading ${Math.floor(progress * 100)}%`
            : "Upload video"}
        </span>
        {locked && (
          <Crown
            size={12}
            className="relative hidden fill-current text-amber-400 sm:block"
          />
        )}
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

      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </>
  );
};

export default UploadVideoButton;
