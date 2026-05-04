/**
 * SOCKET.IO CLIENT CONTEXT
 *
 * PURPOSE:
 * Provides a single Socket.IO connection shared across the entire app.
 * This connection is used for app-specific realtime events that are not handled
 * by LiveKit, such as recording coordination and upload progress.
 *
 * KEY CONCEPTS:
 * - Socket.IO = Real-time bidirectional communication (like WebSockets)
 * - LiveKit owns video, audio, participants, and media reconnection.
 * - Socket.IO owns current app-level recording events.
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
  "recording-started": (data: RecordingSessionData) => void;
  "recording-stopped": (sessionId: string) => void;
  "participant-chunk-uploaded": (data: ChunkUploadedData) => void;
  "participant-recording-complete": (data: RecordingCompleteData) => void;
}

interface ClientToServerEvents {
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
      import.meta.env.VITE_API_SOCKET_URL || "http://localhost:4000",
      {
        transports: ["websocket", "polling"], // Try WebSocket first, fallback to polling
        autoConnect: true,
      },
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
