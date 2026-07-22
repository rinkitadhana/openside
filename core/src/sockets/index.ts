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

import type { Server as HTTPServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../db/index.ts";
import { getSessionIdByShareToken } from "../services/recording-service";

type RecordingCommentEvent = {
	id: string;
	authorName: string;
	body: string;
	createdAt: Date;
	user: { id: string; avatar: string | null } | null;
};

const recordingCommentsRoom = (sessionId: string) =>
	`recording-comments:${sessionId}`;

// REST controllers publish here only after the comment is committed.
let socketServer: SocketIOServer | null = null;

/** Deliver a newly created comment to every viewer of that shared recording. */
export function emitRecordingCommentCreated(
	sessionId: string,
	comment: RecordingCommentEvent,
) {
	socketServer
		?.to(recordingCommentsRoom(sessionId))
		.emit("recording-comment-created", comment);
}

// Recording session data sent to participants
interface RecordingSessionData {
	sessionId: string;
	spaceRecordingSessionId: string;
	startedAt: number;
	/** Synced 3-2-1 lead-in (ms) so every client starts capturing together. */
	countdownMs?: number;
	videoResolution: number;
	audioSampleRate: number;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	echoCancellation: boolean;
	recordingMode: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
}

export function initSocket(httpServer: HTTPServer) {
	const activeRecordingsByRoom = new Map<string, RecordingSessionData>();

	const io = new SocketIOServer(httpServer, {
		cors: {
			origin: process.env.WEB_URL || "http://localhost:3000",
			methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
			allowedHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		},
	});
	socketServer = io;

	io.on("connection", (socket) => {
		/**
		 * EVENT: time:sync
		 * Clock-synchronization handshake. The client sends this with an ack
		 * callback; we immediately answer with the server's wall-clock time.
		 *
		 * The server is the single source of truth for time. Each client pings a
		 * few times, measures the round-trip, and derives how far its own clock is
		 * from ours (NTP-style). Every recording timestamp - start, join,
		 * screen-share, stop - is then expressed in server time, so tracks line up
		 * regardless of how wrong an individual laptop's clock is.
		 */
		socket.on("time:sync", (ack: (serverTime: number) => void) => {
			if (typeof ack === "function") ack(Date.now());
		});

		/**
		 * EVENT: join-room / leave-room
		 * Clients must join a Socket.IO room (keyed by the space join code) so that
		 * recording coordination broadcasts (io.to(roomId)) actually reach them.
		 */
		socket.on("join-room", async (roomId: string) => {
			if (!roomId) return;

			socket.join(roomId);

			const activeRecording = activeRecordingsByRoom.get(roomId);
			if (activeRecording) {
				socket.emit("recording-started", activeRecording);
				return;
			}

			const activeSession = await prisma.space
				.findUnique({
					where: { joinCode: roomId },
					select: {
						recordingSessions: {
							where: { status: "ACTIVE" },
							orderBy: { startedAt: "desc" },
							take: 1,
							select: {
								id: true,
								spaceRecordingSessionId: true,
								startedAt: true,
								videoResolution: true,
								audioSampleRate: true,
								noiseSuppression: true,
								autoGainControl: true,
								echoCancellation: true,
								recordingMode: true,
							},
						},
					},
				})
				.catch((error) => {
					console.error(
						`[Socket] active recording lookup failed for ${roomId}:`,
						error,
					);
					return null;
				});
			const session = activeSession?.recordingSessions[0];
			if (!session) return;

			socket.emit("recording-started", {
				sessionId: session.id,
				spaceRecordingSessionId: session.spaceRecordingSessionId,
				startedAt: session.startedAt.getTime() + 3000,
				countdownMs: 0,
				videoResolution: session.videoResolution,
				audioSampleRate: session.audioSampleRate,
				noiseSuppression: session.noiseSuppression,
				autoGainControl: session.autoGainControl,
				echoCancellation: session.echoCancellation,
				recordingMode:
					session.recordingMode === "AUDIO_ONLY"
						? "AUDIO_ONLY"
						: "VIDEO_AND_AUDIO",
			});
		});

		socket.on("leave-room", (roomId: string) => {
			if (roomId) socket.leave(roomId);
		});

		/**
		 * The public share token is verified before the socket can subscribe. This
		 * prevents an arbitrary recording id from exposing a comment stream.
		 */
		socket.on(
			"join-recording-comments",
			async (shareToken: string, ack?: (joined: boolean) => void) => {
				if (!shareToken) {
					ack?.(false);
					return;
				}
				const sessionId = await getSessionIdByShareToken(shareToken).catch(
					(error) => {
						console.error("[Socket] shared comment lookup failed:", error);
						return null;
					},
				);
				if (!sessionId) {
					ack?.(false);
					return;
				}
				socket.join(recordingCommentsRoom(sessionId));
				ack?.(true);
			},
		);

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
		socket.on(
			"recording-start",
			(roomId: string, data: RecordingSessionData) => {
				if (!roomId) return;

				activeRecordingsByRoom.set(roomId, data);
				// Broadcast to ALL users in the room including sender
				io.to(roomId).emit("recording-started", data);
			},
		);

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
			if (!roomId) return;

			const activeRecording = activeRecordingsByRoom.get(roomId);
			if (!activeRecording || activeRecording.sessionId === sessionId) {
				activeRecordingsByRoom.delete(roomId);
			}
			// Broadcast to ALL users in the room including sender
			io.to(roomId).emit("recording-stopped", sessionId);
		});

		/**
		 * EVENT: recording-chunk-uploaded
		 * A participant successfully uploaded a chunk
		 * Used for progress tracking (optional - host can see upload progress)
		 */
		socket.on(
			"recording-chunk-uploaded",
			(
				roomId: string,
				data: {
					participantId: string;
					sequenceNumber: number;
					totalUploaded: number;
				},
			) => {
				// Broadcast to all (host can track progress)
				socket.broadcast.to(roomId).emit("participant-chunk-uploaded", data);
			},
		);

		/**
		 * EVENT: recording-complete
		 * A participant finished uploading all their chunks
		 */
		socket.on(
			"recording-complete",
			(
				roomId: string,
				data: {
					participantId: string;
					totalSegments: number;
				},
			) => {
				socket.broadcast
					.to(roomId)
					.emit("participant-recording-complete", data);
			},
		);
	});

	return io;
}
