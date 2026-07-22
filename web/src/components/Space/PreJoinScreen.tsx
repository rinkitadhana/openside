import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { RiMicLine, RiMicOffLine, RiVolumeUpLine } from "react-icons/ri";
import { FiCheckSquare, FiSquare, FiVideo, FiVideoOff } from "react-icons/fi";
import { ArrowLeft, ChevronUp, Headphones, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import playClickSound from "@/utils/ClickSound";
import {
  applyAudioOutput,
  canSelectAudioOutput,
  cleanDeviceLabel,
  sortMediaDevices,
} from "@/lib/mediaDevices";
import UserMedia from "./UserMedia";
import UserAvatar from "./ui/UserAvatar";
import AppLoader from "@/components/shared/AppLoader";
import { useGetMe } from "@/hooks/useUserQuery";
import { useGetSpaceByJoinCode } from "@/hooks/useSpace";
import { useJoinSpace } from "@/hooks/useParticipant";
import type { PreJoinSettings } from "@/types/preJoinTypes";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import { DEFAULT_FPS, clampFps } from "@/lib/recordingConstants";

interface PreJoinScreenProps {
  onJoinCall: (settings: PreJoinSettings) => void;
  roomId: string;
  // Called when the room turns out to be gone/expired at join time, so the
  // parent can leave pre-join and show the not-found/expired screen.
  onRoomUnavailable?: () => void;
  // Called when the join is rejected because the session hit its plan's
  // participant cap, so the parent can show the "session is full" screen.
  onSpaceFull?: () => void;
}

const PreJoinScreen = ({
  onJoinCall,
  roomId,
  onRoomUnavailable,
  onSpaceFull,
}: PreJoinScreenProps) => {
  const navigate = useNavigate();
  const { data: user, isLoading: isLoadingUser } = useGetMe();
  const { data: spaceData, isLoading: isLoadingSpace } =
    useGetSpaceByJoinCode(roomId);
  const joinSpace = useJoinSpace(spaceData?.id || "");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>("");
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>("");
  const [videoSize, setVideoSize] = useState<{ width: number; height: number }>(
    () => {
      const stored = localStorage.getItem("prejoin-video-size-v4");
      if (stored) {
        try {
          return JSON.parse(stored) as { width: number; height: number };
        } catch {
          // fall through to default
        }
      }
      // Default to a comfortably smaller preview (user can drag it larger).
      return {
        width: Math.round(window.innerWidth * 0.5),
        height: Math.round(window.innerHeight * 0.7),
      };
    },
  );
  // Track the viewport so the preview can shrink/grow with the window instead of
  // being locked to a fixed pixel size. The stored/dragged size acts as the
  // preferred (max) size; the actual size is clamped to what fits on screen.
  const [viewport, setViewport] = useState<{ width: number; height: number }>(
    () => ({ width: window.innerWidth, height: window.innerHeight }),
  );
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  // With headphones there's no acoustic path back to the mic, so echo
  // cancellation would only chew on the loopback (the "voice cuts out"
  // problem). On speakers it must stay on or the mic test feeds back.
  const [usingHeadphones, setUsingHeadphones] = useState(
    () => localStorage.getItem("prejoin-headphones") === "1",
  );
  const streamRef = useRef<MediaStream | null>(null);
  // Monotonic token: each acquireStream call claims one, and only the latest
  // call is allowed to apply its result. Prevents concurrent acquisitions (e.g.
  // a StrictMode double-mount or a quick device switch) from racing and leaving
  // the preview stuck on the loading spinner.
  const acquireTokenRef = useRef(0);
  const testAudioRef = useRef<HTMLAudioElement>(null);
  const speakerTestAudioRef = useRef<HTMLAudioElement>(null);
  // Dedicated capture for the loopback test (echo cancellation off), separate
  // from the processed preview stream.
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const participantSessionId = getOrCreateSessionId(roomId);

  // Enumerate available mics/cameras/speakers and sync the selected ids with
  // the active tracks (labels are only available after permission is granted).
  const refreshDevices = async (currentStream: MediaStream) => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = sortMediaDevices(
      devices.filter((device) => device.kind === "audioinput"),
    );
    const cameras = sortMediaDevices(
      devices.filter((device) => device.kind === "videoinput"),
    );
    const speakers = sortMediaDevices(
      devices.filter((device) => device.kind === "audiooutput"),
    );
    setAudioDevices(mics);
    setVideoDevices(cameras);
    setSpeakerDevices(speakers);

    // Sync with the actually-active track, but never clobber an explicit user
    // choice that's still plugged in. Picking the "Default" pseudo-device
    // resolves to the hardware id in track settings, which would otherwise
    // jump the checkmark to a different row right after selecting.
    const activeAudioId = currentStream
      .getAudioTracks()[0]
      ?.getSettings().deviceId;
    const activeVideoId = currentStream
      .getVideoTracks()[0]
      ?.getSettings().deviceId;
    setSelectedAudioId((prev) =>
      prev && mics.some((device) => device.deviceId === prev)
        ? prev
        : activeAudioId || prev,
    );
    setSelectedVideoId((prev) =>
      prev && cameras.some((device) => device.deviceId === prev)
        ? prev
        : activeVideoId || prev,
    );
    setSelectedSpeakerId((prev) =>
      prev && speakers.some((device) => device.deviceId === prev)
        ? prev
        : (speakers[0]?.deviceId ?? ""),
    );
  };

  const acquireStream = async (audioId?: string, videoId?: string) => {
    const token = ++acquireTokenRef.current;
    const isCurrent = () => token === acquireTokenRef.current;

    try {
      setIsLoading(true);

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      // Capture with the browser's default processing (echo cancellation,
      // noise suppression, auto gain) - that's what the call itself publishes,
      // so the mic test sounds like what others actually hear, and the
      // loopback can't feed back through speakers.
      const audioConstraints: MediaTrackConstraints | boolean = audioId
        ? { deviceId: { exact: audioId } }
        : true;
      const videoConstraints: MediaTrackConstraints = {
        ...(videoId ? { deviceId: { exact: videoId } } : {}),
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        // Capture hint at the user's preferred frame rate; the server's CFR step
        // guarantees the final constant rate regardless of what hardware gives.
        frameRate: { ideal: clampFps(user?.targetFps ?? DEFAULT_FPS) },
        resizeMode: "none",
      } as MediaTrackConstraints;

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints,
        });
      } catch (combinedError) {
        const errorName =
          combinedError instanceof Error ? combinedError.name : "";

        // A requested device id went stale (unplugged / re-enumerated): retry
        // with browser-chosen devices instead of hard-failing the whole preview.
        if (errorName === "OverconstrainedError" && (audioId || videoId)) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } else if (errorName === "NotFoundError") {
          // A machine missing one kind (commonly: desktop with a mic but no
          // webcam) rejects the combined request outright, which would leave
          // the user unable to use or even list the device they DO have. Fall
          // back to whichever single kind exists.
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
            });
            if (isCurrent()) setVideoEnabled(false);
          } catch {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints,
            });
            if (isCurrent()) setAudioEnabled(false);
          }
        } else {
          throw combinedError;
        }
      }

      // A newer acquire (device switch / remount) superseded this one - throw
      // away this stream so it doesn't clobber state or leave the camera on.
      if (!isCurrent()) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const s = mediaStream.getVideoTracks()[0]?.getSettings();
      console.log("[capture]", s?.width, "x", s?.height, "@", s?.frameRate);

      const videoTracks = mediaStream.getVideoTracks();
      const audioTracks = mediaStream.getAudioTracks();

      videoTracks.forEach((track) => {
        track.enabled = videoEnabled;
      });

      audioTracks.forEach((track) => {
        track.enabled = audioEnabled;
      });

      await refreshDevices(mediaStream);
    } catch (error) {
      console.error("Error accessing media devices:", error);
      // Ignore errors from a superseded acquire so a stale failure can't surface
      // over a newer, successful stream.
      if (!isCurrent()) return;

      // Don't block the user with a full-screen error. Drop the preview to the
      // avatar, force mic/cam off, and explain what's wrong with a toast. Each
      // retry (toggling cam/mic) re-runs acquireStream, so the toast reappears
      // until the underlying permission/device issue is fixed.
      streamRef.current = null;
      setStream(null);
      setVideoEnabled(false);
      setAudioEnabled(false);

      // Preview errors leave both controls off; a later toggle retries access.
    } finally {
      // Only the latest acquire controls the loading state, so a stale call
      // resolving late can't flip the spinner back on (or off) incorrectly.
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  };

  const initializeStream = () => acquireStream();

  const handleSelectAudioDevice = (deviceId: string) => {
    setSelectedAudioId(deviceId);
    void acquireStream(deviceId, selectedVideoId || undefined);
  };

  const handleSelectVideoDevice = (deviceId: string) => {
    setSelectedVideoId(deviceId);
    void acquireStream(selectedAudioId || undefined, deviceId);
  };

  const handleSelectSpeakerDevice = (deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    // Route the mic-test loopback to the newly chosen speaker right away.
    void applyAudioOutput(testAudioRef.current, deviceId);
  };

  useEffect(() => {
    initializeStream();

    return () => {
      // Invalidate any in-flight acquire and release the camera/mic. This makes
      // the StrictMode mount/unmount/mount cycle safe: the first acquire's stream
      // is stopped and its token retired, so only the second one applies.
      acquireTokenRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      micTestStreamRef.current?.getTracks().forEach((track) => track.stop());
      micTestStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the device lists in sync when a mic/camera is plugged in or removed,
  // so newly connected devices show up without reloading the page.
  useEffect(() => {
    const handleDeviceChange = () => {
      if (streamRef.current) {
        void refreshDevices(streamRef.current);
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, []);

  // Auto-fill user's name from backend
  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user]);

  useEffect(() => {
    if (!stream) return;

    // Mic mute keeps the track alive (enabled = false) so unmute is instant.
    stream.getAudioTracks().forEach((track) => {
      track.enabled = audioEnabled;
    });

    // Camera "off" fully stops the track so the camera light and the tab's
    // media indicator actually turn off - enabled = false alone keeps the
    // device captured. Removing the dead track from the stream lets
    // handleVideoToggle's no-track path re-acquire it on toggle-on. This also
    // runs after every acquireStream (stream dep), so a device switch made
    // while the camera is off can't leave the new camera silently capturing.
    stream.getVideoTracks().forEach((track) => {
      if (videoEnabled) {
        track.enabled = true;
      } else {
        track.stop();
        stream.removeTrack(track);
      }
    });
  }, [videoEnabled, audioEnabled, stream]);

  const handleVideoToggle = () => {
    // Camera isn't available (denied/missing) - re-request it so a user who just
    // fixed permissions can turn it on. acquireStream re-toasts and keeps video
    // off if it still fails.
    if (!streamRef.current?.getVideoTracks().length) {
      setVideoEnabled(true);
      void acquireStream(
        selectedAudioId || undefined,
        selectedVideoId || undefined,
      );
      return;
    }
    setVideoEnabled((prev) => !prev);
  };

  const handleAudioToggle = () => {
    // Same idea as the camera: with no mic track, re-request rather than just
    // flipping a flag that has nothing to apply to.
    if (!streamRef.current?.getAudioTracks().length) {
      setAudioEnabled(true);
      void acquireStream(
        selectedAudioId || undefined,
        selectedVideoId || undefined,
      );
      return;
    }
    setAudioEnabled((prev) => !prev);
  };

  const stopMicTestStream = () => {
    micTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    micTestStreamRef.current = null;
  };

  const toggleMicTest = async () => {
    const audioEl = testAudioRef.current;
    if (!audioEl) return;

    if (isTestingMic) {
      audioEl.pause();
      audioEl.srcObject = null;
      stopMicTestStream();
      setIsTestingMic(false);
      return;
    }

    // Testing implies the mic is live - make sure it's on so the level meter
    // gives feedback too.
    if (!audioEnabled) setAudioEnabled(true);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    try {
      // Echo cancellation follows the headphones toggle. Headphones: EC off -
      // the AEC uses the page's audio output as its echo reference, and during
      // loopback that output is your own delayed voice, so it gets gated and
      // garbled. Speakers: EC on - without it the loopback feeds back and
      // howls. NS + AGC always stay on so the test sounds like the call.
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedAudioId ? { deviceId: { exact: selectedAudioId } } : {}),
          echoCancellation: !usingHeadphones,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micTestStreamRef.current = testStream;
      audioEl.srcObject = testStream;
      audioEl.muted = false;
      await applyAudioOutput(audioEl, selectedSpeakerId);
      await audioEl.play();
      setIsTestingMic(true);
    } catch (error) {
      stopMicTestStream();
      console.error("Unable to start mic test:", error);
    }
  };

  const setHeadphonesChoice = (next: boolean) => {
    if (next === usingHeadphones) return;
    setUsingHeadphones(next);
    localStorage.setItem("prejoin-headphones", next ? "1" : "0");
    // The constraint only applies to a fresh capture - stop a running test so
    // the next start picks up the new echo-cancellation setting.
    if (isTestingMic) {
      const audioEl = testAudioRef.current;
      if (audioEl) {
        audioEl.pause();
        audioEl.srcObject = null;
      }
      stopMicTestStream();
      setIsTestingMic(false);
    }
  };

  const toggleSpeakerTest = async () => {
    const audioEl = speakerTestAudioRef.current;
    if (!audioEl) return;

    if (isTestingSpeaker) {
      audioEl.pause();
      audioEl.currentTime = 0;
      setIsTestingSpeaker(false);
      return;
    }

    audioEl.src = "/audio/my_name_is_pink.mp3";
    try {
      await applyAudioOutput(audioEl, selectedSpeakerId);
      audioEl.onended = () => setIsTestingSpeaker(false);
      await audioEl.play();
      setIsTestingSpeaker(true);
    } catch (error) {
      console.error("Unable to play speaker test:", error);
    }
  };

  // Remember the user's preferred preview size across sessions.
  useEffect(() => {
    localStorage.setItem("prejoin-video-size-v4", JSON.stringify(videoSize));
  }, [videoSize]);

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startW: videoSize.width,
      startH: videoSize.height,
    };
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    const dx = event.clientX - resizeRef.current.startX;
    const dy = event.clientY - resizeRef.current.startY;
    const width = Math.min(
      Math.max(resizeRef.current.startW + dx, 380),
      Math.round(window.innerWidth * 0.7),
    );
    const height = Math.min(
      Math.max(resizeRef.current.startH + dy, 260),
      Math.round(window.innerHeight * 0.92),
    );
    setVideoSize({ width, height });
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current.srcObject = null;
    }
    micTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    micTestStreamRef.current = null;
    setIsTestingMic(false);
  }, [stream]);

  useEffect(() => {
    const handleWindowResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  // Clamp the preferred (dragged/stored) size to the current viewport so the
  // preview stays fully visible and responsive on small screens. Crucially, we
  // reserve room for the side panel (form) + gap so the preview can never push
  // the form off-screen - the preview shrinks first.
  const SIDE_PANEL_WIDTH = 300;
  const LAYOUT_GAP = 40; // gap-10
  const HORIZONTAL_MARGIN = 48; // breathing room on both sides
  // Below md the layout stacks vertically, so the stored/dragged size no longer
  // applies - the preview simply spans the width at 16:9, capped so the form
  // below it stays reachable without scrolling far.
  const isStackedLayout = viewport.width < 768;
  const availableForVideo =
    viewport.width - SIDE_PANEL_WIDTH - LAYOUT_GAP - HORIZONTAL_MARGIN;
  const stackedWidth = Math.min(viewport.width - 32, 560);
  const displaySize = isStackedLayout
    ? {
        width: stackedWidth,
        height: Math.min(
          Math.round((stackedWidth * 9) / 16),
          Math.round(viewport.height * 0.4),
        ),
      }
    : {
        width: Math.max(
          220,
          Math.min(
            videoSize.width,
            Math.round(viewport.width * 0.7),
            availableForVideo,
          ),
        ),
        height: Math.min(videoSize.height, Math.round(viewport.height * 0.92)),
      };

  const handleJoinCall = () => {
    if (!spaceData?.id || !name.trim()) return;

    // Clear any previous join errors
    setJoinError(null);

    // Call the join space API
    joinSpace.mutate(
      {
        displayName: name.trim(),
        participantSessionId,
      },
      {
        onSuccess: (data) => {
          // After successful API call, update the UI state
          onJoinCall({
            videoEnabled,
            audioEnabled,
            name: name.trim(),
            avatar: user?.avatar ?? undefined,
            audioDeviceId: selectedAudioId || undefined,
            echoCancellation: !usingHeadphones,
            videoDeviceId: selectedVideoId || undefined,
            audioOutputDeviceId: selectedSpeakerId || undefined,
            livekit: data.livekit,
          });
        },
        onError: (error: unknown) => {
          console.error("Failed to join space:", error);

          // Extract the status + message from the API response.
          let errorMessage = "Failed to join the space. Please try again.";
          let status: number | undefined;
          if (axios.isAxiosError(error)) {
            status = error.response?.status;
            const data = error.response?.data;
            if (
              data &&
              typeof data === "object" &&
              "message" in data &&
              typeof (data as { message?: unknown }).message === "string"
            ) {
              errorMessage = (data as { message: string }).message;
            }
          } else if (error instanceof Error) {
            errorMessage = error.message;
          }

          // The session hit the host plan's participant cap. Check this before
          // the generic room-unavailable handoff so a full room shows the
          // dedicated "session is full" screen instead of "not found".
          const spaceFull =
            status === 403 &&
            /full|maximum number of participants|participant limit|reached/i.test(
              errorMessage,
            );
          if (spaceFull && onSpaceFull) {
            onSpaceFull();
            return;
          }

          // The space row can be left marked LIVE while the underlying room has
          // already expired/ended, so the existence check passes but the join
          // fails. Don't trap the user on pre-join with an unresolvable inline
          // error - hand off to the parent's not-found/expired screen.
          const roomUnavailable =
            status === 404 ||
            status === 409 ||
            status === 410 ||
            /expir|no longer|not found|ended|inactive|doesn'?t exist/i.test(
              errorMessage,
            );
          if (roomUnavailable && onRoomUnavailable) {
            onRoomUnavailable();
            return;
          }

          setJoinError(errorMessage);
        },
      },
    );
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background p-2">
      {(isLoadingUser || isLoadingSpace) && (
        <AppLoader overlay message="Setting things up..." />
      )}
      {joinSpace.isPending && <AppLoader overlay message="Joining space..." />}
      <audio ref={testAudioRef} className="hidden" />
      <audio ref={speakerTestAudioRef} className="hidden" />

      <main className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 max-md:justify-start max-md:overflow-y-auto max-md:py-4">
          <div className="flex w-full max-w-full flex-col items-center justify-center gap-5 md:flex-row md:items-end md:gap-6 lg:gap-10">
            <div className="relative">
              <div
                style={{ width: displaySize.width, height: displaySize.height }}
                className="bg-primary rounded-xl overflow-hidden"
              >
                {isLoading ? (
                  <div className="w-full h-full flex items-center justify-center bg-primary">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2
                        className="animate-spin text-foreground"
                        size={30}
                      />
                    </div>
                  </div>
                ) : stream ? (
                  <UserMedia
                    url={stream}
                    muted={true}
                    playing={videoEnabled}
                    className="w-full h-full object-cover"
                    myVideo={true}
                    name={name}
                    avatar={user?.avatar ?? undefined}
                    preJoin={false}
                    hideElements={true}
                  />
                ) : (
                  <UserAvatar
                    name={name}
                    avatar={user?.avatar || ""}
                    preJoin={false}
                  />
                )}
              </div>
              <div className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2">
                <button
                  onClick={() => {
                    handleAudioToggle();
                    playClickSound();
                  }}
                  className={`flex items-center justify-center p-3 rounded-xl text-xl font-medium cursor-pointer transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                    audioEnabled
                      ? "bg-primary/50 hover:bg-primary/70"
                      : "bg-red-500/20 hover:bg-red-500/30 text-red-400"
                  }`}
                  disabled={isLoading}
                >
                  {audioEnabled ? <RiMicLine /> : <RiMicOffLine />}
                </button>

                <button
                  onClick={() => {
                    handleVideoToggle();
                    playClickSound();
                  }}
                  className={`flex items-center justify-center p-3 rounded-xl text-xl font-medium cursor-pointer transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                    videoEnabled
                      ? "bg-primary/50 hover:bg-primary/70"
                      : "bg-red-500/20 hover:bg-red-500/30 text-red-400"
                  }`}
                  disabled={isLoading}
                >
                  {videoEnabled ? <FiVideo /> : <FiVideoOff />}
                </button>
              </div>

              <div
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                className="absolute bottom-1.5 right-1.5 z-20 flex size-6 cursor-se-resize touch-none select-none items-center justify-center rounded-md bg-primary/50 text-foreground/70 transition-all duration-200 hover:bg-primary/70 hover:text-foreground max-md:hidden"
                title="Drag to resize"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M11 5L5 11M11 9L9 11"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            <div className="flex w-full max-w-[560px] shrink flex-col items-start gap-3 pb-4 md:w-[300px] md:min-w-[240px] md:max-w-full md:pb-0">
              {user && (
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground/80 bg-primary hover:bg-primary/60 cursor-pointer transition-all duration-200"
                >
                  <ArrowLeft size={16} />
                  <span>Back</span>
                </button>
              )}
              <div className="flex flex-col gap-1.5 mb-2">
                <h1 className="text-xl font-semibold">
                  {spaceData?.title || "Let's check your cam and mic"}
                </h1>
              </div>

              {/* Device selectors */}
              <div className="w-full flex flex-col">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="mb-2 w-full flex items-center justify-between gap-2 px-3 py-2 bg-primary rounded-lg text-sm cursor-pointer hover:bg-primary/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isLoading || videoDevices.length === 0}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FiVideo className="shrink-0 text-base text-foreground/60" />
                        <span className="truncate text-foreground/80">
                          {cleanDeviceLabel(
                            videoDevices.find(
                              (d) => d.deviceId === selectedVideoId,
                            )?.label ||
                              videoDevices[0]?.label ||
                              "",
                          ) || "Camera"}
                        </span>
                      </div>
                      <ChevronUp
                        size={14}
                        className="shrink-0 text-foreground/50"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className="w-[280px] border-0 bg-primary/70 text-foreground backdrop-blur-md"
                  >
                    <DropdownMenuLabel>Camera</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={selectedVideoId}
                      onValueChange={handleSelectVideoDevice}
                    >
                      {videoDevices.map((device, index) => (
                        <DropdownMenuRadioItem
                          key={device.deviceId}
                          value={device.deviceId}
                          className="cursor-pointer pl-2 [&>span:first-child]:hidden"
                        >
                          {selectedVideoId === device.deviceId ? (
                            <FiCheckSquare className="size-4" />
                          ) : (
                            <FiSquare className="size-4" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {cleanDeviceLabel(device.label) ||
                              `Camera ${index + 1}`}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="min-w-0 flex-1 flex items-center justify-between gap-2 px-3 py-2 bg-primary rounded-lg text-sm cursor-pointer hover:bg-primary/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isLoading || audioDevices.length === 0}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <RiMicLine className="shrink-0 text-base text-foreground/60" />
                          <span className="truncate text-foreground/80">
                            {cleanDeviceLabel(
                              audioDevices.find(
                                (d) => d.deviceId === selectedAudioId,
                              )?.label ||
                                audioDevices[0]?.label ||
                                "",
                            ) || "Microphone"}
                          </span>
                        </div>
                        <ChevronUp
                          size={14}
                          className="shrink-0 text-foreground/50"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="start"
                      className="w-[280px] border-0 bg-primary/70 text-foreground backdrop-blur-md"
                    >
                      <DropdownMenuLabel>Microphone</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={selectedAudioId}
                        onValueChange={handleSelectAudioDevice}
                      >
                        {audioDevices.map((device, index) => (
                          <DropdownMenuRadioItem
                            key={device.deviceId}
                            value={device.deviceId}
                            className="cursor-pointer pl-2 [&>span:first-child]:hidden"
                          >
                            {selectedAudioId === device.deviceId ? (
                              <FiCheckSquare className="size-4" />
                            ) : (
                              <FiSquare className="size-4" />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {cleanDeviceLabel(device.label) ||
                                `Microphone ${index + 1}`}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    onClick={toggleMicTest}
                    disabled={isLoading || !stream}
                    className={`shrink-0 flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium select-none cursor-pointer transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                      isTestingMic
                        ? "bg-brand/20 text-foreground"
                        : "bg-primary text-foreground/80 hover:bg-primary/60"
                    }`}
                  >
                    {isTestingMic ? "Listening" : "Test"}
                  </button>
                </div>

                {canSelectAudioOutput && (
                  <div className="mt-2 flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="min-w-0 flex-1 flex items-center justify-between gap-2 px-3 py-2 bg-primary rounded-lg text-sm cursor-pointer hover:bg-primary/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isLoading || speakerDevices.length === 0}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <RiVolumeUpLine className="shrink-0 text-base text-foreground/60" />
                            <span className="truncate text-foreground/80">
                              {cleanDeviceLabel(
                                speakerDevices.find(
                                  (d) => d.deviceId === selectedSpeakerId,
                                )?.label ||
                                  speakerDevices[0]?.label ||
                                  "",
                              ) || "Speaker"}
                            </span>
                          </div>
                          <ChevronUp
                            size={14}
                            className="shrink-0 text-foreground/50"
                          />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="top"
                        align="start"
                        className="w-[280px] border-0 bg-primary/70 text-foreground backdrop-blur-md"
                      >
                        <DropdownMenuLabel>Speaker</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={selectedSpeakerId}
                          onValueChange={handleSelectSpeakerDevice}
                        >
                          {speakerDevices.map((device, index) => (
                            <DropdownMenuRadioItem
                              key={device.deviceId}
                              value={device.deviceId}
                              className="cursor-pointer pl-2 [&>span:first-child]:hidden"
                            >
                              {selectedSpeakerId === device.deviceId ? (
                                <FiCheckSquare className="size-4" />
                              ) : (
                                <FiSquare className="size-4" />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {cleanDeviceLabel(device.label) ||
                                  `Speaker ${index + 1}`}
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      onClick={toggleSpeakerTest}
                      className={`shrink-0 flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium select-none cursor-pointer transition-all duration-200 ${
                        isTestingSpeaker
                          ? "bg-brand/20 text-foreground"
                          : "bg-primary text-foreground/80 hover:bg-primary/60"
                      }`}
                    >
                      {isTestingSpeaker ? "Playing" : "Test"}
                    </button>
                  </div>
                )}
              </div>

              <div className="w-full flex flex-col gap-2">
                <p className="flex items-center gap-2 px-0.5 text-base text-foreground/80 select-none">
                  <Headphones size={18} className="shrink-0 text-foreground/60" />
                  Are you wearing headphones?
                </p>
                <div className="flex w-full items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHeadphonesChoice(true)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium select-none cursor-pointer transition-all duration-200 ${
                      usingHeadphones
                        ? "bg-brand/20 text-foreground"
                        : "bg-primary text-foreground/60 hover:bg-primary/60"
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeadphonesChoice(false)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium select-none cursor-pointer transition-all duration-200 ${
                      !usingHeadphones
                        ? "bg-brand/20 text-foreground"
                        : "bg-primary text-foreground/60 hover:bg-primary/60"
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>

              <div className="w-full flex flex-col gap-2">
                <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-foreground/40">
                  Ready to join
                </p>
                <input
                  type="text"
                  id="name"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-primary border border-border rounded-lg text-sm focus:outline-none transition-all duration-200"
                />
              </div>

              {joinError && (
                <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-red-400 text-sm">{joinError}</p>
                </div>
              )}

              <button
                onClick={handleJoinCall}
                disabled={
                  isLoading ||
                  !name.trim() ||
                  joinSpace.isPending ||
                  !spaceData?.id
                }
                className="py-2.5 w-full select-none text-center bg-brand/80 hover:bg-brand/60 font-medium disabled:bg-brand/40 disabled:text-foreground/40 disabled:cursor-not-allowed text-sm rounded-lg cursor-pointer transition-all duration-200"
              >
                <span>Join Call</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PreJoinScreen;
