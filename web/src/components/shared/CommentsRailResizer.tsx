import { useRef, useState, type CSSProperties } from "react";

/** The video side always keeps at least this much room. */
const MIN_VIDEO_WIDTH = 420;

interface RailOptions {
  /** localStorage key, so each kind of rail remembers its own width. */
  storageKey?: string;
  label?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * Drag-to-resize for the side rail (comments, tracks) beside a recording's
 * video (desktop only). The width is a per-viewer preference kept in
 * localStorage under `storageKey`, so each kind of rail remembers its own.
 *
 * Spread `gridStyle` on the two-column grid and give it
 * `lg:grid-cols-[minmax(0,1fr)_var(--comments-rail-width)]` plus `relative`;
 * render `handle` inside that grid.
 */
export const useCommentsRailResizer = ({
  storageKey = "openside:comments-rail-width",
  label = "Resize comments",
  defaultWidth = 380,
  minWidth = 300,
  maxWidth = 640,
}: RailOptions = {}) => {
  const clamp = (next: number, containerWidth?: number) => {
    const max = containerWidth
      ? Math.min(maxWidth, containerWidth - MIN_VIDEO_WIDTH)
      : maxWidth;
    return Math.round(Math.max(minWidth, Math.min(next, max)));
  };

  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return stored ? clamp(stored) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);

  const save = (next: number) => {
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Storage blocked - the width just won't be remembered.
    }
  };

  const gridStyle = {
    "--comments-rail-width": `${width}px`,
  } as CSSProperties;

  const handle = (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      style={{ right: width }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const grid = handleRef.current?.parentElement;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        setWidth(clamp(rect.right - event.clientX, rect.width));
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        document.body.style.userSelect = "";
        save(width);
      }}
      onDoubleClick={() => {
        setWidth(defaultWidth);
        save(defaultWidth);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        const grid = handleRef.current?.parentElement;
        const containerWidth = grid?.getBoundingClientRect().width;
        // Left widens the rail (its edge moves left), right narrows it.
        const delta =
          event.key === "ArrowLeft"
            ? step
            : event.key === "ArrowRight"
              ? -step
              : 0;
        if (!delta) return;
        const next = clamp(width + delta, containerWidth);
        event.preventDefault();
        setWidth(next);
        save(next);
      }}
      className="group absolute inset-y-0 z-10 hidden w-4 translate-x-1/2 cursor-col-resize items-center justify-center outline-none lg:flex"
    >
      {/* A small pill centred on the divider - looks the same at rest, on
          hover and while dragging. The divider is the video column's 1px
          right border, so its centre sits half a pixel left of the column
          edge this handle is centred on. */}
      <span className="h-10 w-1 -translate-x-[0.5px] rounded-full bg-fg-subtle" />
    </div>
  );

  return { gridStyle, handle };
};
