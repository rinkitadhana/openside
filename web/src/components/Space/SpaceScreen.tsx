/**
 * COMPONENT: SpaceScreen
 *
 * PURPOSE:
 * The main orchestrator of the video calling experience. Combines all hooks and
 * manages the complete WebRTC connection flow.
 *
 * WEBRTC CONNECTION FLOW (simplified):
 * 1. Get your camera/mic (useMediaStream)
 * 2. Create peer instance (usePeer) → get peer ID
 * 3. Join room via Socket.IO → tell server you're here
 * 4. When new user joins:
 *    a. You call them with peer.call(theirId, yourStream)
 *    b. They receive your stream
 *    c. They answer with their stream
 *    d. You receive their stream
 * 5. When you receive incoming call:
 *    a. Answer with your stream
 *    b. Receive their stream
 * 6. Both users now have bidirectional audio/video
 *
 * RECORDING FLOW:
 * 1. Host clicks "Start Recording" → API call → Socket broadcast
 * 2. All participants receive "recording-started" event
 * 3. Each participant starts local MediaRecorder
 * 4. Chunks (5 seconds each) are uploaded as they're generated
 * 5. Host clicks "Stop Recording" → Socket broadcast → All stop
 * 6. Final chunks uploaded → Mark complete
 *
 * STATE MANAGEMENT:
 * - players: Map of all participants and their streams
 * - users: Map of active peer connections (for cleanup)
 * - currentPage: Pagination for participant grid
 * - fullScreen states: Object-fit mode for videos
 * - recording state: Managed by useRecordingManager
 */

import React, { useEffect, useState, useCallback } from "react";
import { useSocket } from "@/context/socket";
import usePeer from "@/hooks/usePeer";
import useMediaStream from "@/hooks/useMediaStream";
import usePlayer from "@/hooks/usePlayer";
import { useParams } from "react-router-dom";
import { cloneDeep } from "lodash";
import { MediaConnection } from "peerjs";
import VideoCallControls from "./VideoCallControls";
import UserMedia from "./UserMedia";
import VideoGrid, { getGridLayout } from "./layout/VideoGrid";
import VideoContainer from "./layout/VideoContainer";
import PaginationControls from "./ui/PaginationControls";
import WaitingState from "./ui/WaitingState";
import { RxEnterFullScreen, RxExitFullScreen } from "react-icons/rx";
import { PreJoinSettings } from "@/pages/Space/SpacePage";
import { useGetMe } from "@/hooks/useUserQuery";
import { useEndSpace, useGetSpaceByJoinCode } from "@/hooks/useSpace";
import { useLeaveSpace } from "@/hooks/useParticipant";
import { getOrCreateSessionId } from "@/utils/ParticipantSessionId";
import useRecordingManager, {
  type RecordingState,
  type ChunkData,
} from "@/hooks/useRecordingManager";

type SidebarType = "info" | "users" | "chat" | null;

interface SpaceScreenProps {
  toggleSidebar: (sidebarType: SidebarType) => void;
  activeSidebar: SidebarType;
  preJoinSettings: PreJoinSettings | null;
  onRecordingStateChange?: (state: RecordingState) => void;
  onRecordingDurationChange?: (durationMs: number) => void;
  // Callback when a chunk is ready - implement your upload logic here
  onChunkReady?: (data: ChunkData) => void;
}

const SpaceScreen = ({
  toggleSidebar,
  activeSidebar,
  preJoinSettings,
  onRecordingStateChange,
  onRecordingDurationChange,
  onChunkReady,
}: SpaceScreenProps) => {
  // ============================================================================
  // SETUP & HOOKS
  // ============================================================================

  const socket = useSocket();
  const params = useParams();
  const roomId = params.roomId as string;
  const { data: user } = useGetMe();
  const { data: spaceData } = useGetSpaceByJoinCode(roomId);
  const endSpace = useEndSpace();
  const leaveSpaceApi = useLeaveSpace(spaceData?.id || "");
  const participantSessionId = getOrCreateSessionId(roomId);

  // Get peer instance and peer ID
  const { peer, myId } = usePeer();

  // Get camera/microphone stream
  const { stream } = useMediaStream(preJoinSettings || undefined);

  // Get player management functions
  const {
    players,
    setPlayers,
    playerHighlighted,
    nonHighlightedPlayers,
    toggleAudio,
    toggleVideo,
    toggleSpeaker,
    leaveRoom: originalLeaveRoom,
  } = usePlayer(myId || "", roomId || "", peer);

  // UI state
  const [currentPage, setCurrentPage] = useState(0);
  const [closeWaiting, setCloseWaiting] = useState(false);
  const [myFullScreen, setMyFullScreen] = useState(true);
  const [otherFullScreen, setOtherFullScreen] = useState(true);

  // Track active peer connections for cleanup when users leave
  const [users, setUsers] = useState<Record<string, MediaConnection>>({});

  // Check if current user is the host
  const isHost = user && spaceData && user.id === spaceData.host?.id;

  // ============================================================================
  // RECORDING MANAGER
  // ============================================================================

  const recordingManager = useRecordingManager({
    spaceId: spaceData?.id || "",
    participantSessionId,
    isHost: !!isHost,
    roomId,
    onChunkReady: (data) => {
      // Pass chunk to parent for upload handling
      onChunkReady?.(data);
      console.log("[SpaceScreen] Chunk ready:", {
        sequenceNumber: data.chunk.sequenceNumber,
        size: (data.chunk.blob.size / 1024).toFixed(2) + " KB",
        duration: data.chunk.durationMs + "ms",
      });
    },
  });

  // Notify parent of recording state changes
  useEffect(() => {
    onRecordingStateChange?.(recordingManager.recordingState);
  }, [recordingManager.recordingState, onRecordingStateChange]);

  useEffect(() => {
    onRecordingDurationChange?.(recordingManager.recordingDurationMs);
  }, [recordingManager.recordingDurationMs, onRecordingDurationChange]);

  // Set the stream for recording when available
  useEffect(() => {
    if (stream && "setStream" in recordingManager) {
      (
        recordingManager as ReturnType<typeof useRecordingManager> & {
          setStream: (s: MediaStream | null) => void;
        }
      ).setStream(stream);
    }
  }, [stream, recordingManager]);

  // Handle start recording (for host)
  const handleStartRecording = useCallback(async () => {
    if (!stream) {
      console.error("[SpaceScreen] No stream available for recording");
      return;
    }
    try {
      await recordingManager.startRecording(stream);
    } catch (error) {
      console.error("[SpaceScreen] Failed to start recording:", error);
    }
  }, [stream, recordingManager]);

  // Handle stop recording (for host)
  const handleStopRecording = useCallback(async () => {
    try {
      await recordingManager.stopRecording();
    } catch (error) {
      console.error("[SpaceScreen] Failed to stop recording:", error);
    }
  }, [recordingManager]);

  // ============================================================================
  // HANDLE LEAVE ROOM - END SPACE IF HOST
  // ============================================================================

  /**
   * Custom leave room handler that ends the space if user is the host
   * Otherwise just leaves the room normally
   */
  const leaveRoom = () => {
    if (isHost && spaceData?.id) {
      // If host, end the space first
      endSpace.mutate(spaceData.id, {
        onSettled: () => {
          // Whether success or error, leave the room
          originalLeaveRoom();
        },
      });
    } else if (spaceData?.id) {
      // Regular participant, call leave API first
      leaveSpaceApi.mutate(
        {
          participantSessionId,
        },
        {
          onSettled: () => {
            // Whether success or error, leave the room
            originalLeaveRoom();
          },
        }
      );
    } else {
      // Fallback if no space data, just leave
      originalLeaveRoom();
    }
  };

  // Pagination logic for participant grid
  const USERS_PER_PAGE = 4;
  const otherPlayerIds = Object.keys(nonHighlightedPlayers);
  const totalPages = Math.ceil(otherPlayerIds.length / USERS_PER_PAGE);
  const startIndex = currentPage * USERS_PER_PAGE;
  const visibleOtherPlayers = otherPlayerIds.slice(
    startIndex,
    startIndex + USERS_PER_PAGE
  );

  const gridLayout = getGridLayout(visibleOtherPlayers.length);

  // ============================================================================
  // WEBRTC: HANDLE NEW USER JOINING (OUTGOING CALL)
  // ============================================================================

  /**
   * When socket server notifies us that a new user joined:
   * 1. Call them with our stream
   * 2. Wait for their stream in response
   * 3. Add their stream to our players state
   *
   * This runs when OTHER users join AFTER you
   */
  useEffect(() => {
    if (!socket || !peer || !stream) return;

    const handleUserConnected = (newUserId: string) => {
      console.log(`[WebRTC] New user joined: ${newUserId}, initiating call...`);

      // Initiate call to the new user with our stream
      const call = peer.call(newUserId, stream);

      // When we receive their stream
      call.on("stream", (incomingStream: MediaStream) => {
        console.log(`[WebRTC] Received stream from ${newUserId}`);

        // Add them to our players state
        setPlayers((prev) => ({
          ...prev,
          [newUserId]: {
            url: incomingStream,
            muted: false,
            playing: true,
            speakerMuted: false,
            name: `User ${newUserId.slice(-4)}`,
            avatar: undefined,
          },
        }));

        // Store the call connection for cleanup later
        setUsers((prev) => ({
          ...prev,
          [newUserId]: call,
        }));
      });
    };

    socket.on("user-connected", handleUserConnected);

    return () => {
      socket.off("user-connected", handleUserConnected);
    };
  }, [socket, peer, stream, setPlayers]);

  // ============================================================================
  // SOCKET.IO: HANDLE MEDIA CONTROL EVENTS
  // ============================================================================

  /**
   * Listen for other users toggling their audio/video/speaker
   * Update their state in our players object so UI reflects changes
   */
  useEffect(() => {
    if (!socket) return;

    // User muted/unmuted their mic
    const handleToggleAudio = (userId: string) => {
      setPlayers((prev) => {
        const copy = cloneDeep(prev);
        copy[userId].muted = !copy[userId].muted;
        return copy;
      });
    };

    // User turned camera on/off
    const handleToggleVideo = (userId: string) => {
      setPlayers((prev) => {
        const copy = cloneDeep(prev);
        copy[userId].playing = !copy[userId].playing;
        return copy;
      });
    };

    // User muted/unmuted their speaker
    const handleToggleSpeaker = (userId: string) => {
      setPlayers((prev) => {
        const copy = cloneDeep(prev);
        copy[userId].speakerMuted = !copy[userId].speakerMuted;
        return copy;
      });
    };

    // User left the call
    const handleUserLeave = (userId: string) => {
      console.log(`[WebRTC] User ${userId} left the call`);

      // Close the peer connection
      users[userId]?.close();

      // Remove them from players state
      const playersCopy = cloneDeep(players);
      delete playersCopy[userId];
      setPlayers(playersCopy);
    };

    // Register all event listeners
    socket.on("user-toggle-audio", handleToggleAudio);
    socket.on("user-toggle-video", handleToggleVideo);
    socket.on("user-toggle-speaker", handleToggleSpeaker);
    socket.on("user-leave", handleUserLeave);

    // Cleanup listeners on unmount
    return () => {
      socket.off("user-toggle-audio", handleToggleAudio);
      socket.off("user-toggle-video", handleToggleVideo);
      socket.off("user-toggle-speaker", handleToggleSpeaker);
      socket.off("user-leave", handleUserLeave);
    };
  }, [setPlayers, socket, users, players]);

  // ============================================================================
  // WEBRTC: ANSWER INCOMING CALLS
  // ============================================================================

  /**
   * When someone calls us (we joined AFTER them):
   * 1. Answer with our stream
   * 2. Receive their stream
   * 3. Add their stream to our players state
   *
   * This runs when YOU join and others are already there
   */
  useEffect(() => {
    if (!peer || !stream) return;

    peer.on("call", (call) => {
      const { peer: callerId } = call;
      console.log(`[WebRTC] Receiving call from ${callerId}, answering...`);

      // Answer the call with our stream
      call.answer(stream);

      // When we receive their stream
      call.on("stream", (incomingStream: MediaStream) => {
        console.log(`[WebRTC] Received stream from ${callerId}`);

        // Add them to our players state
        setPlayers((prev) => ({
          ...prev,
          [callerId]: {
            url: incomingStream,
            muted: false,
            playing: true,
            speakerMuted: false,
            name: `User ${callerId.slice(-4)}`,
            avatar: undefined,
          },
        }));

        // Store the call connection for cleanup
        setUsers((prev) => ({
          ...prev,
          [callerId]: call,
        }));
      });
    });
  }, [peer, stream, setPlayers]);

  // ============================================================================
  // ADD YOUR OWN STREAM TO PLAYERS
  // ============================================================================

  /**
   * Once we have our stream and peer ID, add ourselves to the players state
   * This displays our own video in the UI
   */
  useEffect(() => {
    if (!stream || !myId) return;

    setPlayers((prev) => ({
      ...prev,
      [myId]: {
        url: stream,
        muted: preJoinSettings ? !preJoinSettings.audioEnabled : false,
        playing: preJoinSettings ? preJoinSettings.videoEnabled : true,
        speakerMuted: false,
        name: preJoinSettings?.name || "You",
        avatar: preJoinSettings?.avatar,
      },
    }));
  }, [stream, myId, preJoinSettings, setPlayers]);

  // ============================================================================
  // RENDER: YOUR VIDEO (FEATURED/HIGHLIGHTED)
  // ============================================================================

  const renderMainUser = () => {
    if (!playerHighlighted) return null;

    const { url, muted, playing } = playerHighlighted;
    return (
      <VideoContainer
        isFullScreen={myFullScreen}
        onToggleFullScreen={() => setMyFullScreen((prev) => !prev)}
        showFullScreenButton={playerHighlighted.playing}
        className="flex-1 h-full min-w-0"
      >
        <UserMedia
          url={url}
          muted={muted}
          playing={playing}
          myVideo={true}
          name={playerHighlighted.name}
          avatar={playerHighlighted.avatar}
          className={`h-full w-full ${myFullScreen ? "object-cover" : "object-contain"}`}
          speakerMuted={playerHighlighted.speakerMuted}
        />
      </VideoContainer>
    );
  };

  // ============================================================================
  // RENDER: OTHER USERS (GRID)
  // ============================================================================

  const renderOtherUsers = () => {
    // Show waiting state if no other users
    if (visibleOtherPlayers.length === 0) {
      return (
        <WaitingState
          onClose={() => setCloseWaiting(true)}
          isVisible={!closeWaiting}
        />
      );
    }

    return (
      <div className="flex-1 h-full min-w-0 relative group/other-screen group/pagination overflow-hidden">
        <VideoGrid layout={gridLayout}>
          {visibleOtherPlayers.map((playerId, index) => {
            const { url, muted, playing, speakerMuted, avatar } =
              nonHighlightedPlayers[playerId];

            // Special handling for 3 users layout (2 top, 1 bottom spanning full width)
            const isBottomSpanning = gridLayout.bottomSpan && index === 2;

            return (
              <div
                key={playerId}
                className={`bg-call-primary overflow-hidden rounded-xl border border-call-border relative ${
                  isBottomSpanning ? "col-span-2" : ""
                }`}
              >
                <UserMedia
                  url={url}
                  muted={muted}
                  playing={playing}
                  name={
                    nonHighlightedPlayers[playerId]?.name ||
                    `User ${index + 1 + currentPage * USERS_PER_PAGE}`
                  }
                  avatar={avatar}
                  className={`h-full w-full ${otherFullScreen ? "object-cover" : "object-contain"}`}
                  speakerMuted={speakerMuted}
                />
              </div>
            );
          })}
        </VideoGrid>

        {/* Fullscreen toggle button for other users grid */}
        <button
          onClick={() => setOtherFullScreen((prev) => !prev)}
          className="select-none opacity-0 group-hover/other-screen:opacity-100 absolute bottom-0 right-0 p-2 m-2 rounded-xl bg-secondary hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
        >
          {otherFullScreen ? (
            <RxExitFullScreen size={20} />
          ) : (
            <RxEnterFullScreen size={20} />
          )}
        </button>

        {/* Pagination controls (if more than 4 users) */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    );
  };

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className="flex flex-col h-full w-full">
      {/* Video area: Your video + Others grid */}
      <div className="flex h-full w-full gap-2 flex-1 min-h-0 pb-2">
        {renderMainUser()}
        {renderOtherUsers()}
      </div>

      {/* Control bar: Mic, Camera, Leave, etc. */}
      <div className="w-full flex-shrink-0 py-2">
        <VideoCallControls
          muted={playerHighlighted?.muted}
          playing={playerHighlighted?.playing}
          toggleAudio={toggleAudio}
          toggleVideo={toggleVideo}
          leaveRoom={leaveRoom}
          speakerMuted={playerHighlighted?.speakerMuted}
          toggleSpeaker={toggleSpeaker}
          toggleSidebar={toggleSidebar}
          activeSidebar={activeSidebar}
          // Recording props
          isHost={!!isHost}
          recordingState={recordingManager.recordingState}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
        />
      </div>
    </div>
  );
};

export default SpaceScreen;
