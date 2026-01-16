/**
 * HOOK: usePeer
 * 
 * PURPOSE:
 * Creates and manages a PeerJS instance for WebRTC peer-to-peer connections.
 * PeerJS simplifies WebRTC by handling the complex connection logic.
 * 
 * WHAT IS PEERJS:
 * - A library that wraps WebRTC APIs for easier peer-to-peer connections
 * - Handles ICE candidates, STUN/TURN servers, and signaling automatically
 * - Each peer gets a unique ID to identify them in the network
 * 
 * HOW IT WORKS:
 * 1. Create a new Peer instance → generates a unique peer ID
 * 2. Wait for "open" event → peer is ready to connect
 * 3. Emit "join-room" via Socket.IO → tell server you're available
 * 4. Other peers will use your peer ID to initiate WebRTC connections
 * 
 * WEBRTC FLOW:
 * 1. User A joins → gets peer ID "abc123"
 * 2. Socket.IO tells User B: "User A (abc123) is here"
 * 3. User B calls peer.call("abc123", myStream)
 * 4. User A answers the call with their stream
 * 5. Both users now have direct peer-to-peer connection
 * 
 * @returns {peer} - PeerJS instance for making/receiving calls
 * @returns {myId} - Your unique peer ID (used by others to call you)
 */

import { useEffect, useRef, useState } from "react";
import { Peer } from "peerjs";
import { useVideoCall } from "@/shared/context/socket";
import { useParams } from "next/navigation";

const usePeer = () => {
  const { socket, joinRoom } = useVideoCall();
  const params = useParams();
  const roomId = params.roomId as string;
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myId, setMyId] = useState("");
  
  // Use ref to prevent multiple peer instances
  const isPeerSet = useRef(false);

  useEffect(() => {
    // Wait for both roomId and socket to be ready
    if (isPeerSet.current || !roomId || !socket) return;
    isPeerSet.current = true;

    (async function initPeer() {
      // Dynamically import PeerJS (reduces initial bundle size)
      const myPeer = new (await import("peerjs")).default();
      setPeer(myPeer);

      // When peer is ready and has an ID
      myPeer.on("open", (id) => {
        console.log("[Peer] My peer ID:", id);
        setMyId(id);
        
        // Notify the signaling server (Socket.IO) that we've joined the room
        // This triggers other users to initiate WebRTC connections to us
        joinRoom(roomId, id);
      });
    })();
  }, [roomId, socket, joinRoom]);

  return { peer, myId };
};

export default usePeer;

