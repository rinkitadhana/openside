/**
 * SOCKET.IO SIGNALING SERVER
 * 
 * PURPOSE:
 * This server acts as a "signaling server" for WebRTC connections. It helps peers 
 * discover each other and coordinate their peer-to-peer connections.
 * 
 * HOW WEBRTC WORKS:
 * 1. Users connect to this Socket.IO server (signaling server)
 * 2. When user joins a room, server broadcasts to others: "new user available"
 * 3. Users then establish DIRECT peer-to-peer connections using PeerJS (WebRTC)
 * 4. Video/audio streams flow DIRECTLY between peers (not through this server)
 * 5. This server only relays control messages (mute, unmute, leave, etc.)
 * 
 * EVENTS FLOW:
 * - join-room: User enters space → notify others to initiate WebRTC connection
 * - user-toggle-audio/video/speaker: Notify others about UI state changes
 * - user-leave: User exits → notify others to close their connection to that peer
 * - recording-started: Host started recording → all participants start local recording
 * - recording-stopped: Host stopped recording → all participants stop and finalize
 */

import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";

// Recording session data sent to participants
interface RecordingSessionData {
  sessionId: string;
  spaceRecordingSessionId: string;
  startedAt: number;
}

export function initSocket(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);

    /**
     * EVENT: join-room
     * Triggered when a user joins a space/room
     * 
     * FLOW:
     * 1. User joins a room (identified by roomId)
     * 2. Socket joins that room (for targeted broadcasting)
     * 3. Broadcast "user-connected" to all OTHER users in the room
     * 4. Other users will then initiate WebRTC peer connections to this new user
     */
    socket.on("join-room", (roomId, userId) => {
      socket.join(roomId);
      
      const room = io.sockets.adapter.rooms.get(roomId);
      const usersInRoom = room ? room.size : 0;
      
      console.log(`[Socket] User ${userId} joined room ${roomId} (${usersInRoom} total users)`);

      // Notify all OTHER users in the room about the new user
      // This triggers them to initiate a WebRTC call to the new user
      socket.broadcast.to(roomId).emit("user-connected", userId);
    });

    /**
     * EVENT: user-toggle-audio
     * User muted/unmuted their microphone
     * Broadcast this state change to others so they can update UI
     */
    socket.on("user-toggle-audio", (userId, roomId) => {
      socket.broadcast.to(roomId).emit("user-toggle-audio", userId);
    });

    /**
     * EVENT: user-toggle-video
     * User turned camera on/off
     * Broadcast this state change to others so they can update UI
     */
    socket.on("user-toggle-video", (userId, roomId) => {
      socket.broadcast.to(roomId).emit("user-toggle-video", userId);
    });

    /**
     * EVENT: user-toggle-speaker
     * User muted/unmuted incoming audio (their speaker)
     * Broadcast to sync UI state across clients
     */
    socket.on("user-toggle-speaker", (userId, roomId) => {
      socket.broadcast.to(roomId).emit("user-toggle-speaker", userId);
    });

    /**
     * EVENT: user-leave
     * User left the space
     * 
     * FLOW:
     * 1. Notify all other users in the room
     * 2. Other users will close their WebRTC peer connections to this user
     * 3. Remove the user's video from their UI
     */
    socket.on("user-leave", (userId, roomId) => {
      console.log(`[Socket] User ${userId} left room ${roomId}`);
      socket.broadcast.to(roomId).emit("user-leave", userId);
    });

    // ============================================================================
    // RECORDING EVENTS
    // ============================================================================

    /**
     * EVENT: recording-start
     * Host started recording → broadcast to ALL users in room (including sender)
     * 
     * FLOW:
     * 1. Host clicks "Start Recording" and calls the API
     * 2. API succeeds → Host emits this event
     * 3. ALL participants (including host) receive "recording-started"
     * 4. Each participant starts their local MediaRecorder
     * 5. Chunks are uploaded as they're generated
     */
    socket.on("recording-start", (roomId: string, data: RecordingSessionData) => {
      console.log(`[Socket] Recording started in room ${roomId}, session: ${data.sessionId}`);
      // Broadcast to ALL users in the room including sender
      io.to(roomId).emit("recording-started", data);
    });

    /**
     * EVENT: recording-stop
     * Host stopped recording → broadcast to ALL users
     * 
     * FLOW:
     * 1. Host clicks "Stop Recording"
     * 2. Host emits this event
     * 3. ALL participants receive "recording-stopped"
     * 4. Each participant stops their MediaRecorder
     * 5. Each participant uploads any remaining chunks
     * 6. Each participant marks their recording as complete
     */
    socket.on("recording-stop", (roomId: string, sessionId: string) => {
      console.log(`[Socket] Recording stopped in room ${roomId}, session: ${sessionId}`);
      // Broadcast to ALL users in the room including sender
      io.to(roomId).emit("recording-stopped", sessionId);
    });

    /**
     * EVENT: recording-chunk-uploaded
     * A participant successfully uploaded a chunk
     * Used for progress tracking (optional - host can see upload progress)
     */
    socket.on("recording-chunk-uploaded", (roomId: string, data: {
      participantId: string;
      sequenceNumber: number;
      totalUploaded: number;
    }) => {
      // Broadcast to all (host can track progress)
      socket.broadcast.to(roomId).emit("participant-chunk-uploaded", data);
    });

    /**
     * EVENT: recording-complete
     * A participant finished uploading all their chunks
     */
    socket.on("recording-complete", (roomId: string, data: {
      participantId: string;
      totalSegments: number;
    }) => {
      console.log(`[Socket] Participant ${data.participantId} completed upload in room ${roomId}`);
      socket.broadcast.to(roomId).emit("participant-recording-complete", data);
    });
  });

  return io;
}
