import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import {
	DOWNLOAD_FORMATS,
	type DownloadFormat,
	resolveDownloadUrl,
} from "../services/download-service";
import {
	COMMENT_AUTHOR_MAX_LENGTH,
	COMMENT_MAX_LENGTH,
	createRecordingComment,
	createScreenRecording,
	createSegment,
	deleteRecordingComment,
	deleteScreenRecordingSession,
	disableScreenRecordingShare,
	enableScreenRecordingShare,
	getScreenRecordingOwnerUserId,
	getScreenRecordingStorageContext,
	getScreenSessionForUser,
	getSessionIdByShareToken,
	getSharedFinalOutputKey,
	getSharedOutputKey,
	getSharedRecording,
	listRecordingComments,
	listScreenRecordings,
	markScreenRecordingComplete,
	renameScreenRecordingSession,
	startScreenRecordingSession,
	stopScreenRecordingSession,
} from "../services/recording-service";
import { maybeFinalizeScreenSession } from "../services/screen-finalization-service";
import {
	type TrackType,
	buildScreenSegmentKey,
	presignGet,
	presignPut,
} from "../services/storage-service";
import { emitRecordingCommentCreated } from "../sockets/index";
import { serializeBigInt } from "../utils/serialize";

const VALID_TRACK_TYPES: TrackType[] = [
	"combined",
	"audio",
	"screen",
	"camera",
];

// Screen-recorder sessions are single-user and owned by the authenticated user.
// They reuse the same RecordingSession/ParticipantRecording/RecordingSegment
// tables (source = SCREEN_RECORDER, spaceId/participantId null) so the chunk →
// R2 pipeline is shared, but ownership is by userId rather than participant.

export async function startScreenSessionController(
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

		const { spaceRecordingSessionId, title, description, composition } =
			req.body;

		if (
			!spaceRecordingSessionId ||
			typeof spaceRecordingSessionId !== "string"
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		// Every recording gets a default title/description derived from the author.
		const authorName = user.name?.trim() || "User";
		const resolvedTitle =
			typeof title === "string" && title.trim()
				? title.trim()
				: `${authorName}'s recording`;
		const resolvedDescription =
			typeof description === "string" && description.trim()
				? description.trim()
				: `${authorName}'s screen recording`;

		const session = await startScreenRecordingSession({
			userId: user.id,
			spaceRecordingSessionId,
			title: resolvedTitle,
			description: resolvedDescription,
			composition:
				composition && typeof composition === "object"
					? composition
					: undefined,
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(session),
			message: "Screen recording session started successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "USAGE_EXHAUSTED") {
			res.status(402).json({
				success: false,
				data: { code: "USAGE_EXHAUSTED" },
				message: "Recording credit used up. Upgrade to Pro to keep recording!",
			});
			return;
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

export async function stopScreenSessionController(
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
		const session = await stopScreenRecordingSession(sessionId, user.id);

		console.log(
			`[ScreenRecording] stop requested session=${sessionId} user=${user.id} recordings=${session.participantRecordings.length}`,
			session.participantRecordings.map((r) => ({
				id: r.id,
				type: r.type,
				status: r.status,
				uploaded: r.uploadedSegments,
			})),
		);

		// Stitch masters + composite the PiP once everything has uploaded.
		void maybeFinalizeScreenSession(sessionId);

		res.status(200).json({
			success: true,
			data: serializeBigInt(session),
			message: "Screen recording session stopped successfully!",
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

export async function renameScreenSessionController(
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
		const session = await renameScreenRecordingSession(
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
					message: "Recording not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "You can only rename your own recordings!",
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

export async function deleteScreenSessionController(
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
		const result = await deleteScreenRecordingSession(sessionId, user.id);

		res.status(200).json({
			success: true,
			data: result,
			message: "Recording deleted permanently!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
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
			message: `Failed to delete recording: ${errorMessage}!`,
		});
	}
}

export async function createScreenRecordingController(
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

		const {
			recordingSessionId,
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
		} = req.body;

		if (!recordingSessionId || typeof recordingSessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
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

		const user = await findOrCreateUser(req.user);
		const recording = await createScreenRecording({
			recordingSessionId,
			userId: user.id,
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
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(recording),
			message: "Screen recording created successfully!",
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
			message: `Failed to create recording: ${errorMessage}!`,
		});
	}
}

export async function presignScreenSegmentController(
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

		const {
			participantRecordingId,
			trackType,
			sequenceNumber,
			contentType,
			ext,
		} = req.body;

		if (!participantRecordingId || typeof participantRecordingId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
			});
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

		const user = await findOrCreateUser(req.user);
		const ownerUserId = await getScreenRecordingOwnerUserId(
			participantRecordingId,
		);
		if (!ownerUserId) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}
		if (ownerUserId !== user.id) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You can only upload to your own recordings!",
			});
			return;
		}

		const context = await getScreenRecordingStorageContext(
			participantRecordingId,
		);
		if (!context) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const assetKey = buildScreenSegmentKey({
			userId: context.userId,
			recordingSessionId: context.recordingSessionId,
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

export async function createScreenSegmentController(
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

		const {
			participantRecordingId,
			spaceRecordingSessionId,
			sequenceNumber,
			assetKey,
			startMs,
			durationMs,
			sizeBytes,
			checksum,
		} = req.body;

		if (!participantRecordingId || typeof participantRecordingId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording ID is required!",
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
				message: "Recording session ID is required!",
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

		const user = await findOrCreateUser(req.user);
		const ownerUserId = await getScreenRecordingOwnerUserId(
			participantRecordingId,
		);
		if (ownerUserId !== user.id) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You can only upload segments to your own recordings!",
			});
			return;
		}

		// The finalizer downloads whatever assetKey is registered here, so it must
		// be pinned to this user's own session prefix - otherwise a crafted key
		// could pull another user's stored objects into this recording's master.
		const context = await getScreenRecordingStorageContext(
			participantRecordingId,
		);
		if (
			!context ||
			!assetKey.startsWith(
				`screen/${context.userId}/sessions/${context.recordingSessionId}/`,
			)
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Asset key does not belong to this recording!",
			});
			return;
		}

		// spaceId/participantId on the segment row are plain (non-FK) strings; for
		// screen recordings we store the owner userId so the rows stay groupable.
		const segment = await createSegment({
			participantRecordingId,
			spaceRecordingSessionId,
			spaceId: user.id,
			participantId: user.id,
			sequenceNumber,
			assetKey,
			startMs,
			durationMs,
			sizeBytes: BigInt(sizeBytes),
			checksum,
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

const OUTPUT_KINDS = ["screen", "screenAligned", "camera", "both"] as const;

export async function listScreenRecordingsController(
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
		const user = await findOrCreateUser(req.user);
		const recordings = await listScreenRecordings(user.id);
		res.status(200).json({
			success: true,
			data: { recordings: serializeBigInt(recordings) },
			message: "Screen recordings retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to list recordings: ${errorMessage}!`,
		});
	}
}

export async function getScreenOutputUrlController(
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
		const kind = req.params.kind as string | undefined;
		const download =
			req.query.download === "1" || req.query.download === "true";

		if (
			!sessionId ||
			!kind ||
			!OUTPUT_KINDS.includes(kind as (typeof OUTPUT_KINDS)[number])
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Valid session ID and output kind are required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const session = await getScreenSessionForUser(sessionId, user.id);
		if (!session) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const outputs =
			(session.outputs as Record<string, { key?: string }> | null) ?? {};
		const key = outputs[kind]?.key;
		if (!key) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This output isn't available!",
			});
			return;
		}

		const safeTitle = (session.title || "recording").replace(/[^\w.-]+/g, "_");
		// Masters may be .mp4 (CFR re-encode) or .webm (remux fallback) - name the
		// download after what was actually produced.
		const keyExt = key.match(/\.(\w+)$/)?.[1] ?? "webm";
		const url = await presignGet(
			key,
			download ? { downloadName: `${safeTitle}-${kind}.${keyExt}` } : undefined,
		);

		res.status(200).json({
			success: true,
			data: { url },
			message: "Download URL issued successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get URL: ${errorMessage}!`,
		});
	}
}

// Share links + comments.
//
// The /shared/:token endpoints are PUBLIC by design - holding the token is the
// authorization, so they never read req.user for access. They run behind
// optionalAuthMiddleware only so a signed-in visitor's comment can be
// attributed to their account instead of an anonymous name.

/** Turn sharing on (or return the existing link) for a recording. */
export async function shareScreenSessionController(
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
		const { shareToken } = await enableScreenRecordingShare(sessionId, user.id);

		res.status(200).json({
			success: true,
			data: { shareToken },
			message: "Share link created successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "You can only share your own recordings!",
				});
				return;
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create share link: ${errorMessage}!`,
		});
	}
}

/** Revoke the share link - existing URLs stop working immediately. */
export async function unshareScreenSessionController(
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
		await disableScreenRecordingShare(sessionId, user.id);

		res.status(200).json({
			success: true,
			data: { shareToken: null },
			message: "Share link revoked successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "SESSION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Recording not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "You can only manage your own recordings!",
				});
				return;
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to revoke share link: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: the shared recording's viewable metadata (no storage keys). */
export async function getSharedRecordingController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		if (!token) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Share token is required!",
			});
			return;
		}

		const recording = await getSharedRecording(token);
		if (!recording) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This link is no longer available!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: { recording },
			message: "Recording retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to load recording: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: presigned URL for one output of a shared recording. */
export async function getSharedOutputUrlController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		const kind = req.params.kind as string | undefined;
		const download =
			req.query.download === "1" || req.query.download === "true";

		if (
			!token ||
			!kind ||
			!OUTPUT_KINDS.includes(kind as (typeof OUTPUT_KINDS)[number])
		) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Valid share token and output kind are required!",
			});
			return;
		}

		const output = await getSharedOutputKey(token, kind);
		if (!output) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This output isn't available!",
			});
			return;
		}

		const safeTitle = (output.title || "recording").replace(/[^\w.-]+/g, "_");
		const keyExt = output.key.match(/\.(\w+)$/)?.[1] ?? "webm";
		const url = await presignGet(
			output.key,
			download ? { downloadName: `${safeTitle}-${kind}.${keyExt}` } : undefined,
		);

		res.status(200).json({
			success: true,
			data: { url },
			message: "URL issued successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get URL: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: presigned playback/download URL for a Space recording track. */
export async function getSharedFinalOutputUrlController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		const outputId = req.params.outputId as string | undefined;
		const download =
			req.query.download === "1" || req.query.download === "true";
		if (!token || !outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Share token and output ID are required!",
			});
			return;
		}

		const output = await getSharedFinalOutputKey(token, outputId);
		if (!output) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This output isn't available!",
			});
			return;
		}

		const safeTitle = (output.title || "recording").replace(/[^\w.-]+/g, "_");
		const keyExt = output.key.match(/\.(\w+)$/)?.[1] ?? "webm";
		const url = await presignGet(
			output.key,
			download
				? { downloadName: `${safeTitle}-${outputId.slice(-6)}.${keyExt}` }
				: undefined,
		);

		res.status(200).json({
			success: true,
			data: { url },
			message: "URL issued successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get URL: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: request a Space track download in one of its available formats. */
export async function getSharedFinalOutputDownloadController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		const outputId = req.params.outputId as string | undefined;
		const format =
			(req.query.format as string | undefined)?.toLowerCase() || "webm";
		if (!token || !outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Share token and output ID are required!",
			});
			return;
		}
		if (!DOWNLOAD_FORMATS.includes(format as DownloadFormat)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Unsupported format!",
			});
			return;
		}

		const output = await getSharedFinalOutputKey(token, outputId);
		if (!output) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This output isn't available!",
			});
			return;
		}

		const safeTitle = (output.title || "recording").replace(/[^\w.-]+/g, "_");
		const result = await resolveDownloadUrl({
			masterKey: output.key,
			hasVideo: output.hasVideo,
			hasAudio: output.hasAudio,
			audioWavKey: output.audioWavKey,
			format: format as DownloadFormat,
			downloadName: `${safeTitle}-${outputId.slice(-6)}.${format}`,
		});
		if (result.error) {
			res
				.status(400)
				.json({ success: false, data: null, message: result.error });
			return;
		}
		res.status(result.ready ? 200 : 202).json({
			success: true,
			data: result,
			message: result.ready
				? "Download URL ready!"
				: "Preparing download, try again shortly!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get download URL: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: comments on a shared recording. */
export async function listSharedCommentsController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		if (!token) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Share token is required!",
			});
			return;
		}

		const sessionId = await getSessionIdByShareToken(token);
		if (!sessionId) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This link is no longer available!",
			});
			return;
		}

		const comments = await listRecordingComments(sessionId);
		res.status(200).json({
			success: true,
			data: { comments },
			message: "Comments retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to load comments: ${errorMessage}!`,
		});
	}
}

/** PUBLIC: leave a comment on a shared recording. */
export async function createSharedCommentController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		const token = req.params.token as string | undefined;
		const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
		const rawName =
			typeof req.body.authorName === "string" ? req.body.authorName.trim() : "";

		if (!token) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Share token is required!",
			});
			return;
		}
		if (!body || body.length > COMMENT_MAX_LENGTH) {
			res.status(400).json({
				success: false,
				data: null,
				message: `Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters!`,
			});
			return;
		}

		const sessionId = await getSessionIdByShareToken(token);
		if (!sessionId) {
			res.status(404).json({
				success: false,
				data: null,
				message: "This link is no longer available!",
			});
			return;
		}

		// A signed-in visitor comments as their account; everyone else must type
		// a display name (the share link is open to anyone).
		let userId: string | null = null;
		let authorName = rawName;
		if (req.user) {
			const user = await findOrCreateUser(req.user);
			userId = user.id;
			authorName = user.name?.trim() || rawName;
		}
		if (!authorName || authorName.length > COMMENT_AUTHOR_MAX_LENGTH) {
			res.status(400).json({
				success: false,
				data: null,
				message: `Name must be between 1 and ${COMMENT_AUTHOR_MAX_LENGTH} characters!`,
			});
			return;
		}

		const comment = await createRecordingComment({
			sessionId,
			userId,
			authorName,
			body,
		});
		emitRecordingCommentCreated(sessionId, comment);

		res.status(201).json({
			success: true,
			data: { comment },
			message: "Comment posted successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to post comment: ${errorMessage}!`,
		});
	}
}

/** Owner-side comment list for a recording's project page. */
export async function listScreenCommentsController(
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
		const session = await getScreenSessionForUser(sessionId, user.id);
		if (!session) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const comments = await listRecordingComments(sessionId);
		res.status(200).json({
			success: true,
			data: { comments },
			message: "Comments retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to load comments: ${errorMessage}!`,
		});
	}
}

/** Owner-side comment create for a recording's project page. */
export async function createScreenCommentController(
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
		const body = typeof req.body.body === "string" ? req.body.body.trim() : "";

		if (!sessionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Recording session ID is required!",
			});
			return;
		}
		if (!body || body.length > COMMENT_MAX_LENGTH) {
			res.status(400).json({
				success: false,
				data: null,
				message: `Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters!`,
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const session = await getScreenSessionForUser(sessionId, user.id);
		if (!session) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Recording not found!" });
			return;
		}

		const comment = await createRecordingComment({
			sessionId,
			userId: user.id,
			authorName: user.name?.trim() || "User",
			body,
		});
		emitRecordingCommentCreated(sessionId, comment);

		res.status(201).json({
			success: true,
			data: { comment },
			message: "Comment posted successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to post comment: ${errorMessage}!`,
		});
	}
}

/** Delete a comment (its author, or the recording's owner as moderator). */
export async function deleteScreenCommentController(
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

		const commentId = req.params.commentId as string | undefined;
		if (!commentId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Comment ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		await deleteRecordingComment(commentId, user.id);

		res.status(200).json({
			success: true,
			data: { deleted: true },
			message: "Comment deleted successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "COMMENT_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Comment not found!",
				});
				return;
			}
			if (error.message === "FORBIDDEN") {
				res.status(403).json({
					success: false,
					data: null,
					message: "You can't delete this comment!",
				});
				return;
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to delete comment: ${errorMessage}!`,
		});
	}
}

export async function markScreenRecordingCompleteController(
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
		const { expectedSegments, width, height } = req.body;

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

		const user = await findOrCreateUser(req.user);
		const toDimension = (value: unknown): number | null =>
			typeof value === "number" && Number.isFinite(value) && value > 0
				? Math.round(value)
				: null;

		const recording = await markScreenRecordingComplete(
			recordingId,
			user.id,
			expectedSegments,
			{ width: toDimension(width), height: toDimension(height) },
		);

		console.log(
			`[ScreenRecording] track complete recording=${recordingId} session=${recording.recordingSessionId} expected=${expectedSegments} uploaded=${recording.uploadedSegments} isComplete=${recording.isComplete} status=${recording.status}`,
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
