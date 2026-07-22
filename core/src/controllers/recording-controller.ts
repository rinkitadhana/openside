import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import { triggerFinalize } from "../services/finalization-service";
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
	getParticipantRecordingById,
	getRecordingOwnerParticipantId,
	getRecordingSessionById,
	getRecordingSessionsBySpaceId,
	getRecordingStorageContext,
	getRecordingsBySessionId,
	getSegmentsByRecordingId,
	isActiveParticipant,
	isHostOrCoHost,
	markRecordingComplete,
	renameSpaceRecordingSession,
	startRecordingSession,
	stopRecordingSession,
	updateParticipantRecording,
} from "../services/recording-service";
import {
	type TrackType,
	buildSegmentKey,
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to start recording: ${errorMessage}!`,
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to stop recording: ${errorMessage}!`,
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to delete recording: ${errorMessage}!`,
		});
	}
}

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
		const title =
			typeof req.body.title === "string" ? req.body.title.trim() : "";
		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}
		if (!title || title.length > 120) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording title must be between 1 and 120 characters!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const session = await renameSpaceRecordingSession(
			sessionId,
			user.id,
			title,
		);

		res.status(200).json({
			success: true,
			data: session,
			message: "Recording renamed successfully!",
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
					message: "Only the host can rename this recording!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to rename recording: ${errorMessage}!`,
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
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get recording session: ${errorMessage}!`,
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get recording sessions: ${errorMessage}!`,
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
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get active recording session: ${errorMessage}!`,
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
			participantId,
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

		// Get participant ID from participantSessionId if not provided directly
		let resolvedParticipantId = participantId;
		if (!resolvedParticipantId && participantSessionId) {
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
			resolvedParticipantId = participant.id;
		}

		if (!resolvedParticipantId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant ID or participant session ID is required!",
			});
			return;
		}

		// Verify participant is active in the space
		const isActive = await isActiveParticipant(spaceId, resolvedParticipantId);
		if (!isActive) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Participant is not active in this space!",
			});
			return;
		}

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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create participant recording: ${errorMessage}!`,
		});
	}
}

export async function updateParticipantRecordingController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const recordingId = req.params.recordingId as string | undefined;
		const {
			participantSessionId,
			spaceId,
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
			videoQuality,
			audioQuality,
			videoLabel,
			audioLabel,
			startOffsetMs,
			durationMs,
			expectedSegments,
		} = req.body;

		if (!recordingId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
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
				message: "You can only update your own recordings!",
			});
			return;
		}

		// Validate enum values if provided
		const validVideoQualities = [
			"P360",
			"P480",
			"P720",
			"P1080",
			"P1440",
			"P2160",
		];
		const validAudioQualities = [
			"SR_22050",
			"SR_44100",
			"SR_48000",
			"SR_96000",
		];

		if (videoQuality && !validVideoQualities.includes(videoQuality)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Invalid video quality value!",
			});
			return;
		}

		if (audioQuality && !validAudioQualities.includes(audioQuality)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Invalid audio quality value!",
			});
			return;
		}

		const updateData: Record<string, unknown> = {};
		if (container !== undefined) updateData.container = container;
		if (codec !== undefined) updateData.codec = codec;
		if (width !== undefined) updateData.width = width;
		if (height !== undefined) updateData.height = height;
		if (fps !== undefined) updateData.fps = fps;
		if (bitrate !== undefined) updateData.bitrate = bitrate;
		if (sampleRate !== undefined) updateData.sampleRate = sampleRate;
		if (channels !== undefined) updateData.channels = channels;
		if (hasAudio !== undefined) updateData.hasAudio = hasAudio;
		if (hasVideo !== undefined) updateData.hasVideo = hasVideo;
		if (videoQuality !== undefined) updateData.videoQuality = videoQuality;
		if (audioQuality !== undefined) updateData.audioQuality = audioQuality;
		if (videoLabel !== undefined) updateData.videoLabel = videoLabel;
		if (audioLabel !== undefined) updateData.audioLabel = audioLabel;
		if (startOffsetMs !== undefined) updateData.startOffsetMs = startOffsetMs;
		if (durationMs !== undefined) updateData.durationMs = durationMs;
		if (expectedSegments !== undefined)
			updateData.expectedSegments = expectedSegments;

		if (Object.keys(updateData).length === 0) {
			res.status(400).json({
				success: false,
				data: null,
				message: "At least one field must be provided to update!",
			});
			return;
		}

		const recording = await updateParticipantRecording(recordingId, updateData);

		res.status(200).json({
			success: true,
			data: serializeBigInt(recording),
			message: "Participant recording updated successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to update recording: ${errorMessage}!`,
		});
	}
}

export async function getParticipantRecordingByIdController(
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

		const recordingId = req.params.recordingId as string | undefined;

		if (!recordingId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
			});
			return;
		}

		const recording = await getParticipantRecordingById(recordingId);

		if (!recording) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		// Verify user has access (is host or participant in the space)
		const user = await findOrCreateUser(req.user);
		const canAccess = await canAccessRecordingSession(
			recording.recordingSessionId,
			user.id,
		);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this recording!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: serializeBigInt(recording),
			message: "Recording retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get recording: ${errorMessage}!`,
		});
	}
}

export async function getRecordingsBySessionIdController(
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

		const recordings = await getRecordingsBySessionId(sessionId);

		res.status(200).json({
			success: true,
			data: {
				recordings: serializeBigInt(recordings),
				count: recordings.length,
			},
			message: "Recordings retrieved successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
			res.status(404).json({
				success: false,
				data: null,
				message: "Recording session not found!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get recordings: ${errorMessage}!`,
		});
	}
}

export async function markRecordingCompleteController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const recordingId = req.params.recordingId as string | undefined;
		const { expectedSegments, participantSessionId, spaceId } = req.body;

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

		const recording = await markRecordingComplete(
			recordingId,
			expectedSegments,
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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to mark recording complete: ${errorMessage}!`,
		});
	}
}

/**
 * Manually (re)trigger finalization for a session - host fallback if the
 * automatic trigger didn't fire (e.g. a participant's recording got stuck).
 */
export async function finalizeSessionController(
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
		const session = await getRecordingSessionById(sessionId);
		if (!session) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Recording session not found!",
			});
			return;
		}

		// Finalization is space-only; screen recordings aren't finalized here.
		if (!session.spaceId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "This session cannot be finalized!",
			});
			return;
		}

		// Only the host can finalize.
		const isHost = await isUserHost(session.spaceId, user.id);
		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can finalize recordings!",
			});
			return;
		}

		// Hand off to the worker fleet (or in-process fallback); client polls
		// session status for completion.
		void triggerFinalize(sessionId);

		res.status(202).json({
			success: true,
			data: { sessionId, status: "PROCESSING" },
			message: "Finalization started!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to finalize: ${errorMessage}!`,
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
			participantId,
			trackType,
			sequenceNumber,
			contentType,
			ext,
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

		// Resolve participantId from session id if needed. Allow inactive so a
		// participant who left can still upload chunks they captured while here.
		let resolvedParticipantId = participantId;
		if (!resolvedParticipantId && participantSessionId) {
			const participant = await getParticipantBySessionIdAllowInactive(
				spaceId,
				participantSessionId,
			);
			if (participant) resolvedParticipantId = participant.id;
		}

		if (!resolvedParticipantId || typeof resolvedParticipantId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant ID or participant session ID is required!",
			});
			return;
		}

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
			ext: typeof ext === "string" ? ext : undefined,
		});

		const uploadUrl = await presignPut(
			assetKey,
			typeof contentType === "string"
				? contentType
				: "application/octet-stream",
		);

		res.status(200).json({
			success: true,
			data: { uploadUrl, assetKey },
			message: "Upload URL issued successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to presign upload: ${errorMessage}!`,
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
			participantId,
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

		// Resolve participantId from participantSessionId if needed. Allow inactive
		// so a just-left participant's final segments still register.
		let resolvedParticipantId = participantId;
		if (!resolvedParticipantId && participantSessionId) {
			const participant = await getParticipantBySessionIdAllowInactive(
				spaceId,
				participantSessionId,
			);
			if (participant) {
				resolvedParticipantId = participant.id;
			}
		}

		if (!resolvedParticipantId || typeof resolvedParticipantId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Participant ID or participant session ID is required!",
			});
			return;
		}

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

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create segment: ${errorMessage}!`,
		});
	}
}

export async function getSegmentsByRecordingIdController(
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

		const recordingId = req.params.recordingId as string | undefined;

		if (!recordingId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
			});
			return;
		}

		// Get recording to check access
		const recording = await getParticipantRecordingById(recordingId);
		if (!recording) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		// Verify user has access
		const user = await findOrCreateUser(req.user);
		const canAccess = await canAccessRecordingSession(
			recording.recordingSessionId,
			user.id,
		);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this recording!",
			});
			return;
		}

		const segments = await getSegmentsByRecordingId(recordingId);

		res.status(200).json({
			success: true,
			data: {
				segments: serializeBigInt(segments),
				count: segments.length,
			},
			message: "Segments retrieved successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get segments: ${errorMessage}!`,
		});
	}
}
