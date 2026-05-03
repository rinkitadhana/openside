/**
 * SOCKET.IO APP EVENT SERVER
 * 
 * PURPOSE:
 * LiveKit owns video, audio, participant state, and media reconnection.
 * Socket.IO remains for app-specific realtime events that are not currently
 * handled by LiveKit, such as recording coordination and upload progress.
 * 
 * EVENTS FLOW:
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
      origin: process.env.WEB_URL || "http://localhost:3000",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {

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
      socket.broadcast.to(roomId).emit("participant-recording-complete", data);
    });
  });

  return io;
}
