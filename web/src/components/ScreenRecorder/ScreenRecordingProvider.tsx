/**
 * ScreenRecordingProvider
 *
 * Runs the single-user screen-recorder orchestration (useScreenRecordingManager)
 * inside the local (unconnected) LiveKit room so it can read the local
 * screen-share / camera / mic tracks, and exposes a tiny context the controls +
 * countdown consume.
 *
 * Recorded tracks:
 *   - combined: screen-share video + mic audio (the master)
 *   - camera:   webcam video only
 *   - audio:    mic only
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import CountdownOverlay from "@/components/Space/recording/CountdownOverlay";
import { useGetMe } from "@/hooks/useUserQuery";
import useScreenRecordingManager, {
  type ScreenRecordingState,
} from "@/hooks/useScreenRecordingManager";
import type { ScreenStreams } from "@/hooks/useScreenLocalRecording";
import { useLocalMedia } from "./LocalMediaProvider";

export interface RecordingInfo {
  title: string;
  description: string;
}

export type ScreenRecorderLayout = "screen" | "camera" | "screen-camera";
export type PipSize = "normal" | "big";
export type PipShape = "square" | "rectangle";

interface ScreenRecordingContextValue {
  recordingState: ScreenRecordingState;
  isActive: boolean;
  recordingDurationMs: number;
  countdownValue: number | null;
  pendingUploads: number;
  uploadProgress: number;
  error: string | null;
  toggleRecording: () => void;
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
}

const ScreenRecordingContext = createContext<ScreenRecordingContextValue | null>(
  null,
);

export const useScreenRecordingContext = (): ScreenRecordingContextValue => {
  const ctx = useContext(ScreenRecordingContext);
  if (!ctx) {
    throw new Error(
      "useScreenRecordingContext must be used within a ScreenRecordingProvider",
    );
  }
  return ctx;
};

const ACTIVE_STATES: ScreenRecordingState[] = [
  "starting",
  "countdown",
  "recording",
  "stopping",
  "uploading",
];

const ScreenRecordingProvider = ({ children }: { children: ReactNode }) => {
  const { screenStream, cameraStream, micStream } = useLocalMedia();
  const { data: user } = useGetMe();

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
  const [layout, setLayoutState] = useState<ScreenRecorderLayout>("screen-camera");
  const [cameraSize, setCameraSizeState] = useState<PipSize>("normal");
  const [cameraShape, setCameraShapeState] = useState<PipShape>("square");
  const layoutRef = useRef(layout);
  const cameraSizeRef = useRef(cameraSize);
  const cameraShapeRef = useRef(cameraShape);
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

  // Default title/description from the author's name, until the user edits them.
  useEffect(() => {
    if (touchedRef.current) return;
    const name = user?.name?.trim();
    if (!name) return;
    const next: RecordingInfo = {
      title: `${name}'s recording`,
      description: `${name}'s screen recording`,
    };
    infoRef.current = next;
    setInfoState(next);
  }, [user?.name]);

  const buildStreams = useCallback((): ScreenStreams => {
    const screenTrack = screenStream?.getVideoTracks()[0];
    const systemAudio = screenStream?.getAudioTracks()[0];
    const cameraTrack = cameraStream?.getVideoTracks()[0];
    const micTrack = micStream?.getAudioTracks()[0];

    // combined = screen video + mic + system audio (mic & system are mixed into
    // one track by the recorder). camera = webcam video + mic audio.
    const combinedTracks: MediaStreamTrack[] = [];
    if (screenTrack) combinedTracks.push(screenTrack);
    if (micTrack) combinedTracks.push(micTrack);
    if (systemAudio) combinedTracks.push(systemAudio);

    const cameraTracks: MediaStreamTrack[] = [];
    if (cameraTrack) cameraTracks.push(cameraTrack);
    if (micTrack) cameraTracks.push(micTrack);

    return {
      combined: screenTrack ? new MediaStream(combinedTracks) : null,
      camera: cameraTrack ? new MediaStream(cameraTracks) : null,
      audio: micTrack ? new MediaStream([micTrack]) : null,
    };
  }, [screenStream, cameraStream, micStream]);

  const manager = useScreenRecordingManager({
    buildStreams,
    getInfo: () => infoRef.current,
    getComposition: () => ({
      layout: layoutRef.current,
      cameraSize: cameraSizeRef.current,
      cameraShape: cameraShapeRef.current,
      cameraCorner: "bottom-right",
    }),
  });

  const toggleRecording = useCallback(() => {
    if (manager.recordingState === "idle" || manager.recordingState === "complete") {
      const { combined, camera, audio } = buildStreams();
      if (!combined && !camera && !audio) {
        return;
      }
    }
    manager.toggleRecording();
  }, [manager, buildStreams]);

  const value = useMemo<ScreenRecordingContextValue>(
    () => ({
      recordingState: manager.recordingState,
      isActive: ACTIVE_STATES.includes(manager.recordingState),
      recordingDurationMs: manager.recordingDurationMs,
      countdownValue: manager.countdownValue,
      pendingUploads: manager.pendingUploads,
      uploadProgress: manager.uploadProgress,
      error: manager.error,
      toggleRecording,
      info,
      setInfo,
      layout,
      setLayout,
      cameraSize,
      setCameraSize,
      cameraShape,
      setCameraShape,
    }),
    [
      manager,
      toggleRecording,
      info,
      setInfo,
      layout,
      setLayout,
      cameraSize,
      setCameraSize,
      cameraShape,
      setCameraShape,
    ],
  );

  return (
    <ScreenRecordingContext.Provider value={value}>
      {children}
      {manager.recordingState === "countdown" && (
        <CountdownOverlay value={manager.countdownValue} />
      )}
    </ScreenRecordingContext.Provider>
  );
};

export default ScreenRecordingProvider;
