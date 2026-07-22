import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import {
	DOWNLOAD_FORMATS,
	type DownloadFormat,
	resolveDownloadUrl,
} from "../services/download-service";
import {
	canAccessFinalOutput,
	createFinalOutput,
	createRendition,
	deleteFinalOutput,
	deleteRendition,
	getFinalOutputById,
	getFinalOutputsBySessionId,
	getFinalOutputsBySpaceId,
	getRenditionOutputId,
	getRenditionsByOutputId,
	updateFinalOutput,
	updateRendition,
} from "../services/final-output-service";
import { isUserHost } from "../services/participant-service";
import { canAccessRecordingSession } from "../services/recording-service";
import { presignGet } from "../services/storage-service";
import { serializeBigInt } from "../utils/serialize";

// FinalOutput Controllers

/**
 * Resolve a presigned download URL for an output in the requested format.
 * WebM is immediate; mp4/mp3/wav transcode on demand (returns ready:false while
 * the first transcode runs - client polls). Host-only per PRD.
 */
export async function getDownloadUrlController(
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

		const outputId = req.params.outputId as string | undefined;
		const format =
			(req.query.format as string | undefined)?.toLowerCase() || "webm";

		if (!outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Output ID is required!",
			});
			return;
		}

		if (!DOWNLOAD_FORMATS.includes(format as DownloadFormat)) {
			res
				.status(400)
				.json({ success: false, data: null, message: "Unsupported format!" });
			return;
		}

		const output = await getFinalOutputById(outputId);
		if (!output) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Output not found!" });
			return;
		}

		// Host-only download access.
		const user = await findOrCreateUser(req.user);
		if (output.space.hostId !== user.id) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can download recordings!",
			});
			return;
		}

		if (output.status !== "READY" || !output.masterKey) {
			res.status(409).json({
				success: false,
				data: null,
				message: "Recording is still processing!",
			});
			return;
		}

		// inline → preview playback; otherwise force a download with a friendly name.
		const inline = req.query.disposition === "inline";
		const base =
			output.type === "COMPOSITE"
				? "cloud-mix"
				: output.hasVideo
					? "video-audio"
					: "audio";
		const downloadName = `openside-${base}-${output.id.slice(-6)}.${format}`;

		const result = await resolveDownloadUrl({
			masterKey: output.masterKey,
			hasVideo: output.hasVideo,
			hasAudio: output.hasAudio,
			// Real lossless WAV (from the PCM track) when present; wav/mp3 downloads
			// serve/encode from it instead of extracting from the WebM master.
			audioWavKey: output.audioWavKey,
			format: format as DownloadFormat,
			downloadName: inline ? undefined : downloadName,
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

export async function createFinalOutputController(
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
			spaceId,
			type,
			mode,
			targetParticipantId,
			sourceRecordingId,
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

		if (!type || !["COMPOSITE", "PER_PARTICIPANT"].includes(type)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Type must be COMPOSITE or PER_PARTICIPANT!",
			});
			return;
		}

		if (mode && !["MIXED", "VIDEO_ONLY", "AUDIO_ONLY"].includes(mode)) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Mode must be MIXED, VIDEO_ONLY, or AUDIO_ONLY!",
			});
			return;
		}

		// Verify user is host
		const user = await findOrCreateUser(req.user);
		const isHost = await isUserHost(spaceId, user.id);

		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can create final outputs!",
			});
			return;
		}

		const output = await createFinalOutput({
			recordingSessionId,
			spaceId,
			type,
			mode,
			targetParticipantId,
			sourceRecordingId,
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(output),
			message: "Final output created successfully!",
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
			if (error.message === "SESSION_SPACE_MISMATCH") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Recording session does not belong to this space!",
				});
				return;
			}
			if (error.message === "PARTICIPANT_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Target participant not found!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create final output: ${errorMessage}!`,
		});
	}
}

export async function updateFinalOutputController(
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

		const outputId = req.params.outputId as string | undefined;

		if (!outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Output ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check access
		const canAccess = await canAccessFinalOutput(outputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		const {
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
			thumbnailKey,
			masterKey,
			mimeType,
			durationMs,
			fileSize,
			checksum,
			status,
			processingJobId,
			errorMessage,
		} = req.body;

		const updateData: Record<string, unknown> = {};
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
		if (thumbnailKey !== undefined) updateData.thumbnailKey = thumbnailKey;
		if (masterKey !== undefined) updateData.masterKey = masterKey;
		if (mimeType !== undefined) updateData.mimeType = mimeType;
		if (durationMs !== undefined) updateData.durationMs = durationMs;
		if (fileSize !== undefined) updateData.fileSize = BigInt(fileSize);
		if (checksum !== undefined) updateData.checksum = checksum;
		if (status !== undefined) updateData.status = status;
		if (processingJobId !== undefined)
			updateData.processingJobId = processingJobId;
		if (errorMessage !== undefined) updateData.errorMessage = errorMessage;

		if (Object.keys(updateData).length === 0) {
			res.status(400).json({
				success: false,
				data: null,
				message: "At least one field must be provided to update!",
			});
			return;
		}

		const output = await updateFinalOutput(outputId, updateData);

		res.status(200).json({
			success: true,
			data: serializeBigInt(output),
			message: "Final output updated successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "OUTPUT_NOT_FOUND") {
			res.status(404).json({
				success: false,
				data: null,
				message: "Final output not found!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to update final output: ${errorMessage}!`,
		});
	}
}

export async function getFinalOutputByIdController(
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

		const outputId = req.params.outputId as string | undefined;

		if (!outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Output ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check access
		const canAccess = await canAccessFinalOutput(outputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		const output = await getFinalOutputById(outputId);

		if (!output) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Final output not found!",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: serializeBigInt(output),
			message: "Final output retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get final output: ${errorMessage}!`,
		});
	}
}

export async function getFinalOutputsBySessionIdController(
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

		// Only the session's owner/host/participant may list its outputs - keeps a
		// known sessionId from leaking another user's recording metadata + keys.
		const user = await findOrCreateUser(req.user);
		const canAccess = await canAccessRecordingSession(sessionId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this recording session!",
			});
			return;
		}

		const outputs = await getFinalOutputsBySessionId(sessionId);

		res.status(200).json({
			success: true,
			data: {
				outputs: serializeBigInt(outputs),
				count: outputs.length,
			},
			message: "Final outputs retrieved successfully!",
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
			message: `Failed to get final outputs: ${errorMessage}!`,
		});
	}
}

export async function getFinalOutputsBySpaceIdController(
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

		// Only host can see all outputs for a space
		const isHost = await isUserHost(spaceId, user.id);
		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can view all outputs for a space!",
			});
			return;
		}

		const outputs = await getFinalOutputsBySpaceId(spaceId);

		// Attach a presigned URL for each stored thumbnail so the client can render
		// it instantly (no per-thumbnail round trip). presignGet is local signing,
		// so mapping the whole list is cheap.
		const outputsWithThumbnails = await Promise.all(
			outputs.map(async (output) => ({
				...output,
				thumbnailUrl: output.thumbnailKey
					? await presignGet(output.thumbnailKey)
					: null,
			})),
		);

		res.status(200).json({
			success: true,
			data: {
				outputs: serializeBigInt(outputsWithThumbnails),
				count: outputs.length,
			},
			message: "Final outputs retrieved successfully!",
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
			message: `Failed to get final outputs: ${errorMessage}!`,
		});
	}
}

export async function deleteFinalOutputController(
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

		const outputId = req.params.outputId as string | undefined;

		if (!outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Output ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Get output to check space ownership
		const output = await getFinalOutputById(outputId);
		if (!output) {
			res.status(404).json({
				success: false,
				data: null,
				message: "Final output not found!",
			});
			return;
		}

		// Only host can delete
		const isHost = await isUserHost(output.spaceId, user.id);
		if (!isHost) {
			res.status(403).json({
				success: false,
				data: null,
				message: "Only the host can delete outputs!",
			});
			return;
		}

		await deleteFinalOutput(outputId);

		res.status(200).json({
			success: true,
			data: null,
			message: "Final output deleted successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "OUTPUT_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Final output not found!",
				});
				return;
			}
			if (error.message === "CANNOT_DELETE_PROCESSING_OUTPUT") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Cannot delete an output that is currently processing!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to delete final output: ${errorMessage}!`,
		});
	}
}

// Rendition Controllers

export async function createRenditionController(
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
			finalOutputId,
			width,
			height,
			bitrate,
			codec,
			container,
			assetKey,
			sizeBytes,
			jobId,
		} = req.body;

		if (!finalOutputId || typeof finalOutputId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Final output ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check access to the final output
		const canAccess = await canAccessFinalOutput(finalOutputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		const rendition = await createRendition({
			finalOutputId,
			width,
			height,
			bitrate,
			codec,
			container,
			assetKey,
			sizeBytes: sizeBytes ? BigInt(sizeBytes) : undefined,
			jobId,
		});

		res.status(201).json({
			success: true,
			data: serializeBigInt(rendition),
			message: "Rendition created successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "OUTPUT_NOT_FOUND") {
			res.status(404).json({
				success: false,
				data: null,
				message: "Final output not found!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to create rendition: ${errorMessage}!`,
		});
	}
}

export async function updateRenditionController(
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

		const renditionId = req.params.renditionId as string | undefined;

		if (!renditionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Rendition ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Authorize against the owning output - a rendition is only reachable by
		// users who can access its final output (matches create/get rendition).
		const outputId = await getRenditionOutputId(renditionId);
		if (!outputId) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Rendition not found!" });
			return;
		}
		const canAccess = await canAccessFinalOutput(outputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		const { assetKey, sizeBytes, status } = req.body;

		const updateData: Record<string, unknown> = {};
		if (assetKey !== undefined) updateData.assetKey = assetKey;
		if (sizeBytes !== undefined) updateData.sizeBytes = BigInt(sizeBytes);
		if (status !== undefined) updateData.status = status;

		if (Object.keys(updateData).length === 0) {
			res.status(400).json({
				success: false,
				data: null,
				message: "At least one field must be provided to update!",
			});
			return;
		}

		const rendition = await updateRendition(renditionId, updateData);

		res.status(200).json({
			success: true,
			data: serializeBigInt(rendition),
			message: "Rendition updated successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "RENDITION_NOT_FOUND") {
			res
				.status(404)
				.json({ success: false, data: null, message: "Rendition not found!" });
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to update rendition: ${errorMessage}!`,
		});
	}
}

export async function getRenditionsByOutputIdController(
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

		const outputId = req.params.outputId as string | undefined;

		if (!outputId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Output ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Check access
		const canAccess = await canAccessFinalOutput(outputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		const renditions = await getRenditionsByOutputId(outputId);

		res.status(200).json({
			success: true,
			data: {
				renditions: serializeBigInt(renditions),
				count: renditions.length,
			},
			message: "Renditions retrieved successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "OUTPUT_NOT_FOUND") {
			res.status(404).json({
				success: false,
				data: null,
				message: "Final output not found!",
			});
			return;
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to get renditions: ${errorMessage}!`,
		});
	}
}

export async function deleteRenditionController(
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

		const renditionId = req.params.renditionId as string | undefined;

		if (!renditionId) {
			res.status(400).json({
				success: false,
				data: null,
				message: "Rendition ID is required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);

		// Authorize against the owning output before deleting.
		const outputId = await getRenditionOutputId(renditionId);
		if (!outputId) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Rendition not found!" });
			return;
		}
		const canAccess = await canAccessFinalOutput(outputId, user.id);
		if (!canAccess) {
			res.status(403).json({
				success: false,
				data: null,
				message: "You don't have access to this output!",
			});
			return;
		}

		await deleteRendition(renditionId);

		res.status(200).json({
			success: true,
			data: null,
			message: "Rendition deleted successfully!",
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message === "RENDITION_NOT_FOUND") {
				res.status(404).json({
					success: false,
					data: null,
					message: "Rendition not found!",
				});
				return;
			}
			if (error.message === "CANNOT_DELETE_GENERATING_RENDITION") {
				res.status(400).json({
					success: false,
					data: null,
					message: "Cannot delete a rendition that is currently generating!",
				});
				return;
			}
		}

		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to delete rendition: ${errorMessage}!`,
		});
	}
}
