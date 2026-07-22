/**
 * RecorderPip
 *
 * Uses the browser's Document Picture-in-Picture API (the real OS-level floating
 * window, like Google Meet) to keep the camera preview + recorder controls
 * visible while the user is away from the recorder page. Media/recording state
 * lives above the routes (see App.tsx), so it survives navigation; this just
 * mirrors it into the PiP window.
 *
 * Requires a Chromium browser that supports `documentPictureInPicture`. On
 * unsupported browsers it's a no-op.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, MicOff, Video, VideoOff, Square, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { pipController } from "@/lib/pipController";
import { useLocalMedia } from "./LocalMediaProvider";
import { useScreenRecordingContext } from "./ScreenRecordingProvider";

const RECORDER_PATH = "/dashboard/screen-recorder";

interface DocumentPiP {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
}

const getDocumentPip = (): DocumentPiP | undefined =>
  (window as unknown as { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture;

const isUsablePipWindow = (win: Window | null | undefined): win is Window =>
  !!win && !win.closed;

const formatDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

// Clone the app's stylesheets into the PiP document so Tailwind classes apply.
const copyStyles = (target: Document) => {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("");
      const style = target.createElement("style");
      style.textContent = css;
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
};

const RecorderPip = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    cameraStream,
    isCameraEnabled,
    isMicrophoneEnabled,
    toggleCamera,
    toggleMicrophone,
  } = useLocalMedia();
  const { isActive, recordingState, recordingDurationMs, toggleRecording } =
    useScreenRecordingContext();

  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false,
  );
  // True when the user manually popped out - keeps it open regardless of route/
  // visibility until they close it or capture stops.
  const pinnedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const onVis = () => {
      setTabHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const onRecorderPage = location.pathname === RECORDER_PATH;
  // Show while the camera is on or a recording is actively running - NOT during
  // the post-stop upload (so "End" cleanly dismisses it).
  const recordingLive =
    recordingState === "starting" ||
    recordingState === "countdown" ||
    recordingState === "recording";
  const active = isCameraEnabled || recordingLive;
  const shouldShow = active && (!onRecorderPage || tabHidden);

  const openPip = useCallback(async () => {
    const dpip = getDocumentPip();
    if (!dpip) return;
    if (isUsablePipWindow(pipWindowRef.current)) {
      return;
    }
    pipWindowRef.current = null;
    setPipWindow(null);
    try {
      // Called synchronously from the visibilitychange/auto-pip handler so
      // Chrome's "capturing tab is being hidden" allowance applies.
      const win = await dpip.requestWindow({ width: 320, height: 260 });
      copyStyles(win.document);
      win.document.documentElement.className = document.documentElement.className;
      win.document.body.style.margin = "0";
      win.addEventListener("pagehide", () => {
        if (pipWindowRef.current === win) pipWindowRef.current = null;
        pinnedRef.current = false;
        setPipWindow(null);
      });
      pipWindowRef.current = win;
      setPipWindow(win);
    } catch {
      const existingWindow = dpip.window;
      if (isUsablePipWindow(existingWindow)) {
        pipWindowRef.current = existingWindow;
        setPipWindow(existingWindow);
      }
    }
  }, []);

  const closePip = useCallback(() => {
    pinnedRef.current = false;
    const win = pipWindowRef.current ?? getDocumentPip()?.window ?? null;
    pipWindowRef.current = null;
    setPipWindow(null);
    if (!isUsablePipWindow(win)) return;
    win.close();
  }, []);

  // Manual "Pop out" from the recorder controls (a real click → always allowed,
  // even while screen-sharing, unlike the gesture-free auto paths).
  useEffect(() => {
    pipController.open = () => {
      pinnedRef.current = true;
      void openPip();
    };
    pipController.close = closePip;
    return () => {
      pipController.open = undefined;
      pipController.close = undefined;
    };
  }, [openPip, closePip]);

  // Chrome's Auto-PiP path can call these while the captured tab is being
  // hidden/restored. Keep the visibility effect below as a fallback.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!active || !ms || typeof ms.setActionHandler !== "function") return;
    const setHandler = (action: string, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action as MediaSessionAction, fn);
      } catch {
        /* action not supported in this browser */
      }
    };
    setHandler("enterpictureinpicture", () => void openPip());
    setHandler("leavepictureinpicture", () => {
      if (!pinnedRef.current) closePip();
    });
    return () => {
      setHandler("enterpictureinpicture", null);
      setHandler("leavepictureinpicture", null);
    };
  }, [active, openPip, closePip]);

  // Open when the recorder UI is not visible, close when the user returns to
  // the recorder tab, and do not treat that automatic close as a manual dismiss.
  useEffect(() => {
    if (!active) {
      closePip();
      return;
    }
    if (!shouldShow) {
      if (!pinnedRef.current) closePip();
      return;
    }
    void openPip();
  }, [active, shouldShow, openPip, closePip]);

  // Keep the PiP <video> bound to the live camera stream.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = cameraStream ?? null;
    if (cameraStream) {
      el.muted = true;
      void el.play().catch(() => undefined);
    }
  }, [pipWindow, cameraStream]);

  if (!pipWindow) return null;

  const isRecording = recordingState === "recording";
  const isBusy =
    recordingState === "starting" ||
    recordingState === "countdown" ||
    recordingState === "stopping" ||
    recordingState === "uploading";

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      // The recorder controls remain available for a retry.
    }
  };

  return createPortal(
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <button
        type="button"
        onClick={() => navigate(RECORDER_PATH)}
        title="Back to recorder"
        className="relative flex-1 overflow-hidden bg-primary"
      >
        {cameraStream ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-foreground/55">
            Recording in progress
          </div>
        )}

        {isActive && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            <span className="tabular-nums">
              {isRecording ? formatDuration(recordingDurationMs) : "•••"}
            </span>
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-md bg-black/55 p-1 text-white">
          <Maximize2 size={13} />
        </div>
      </button>

      <div className="flex items-center justify-center gap-1.5 p-2">
        <button
          type="button"
          onClick={() => guard(toggleMicrophone)}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg border transition-colors",
            isMicrophoneEnabled
              ? "border-call-border bg-call-primary hover:bg-primary-hover"
              : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
        >
          {isMicrophoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button
          type="button"
          onClick={() => guard(toggleCamera)}
          title={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg border transition-colors",
            isCameraEnabled
              ? "border-call-border bg-call-primary hover:bg-primary-hover"
              : "border-red-400/10 bg-red-400/20 text-red-400 hover:bg-red-400/40",
          )}
        >
          {isCameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
        </button>
        {isActive && (
          <button
            type="button"
            disabled={isBusy}
            onClick={toggleRecording}
            title="Stop recording"
            className={cn(
              "flex size-9 items-center justify-center rounded-lg bg-red-600 text-white transition-colors hover:bg-red-700",
              isBusy && "cursor-not-allowed opacity-60",
            )}
          >
            <Square size={15} className="fill-white" />
          </button>
        )}
      </div>
    </div>,
    pipWindow.document.body,
  );
};

export default RecorderPip;
