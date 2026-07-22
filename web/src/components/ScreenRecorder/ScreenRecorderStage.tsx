import { useEffect, useRef, type ReactNode } from "react";
import {
  Square,
  RectangleHorizontal,
  Minimize2,
  Maximize2,
  Expand,
} from "lucide-react";
import { LuScreenShare } from "react-icons/lu";
import { FiVideo } from "react-icons/fi";
import { cn } from "@/lib/utils";
import { useLocalMedia } from "./LocalMediaProvider";
import { useScreenRecordingContext } from "./ScreenRecordingProvider";

// Local-only stage: mirrors the local screen-share / camera streams via plain
// <video> elements. No LiveKit, no remote participants. Three layouts:
//   - screen:        shared screen only
//   - camera:        user camera only
//   - screen-camera: screen full-bleed with the camera as a bottom-right PiP
const ScreenRecorderStage = () => {
  const {
    screenStream,
    cameraStream,
    toggleScreenShare,
    stopScreenShare,
    toggleCamera,
  } = useLocalMedia();
  // Layout + camera PiP config live in the recording context (persisted as
  // `composition` at record start). Customization is locked while recording.
  const {
    isActive,
    layout,
    setLayout,
    cameraSize: pipSize,
    setCameraSize: setPipSize,
    cameraShape: pipShape,
    setCameraShape: setPipShape,
  } = useScreenRecordingContext();

  // "Camera only" from the PiP: drop screen share and switch layout.
  const handleCameraOnly = () => {
    if (screenStream) void stopScreenShare();
    setLayout("camera");
  };

  const handleShareScreen = async () => {
    try {
      await toggleScreenShare();
    } catch {
      // Screen sharing remains off when the browser rejects the request.
    }
  };

  const handleTurnOnCamera = async () => {
    try {
      await toggleCamera();
    } catch {
      // Camera preview remains off when the browser rejects the request.
    }
  };

  const shareScreenAction = {
    label: "Share screen",
    icon: <LuScreenShare className="size-4" />,
    onClick: handleShareScreen,
  };
  const cameraAction = {
    label: "Turn on camera",
    icon: <FiVideo className="size-4" />,
    onClick: handleTurnOnCamera,
  };

  // The camera PiP that overlays the screen box (bottom-right, inside it).
  const cameraPip = (
    <div className="group/pip absolute bottom-3 right-3 z-30 flex flex-col items-center gap-2">

      {/* Hover toolbar above the box: shape, size, and "camera only".
          Hidden while recording so the camera layout can't change mid-capture. */}
      {!isActive && (
        <div className="flex items-center gap-1 rounded-full border border-call-border bg-call-background p-1 opacity-0 shadow-lg transition-opacity duration-150 group-hover/pip:opacity-100">
          <PipButton
            label={pipShape === "square" ? "Make rectangle" : "Make square"}
            onClick={() =>
              setPipShape(pipShape === "square" ? "rectangle" : "square")
            }
          >
            {pipShape === "square" ? (
              <RectangleHorizontal size={15} />
            ) : (
              <Square size={15} />
            )}
          </PipButton>
          <PipButton
            label={pipSize === "normal" ? "Bigger" : "Smaller"}
            onClick={() => setPipSize(pipSize === "normal" ? "big" : "normal")}
          >
            {pipSize === "normal" ? (
              <Maximize2 size={15} />
            ) : (
              <Minimize2 size={15} />
            )}
          </PipButton>
          <PipButton label="Camera only" onClick={handleCameraOnly}>
            <Expand size={15} />
          </PipButton>
        </div>
      )}
      {/* Height is fixed per size; switching shape changes the WIDTH only. */}
      <div
        className={cn(
          "overflow-hidden rounded-[2rem] border border-call-border bg-background shadow-md",
          pipSize === "big" ? "h-[375px]" : "h-[260px]",
          pipShape === "rectangle" ? "aspect-video" : "aspect-square",
        )}
      >
        <VideoFrame stream={cameraStream} emptyAction={cameraAction} compact />
      </div>
    </div>
  );

  const renderBody = () => {
    if (layout === "camera") {
      return <VideoFrame stream={cameraStream} emptyAction={cameraAction} focus />;
    }

    if (layout === "screen") {
      return (
        <VideoFrame stream={screenStream} emptyAction={shareScreenAction} focus />
      );
    }

    // screen-camera: camera PiP overlays the screen box itself (passed as
    // overlay so it sits inside the screen video, not the surrounding area).
    return (
      <VideoFrame
        stream={screenStream}
        emptyAction={shareScreenAction}
        overlay={cameraPip}
        focus
      />
    );
  };

  return (
    <div className="relative h-full min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-0">{renderBody()}</div>
    </div>
  );
};

interface EmptyAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

interface VideoFrameProps {
  stream: MediaStream | null;
  focus?: boolean;
  /** PiP tile: no labels, fixed aspect, fills its container. */
  compact?: boolean;
  /** Shown (as a centered button) in the primary-color box when no video. */
  emptyAction?: EmptyAction;
  /** Rendered inside the video box (e.g. the camera PiP). */
  overlay?: ReactNode;
}

const VideoFrame = ({
  stream,
  focus = false,
  compact = false,
  emptyAction,
  overlay,
}: VideoFrameProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideo = !!stream && stream.getVideoTracks().length > 0;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream ?? null;
    if (stream) {
      el.muted = true; // local preview must be muted to avoid feedback
      void el.play().catch(() => undefined);
    }
  }, [stream]);

  // Compact (PiP): the video fills the parent box.
  if (compact) {
    return hasVideo ? (
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-cover"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-background">
        {emptyAction && (
          <button
            type="button"
            onClick={emptyAction.onClick}
            className="flex items-center gap-1.5 rounded-lg border border-call-border bg-call-primary px-2.5 py-1.5 text-xs font-medium text-foreground transition-all duration-200 hover:bg-primary-hover"
          >
            {emptyAction.icon}
            {emptyAction.label}
          </button>
        )}
      </div>
    );
  }

  // Non-compact: the bordered box hugs the actual video (its native aspect),
  // centered in the available area - no full-width letterboxing. Any overlay
  // (e.g. the camera PiP) is anchored INSIDE that box.
  return (
    <div
      className={`relative flex h-full w-full items-center justify-center ${
        focus ? "min-h-[360px]" : "min-h-[180px]"
      }`}
    >
      {hasVideo ? (
        <div className="relative inline-flex h-full max-w-full items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-auto max-w-full border border-call-border bg-primary object-contain"
          />
          {overlay}
        </div>
      ) : (
        <div className="relative flex h-full w-full items-center justify-center border border-call-border bg-primary">
          {emptyAction && (
            <button
              type="button"
              onClick={emptyAction.onClick}
              className="flex items-center gap-2 rounded-xl border border-call-border bg-call-primary px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-primary-hover"
            >
              {emptyAction.icon}
              {emptyAction.label}
            </button>
          )}
          {overlay}
        </div>
      )}
    </div>
  );
};

interface PipButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}

const PipButton = ({ label, onClick, active = false, children }: PipButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={cn(
      "flex size-7 items-center justify-center rounded-full text-foreground transition-colors duration-150",
      active ? "bg-primary-hover" : "hover:bg-primary-hover",
    )}
  >
    {children}
  </button>
);

export default ScreenRecorderStage;
