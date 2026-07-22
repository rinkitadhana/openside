/**
 * LocalMediaProvider
 *
 * Owns the screen recorder's local media WITHOUT LiveKit. The room is never
 * connected, so LiveKit's publish path (setCameraEnabled/setMicrophoneEnabled)
 * never registers tracks - instead we acquire devices directly:
 *   - camera / mic via getUserMedia
 *   - screen   via getDisplayMedia
 *
 * Toggling a source acquires or fully stops its stream (so the OS "in use"
 * indicator turns off on disable). Streams are exposed for both preview
 * (<video srcObject>) and recording.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useEntitlements } from "@/hooks/useUsage";

interface LocalMediaContextValue {
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  screenStream: MediaStream | null;

  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;

  toggleCamera: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;

  microphoneDevices: MediaDeviceInfo[];
  cameraDevices: MediaDeviceInfo[];
  activeMicrophoneId: string;
  activeCameraId: string;
  selectMicrophone: (deviceId: string) => Promise<void>;
  selectCamera: (deviceId: string) => Promise<void>;

  /** Prompt for device permissions so the device menus can show labels. */
  ensureDevicePermissions: () => void;
  stopAll: () => void;
}

const LocalMediaContext = createContext<LocalMediaContextValue | null>(null);

export const useLocalMedia = (): LocalMediaContextValue => {
  const ctx = useContext(LocalMediaContext);
  if (!ctx) {
    throw new Error("useLocalMedia must be used within a LocalMediaProvider");
  }
  return ctx;
};

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const LocalMediaProvider = ({ children }: { children: ReactNode }) => {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeMicrophoneId, setActiveMicrophoneId] = useState("");
  const [activeCameraId, setActiveCameraId] = useState("");

  // Refs mirror state so cleanup/unmount always sees the latest streams.
  const cameraRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);

  // Plan-based capture cap (demo 1080p, pro/self-host 4K). Read through a ref
  // so the capture callback doesn't churn; the server independently enforces
  // everything that costs money, so this is just honest capture sizing.
  const { isSignedIn } = useClerkAuth();
  const { data: entitlements } = useEntitlements(isSignedIn === true);
  const maxVideoHeightRef = useRef(1080);
  maxVideoHeightRef.current = entitlements?.maxVideoHeight ?? 1080;

  const setCamera = useCallback((stream: MediaStream | null) => {
    cameraRef.current = stream;
    setCameraStream(stream);
  }, []);
  const setMic = useCallback((stream: MediaStream | null) => {
    micRef.current = stream;
    setMicStream(stream);
  }, []);
  const setScreen = useCallback((stream: MediaStream | null) => {
    screenRef.current = stream;
    setScreenStream(stream);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophoneDevices(devices.filter((d) => d.kind === "audioinput"));
      setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      /* ignore enumeration failures */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshDevices]);

  const acquireCamera = useCallback(
    async (deviceId?: string) => {
      // Ask for the webcam's full 16:9 frame at the plan's capture cap. A bare
      // `video: true` defaults to 640x480 (4:3), which center-crops the sides
      // off a 16:9 sensor - the standalone camera master must be the full raw
      // frame; any cropping (the PiP box) happens later in ffmpeg.
      // aspectRatio is stated explicitly: width/height ideals alone let a
      // portrait source (e.g. an iPhone Continuity Camera held upright) stay
      // portrait, while the aspect hint makes the browser crop-and-scale it to
      // a normal landscape webcam frame.
      const cap = maxVideoHeightRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          aspectRatio: { ideal: 16 / 9 },
          width: { ideal: Math.round((cap * 16) / 9) },
          height: { ideal: cap, max: cap },
        },
      });
      stopStream(cameraRef.current);
      setCamera(stream);
      const settings = stream.getVideoTracks()[0]?.getSettings();
      if (settings?.deviceId) setActiveCameraId(settings.deviceId);
      void refreshDevices();
    },
    [setCamera, refreshDevices],
  );

  const acquireMic = useCallback(
    async (deviceId?: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      stopStream(micRef.current);
      setMic(stream);
      const settings = stream.getAudioTracks()[0]?.getSettings();
      if (settings?.deviceId) setActiveMicrophoneId(settings.deviceId);
      void refreshDevices();
    },
    [setMic, refreshDevices],
  );

  const toggleCamera = useCallback(async () => {
    if (cameraRef.current) {
      stopStream(cameraRef.current);
      setCamera(null);
      return;
    }
    await acquireCamera(activeCameraId || undefined);
  }, [acquireCamera, activeCameraId, setCamera]);

  const toggleMicrophone = useCallback(async () => {
    if (micRef.current) {
      stopStream(micRef.current);
      setMic(null);
      return;
    }
    await acquireMic(activeMicrophoneId || undefined);
  }, [acquireMic, activeMicrophoneId, setMic]);

  const toggleScreenShare = useCallback(async () => {
    if (screenRef.current) {
      stopStream(screenRef.current);
      setScreen(null);
      return;
    }
    // audio: true captures tab/system audio when the user grants it; mixed with
    // the mic into the screen ("combined") recording at record time.
    // Capture height is capped by the plan (demo 1080p, pro/self-host 4K).
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 },
        height: { max: maxVideoHeightRef.current },
      },
      audio: true,
    });
    // Browser "Stop sharing" UI ends the track directly - reflect that.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopStream(screenRef.current);
      setScreen(null);
    });
    setScreen(stream);
  }, [setScreen]);

  const stopScreenShare = useCallback(async () => {
    stopStream(screenRef.current);
    setScreen(null);
  }, [setScreen]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setActiveCameraId(deviceId);
      if (cameraRef.current) await acquireCamera(deviceId);
    },
    [acquireCamera],
  );

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      setActiveMicrophoneId(deviceId);
      if (micRef.current) await acquireMic(deviceId);
    },
    [acquireMic],
  );

  const ensureDevicePermissions = useCallback(() => {
    // A no-op once any device is live; otherwise enumerate (labels appear once
    // the user grants a device elsewhere). We avoid forcing a getUserMedia
    // prompt here so opening a menu doesn't turn the camera light on.
    void refreshDevices();
  }, [refreshDevices]);

  const stopAll = useCallback(() => {
    stopStream(cameraRef.current);
    stopStream(micRef.current);
    stopStream(screenRef.current);
    setCamera(null);
    setMic(null);
    setScreen(null);
  }, [setCamera, setMic, setScreen]);

  // Release every device when the recorder surface unmounts.
  useEffect(() => {
    return () => {
      stopStream(cameraRef.current);
      stopStream(micRef.current);
      stopStream(screenRef.current);
    };
  }, []);

  const value: LocalMediaContextValue = {
    cameraStream,
    micStream,
    screenStream,
    isCameraEnabled: !!cameraStream,
    isMicrophoneEnabled: !!micStream,
    isScreenShareEnabled: !!screenStream,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    stopScreenShare,
    microphoneDevices,
    cameraDevices,
    activeMicrophoneId,
    activeCameraId,
    selectMicrophone,
    selectCamera,
    ensureDevicePermissions,
    stopAll,
  };

  return (
    <LocalMediaContext.Provider value={value}>
      {children}
    </LocalMediaContext.Provider>
  );
};

export default LocalMediaProvider;
