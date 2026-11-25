/**
 * ScreenRecordingProvider
 *
 * Runs the single-user screen-recorder orchestration (useScreenRecordingManager)
 * over the local screen-share / camera / mic streams, and owns the floating
 * recorder panel: opening the recorder anywhere in the app shows the panel on
 * the right, and it stays up across navigation until the user closes it.
 *
 * Recorded tracks:
 *   - combined: screen-share video + mic/system audio (the master)
 *   - camera:   webcam video (+ mic, when there's no screen)
 */

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import CountdownOverlay from "@/components/Space/recording/CountdownOverlay";

// The provider wraps every page; the panel's UI only downloads once the
// recorder is first opened.
const ScreenRecorderPanel = lazy(() => import("./ScreenRecorderPanel"));
import { useGetMe } from "@/hooks/useUserQuery";
import { toast } from "@/lib/toast";
import useScreenRecordingManager, {
  type ScreenRecordingState,
} from "@/hooks/useScreenRecordingManager";
import useUnloadWarning from "@/hooks/useUnloadWarning";
import { usePresence } from "@/hooks/usePresence";
import type { ScreenStreams } from "@/hooks/useScreenLocalRecording";
import { measureCaptureRect } from "@/lib/captureGeometry";
import { prepareCallSounds } from "@/lib/callSounds";
import { useLocalMedia, type ScreenSurface } from "./LocalMediaProvider";

interface RecordingInfo {
  title: string;
  description: string;
}

export type ScreenRecorderLayout = "screen" | "camera" | "screen-camera";
export type PipSize = "normal" | "big";
export type PipShape = "square" | "circle";

interface ScreenRecordingContextValue {
  /** Whether the floating recorder panel is showing. */
  isOpen: boolean;
  openRecorder: () => void;
  /** The camera/mic the recorder turns on when it opens are still starting. */
  isStartingMedia: boolean;
  /** Hides the panel and releases every device. No-op while a take is live. */
  closeRecorder: () => void;
  recordingState: ScreenRecordingState;
  isActive: boolean;
  /** Paused, and the recorders are still finishing - Resume waits. */
  isPausing: boolean;
  recordingDurationMs: number;
  countdownValue: number | null;
  pendingUploads: number;
  uploadProgress: number;
  error: string | null;
  completedSessionId: string | null;
  /** Turns on whatever the layout needs (prompting for the screen), then
   *  starts the countdown. */
  startRecording: () => Promise<void>;
  /** Finish the take and save it. */
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  /** Throw the current take away (nothing is saved). */
  discardRecording: () => Promise<void>;
  /** Throw the current take away and start over (the screen stays shared). */
  restartRecording: () => Promise<void>;
  /** User-provided title/description saved with the recording. */
  info: RecordingInfo;
  setInfo: (info: RecordingInfo) => void;
  /** Layout + camera PiP config (captured into `composition` at record start). */
  layout: ScreenRecorderLayout;
  setLayout: (layout: ScreenRecorderLayout) => void;
  cameraSize: PipSize;
  setCameraSize: (size: PipSize) => void;
  cameraShape: PipShape;
  setCameraShape: (shape: PipShape) => void;
  /** The camera bubble's video box, measured at record start so the final
   *  video lays the camera exactly over the bubble captured in the screen. */
  cameraBoxRef: RefObject<HTMLDivElement | null>;
  /** What the share picker opens on when Start is pressed. */
  screenSurface: ScreenSurface;
  setScreenSurface: (surface: ScreenSurface) => void;
}

const ScreenRecordingContext =
  createContext<ScreenRecordingContextValue | null>(null);

export const useScreenRecordingContext = (): ScreenRecordingContextValue => {
  const ctx = useContext(ScreenRecordingContext);
  if (!ctx) {
    throw new Error(
      "useScreenRecordingContext must be used within a ScreenRecordingProvider",
    );
  }
  return ctx;
};

// Matches the panel's exit animation (usePresence's overlay timing).
const PANEL_EXIT_MS = 150;

const ACTIVE_STATES: ScreenRecordingState[] = [
  "starting",
  "countdown",
  "recording",
  "paused",
  "stopping",
  "uploading",
];

const ScreenRecordingProvider = ({ children }: { children: ReactNode }) => {
  const {
    screenStream,
    isCameraEnabled,
    isMicrophoneEnabled,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    stopScreenShare,
    getStreams,
    stopAll,
  } = useLocalMedia();
  const { data: user } = useGetMe();
  const [isOpen, setIsOpen] = useState(false);

  // Title/description (held in a ref so the manager reads the latest at start).
  const [info, setInfoState] = useState<RecordingInfo>({
    title: "",
    description: "",
  });
  const infoRef = useRef(info);
  const touchedRef = useRef(false);
  const setInfo = useCallback((next: RecordingInfo) => {
    touchedRef.current = true;
    infoRef.current = next;
    setInfoState(next);
  }, []);

  // Layout + camera PiP config. Mirrored into refs so the manager reads the
  // latest values when a recording starts (to persist as `composition`).
  const [layout, setLayoutState] =
    useState<ScreenRecorderLayout>("screen-camera");
  const [cameraSize, setCameraSizeState] = useState<PipSize>("normal");
  const [cameraShape, setCameraShapeState] = useState<PipShape>("square");
  const layoutRef = useRef(layout);
  const cameraSizeRef = useRef(cameraSize);
  const cameraShapeRef = useRef(cameraShape);
  const cameraBoxRef = useRef<HTMLDivElement | null>(null);
  const [screenSurface, setScreenSurfaceState] =
    useState<ScreenSurface>("monitor");
  const screenSurfaceRef = useRef(screenSurface);
  const setScreenSurface = useCallback((s: ScreenSurface) => {
    screenSurfaceRef.current = s;
    setScreenSurfaceState(s);
  }, []);
  const setLayout = useCallback((l: ScreenRecorderLayout) => {
    layoutRef.current = l;
    setLayoutState(l);
  }, []);
  const setCameraSize = useCallback((s: PipSize) => {
    cameraSizeRef.current = s;
    setCameraSizeState(s);
  }, []);
  const setCameraShape = useCallback((s: PipShape) => {
    cameraShapeRef.current = s;
    setCameraShapeState(s);
  }, []);

  // Default title from the author's name, until the user edits it. The
  // description starts empty; the owner adds one later if they want.
  useEffect(() => {
    if (touchedRef.current) return;
    const name = user?.name?.trim();
    if (!name) return;
    const next: RecordingInfo = {
      title: `${name}'s recording`,
      description: "",
    };
    infoRef.current = next;
    setInfoState(next);
  }, [user?.name]);

  // Reads the live streams (not render state) so a start right after the
  // screen picker resolves - and the countdown's deferred start - see them.
  const buildStreams = useCallback((): ScreenStreams => {
    const { screen, camera, mic } = getStreams();
    const screenTrack = screen?.getVideoTracks()[0];
    const systemAudio = screen?.getAudioTracks()[0];
    const cameraTrack = camera?.getVideoTracks()[0];
    const micTrack = mic?.getAudioTracks()[0];

    // The mic is recorded ONCE, in the track the final video's sound comes
    // from: mixed with system audio into the screen ("combined") track when
    // there's a screen, otherwise into the camera track (camera only). The
    // camera's video under a screen take is just the PiP - it needs no sound.
    const combinedTracks: MediaStreamTrack[] = [];
    if (screenTrack) combinedTracks.push(screenTrack);
    if (micTrack) combinedTracks.push(micTrack);
    if (systemAudio) combinedTracks.push(systemAudio);

    const cameraTracks: MediaStreamTrack[] = [];
    if (cameraTrack) cameraTracks.push(cameraTrack);
    if (micTrack && !screenTrack) cameraTracks.push(micTrack);

    return {
      combined: screenTrack ? new MediaStream(combinedTracks) : null,
      camera: cameraTrack ? new MediaStream(cameraTracks) : null,
      audio: null,
    };
  }, [getStreams]);

  const manager = useScreenRecordingManager({
    buildStreams,
    getInfo: () => infoRef.current,
    getComposition: () => ({
      layout: layoutRef.current,
      cameraSize: cameraSizeRef.current,
      cameraShape: cameraShapeRef.current,
      // The camera is always shown mirrored, so the video matches the preview.
      cameraMirror: true,
      // Where the bubble sits in what's being captured. The bubble is locked
      // in place once a take starts, so this holds for the whole recording.
      cameraRect:
        layoutRef.current === "screen-camera"
          ? measureCaptureRect(
              cameraBoxRef.current,
              getStreams().screen?.getVideoTracks()[0]?.getSettings()
                .displaySurface,
            )
          : undefined,
    }),
  });

  // Closing/reloading this tab kills the capture (see useUnloadWarning), so
  // confirm first while anything is still recording or uploading.
  useUnloadWarning(ACTIVE_STATES.includes(manager.recordingState));

  const isActive = ACTIVE_STATES.includes(manager.recordingState);
  const isCapturing =
    manager.recordingState === "recording" ||
    manager.recordingState === "paused";

  // Opening the recorder turns the camera (when the layout shows it) and mic on
  // once - best-effort; a denied permission just leaves it off.
  // The panel plays its exit animation before unmounting; the devices are
  // released after it, so the camera preview doesn't go black mid-fade.
  const panel = usePresence(isOpen);
  const [isStartingMedia, setIsStartingMedia] = useState(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  const openRecorder = useCallback(() => {
    // Opened from a click, so the audio engine can wake for the blips.
    prepareCallSounds();
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    setIsOpen(true);
    const starts: Promise<void>[] = [];
    if (layoutRef.current !== "screen" && !isCameraEnabled) {
      // No camera permission on a screen take: drop the bubble so the user
      // can still record their screen.
      starts.push(
        toggleCamera().catch(() => {
          if (layoutRef.current === "screen-camera") setLayout("screen");
        }),
      );
    }
    if (!isMicrophoneEnabled) {
      starts.push(toggleMicrophone().catch(() => undefined));
    }
    if (starts.length > 0) {
      setIsStartingMedia(true);
      void Promise.all(starts).finally(() => setIsStartingMedia(false));
    }
  }, [
    isCameraEnabled,
    isMicrophoneEnabled,
    toggleCamera,
    toggleMicrophone,
    setLayout,
  ]);

  const closeRecorder = useCallback(() => {
    if (isActive) return;
    setIsOpen(false);
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null;
      stopAll();
    }, PANEL_EXIT_MS);
  }, [isActive, stopAll]);

  const startRecording = useCallback(async () => {
    const state = manager.recordingState;
    if (state !== "idle" && state !== "complete" && state !== "error") return;

    // Bring up every source the layout records. The screen picker is the
    // natural "what do you want to record?" step, so it opens on Start.
    const needsScreen = layoutRef.current !== "camera";
    let needsCamera = layoutRef.current !== "screen";
    const live = getStreams();
    if (needsCamera && !live.camera) {
      try {
        await toggleCamera();
      } catch {
        // The camera is only required for a camera-only take; a screen take
        // just loses its bubble.
        if (layoutRef.current === "camera") {
          toast.error(
            "Couldn't turn on the camera - check the browser's camera permission.",
          );
          return;
        }
        setLayout("screen");
        needsCamera = false;
      }
    }
    if (needsScreen && !live.screen) {
      try {
        await toggleScreenShare(screenSurfaceRef.current);
      } catch {
        // Screen picker dismissed - stay idle.
        return;
      }
    }

    const streams = buildStreams();
    if (needsScreen && !streams.combined) return;
    if (needsCamera && !streams.camera) return;
    manager.toggleRecording();
  }, [
    manager,
    getStreams,
    toggleCamera,
    toggleScreenShare,
    buildStreams,
    setLayout,
  ]);

  const stopRecording = useCallback(() => {
    if (isCapturing || manager.recordingState === "countdown") {
      manager.toggleRecording();
    }
  }, [manager, isCapturing]);

  const discardRecording = useCallback(async () => {
    await manager.discardRecording();
    void stopScreenShare();
  }, [manager, stopScreenShare]);

  // Ending the share from the browser's own "Stop sharing" bar ends the take:
  // the screen is what's being recorded, so there's nothing left to capture.
  useEffect(() => {
    if (isCapturing && layout !== "camera" && !screenStream) {
      manager.toggleRecording();
    }
  }, [isCapturing, layout, screenStream, manager]);

  // Saved: release the screen so the browser's sharing indicator goes away.
  // The camera stays on for the preview until the panel is closed.
  useEffect(() => {
    if (manager.recordingState === "complete") void stopScreenShare();
  }, [manager.recordingState, stopScreenShare]);

  // Saved and uploaded: open the project in a new tab and put the recorder
  // away. Long uploads outlast the Stop click's popup allowance, so when the
  // browser blocks the tab, go there in this one instead.
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openedSessionRef = useRef<string | null>(null);
  const { completedSessionId } = manager;
  useEffect(() => {
    if (manager.recordingState !== "complete" || !completedSessionId) return;
    if (openedSessionRef.current === completedSessionId) return;
    openedSessionRef.current = completedSessionId;

    const path = `/dashboard/project/screen/${completedSessionId}`;
    void queryClient.invalidateQueries({ queryKey: ["screen-recordings"] });
    const tab = window.open(path, "_blank");
    if (tab) tab.opener = null;
    else navigate(path);
    closeRecorder();
  }, [
    manager.recordingState,
    completedSessionId,
    queryClient,
    navigate,
    closeRecorder,
  ]);

  const value = useMemo<ScreenRecordingContextValue>(
    () => ({
      isOpen,
      openRecorder,
      isStartingMedia,
      closeRecorder,
      recordingState: manager.recordingState,
      isActive,
      isPausing: manager.isPausing,
      recordingDurationMs: manager.recordingDurationMs,
      countdownValue: manager.countdownValue,
      pendingUploads: manager.pendingUploads,
      uploadProgress: manager.uploadProgress,
      error: manager.error,
      completedSessionId: manager.completedSessionId,
      startRecording,
      stopRecording,
      pauseRecording: manager.pauseRecording,
      resumeRecording: manager.resumeRecording,
      discardRecording,
      restartRecording: manager.restartRecording,
      info,
      setInfo,
      layout,
      setLayout,
      cameraSize,
      setCameraSize,
      cameraShape,
      setCameraShape,
      cameraBoxRef,
      screenSurface,
      setScreenSurface,
    }),
    [
      isOpen,
      openRecorder,
      isStartingMedia,
      closeRecorder,
      manager,
      isActive,
      startRecording,
      stopRecording,
      discardRecording,
      info,
      setInfo,
      layout,
      setLayout,
      cameraSize,
      setCameraSize,
      cameraShape,
      setCameraShape,
      screenSurface,
      setScreenSurface,
    ],
  );

  return (
    <ScreenRecordingContext.Provider value={value}>
      {children}
      {panel.rendered && (
        <Suspense fallback={null}>
          <ScreenRecorderPanel isClosing={panel.isClosing} />
        </Suspense>
      )}
      {/* Gone the moment it hits zero, before the chime and the capture. */}
      {manager.recordingState === "countdown" &&
        manager.countdownValue !== null && (
          <CountdownOverlay value={manager.countdownValue} />
        )}
    </ScreenRecordingContext.Provider>
  );
};

export default ScreenRecordingProvider;
