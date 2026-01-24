/**
 * SOCKET.IO CLIENT CONTEXT
 *
 * PURPOSE:
 * Provides a single Socket.IO connection shared across the entire app.
 * This connection is used for SIGNALING in WebRTC (coordinating peer connections).
 *
 * KEY CONCEPTS:
 * - Socket.IO = Real-time bidirectional communication (like WebSockets)
 * - Used for CONTROL MESSAGES only (join, leave, mute, etc.)
 * - Actual video/audio streams flow via WebRTC (peer-to-peer), NOT through sockets
 *
 * USAGE:
 * ```tsx
 * const socket = useSocket();
 * socket?.emit("join-room", roomId, userId);
 * socket?.on("user-connected", (userId) => { ... });
 * ```
 */

"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";

// Define the events that our socket will handle
// These must match the events in the backend Socket.IO server

// Recording session data
interface RecordingSessionData {
  sessionId: string;
  spaceRecordingSessionId: string;
  startedAt: number;
}

// Chunk upload progress data
interface ChunkUploadedData {
  participantId: string;
  sequenceNumber: number;
  totalUploaded: number;
}

// Recording complete data
interface RecordingCompleteData {
  participantId: string;
  totalSegments: number;
}

interface ServerToClientEvents {
  "user-connected": (userId: string) => void;
  "user-toggle-audio": (userId: string) => void;
  "user-toggle-video": (userId: string) => void;
  "user-toggle-speaker": (userId: string) => void;
  "user-leave": (userId: string) => void;
  // Recording events
  "recording-started": (data: RecordingSessionData) => void;
  "recording-stopped": (sessionId: string) => void;
  "participant-chunk-uploaded": (data: ChunkUploadedData) => void;
  "participant-recording-complete": (data: RecordingCompleteData) => void;
}

interface ClientToServerEvents {
  "join-room": (roomId: string, userId: string) => void;
  "user-toggle-audio": (userId: string, roomId: string) => void;
  "user-toggle-video": (userId: string, roomId: string) => void;
  "user-toggle-speaker": (userId: string, roomId: string) => void;
  "user-leave": (userId: string, roomId: string) => void;
  // Recording events
  "recording-start": (roomId: string, data: RecordingSessionData) => void;
  "recording-stop": (roomId: string, sessionId: string) => void;
  "recording-chunk-uploaded": (roomId: string, data: ChunkUploadedData) => void;
  "recording-complete": (roomId: string, data: RecordingCompleteData) => void;
}

type SocketType = Socket<ServerToClientEvents, ClientToServerEvents>;
type SocketContextType = SocketType | null;

const SocketContext = createContext<SocketContextType>(null);

/**
 * HOOK: useSocket
 * Returns the Socket.IO client instance
 * Returns null if socket is not yet connected
 */
export const useSocket = (): SocketContextType => {
  const socket = useContext(SocketContext);
  return socket;
};

/**
 * PROVIDER: SocketProvider
 *
 * Establishes and maintains a single Socket.IO connection for the entire app.
 * Wrap your app with this provider to enable socket functionality.
 *
 * CONNECTION LIFECYCLE:
 * 1. On mount: Connect to backend Socket.IO server
 * 2. On connect: Store socket instance in context
 * 3. On disconnect: Clear socket instance
 * 4. On unmount: Disconnect socket
 */
export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const [socket, setSocket] = useState<SocketContextType>(null);

  useEffect(() => {
    // Connect to the backend socket server
    const connection: SocketType = io(
      process.env.NEXT_PUBLIC_API_SOCKET_URL || "http://localhost:4000",
      {
        transports: ["websocket", "polling"], // Try WebSocket first, fallback to polling
        autoConnect: true,
      }
    );

    // Connection successful
    connection.on("connect", () => {
      console.log("[Socket] Connected:", connection.id);
      setSocket(connection);
    });

    // Connection failed
    connection.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
    });

    // Connection lost
    connection.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
      setSocket(null);
    });

    // Clean up on unmount
    return () => {
      connection.disconnect();
      console.log("[Socket] Connection closed");
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
};

/**
 * HOOK: useVideoCall
 *
 * PURPOSE:
 * Provides convenient wrapper functions for common video call socket events.
 * Use this instead of directly calling socket.emit() for better abstraction.
 *
 * BENEFITS:
 * - Single source of truth for socket events
 * - Type safety enforced by TypeScript
 * - Easier to add logging/analytics
 * - Cleaner component code
 * - Easier to test (mock one hook)
 *
 * USAGE:
 * ```tsx
 * const { joinRoom, toggleAudio } = useVideoCall();
 * joinRoom(roomId, userId);
 * toggleAudio(userId, roomId);
 * ```
 */
export const useVideoCall = () => {
  const socket = useSocket();

  const joinRoom = (roomId: string, userId: string) => {
    socket?.emit("join-room", roomId, userId);
  };

  const toggleAudio = (userId: string, roomId: string) => {
    socket?.emit("user-toggle-audio", userId, roomId);
  };

  const toggleVideo = (userId: string, roomId: string) => {
    socket?.emit("user-toggle-video", userId, roomId);
  };

  const toggleSpeaker = (userId: string, roomId: string) => {
    socket?.emit("user-toggle-speaker", userId, roomId);
  };

  const leaveRoom = (userId: string, roomId: string) => {
    socket?.emit("user-leave", userId, roomId);
  };

  return {
    socket,
    joinRoom,
    toggleAudio,
    toggleVideo,
    toggleSpeaker,
    leaveRoom,
  };
};
