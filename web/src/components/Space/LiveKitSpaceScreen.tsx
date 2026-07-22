import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import {
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RoomOptions,
} from "livekit-client";
import { useParams } from "react-router-dom";
import { useEndSpace, useGetSpaceByJoinCode } from "@/hooks/useSpace";
import { useGetMe } from "@/hooks/useUserQuery";
import type { PreJoinSettings } from "@/types/preJoinTypes";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import { stopAllLocalMedia } from "@/lib/mediaTracker";
import { DEFAULT_FPS, clampFps } from "@/lib/recordingConstants";
import type { CallExitReason } from "./CallExitScreen";
import AppLoader from "@/components/shared/AppLoader";
import LiveKitControls from "./livekit/LiveKitControls";
import LiveKitVideoStage from "./livekit/LiveKitVideoStage";
import { LiveKitChatProvider } from "./chat/LiveKitChatProvider";
import { LiveKitReactionsProvider } from "./reactions/LiveKitReactionsProvider";
import LiveKitReactionsOverlay from "./reactions/LiveKitReactionsOverlay";
import ChatSidebar from "./sidebars/ChatSidebar";
import InfoSidebar from "./sidebars/InfoSidebar";
import UsersSidebar from "./sidebars/UsersSidebar";
import RecordingProvider from "./recording/RecordingProvider";

type SidebarType = "info" | "users" | "chat" | null;

const SIDEBAR_MIN_WIDTH = 350;
const SIDEBAR_MAX_WIDTH = 800;
const SIDEBAR_WIDTH_STORAGE_KEY = "space-sidebar-width";

const clampSidebarWidth = (width: number) =>
  Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);

const isClientInitiatedDisconnectError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return message.toLowerCase().includes("client initiated disconnect");
};

interface LiveKitSpaceScreenProps {
  activeSidebar: SidebarType;
  preJoinSettings: PreJoinSettings | null;
  toggleSidebar: (sidebarType: SidebarType) => void;
  onExit: (reason: CallExitReason) => void;
}

const LiveKitSpaceScreen = ({
  activeSidebar,
  preJoinSettings,
  toggleSidebar,
  onExit,
}: LiveKitSpaceScreenProps) => {
  const params = useParams();
  const roomCode = params.roomId as string;
  const { data: user, isLoading: isLoadingUser } = useGetMe();
  const { data: spaceData, isLoading: isLoadingSpace } =
    useGetSpaceByJoinCode(roomCode);
  const endSpace = useEndSpace();
  const [connectionReady, setConnectionReady] = useState(false);
  // `${identity}::${source}` of the spotlighted (pinned) tile, or null for the
  // grid. Shared by the video stage (click-to-spotlight) and the users sidebar
  // (Pin), so pinning a user and clicking their card are the same action.
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null);
  const [deafened, setDeafened] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  // Populated by RecordingProvider with a "finish my recording now" function, so
  // leaving mid-recording flushes + uploads + completes before we disconnect.
  const recordingFinalizeRef = useRef<(() => Promise<void>) | null>(null);
  const connectionToastRef = useRef<string | null>(null);
  // One default-device retry per kind when the pre-join (exact) device fails.
  const retriedDeviceKindsRef = useRef<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampSidebarWidth(stored)
      : SIDEBAR_MIN_WIDTH;
  });
  const sidebarResizeRef = useRef<{ startX: number; startW: number } | null>(
    null,
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const handleSidebarResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeRef.current = {
      startX: event.clientX,
      startW: sidebarWidth,
    };
  };

  const handleSidebarResizeMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!sidebarResizeRef.current) return;
    // The sidebar is docked to the right edge, so dragging left (negative dx)
    // grows it.
    const dx = event.clientX - sidebarResizeRef.current.startX;
    setSidebarWidth(clampSidebarWidth(sidebarResizeRef.current.startW - dx));
  };

  const handleSidebarResizeEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    sidebarResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const livekit = preJoinSettings?.livekit;
  const isHost = !!user && !!spaceData && user.id === spaceData.host?.id;
  // The creator caches host join settings during the create flow, so this is a
  // reliable, instant signal that this user hosts the room - used to show the
  // invite panel immediately instead of waiting on the spaceData query.
  const isHostHint = useMemo(
    () => !!sessionStorage.getItem(`HOST_JOIN_SETTINGS_${roomCode}`),
    [roomCode],
  );

  const audioDeviceId = preJoinSettings?.audioDeviceId;
  const echoCancellation = preJoinSettings?.echoCancellation ?? true;
  const videoDeviceId = preJoinSettings?.videoDeviceId;
  const audioOutputDeviceId = preJoinSettings?.audioOutputDeviceId;

  const roomOptions = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      // Carry the mic/camera the user picked on the pre-join screen into the
      // call. `exact` matters: a bare string is only an "ideal" constraint, so
      // the browser was free to silently capture from a different device than
      // the one chosen on pre-join.
      audioCaptureDefaults: {
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
        echoCancellation,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
        // The recorder pulls LiveKit's published track, so THIS governs the
        // captured frame rate. Start from the 2160p preset but override its rate
        // with the user's preference (the server's CFR step is the guarantee).
        resolution: {
          ...VideoPresets.h2160.resolution,
          frameRate: clampFps(user?.targetFps ?? DEFAULT_FPS),
        },
      },
      // Cap screen capture at 1080p30 (encoding a native 4K/Retina surface is
      // what makes share start-up stutter) and-crucially-publish at 30fps: the
      // SDK's default screenShareEncoding is 15fps, which makes shared motion
      // look laggy even though capture runs at 30.
      screenShareCaptureDefaults: {
        resolution: ScreenSharePresets.h1080fps30.resolution,
        // NB: tab/system audio capture is requested at the call site
        // (SCREEN_CAPTURE_OPTIONS in LiveKitControls), not here - LiveKit's
        // setScreenShareEnabled/createScreenTracks ignore these defaults and
        // only honor the options passed to them.
      },
      publishDefaults: {
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
      },
    }),
    [audioDeviceId, echoCancellation, videoDeviceId, user?.targetFps],
  );

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  const showConnectionToast = useCallback((message: string) => {
    if (connectionToastRef.current === message) return;

    connectionToastRef.current = message;

    // Only dedupe a burst of identical errors - after a while the same error
    // happening again is new information and should toast again.
    window.setTimeout(() => {
      if (connectionToastRef.current === message) {
        connectionToastRef.current = null;
      }
    }, 8000);
  }, []);

  // Hard-stop every local track so the OS/browser releases the camera & mic
  // (the tab's recording indicator turns off). room.disconnect() is supposed to
  // do this, but we stop them explicitly to guarantee the device is freed on any
  // exit path - leave, end-for-all, being removed, or unmount.
  const releaseLocalMedia = useCallback(() => {
    try {
      room.localParticipant.trackPublications.forEach((publication) => {
        // Stop both the LiveKit track wrapper and the raw MediaStreamTrack - the
        // latter is what actually holds the OS camera/mic, and stopping only the
        // wrapper can leave the device (and the tab indicator) active.
        publication.track?.mediaStreamTrack?.stop();
        publication.track?.stop();
      });
    } catch (error) {
      console.error("Failed to release local media:", error);
    }

    // Belt-and-suspenders: stop every track ever acquired via getUserMedia/
    // getDisplayMedia (including LiveKit's internal ones), which is what actually
    // turns off the tab's camera/mic indicator.
    stopAllLocalMedia();
  }, [room]);

  // Belt-and-suspenders: whatever route the user takes out of the call, release
  // the devices and drop the connection when this screen unmounts.
  useEffect(() => {
    return () => {
      releaseLocalMedia();
      room.disconnect(true);
    };
  }, [room, releaseLocalMedia]);

  // Drop a stale spotlight when that participant leaves - otherwise they'd be
  // silently re-spotlighted full-screen if they rejoined later. Their camera and
  // screen tiles share the identity prefix, so match on that.
  useEffect(() => {
    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      setSpotlightKey((previous) =>
        previous?.startsWith(`${participant.identity}::`) ? null : previous,
      );
    };

    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      room.off(
        RoomEvent.ParticipantDisconnected,
        handleParticipantDisconnected,
      );
    };
  }, [room]);

  // Deafen = actually stop receiving audio, not just volume 0 - otherwise a
  // deafened user keeps downloading every participant's audio. The volume-0
  // pass in LiveKitControls stays as a belt-and-suspenders for elements that
  // are already playing.
  useEffect(() => {
    const setAudioSubscriptions = (subscribed: boolean) => {
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          publication.setSubscribed(subscribed);
        });
      });
    };

    if (!deafened) {
      setAudioSubscriptions(true);
      return;
    }

    setAudioSubscriptions(false);

    // Audio published while deafened must also stay unsubscribed.
    const handleTrackPublished = (publication: RemoteTrackPublication) => {
      if (publication.kind === Track.Kind.Audio) {
        publication.setSubscribed(false);
      }
    };

    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [deafened, room]);

  useEffect(() => {
    let cancelled = false;

    const prepareConnection = async () => {
      if (!livekit?.url) return;

      try {
        await room.prepareConnection(livekit.url, livekit.token);
      } catch (error) {
        // The warm-up is an optimization only - a transient failure here must
        // not block joining (gating connect on it used to strand the user on a
        // never-connecting stage). Real connect errors surface via onError.
        if (!isClientInitiatedDisconnectError(error)) {
          console.warn("LiveKit connection warm-up failed:", error);
        }
      } finally {
        if (!cancelled) {
          setConnectionReady(true);
        }
      }
    };

    prepareConnection();

    return () => {
      cancelled = true;
    };
  }, [livekit?.token, livekit?.url, room, showConnectionToast]);

  // Finish THIS participant's own recording (flush + upload + complete) before we
  // leave/disconnect, so footage captured so far isn't abandoned. Bounded so a
  // stuck upload can't trap the user; the backend recovery sweep + allow-inactive
  // uploads finalize anything still pending afterwards. Safe to call on any exit.
  const finalizeRecordingBeforeExit = useCallback(async () => {
    const finalize = recordingFinalizeRef.current;
    if (!finalize) return;
    setIsLeaving(true);
    try {
      await Promise.race([
        finalize(),
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]);
    } catch (error) {
      console.error("Failed to finalize recording before exit:", error);
    }
  }, []);

  const handleLeave = async () => {
    await finalizeRecordingBeforeExit();

    // Optimistic: drop the connection and show the "left" screen immediately.
    // LiveKit is the source of truth for presence - disconnecting fires a
    // `participant_left` webhook that marks this participant inactive in the DB.
    // No explicit leave API call is needed (and it would miss tab-close/crash).
    releaseLocalMedia();
    room.disconnect(true);
    onExit("left");
  };

  const handleEndForAll = () => {
    if (!spaceData?.id) return;

    // Block until the backend confirms (the "Ending..." overlay below keeps
    // the host informed). Ending optimistically meant a failed request left
    // the room alive for everyone else while the host already saw the ended
    // screen. On success the room deletion fires `room_finished`, so other
    // participants exit via the ROOM_DELETED disconnect.
    endSpace.mutate(
      {
        spaceId: spaceData.id,
        participantSessionId: getOrCreateSessionId(roomCode),
      },
      {
        onSuccess: async () => {
          // Save the host's own recording before tearing the room down.
          await finalizeRecordingBeforeExit();
          releaseLocalMedia();
          room.disconnect(true);
          onExit("ended");
        },
        onError: (error) => {
          console.error("Failed to end space for all:", error);
        },
      },
    );
  };

  const renderSidebarContent = () => {
    switch (activeSidebar) {
      case "info":
        return <InfoSidebar onClose={() => toggleSidebar(null)} />;
      case "users":
        return (
          <UsersSidebar
            isHost={isHost}
            onClose={() => toggleSidebar(null)}
            onSpotlight={setSpotlightKey}
            spotlightKey={spotlightKey}
            spaceId={spaceData?.id}
          />
        );
      case "chat":
        return <ChatSidebar onClose={() => toggleSidebar(null)} />;
      default:
        return null;
    }
  };

  if (!livekit) {
    return (
      <div className="relative h-full rounded-2xl bg-background p-2">
        <div className="absolute left-4 top-4 z-10 rounded-full bg-primary px-3 py-1.5 text-xs text-foreground/70">
          Waiting for join token
        </div>
      </div>
    );
  }

  const connectOptions = {
    maxRetries: 5,
    peerConnectionTimeout: 60000,
  };

  return (
    <LiveKitRoom
      room={room}
      serverUrl={livekit.url}
      token={livekit.token}
      connect={connectionReady}
      audio={preJoinSettings?.audioEnabled ?? true}
      video={preJoinSettings?.videoEnabled ?? true}
      connectOptions={connectOptions}
      onConnected={() => {
        // Carry the speaker chosen on pre-join into the call; LiveKit applies
        // the sinkId to every audio element it manages.
        if (audioOutputDeviceId) {
          room
            .switchActiveDevice("audiooutput", audioOutputDeviceId)
            .catch((error) =>
              console.error("Unable to apply pre-join speaker:", error),
            );
        }
      }}
      onDisconnected={(reason) => {
        // Our own leave/end flows disconnect with CLIENT_INITIATED and drive
        // the exit themselves (including on unmount).
        if (reason === DisconnectReason.CLIENT_INITIATED) return;

        // Server-initiated exits (host ended the room, this user was removed)
        // leave the network up, so we can still finish uploading this
        // participant's recording before exiting. A real network drop can't
        // upload anyway - its chunks resume on the next mount - so don't stall
        // the exit screen on it.
        const canFinalize =
          reason === DisconnectReason.ROOM_DELETED ||
          reason === DisconnectReason.PARTICIPANT_REMOVED;

        void (async () => {
          if (canFinalize) await finalizeRecordingBeforeExit();

          // Free the camera & mic right now rather than waiting for the unmount
          // cleanup, so the tab indicator drops the moment the exit appears.
          releaseLocalMedia();

          if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
            onExit("duplicate");
          } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
            onExit("removed");
          } else if (reason === DisconnectReason.ROOM_DELETED) {
            onExit("ended");
          } else {
            // Everything else (network drop after reconnect attempts ran out,
            // server shutdown, join failure, ...) used to fall through silently,
            // stranding the user on a frozen call UI with dead controls. Land
            // them on the "left" screen, which offers Rejoin.
            onExit("left");
          }
        })();
      }}
      onError={(error) => {
        if (error.name === "NotAllowedError") return;
        if (isClientInitiatedDisconnectError(error)) return;

        showConnectionToast(error.message || "Unable to connect to the room.");
      }}
      onMediaDeviceFailure={(error, kind) => {
        if (error === MediaDeviceFailure.PermissionDenied) {
          return;
        }

        // The pre-join device is carried in as an `exact` constraint. If it
        // went stale (unplugged / re-enumerated between pre-join and connect),
        // the initial publish fails - which used to silently join the user
        // with that device off. Retry once per kind with the browser-chosen
        // default device instead.
        if (
          (kind === "audioinput" || kind === "videoinput") &&
          !retriedDeviceKindsRef.current.has(kind)
        ) {
          retriedDeviceKindsRef.current.add(kind);
          const isVideo = kind === "videoinput";
          const retry = isVideo
            ? room.localParticipant.setCameraEnabled(true, {
                deviceId: undefined,
              })
            : room.localParticipant.setMicrophoneEnabled(true, {
                deviceId: undefined,
                echoCancellation,
                noiseSuppression: true,
                autoGainControl: true,
              });

          void retry.catch(() => {
            // Retry with the default device failed; nothing more to do here.
          });
          return;
        }

        // Camera failures are surfaced where the camera toggle lives
        // (LiveKitControls), so don't double up on a toast here.
        if (kind === "videoinput") {
          return;
        }

      }}
      className="relative flex h-full flex-col gap-2 bg-background"
    >
      {/* The user/space queries decide role-specific UI (host's End-for-all
          menu, invite panel, ...). Mask the call UI until both settle so the
          buttons don't render in the wrong variant and then flip. The room
          keeps connecting underneath, so this adds no join delay. */}
      {(isLoadingUser || isLoadingSpace) && (
        <AppLoader overlay message="Setting up your space..." />
      )}
      {endSpace.isPending && (
        <AppLoader overlay message="Ending the session for everyone..." />
      )}
      {isLeaving && (
        <AppLoader overlay message="Finishing your recording..." />
      )}
      <RecordingProvider
        spaceId={spaceData?.id}
        roomCode={roomCode}
        isHost={isHost}
        finalizeOnLeaveRef={recordingFinalizeRef}
        recordingEchoCancellation={preJoinSettings?.echoCancellation === true}
      >
        <LiveKitChatProvider>
          <LiveKitReactionsProvider>
            <div className="relative flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                <LiveKitVideoStage
                  deafened={deafened}
                  isHost={isHost || isHostHint}
                  localAvatar={preJoinSettings?.avatar}
                  spotlightKey={spotlightKey}
                  onSpotlight={setSpotlightKey}
                  roomCode={roomCode}
                  spaceId={spaceData?.id}
                />
              </div>
              <LiveKitReactionsOverlay />
              {activeSidebar && (
                // On phones the fixed-width docked sidebar would leave no room
                // for the stage, so it becomes a full overlay covering it.
                <div className="flex h-full shrink-0 items-center justify-center max-md:absolute max-md:inset-0 max-md:z-40 md:ml-2">
                  <div
                    style={{ width: sidebarWidth }}
                    className="relative flex h-full flex-col items-stretch justify-start overflow-hidden rounded-2xl bg-primary max-md:!w-full"
                  >
                    <div
                      onPointerDown={handleSidebarResizeStart}
                      onPointerMove={handleSidebarResizeMove}
                      onPointerUp={handleSidebarResizeEnd}
                      className="group absolute left-0 top-0 z-30 flex h-full w-2 cursor-ew-resize touch-none select-none items-center justify-center max-md:hidden"
                      title="Drag to resize"
                    >
                      <span className="h-10 w-1 rounded-full bg-foreground/15 transition-colors duration-200 group-hover:bg-foreground/40" />
                    </div>
                    {renderSidebarContent()}
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0">
              <LiveKitControls
                activeSidebar={activeSidebar}
                deafened={deafened}
                isHost={isHost}
                roomCode={roomCode}
                setDeafened={setDeafened}
                onEndForAll={handleEndForAll}
                onLeave={handleLeave}
                toggleSidebar={toggleSidebar}
              />
            </div>
          </LiveKitReactionsProvider>
        </LiveKitChatProvider>
      </RecordingProvider>
    </LiveKitRoom>
  );
};

export default LiveKitSpaceScreen;
