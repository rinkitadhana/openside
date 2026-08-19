/**
 * RecordingProvider
 *
 * Runs the per-participant recording orchestration (useRecordingManager) inside
 * the LiveKit room so it can read the local camera/mic tracks, and exposes a
 * tiny context that the controls + indicator consume.
 *
 * The recording captures the local participant's live camera + mic
 * MediaStreamTracks (the full-quality source tracks LiveKit holds), assembled
 * into a single MediaStream that the MediaRecorders consume.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import { useSocket } from "@/context/socket";
import useUnloadWarning from "@/hooks/useUnloadWarning";
import useRecordingManager, {
  type RecordingState,
} from "@/hooks/useRecordingManager";
import { useGetRecordingSession } from "@/hooks/useRecording";
import { useEntitlements } from "@/hooks/useUsage";
import { useGetMe } from "@/hooks/useUserQuery";
import type { RecordingSessionStatus } from "@/types/recordingTypes";
import CountdownOverlay from "./CountdownOverlay";

interface RecordingContextValue {
  recordingState: RecordingState;
  /** True while a recording is active anywhere in its lifecycle. */
  isActive: boolean;
  recordingDurationMs: number;
  pendingUploads: number;
  /** Chunk upload progress, 0–100. */
  uploadProgress: number;
  /** Seconds left in the synced 3-2-1 lead-in, or null when not counting down. */
  countdownValue: number | null;
  canControl: boolean;
  error: string | null;
  /** The previous recording needs its server-side stop retried before starting another. */
  stopRequestFailed: boolean;
  backendStatus: RecordingSessionStatus | null;
  /** The space this recording belongs to (for looking up per-track thumbnails). */
  spaceId: string | undefined;
  /** The current recording session id (used to remember dismissed UI per run). */
  sessionId: string | null;
  /** Whether the host's plan offers the per-session cloud backup toggle. */
  cloudBackupAllowed: boolean;
  /** Per-session cloud backup opt-in (always defaults to OFF). */
  cloudBackup: boolean;
  setCloudBackup: (enabled: boolean) => void;
  openRecording: () => void;
  stopRecording: () => Promise<void>;
  toggleRecording: () => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export const useRecordingContext = (): RecordingContextValue => {
  const ctx = useContext(RecordingContext);
  if (!ctx) {
    throw new Error(
      "useRecordingContext must be used within a RecordingProvider",
    );
  }
  return ctx;
};

interface RecordingProviderProps {
  spaceId: string | undefined;
  roomCode: string;
  isHost: boolean;
  /** Populated with a "finish my recording now" function so the parent's leave
   *  handler can flush + upload + complete before disconnecting. */
  finalizeOnLeaveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Mirrors the pre-join headphones choice: speakers request PCM AEC. */
  recordingEchoCancellation?: boolean;
  children: ReactNode;
}

const ACTIVE_STATES: RecordingState[] = [
  "starting",
  "countdown",
  "recording",
  "stopping",
  "uploading",
];

// LiveKit publishes the screen-share video and its (optional) system-audio
// track as two separate operations, so the audio track lands a beat after the
// video track. The screen MediaRecorder can't add a track once it has started,
// so when a share begins we wait this long for the audio track before attaching
// the recorder. If none arrives in the window, the share has no audio (e.g. a
// macOS window/screen share, where the OS never exposes it) and we attach
// video-only. Kept short so audioless shares lose minimal leading footage.
const SCREEN_AUDIO_ATTACH_GRACE_MS = 600;

// Transitional states where a button press should be ignored (mid-flight).
const BUSY_STATES: RecordingState[] = [
  "starting",
  "countdown",
  "stopping",
  "uploading",
];

const RecordingProvider = ({
  spaceId,
  roomCode,
  isHost,
  finalizeOnLeaveRef,
  recordingEchoCancellation,
  children,
}: RecordingProviderProps) => {
  const {
    localParticipant,
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const socket = useSocket();

  const participantSessionId = useMemo(
    () => getOrCreateSessionId(roomCode),
    [roomCode],
  );

  // Join the Socket.IO room so recording start/stop broadcasts reach us.
  useEffect(() => {
    if (!socket) return;
    socket.emit("join-room", roomCode);
    return () => {
      socket.emit("leave-room", roomCode);
    };
  }, [socket, roomCode]);

  const role = localParticipant.attributes.role;
  const canControl = isHost || role === "HOST" || role === "CO_HOST";

  // Cloud backup is a per-session choice, seeded from the host's saved default
  // (Settings → Recording) and still OFF unless the plan allows it. The server
  // re-checks the plan on start, so this is UI gating only.
  const { data: entitlements } = useEntitlements(canControl);
  const { data: me } = useGetMe();
  const cloudBackupAllowed = entitlements?.cloudBackupAllowed === true;
  const [cloudBackup, setCloudBackup] = useState(false);
  // Seed from the saved default once, before any recording starts and only
  // while the toggle hasn't been touched for this mount.
  const seededBackupRef = useRef(false);
  useEffect(() => {
    if (seededBackupRef.current) return;
    if (me?.cloudBackupEnabled === undefined) return;
    seededBackupRef.current = true;
    if (me.cloudBackupEnabled) setCloudBackup(true);
  }, [me?.cloudBackupEnabled]);

  // Stable live-stream getter for the manager. buildLocalStream is defined below
  // (it needs the track snapshots), so the manager reads it through this ref -
  // letting a late-join start poll for the current tracks on demand.
  const buildLocalStreamRef = useRef<(() => MediaStream | null) | null>(null);
  const getLiveStream = useCallback(
    () => buildLocalStreamRef.current?.() ?? null,
    [],
  );

  const manager = useRecordingManager({
    spaceId: spaceId ?? "",
    participantSessionId,
    isHost: canControl,
    roomId: roomCode,
    cloudBackup: cloudBackupAllowed && cloudBackup,
    getLiveStream,
    cameraEnabled: isCameraEnabled,
    recordingEchoCancellation,
  });

  // Expose "finish my recording now" to the parent leave handler. Kept fresh each
  // render so it captures the current recording state / finalizer. Only does work
  // while a recording is active, so a normal leave is unaffected.
  if (finalizeOnLeaveRef) {
    finalizeOnLeaveRef.current = async () => {
      if (ACTIVE_STATES.includes(manager.recordingState)) {
        await manager.finishLocalRecording();
      }
    };
  }

  const {
    setStream,
    setScreenStream,
    attachScreenStream,
    detachScreenStream,
    startRecording,
    stopRecording,
    recordingState,
  } = manager;
  const shouldPollBackend =
    !!manager.sessionId &&
    ["stopping", "uploading", "complete"].includes(manager.recordingState);
  const { data: backendSession } = useGetRecordingSession(
    manager.sessionId ?? "",
    shouldPollBackend,
  );

  // Read the live source tracks directly so their identity changes the moment a
  // track is (un)published - a late-join recorder starts the instant a stream is
  // available, so the effect below must re-run as soon as the camera track lands.
  const cameraTrack =
    localParticipant.getTrackPublication(Track.Source.Camera)?.track
      ?.mediaStreamTrack ?? null;
  const micTrack =
    localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      ?.mediaStreamTrack ?? null;

  // Returns whatever source tracks are attached right now. The recorder start
  // (useRecordingManager) decides whether to wait for a not-yet-attached camera
  // track - a late joiner's video track can land a beat after recording begins -
  // so this stays a plain snapshot and never returns null while audio exists.
  const buildLocalStream = useCallback((): MediaStream | null => {
    const tracks: MediaStreamTrack[] = [];
    if (cameraTrack) tracks.push(cameraTrack);
    if (micTrack) tracks.push(micTrack);

    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [cameraTrack, micTrack]);
  // Keep the manager's live-stream getter pointed at the current builder.
  buildLocalStreamRef.current = buildLocalStream;

  // Read the screen tracks reactively (like camera/mic above) so their identity
  // changes the moment each is (un)published - this is what lets the attach
  // effect below re-fire when the system-audio track lands after the video one.
  const screenVideoTrack =
    localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track
      ?.mediaStreamTrack ?? null;
  const screenAudioTrack =
    localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track
      ?.mediaStreamTrack ?? null;

  const buildLocalScreenStream = useCallback((): MediaStream | null => {
    const tracks: MediaStreamTrack[] = [];
    if (screenVideoTrack) tracks.push(screenVideoTrack);
    if (screenAudioTrack) tracks.push(screenAudioTrack);

    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [screenVideoTrack, screenAudioTrack]);

  // Keep the manager's stream reference fresh as camera/mic come and go, so the
  // moment recording starts it captures the current source tracks.
  useEffect(() => {
    setStream(buildLocalStream());
    setScreenStream(buildLocalScreenStream());
  }, [
    buildLocalStream,
    buildLocalScreenStream,
    setStream,
    setScreenStream,
    isCameraEnabled,
    isMicrophoneEnabled,
    isScreenShareEnabled,
  ]);

  // Pending grace-window timer for the audio-less attach path. Held in a ref so
  // it survives re-renders: this effect's deps (attachScreenStream) churn
  // constantly during recording as the uploader's identity changes, so clearing
  // the timer in the effect cleanup would restart it every render and it would
  // never fire - starving a video-only share of its attach entirely.
  const screenAttachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const clearScreenAttachTimer = useCallback(() => {
    if (screenAttachTimerRef.current) {
      clearTimeout(screenAttachTimerRef.current);
      screenAttachTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Not recording, or nothing being shared: cancel any pending grace attach.
    if (
      recordingState !== "recording" ||
      !isScreenShareEnabled ||
      !screenVideoTrack
    ) {
      clearScreenAttachTimer();
      return;
    }

    const attach = () => {
      clearScreenAttachTimer();
      const screenStream = buildLocalScreenStream();
      if (!screenStream || screenStream.getVideoTracks().length === 0) return;
      setScreenStream(screenStream);
      void attachScreenStream(screenStream);
    };

    // Audio already present: attach immediately with it. (attachScreenStream is
    // idempotent, so re-running this effect while sharing is harmless.)
    if (screenAudioTrack) {
      attach();
      return;
    }

    // No audio track yet: give it a short grace window to arrive (it's published
    // a beat after the video track) before committing to a video-only recorder -
    // the MediaRecorder can't add the audio track after it starts. Schedule
    // once, guarded by the ref, so re-renders don't restart the timer. When the
    // audio track lands within the window, screenAudioTrack changes, this effect
    // re-runs, and we attach with audio immediately.
    if (!screenAttachTimerRef.current) {
      screenAttachTimerRef.current = setTimeout(
        attach,
        SCREEN_AUDIO_ATTACH_GRACE_MS,
      );
    }
  }, [
    recordingState,
    isScreenShareEnabled,
    screenVideoTrack,
    screenAudioTrack,
    buildLocalScreenStream,
    setScreenStream,
    attachScreenStream,
    clearScreenAttachTimer,
  ]);

  // Cancel any pending grace attach on unmount.
  useEffect(() => clearScreenAttachTimer, [clearScreenAttachTimer]);

  // Screen share turned off while still recording - stop that screen track so a
  // later share records as its own track. detachScreenStream no-ops when there's
  // no active screen recording, so this is safe to fire whenever sharing is off.
  useEffect(() => {
    if (recordingState !== "recording" || isScreenShareEnabled) return;
    void detachScreenStream();
  }, [recordingState, isScreenShareEnabled, detachScreenStream]);

  const isActive = ACTIVE_STATES.includes(recordingState);

  // Closing/reloading this tab kills the capture (see useUnloadWarning), so
  // confirm first while anything is still recording or uploading.
  useUnloadWarning(isActive);

  const toggleRecording = useCallback(() => {
    if (!canControl) return;

    // Ignore clicks while a start/stop is mid-flight (incl. the lead-in).
    if (BUSY_STATES.includes(recordingState)) return;

    if (!spaceId) {
      return;
    }

    if (recordingState === "recording") {
      void stopRecording();
      return;
    }

    if (manager.stopRequestFailed) {
      void stopRecording();
      return;
    }

    const stream = buildLocalStream();
    if (!stream || stream.getTracks().length === 0) {
      return;
    }

    setStream(stream);
    void startRecording(stream, buildLocalScreenStream());
  }, [
    canControl,
    spaceId,
    recordingState,
    manager.stopRequestFailed,
    stopRecording,
    buildLocalStream,
    buildLocalScreenStream,
    setStream,
    startRecording,
  ]);

  // Upload progress: uploaded / produced chunks.
  const totalChunks = manager.combinedChunkIndex;
  const uploadedChunks = Math.max(0, totalChunks - manager.pendingUploads);
  const uploadProgress =
    totalChunks > 0 ? Math.round((uploadedChunks / totalChunks) * 100) : 0;

  const value = useMemo<RecordingContextValue>(
    () => ({
      recordingState: manager.recordingState,
      isActive,
      recordingDurationMs: manager.recordingDurationMs,
      pendingUploads: manager.pendingUploads,
      uploadProgress,
      countdownValue: manager.countdownValue,
      canControl,
      error: manager.error,
      stopRequestFailed: manager.stopRequestFailed,
      backendStatus: backendSession?.status ?? null,
      spaceId,
      sessionId: manager.sessionId,
      cloudBackupAllowed,
      cloudBackup,
      setCloudBackup,
      openRecording: () => {
        if (!spaceId || !manager.sessionId) return;
        const params = new URLSearchParams({
          recordingSessionId: manager.sessionId,
        });
        window.open(
          `/dashboard/project/${spaceId}?${params.toString()}`,
          "_blank",
          "noopener",
        );
      },
      stopRecording,
      toggleRecording,
    }),
    [
      manager,
      isActive,
      uploadProgress,
      canControl,
      backendSession?.status,
      spaceId,
      cloudBackupAllowed,
      cloudBackup,
      stopRecording,
      toggleRecording,
    ],
  );

  return (
    <RecordingContext.Provider value={value}>
      {children}
      {manager.recordingState === "countdown" && (
        <CountdownOverlay value={manager.countdownValue} />
      )}
    </RecordingContext.Provider>
  );
};

export default RecordingProvider;
