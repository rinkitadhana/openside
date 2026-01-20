/**
 * HOOK: usePlayer
 * 
 * PURPOSE:
 * Manages all participants in the call and provides controls for audio/video/speaker.
 * Tracks each user's stream, mute status, and provides functions to control them.
 * 
 * DATA STRUCTURE - "players":
 * {
 *   "peer-id-123": {
 *     url: MediaStream,      // The video/audio stream
 *     muted: false,          // Is their mic muted?
 *     playing: true,         // Is their camera on?
 *     speakerMuted: false,   // Have YOU muted their audio?
 *     name: "John Doe",      // Display name
 *     avatar: "url"          // Profile picture
 *   },
 *   "peer-id-456": { ... }
 * }
 * 
 * HOW IT WORKS:
 * - Your own video (myId) is separated from others for UI purposes
 * - Toggle functions control MediaStream tracks (enable/disable)
 * - Socket.IO broadcasts state changes so everyone stays in sync
 * 
 * @param myId - Your peer ID
 * @param roomId - Current space/room ID
 * @param peer - PeerJS instance
 * @returns Player state and control functions
 */

import { useState } from "react";
import { cloneDeep } from "lodash";
import { useVideoCall } from "@/shared/context/socket";
import { useRouter } from "next/navigation";
import { Peer } from "peerjs";

interface Player {
  url: MediaStream | string;
  muted: boolean;
  playing: boolean;
  speakerMuted: boolean;
  name?: string;
  avatar?: string;
}

interface Players {
  [key: string]: Player;
}

const usePlayer = (myId: string, roomId: string, peer: Peer | null) => {
  const { 
    leaveRoom: emitLeaveRoom,
    toggleAudio: emitToggleAudio,
    toggleVideo: emitToggleVideo,
    toggleSpeaker: emitToggleSpeaker
  } = useVideoCall();
  const router = useRouter();
  const [players, setPlayers] = useState<Players>({});

  // Separate your video from others for UI layout
  // Your video is highlighted/featured, others are in a grid
  const playersCopy = cloneDeep(players);
  const playerHighlighted = playersCopy[myId]; // Your video
  delete playersCopy[myId];
  const nonHighlightedPlayers = playersCopy; // Everyone else's videos

  /**
   * FUNCTION: leaveRoom
   * Called when user clicks "Leave" button
   * 
   * FLOW:
   * 1. Notify server via Socket.IO
   * 2. Server broadcasts to others → they remove your video
   * 3. Disconnect peer connections
   * 4. Navigate back to dashboard
   */
  const leaveRoom = () => {
    emitLeaveRoom(myId, roomId);
    peer?.disconnect();
    router.push("/dashboard/home");
  };

  /**
   * FUNCTION: toggleAudio
   * Mute/unmute your microphone
   * 
   * HOW IT WORKS:
   * 1. Toggle muted state in local state
   * 2. Find audio tracks in your MediaStream
   * 3. Set track.enabled = opposite of muted
   * 4. Notify others via Socket.IO (so they see mic icon)
   */
  const toggleAudio = () => {
    setPlayers((prev) => {
      const copy = cloneDeep(prev);
      const newMutedState = !copy[myId].muted;
      copy[myId].muted = newMutedState;

      // Actually control the MediaStream audio track
      if (copy[myId].url instanceof MediaStream) {
        const audioTracks = copy[myId].url.getAudioTracks();
        audioTracks.forEach((track: MediaStreamTrack) => {
          track.enabled = !newMutedState; // enabled is opposite of muted
        });
      }

      return copy;
    });

    // Notify others about your audio state change
    emitToggleAudio(myId, roomId);
  };

  /**
   * FUNCTION: toggleVideo
   * Turn camera on/off
   * 
   * HOW IT WORKS:
   * 1. Toggle playing state in local state
   * 2. Find video tracks in your MediaStream
   * 3. Set track.enabled = new playing state
   * 4. Notify others via Socket.IO (so they see/hide your video)
   */
  const toggleVideo = () => {
    setPlayers((prev) => {
      const copy = cloneDeep(prev);
      const newPlayingState = !copy[myId].playing;
      copy[myId].playing = newPlayingState;

      // Actually control the MediaStream video track
      if (copy[myId].url instanceof MediaStream) {
        const videoTracks = copy[myId].url.getVideoTracks();
        videoTracks.forEach((track: MediaStreamTrack) => {
          track.enabled = newPlayingState;
        });
      }

      return copy;
    });

    // Notify others about your video state change
    emitToggleVideo(myId, roomId);
  };

  /**
   * FUNCTION: toggleSpeaker
   * Mute/unmute incoming audio (your speaker)
   * This doesn't affect the MediaStream - it's handled in UserMedia component
   * via videoElement.volume
   */
  const toggleSpeaker = () => {
    setPlayers((prev) => {
      const copy = cloneDeep(prev);
      copy[myId].speakerMuted = !copy[myId].speakerMuted;
      return copy;
    });

    emitToggleSpeaker(myId, roomId);
  };

  return {
    players,                    // All participants (including you)
    setPlayers,                 // Update player state (used by SpaceScreen)
    playerHighlighted,          // Your video (for featured display)
    nonHighlightedPlayers,      // Other participants (for grid display)
    toggleAudio,                // Mute/unmute mic
    toggleVideo,                // Camera on/off
    toggleSpeaker,              // Mute/unmute incoming audio
    leaveRoom,                  // Exit the call
  };
};

export default usePlayer;

