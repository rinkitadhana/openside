import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import { isUserHost } from "../services/participant-service";
import {
	canAccessRecordingSession,
	createParticipantRecording,
	createSegment,
	deleteSpaceRecordingSession,
	disableSpaceRecordingShare,
	enableSpaceRecordingShare,
	getActiveSessionBySpaceId,
	getParticipantBySessionId,
	getParticipantBySessionIdAllowInactive,
	getRecordingOwnerParticipantId,
	getRecordingSessionById,
	getRecordingSessionsBySpaceId,
	getRecordingStorageContext,
	isHostOrCoHost,
	markRecordingComplete,
	startRecordingSession,
	stopRecordingSession,
	updateSpaceRecordingSession,
} from "../services/recording-service";
import {
	type TrackType,
	buildSegmentKey,
	checkSegmentUpload,
	presignGet,
	presignPut,
} from "../services/storage-service";
import { serializeBigInt } from "../utils/serialize";

const VALID_TRACK_TYPES: TrackType[] = ["combined", "audio", "screen", "pcm"];

/** Turn sharing on for a Space recording owned by the current Space host. */
export async function shareSpaceSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}
		const sessionId = req.params.sessionId as string | undefined;
		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}
		const user = await findOrCreateUser(req.user);
		const { shareToken } = await enableSpaceRecordingShare(sessionId, user.id);
		res.status(200).json({
			success: true,
			data: { shareToken },
			message: "Share link created successfully!",
		});
	} catch (error: unknown) {
		const code = error instanceof Error ? error.message : "";
		res
			.status(
				code === "SESSION_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 500,
			)
			.json({
				success: false,
				data: null,
				message:
					code === "SESSION_NOT_FOUND"
						? "Recording not found!"
						: code === "FORBIDDEN"
							? "Only the Space host can share this recording!"
							: `Failed to create share link: ${code || "Unknown error"}!`,
			});
	}
}

/** Revoke a Space recording's public share link. */
export async function unshareSpaceSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}
		const sessionId = req.params.sessionId as string | undefined;
		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}
		const user = await findOrCreateUser(req.user);
		await disableSpaceRecordingShare(sessionId, user.id);
		res.status(200).json({
			success: true,
			data: { shareToken: null },
			message: "Share link revoked successfully!",
		});
	} catch (error: unknown) {
		const code = error instanceof Error ? error.message : "";
		res
			.status(
				code === "SESSION_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 500,
			)
			.json({
				success: false,
				data: null,
				message:
					code === "SESSION_NOT_FOUND"
						? "Recording not found!"
						: code === "FORBIDDEN"
							? "Only the Space host can manage this link!"
							: `Failed to revoke share link: ${code || "Unknown error"}!`,
			});
	}
}

// RecordingSession Controllers

export async function startSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const { spaceId, spaceRecordingSessionId, participantSessionId } = req.body;

		if (!spaceId || typeof spaceId !== "string") {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (
			!spaceRecordingSessionId ||
			typeof spaceRecordingSessionId !== "string"
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Space recording session ID is required!",
			});
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		// Verify user is host or co-host
		const participant = await getParticipantBySessionId(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not an active participant in this space!",
			});
			return;
		}

		const canStart = await isHostOrCoHost(spaceId, participant.id);
		if (!canStart) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only host or co-host can start recording!",
			});
			return;
		}

		const session = await startRecordingSession({
			spaceId,
			spaceRecordingSessionId,
			// Only forward an explicit per-session choice; leaving it undefined lets
			// the service fall back to the host's saved cloud-backup preference.
			cloudBackup:
				typeof req.body.cloudBackup === "boolean"
					? req.body.cloudBackup
					: undefined,
		});

		res.status(201).json({
			success: true,
			data: session,
			message: "Recording session started successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SPACE_NOT_FOUND") {
				res
					.status(404)
					.json({ success: false, data: null, message: "Space not found!" });
				return;
			}
			if (error.message === "SPACE_NOT_LIVE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Space is not currently live!",
				});
				return;
			}
			if (error.message === "RECORDING_ALREADY_ACTIVE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "A recording session is already active!",
				});
				return;
			}
			if (error.message === "USAGE_EXHAUSTED") {
				res.status(402).json({
					success: false,
					data: { code: "USAGE_EXHAUSTED" },
					message:
						"Recording credit used up. Upgrade to Pro to keep recording!",
				});
				return;
			}
		}

		console.error("[API] Failed to start recording:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to start recording!",
		});
	}
}

export async function stopSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const sessionId = req.params.sessionId as string | undefined;
		const { spaceId, participantSessionId } = req.body;

		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Session ID is required!",
			});
			return;
		}

		if (!spaceId || typeof spaceId !== "string") {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		// Verify user is host or co-host
		const participant = await getParticipantBySessionId(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not an active participant in this space!",
			});
			return;
		}

		const canStop = await isHostOrCoHost(spaceId, participant.id);
		if (!canStop) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only host or co-host can stop recording!",
			});
			return;
		}

		const session = await stopRecordingSession(sessionId);

		res.status(200).json({
			success: true,
			data: session,
			message: "Recording session stopped successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording session not found!",
				});
				return;
			}
			if (error.message === "SESSION_NOT_ACTIVE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Recording session is not active!",
				});
				return;
			}
		}

		console.error("[API] Failed to stop recording:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to stop recording!",
		});
	}
}

export async function deleteSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const sessionId = req.params.sessionId as string | undefined;
		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const result = await deleteSpaceRecordingSession(sessionId, user.id);

		res.status(200).json({
			success: true,
			data: result,
			message: "Recording deleted permanently!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording session not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "Only the host can delete this recording!",
				});
				return;
			}
		}

		console.error("[API] Failed to delete recording:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to delete recording!",
		});
	}
}

const SESSION_DESCRIPTION_MAX_LENGTH = 2000;

export async function renameSessionController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const sessionId = req.params.sessionId as string | undefined;
		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}

		// Either field may be sent alone. A blank description clears it.
		const changes: { title?: string; description?: string | null } = {};
		if (req.body.title !== undefined) {
			const title =
				typeof req.body.title === "string" ? req.body.title.trim() : "";
			if (!title || title.length > 120) {
				res.status(400).json({
					success: false,
					data: null,
					message: "Recording title must be between 1 and 120 characters!",
				});
				return;
			}
			changes.title = title;
		}
		if (req.body.description !== undefined) {
			const description =
				typeof req.body.description === "string"
					? req.body.description.trim()
					: "";
			if (description.length > SESSION_DESCRIPTION_MAX_LENGTH) {
				res.status(400).json({
					success: false,
					data: null,
					message: `Description must be at most ${SESSION_DESCRIPTION_MAX_LENGTH} characters!`,
				});
				return;
			}
			changes.description = description || null;
		}
		if (Object.keys(changes).length === 0) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Nothing to update!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const session = await updateSpaceRecordingSession(
			sessionId,
			user.id,
			changes,
		);

		res.status(200).json({
			success: true,
			data: session,
			message: "Recording updated successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording session not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "Only the host can edit this recording!",
				});
				return;
			}
		}

		console.error("[API] Failed to rename recording:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to rename recording!",
		});
	}
}

export async function getSessionByIdController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const sessionId = req.params.sessionId as string | undefined;

		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Session ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check if user can access this session
		const canAccess = await canAccessRecordingSession(sessionId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this recording session!",
			});
			return;
		}

		const session = await getRecordingSessionById(sessionId);

		if (!session) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Recording session not found!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			// participantRecordings carry BigInt fileSize - serialize or res.json throws.
			data: serializeBigInt(session),
			message: "Recording session retrieved successfully!",
		});
	} catch (error: unknown) {
		console.error("[API] Failed to get recording session:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to get recording session!",
		});
	}
}

export async function getSessionsBySpaceIdController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const spaceId = req.params.spaceId as string | undefined;

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check if user is host or participant
		const isHost = await isUserHost(spaceId, user.id);
		if (!isHost) {
			// For now, only host can see all sessions for a space
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can view all recording sessions!",
			});
			return;
		}

		const sessions = await getRecordingSessionsBySpaceId(spaceId);

		// Attach a presigned URL for each recording's thumbnail (early poster from
		// the first chunk, or the finalized one) so clients can render it directly.
		const sessionsWithThumbnails = await Promise.all(
			sessions.map(async (session) => ({
				...session,
				participantRecordings: await Promise.all(
					session.participantRecordings.map(async (recording) => ({
						...recording,
						thumbnailUrl: recording.thumbnailKey
							? await presignGet(recording.thumbnailKey)
							: null,
					})),
				),
			})),
		);

		res.status(200).json({
			success: true,
			data: {
				sessions: sessionsWithThumbnails,
				count: sessionsWithThumbnails.length,
			},
			message: "Recording sessions retrieved successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "SPACE_NOT_FOUND") {
			res
				.status(404)
				.json({ success: false, data: null, message: "Space not found!" });
			return;
		}

		console.error("[API] Failed to get recording sessions:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to get recording sessions!",
		});
	}
}

export async function getActiveSessionBySpaceIdController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const spaceId = req.params.spaceId as string | undefined;
		const participantSessionId = req.query.participantSessionId;

		if (!spaceId) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		const participant = await getParticipantBySessionId(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not an active participant in this space!",
			});
			return;
		}

		const session = await getActiveSessionBySpaceId(spaceId);

		res.status(200).json({
			success: true,
			data: session,
			message: session
				? "Active recording session retrieved successfully!"
				: "No active recording session.",
		});
	} catch (error: unknown) {
		console.error("[API] Failed to get active recording session:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to get active recording session!",
		});
	}
}

// ParticipantRecording Controllers

export async function createParticipantRecordingController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const {
			recordingSessionId,
			participantSessionId,
			spaceId,
			type,
			isScreenShare,
			container,
			codec,
			width,
			height,
			fps,
			bitrate,
			sampleRate,
			channels,
			hasAudio,
			hasVideo,
			startOffsetMs,
			resumable,
		} = req.body;

		if (!recordingSessionId || typeof recordingSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}

		if (!spaceId || typeof spaceId !== "string") {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (!type || !["AUDIO", "VIDEO"].includes(type)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Type must be AUDIO or VIDEO!",
			});
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		// Participant ids are visible to everyone in the room, so the caller is
		// identified only by their private session id.
		const participant = await getParticipantBySessionId(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not an active participant in this space!",
			});
			return;
		}
		const resolvedParticipantId = participant.id;

		const recording = await createParticipantRecording({
			recordingSessionId,
			participantId: resolvedParticipantId,
			type,
			isScreenShare,
			container,
			codec,
			width,
			height,
			fps,
			bitrate,
			sampleRate,
			channels,
			hasAudio,
			hasVideo,
			startOffsetMs:
				typeof startOffsetMs === "number" && Number.isFinite(startOffsetMs)
					? Math.max(0, Math.round(startOffsetMs))
					: undefined,
			resumable: resumable === true,
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(recording),
			message: "Participant recording created successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording session not found!",
				});
				return;
			}
			if (error.message === "SESSION_NOT_ACTIVE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Recording session is not active!",
				});
				return;
			}
			if (error.message === "PARTICIPANT_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Participant not found!",
				});
				return;
			}
		}

		console.error("[API] Failed to create participant recording:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to create participant recording!",
		});
	}
}

export async function markRecordingCompleteController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const recordingId = req.params.recordingId as string | undefined;
		const { expectedSegments, participantSessionId, spaceId, width, height } =
			req.body;

		if (!recordingId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
			});
			return;
		}

		if (
			expectedSegments === undefined ||
			typeof expectedSegments !== "number" ||
			expectedSegments < 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message:
					"Expected segments count is required and must be a non-negative number!",
			});
			return;
		}

		// Require participantSessionId and spaceId for ownership verification
		if (!participantSessionId || !spaceId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID and space ID are required!",
			});
			return;
		}

		// Verify ownership. Allow inactive: a participant who has already left
		// must still be able to finalize the recording they made while present.
		const participant = await getParticipantBySessionIdAllowInactive(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not an active participant in this space!",
			});
			return;
		}

		const ownerParticipantId =
			await getRecordingOwnerParticipantId(recordingId);
		if (ownerParticipantId !== participant.id) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You can only complete your own recordings!",
			});
			return;
		}

		const toDimension = (value: unknown): number | null =>
			typeof value === "number" && Number.isFinite(value) && value > 0
				? Math.round(value)
				: null;

		const recording = await markRecordingComplete(
			recordingId,
			expectedSegments,
			{ width: toDimension(width), height: toDimension(height) },
		);

		res.status(200).json({
			success: true,
			data: serializeBigInt(recording),
			message: recording.isComplete
				? "Recording marked as complete!"
				: "Recording completion tracked, still uploading segments!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "RECORDING_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording not found!",
				});
				return;
			}
			if (error.message === "RECORDING_ALREADY_COMPLETE") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Recording is already complete!",
				});
				return;
			}
		}

		console.error("[API] Failed to mark recording complete:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to mark recording complete!",
		});
	}
}

// RecordingSegment Controllers

/**
 * Issue a short-lived presigned PUT URL so the client can upload a chunk
 * binary DIRECTLY to R2. The client then registers the segment metadata via
 * createSegmentController using the returned assetKey.
 */
export async function presignSegmentUploadController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const {
			participantRecordingId,
			spaceId,
			participantSessionId,
			trackType,
			sequenceNumber,
		} = req.body;

		if (!participantRecordingId || typeof participantRecordingId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant recording ID is required!",
			});
			return;
		}

		if (!spaceId || typeof spaceId !== "string") {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (!trackType || !VALID_TRACK_TYPES.includes(trackType)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Valid track type is required!",
			});
			return;
		}

		const upload = checkSegmentUpload(req.body);
		if (!upload.ok) {
			res
				.status(400)
				.json({ success: false, data: null, message: upload.message });
			return;
		}

		if (
			sequenceNumber === undefined ||
			typeof sequenceNumber !== "number" ||
			sequenceNumber < 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Sequence number is required and must be non-negative!",
			});
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		// Allow inactive so a participant who left can still upload chunks they
		// captured while here.
		const participant = await getParticipantBySessionIdAllowInactive(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not a participant in this space!",
			});
			return;
		}
		const resolvedParticipantId = participant.id;

		// Ownership: only the recording owner may upload to it.
		const ownerParticipantId = await getRecordingOwnerParticipantId(
			participantRecordingId,
		);
		if (!ownerParticipantId) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}
		if (ownerParticipantId !== resolvedParticipantId) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You can only upload to your own recordings!",
			});
			return;
		}

		const context = await getRecordingStorageContext(participantRecordingId);
		if (!context) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const assetKey = buildSegmentKey({
			spaceId: context.spaceId,
			recordingSessionId: context.recordingSessionId,
			participantId: context.participantId,
			participantRecordingId,
			trackType,
			sequenceNumber,
			ext: upload.ext,
		});

		const uploadUrl = await presignPut(
			assetKey,
			upload.contentType,
			upload.sizeBytes,
		);

		res.status(200).json({
			success: true,
			data: { uploadUrl, assetKey },
			message: "Upload URL issued successfully!",
		});
	} catch (error: unknown) {
		console.error("[API] Failed to presign upload:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to presign upload!",
		});
	}
}

export async function createSegmentController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const {
			participantRecordingId,
			spaceRecordingSessionId,
			spaceId,
			participantSessionId,
			sequenceNumber,
			assetKey,
			startMs,
			durationMs,
			sizeBytes,
			checksum,
			sampleRate,
			bitDepth,
			channelCount,
		} = req.body;

		if (!participantRecordingId || typeof participantRecordingId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant recording ID is required!",
			});
			return;
		}

		if (
			!spaceRecordingSessionId ||
			typeof spaceRecordingSessionId !== "string"
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Space recording session ID is required!",
			});
			return;
		}

		if (!spaceId || typeof spaceId !== "string") {
			res
				.status(400)
				.json({ success: false, data: null, message: "Space ID is required!" });
			return;
		}

		if (
			sequenceNumber === undefined ||
			typeof sequenceNumber !== "number" ||
			sequenceNumber < 0
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Sequence number is required and must be non-negative!",
			});
			return;
		}

		if (!assetKey || typeof assetKey !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Asset key is required!",
			});
			return;
		}

		if (startMs === undefined || typeof startMs !== "number") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Start time (ms) is required!",
			});
			return;
		}

		if (durationMs === undefined || typeof durationMs !== "number") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Duration (ms) is required!",
			});
			return;
		}

		if (sizeBytes === undefined) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Size in bytes is required!",
			});
			return;
		}

		if (!participantSessionId || typeof participantSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant session ID is required!",
			});
			return;
		}

		// Allow inactive so a just-left participant's final segments still
		// register.
		const participant = await getParticipantBySessionIdAllowInactive(
			spaceId,
			participantSessionId,
		);
		if (!participant) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You are not a participant in this space!",
			});
			return;
		}
		const resolvedParticipantId = participant.id;

		// Verify ownership - only recording owner can upload segments
		const ownerParticipantId = await getRecordingOwnerParticipantId(
			participantRecordingId,
		);
		if (ownerParticipantId !== resolvedParticipantId) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You can only upload segments to your own recordings!",
			});
			return;
		}

		// The finalizer downloads whatever assetKey is registered here. Requiring
		// the caller's own (ownership-verified) recording id in the key means it
		// can only ever reference chunks presigned for THIS recording - a crafted
		// key can't pull someone else's stored objects into this master.
		if (
			!assetKey.startsWith("spaces/") ||
			!assetKey.includes(`/${participantRecordingId}/`)
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Asset key does not belong to this recording!",
			});
			return;
		}

		const segment = await createSegment({
			participantRecordingId,
			spaceRecordingSessionId,
			spaceId,
			participantId: resolvedParticipantId,
			sequenceNumber,
			assetKey,
			startMs,
			durationMs,
			sizeBytes: BigInt(sizeBytes),
			checksum,
			// Raw-PCM tracks only; ignored (undefined) for WebM segments.
			sampleRate: typeof sampleRate === "number" ? sampleRate : undefined,
			bitDepth: typeof bitDepth === "number" ? bitDepth : undefined,
			channelCount: typeof channelCount === "number" ? channelCount : undefined,
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(segment),
			message: "Segment created successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "RECORDING_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording not found!",
				});
				return;
			}
			if (error.message === "DUPLICATE_SEQUENCE_NUMBER") {
				res.status(409).json({
					success: false,
					data: null,
					message: "Segment with this sequence number already exists!",
				});
				return;
			}
		}

		console.error("[API] Failed to create segment:", error);
		res.status(500).json({
			success: false,
			data: null,
			message: "Failed to create segment!",
		});
	}
}
