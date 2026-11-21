import { FiAlertTriangle } from "react-icons/fi";
import { LuLoaderCircle } from "react-icons/lu";

/**
 * A recording card's thumbnail while its video isn't ready. Matches the
 * project page's processing panel (ProcessingStagePanel): a flat frame with a
 * spinner and a shimmering label, or a warning when processing failed. Same
 * 16:9 frame as a real thumbnail, so cards line up.
 */
const ProcessingThumbnail = ({ failed = false }: { failed?: boolean }) => (
  <div
    role="status"
    aria-label={failed ? "Processing failed" : "Processing"}
    className="flex aspect-video flex-col items-center justify-center gap-2.5 rounded-lg bg-muted/60 ring-1 ring-border/50"
  >
    {failed ? (
      <FiAlertTriangle className="size-6 text-danger" />
    ) : (
      <LuLoaderCircle className="size-6 animate-spin text-fg-muted" />
    )}
    <p
      className={
        failed
          ? "text-sm font-medium text-foreground/85"
          : "shimmer-text text-sm font-medium"
      }
    >
      {failed ? "Processing failed" : "Processing…"}
    </p>
  </div>
);

export default ProcessingThumbnail;
