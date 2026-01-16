import type { Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import {
  startRecordingSession,
  stopRecordingSession,
  getRecordingSessionById,
  getRecordingSessionsBySpaceId,
  createParticipantRecording,
  updateParticipantRecording,
  getParticipantRecordingById,
  getRecordingsBySessionId,
  markRecordingComplete,
  createSegment,
  getSegmentsByRecordingId,
  isHostOrCoHost,
  isActiveParticipant,
  getParticipantBySessionId,
  canAccessRecordingSession,
  getRecordingOwnerParticipantId,
} from "../services/recording-service";
import { findOrCreateUser } from "../services/auth-service";
import { isUserHost } from "../services/participant-service";

// RecordingSession Controllers

export async function startSessionController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { spaceId, spaceRecordingSessionId, participantSessionId } = req.body;

    if (!spaceId || typeof spaceId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space ID is required!" });
      return;
    }

    if (!spaceRecordingSessionId || typeof spaceRecordingSessionId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space recording session ID is required!" });
      return;
    }

    if (!participantSessionId || typeof participantSessionId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Participant session ID is required!" });
      return;
    }

    // Verify user is host or co-host
    const participant = await getParticipantBySessionId(spaceId, participantSessionId);
    if (!participant) {
      res.status(403).json({ success: false, data: null, message: "You are not an active participant in this space!" });
      return;
    }

    const canStart = await isHostOrCoHost(spaceId, participant.id);
    if (!canStart) {
      res.status(403).json({ success: false, data: null, message: "Only host or co-host can start recording!" });
      return;
    }

    const session = await startRecordingSession({
      spaceId,
      spaceRecordingSessionId,
    });

    res.status(201).json({
      success: true,
      data: session,
      message: "Recording session started successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "SPACE_NOT_FOUND") {
        res.status(404).json({ success: false, data: null, message: "Space not found!" });
        return;
      }
      if (error.message === "SPACE_NOT_LIVE") {
        res.status(400).json({ success: false, data: null, message: "Space is not currently live!" });
        return;
      }
      if (error.message === "RECORDING_ALREADY_ACTIVE") {
        res.status(400).json({ success: false, data: null, message: "A recording session is already active!" });
        return;
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to start recording: ${errorMessage}!` });
  }
}

export async function stopSessionController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { sessionId } = req.params;
    const { spaceId, participantSessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, data: null, message: "Session ID is required!" });
      return;
    }

    if (!spaceId || typeof spaceId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space ID is required!" });
      return;
    }

    if (!participantSessionId || typeof participantSessionId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Participant session ID is required!" });
      return;
    }

    // Verify user is host or co-host
    const participant = await getParticipantBySessionId(spaceId, participantSessionId);
    if (!participant) {
      res.status(403).json({ success: false, data: null, message: "You are not an active participant in this space!" });
      return;
    }

    const canStop = await isHostOrCoHost(spaceId, participant.id);
    if (!canStop) {
      res.status(403).json({ success: false, data: null, message: "Only host or co-host can stop recording!" });
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
        res.status(404).json({ success: false, data: null, message: "Recording session not found!" });
        return;
      }
      if (error.message === "SESSION_NOT_ACTIVE") {
        res.status(400).json({ success: false, data: null, message: "Recording session is not active!" });
        return;
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to stop recording: ${errorMessage}!` });
  }
}

export async function getSessionByIdController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ success: false, data: null, message: "Session ID is required!" });
      return;
    }

    const user = await findOrCreateUser(req.user);

    // Check if user can access this session
    const canAccess = await canAccessRecordingSession(sessionId, user.id);
    if (!canAccess) {
      res.status(403).json({ success: false, data: null, message: "You don't have access to this recording session!" });
      return;
    }

    const session = await getRecordingSessionById(sessionId);

    if (!session) {
      res.status(404).json({ success: false, data: null, message: "Recording session not found!" });
      return;
    }

    res.status(200).json({
      success: true,
      data: session,
      message: "Recording session retrieved successfully!",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get recording session: ${errorMessage}!` });
  }
}

export async function getSessionsBySpaceIdController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { spaceId } = req.params;

    if (!spaceId) {
      res.status(400).json({ success: false, data: null, message: "Space ID is required!" });
      return;
    }

    const user = await findOrCreateUser(req.user);

    // Check if user is host or participant
    const isHost = await isUserHost(spaceId, user.id);
    if (!isHost) {
      // For now, only host can see all sessions for a space
      res.status(403).json({ success: false, data: null, message: "Only the host can view all recording sessions!" });
      return;
    }

    const sessions = await getRecordingSessionsBySpaceId(spaceId);

    res.status(200).json({
      success: true,
      data: {
        sessions,
        count: sessions.length,
      },
      message: "Recording sessions retrieved successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SPACE_NOT_FOUND") {
      res.status(404).json({ success: false, data: null, message: "Space not found!" });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get recording sessions: ${errorMessage}!` });
  }
}

// ParticipantRecording Controllers

export async function createParticipantRecordingController(
  req: AuthenticatedRequest,
  res: Response
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
    } = req.body;

    if (!recordingSessionId || typeof recordingSessionId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Recording session ID is required!" });
      return;
    }

    if (!spaceId || typeof spaceId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space ID is required!" });
      return;
    }

    if (!type || !["AUDIO", "VIDEO"].includes(type)) {
      res.status(400).json({ success: false, data: null, message: "Type must be AUDIO or VIDEO!" });
      return;
    }

    // Get participant ID from participantSessionId if not provided directly
    let resolvedParticipantId = participantId;
    if (!resolvedParticipantId && participantSessionId) {
      const participant = await getParticipantBySessionId(spaceId, participantSessionId);
      if (!participant) {
        res.status(403).json({ success: false, data: null, message: "You are not an active participant in this space!" });
        return;
      }
      resolvedParticipantId = participant.id;
    }

    if (!resolvedParticipantId) {
      res.status(400).json({ success: false, data: null, message: "Participant ID or participant session ID is required!" });
      return;
    }

    // Verify participant is active in the space
    const isActive = await isActiveParticipant(spaceId, resolvedParticipantId);
    if (!isActive) {
      res.status(403).json({ success: false, data: null, message: "Participant is not active in this space!" });
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
    });

    res.status(201).json({
      success: true,
      data: recording,
      message: "Participant recording created successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "SESSION_NOT_FOUND") {
        res.status(404).json({ success: false, data: null, message: "Recording session not found!" });
        return;
      }
      if (error.message === "SESSION_NOT_ACTIVE") {
        res.status(400).json({ success: false, data: null, message: "Recording session is not active!" });
        return;
      }
      if (error.message === "PARTICIPANT_NOT_FOUND") {
        res.status(404).json({ success: false, data: null, message: "Participant not found!" });
        return;
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to create participant recording: ${errorMessage}!` });
  }
}

export async function updateParticipantRecordingController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { recordingId } = req.params;
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
      res.status(400).json({ success: false, data: null, message: "Recording ID is required!" });
      return;
    }

    // Verify ownership if participantSessionId provided
    if (participantSessionId && spaceId) {
      const participant = await getParticipantBySessionId(spaceId, participantSessionId);
      if (participant) {
        const ownerParticipantId = await getRecordingOwnerParticipantId(recordingId);
        if (ownerParticipantId !== participant.id) {
          res.status(403).json({ success: false, data: null, message: "You can only update your own recordings!" });
          return;
        }
      }
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
    if (expectedSegments !== undefined) updateData.expectedSegments = expectedSegments;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, data: null, message: "At least one field must be provided to update!" });
      return;
    }

    const recording = await updateParticipantRecording(recordingId, updateData);

    res.status(200).json({
      success: true,
      data: recording,
      message: "Participant recording updated successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") {
      res.status(404).json({ success: false, data: null, message: "Recording not found!" });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to update recording: ${errorMessage}!` });
  }
}

export async function getParticipantRecordingByIdController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { recordingId } = req.params;

    if (!recordingId) {
      res.status(400).json({ success: false, data: null, message: "Recording ID is required!" });
      return;
    }

    const recording = await getParticipantRecordingById(recordingId);

    if (!recording) {
      res.status(404).json({ success: false, data: null, message: "Recording not found!" });
      return;
    }

    // Verify user has access (is host or participant in the space)
    const user = await findOrCreateUser(req.user);
    const canAccess = await canAccessRecordingSession(recording.recordingSessionId, user.id);
    if (!canAccess) {
      res.status(403).json({ success: false, data: null, message: "You don't have access to this recording!" });
      return;
    }

    res.status(200).json({
      success: true,
      data: recording,
      message: "Recording retrieved successfully!",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get recording: ${errorMessage}!` });
  }
}

export async function getRecordingsBySessionIdController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ success: false, data: null, message: "Session ID is required!" });
      return;
    }

    const user = await findOrCreateUser(req.user);

    // Check if user can access this session
    const canAccess = await canAccessRecordingSession(sessionId, user.id);
    if (!canAccess) {
      res.status(403).json({ success: false, data: null, message: "You don't have access to this recording session!" });
      return;
    }

    const recordings = await getRecordingsBySessionId(sessionId);

    res.status(200).json({
      success: true,
      data: {
        recordings,
        count: recordings.length,
      },
      message: "Recordings retrieved successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      res.status(404).json({ success: false, data: null, message: "Recording session not found!" });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get recordings: ${errorMessage}!` });
  }
}

export async function markRecordingCompleteController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { recordingId } = req.params;
    const { expectedSegments, participantSessionId, spaceId } = req.body;

    if (!recordingId) {
      res.status(400).json({ success: false, data: null, message: "Recording ID is required!" });
      return;
    }

    if (expectedSegments === undefined || typeof expectedSegments !== "number" || expectedSegments < 0) {
      res.status(400).json({ success: false, data: null, message: "Expected segments count is required and must be a non-negative number!" });
      return;
    }

    // Verify ownership if participantSessionId provided
    if (participantSessionId && spaceId) {
      const participant = await getParticipantBySessionId(spaceId, participantSessionId);
      if (participant) {
        const ownerParticipantId = await getRecordingOwnerParticipantId(recordingId);
        if (ownerParticipantId !== participant.id) {
          res.status(403).json({ success: false, data: null, message: "You can only complete your own recordings!" });
          return;
        }
      }
    }

    const recording = await markRecordingComplete(recordingId, expectedSegments);

    res.status(200).json({
      success: true,
      data: recording,
      message: recording.isComplete
        ? "Recording marked as complete!"
        : "Recording completion tracked, still uploading segments!",
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "RECORDING_NOT_FOUND") {
        res.status(404).json({ success: false, data: null, message: "Recording not found!" });
        return;
      }
      if (error.message === "RECORDING_ALREADY_COMPLETE") {
        res.status(400).json({ success: false, data: null, message: "Recording is already complete!" });
        return;
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to mark recording complete: ${errorMessage}!` });
  }
}

// RecordingSegment Controllers

export async function createSegmentController(
  req: AuthenticatedRequest,
  res: Response
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
    } = req.body;

    if (!participantRecordingId || typeof participantRecordingId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Participant recording ID is required!" });
      return;
    }

    if (!spaceRecordingSessionId || typeof spaceRecordingSessionId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space recording session ID is required!" });
      return;
    }

    if (!spaceId || typeof spaceId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Space ID is required!" });
      return;
    }

    if (sequenceNumber === undefined || typeof sequenceNumber !== "number" || sequenceNumber < 0) {
      res.status(400).json({ success: false, data: null, message: "Sequence number is required and must be non-negative!" });
      return;
    }

    if (!assetKey || typeof assetKey !== "string") {
      res.status(400).json({ success: false, data: null, message: "Asset key is required!" });
      return;
    }

    if (startMs === undefined || typeof startMs !== "number") {
      res.status(400).json({ success: false, data: null, message: "Start time (ms) is required!" });
      return;
    }

    if (durationMs === undefined || typeof durationMs !== "number") {
      res.status(400).json({ success: false, data: null, message: "Duration (ms) is required!" });
      return;
    }

    if (sizeBytes === undefined) {
      res.status(400).json({ success: false, data: null, message: "Size in bytes is required!" });
      return;
    }

    // Resolve participantId from participantSessionId if needed
    let resolvedParticipantId = participantId;
    if (!resolvedParticipantId && participantSessionId) {
      const participant = await getParticipantBySessionId(spaceId, participantSessionId);
      if (participant) {
        resolvedParticipantId = participant.id;
      }
    }

    if (!resolvedParticipantId || typeof resolvedParticipantId !== "string") {
      res.status(400).json({ success: false, data: null, message: "Participant ID or participant session ID is required!" });
      return;
    }

    // Verify ownership - only recording owner can upload segments
    const ownerParticipantId = await getRecordingOwnerParticipantId(participantRecordingId);
    if (ownerParticipantId !== resolvedParticipantId) {
      res.status(403).json({ success: false, data: null, message: "You can only upload segments to your own recordings!" });
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
    });

    res.status(201).json({
      success: true,
      data: {
        ...segment,
        sizeBytes: segment.sizeBytes.toString(), // Convert BigInt to string for JSON
      },
      message: "Segment created successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") {
      res.status(404).json({ success: false, data: null, message: "Recording not found!" });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to create segment: ${errorMessage}!` });
  }
}

export async function getSegmentsByRecordingIdController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "Authentication required!" });
      return;
    }

    const { recordingId } = req.params;

    if (!recordingId) {
      res.status(400).json({ success: false, data: null, message: "Recording ID is required!" });
      return;
    }

    // Get recording to check access
    const recording = await getParticipantRecordingById(recordingId);
    if (!recording) {
      res.status(404).json({ success: false, data: null, message: "Recording not found!" });
      return;
    }

    // Verify user has access
    const user = await findOrCreateUser(req.user);
    const canAccess = await canAccessRecordingSession(recording.recordingSessionId, user.id);
    if (!canAccess) {
      res.status(403).json({ success: false, data: null, message: "You don't have access to this recording!" });
      return;
    }

    const segments = await getSegmentsByRecordingId(recordingId);

    res.status(200).json({
      success: true,
      data: {
        segments: segments.map((s) => ({
          ...s,
          sizeBytes: s.sizeBytes.toString(), // Convert BigInt to string for JSON
        })),
        count: segments.length,
      },
      message: "Segments retrieved successfully!",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") {
      res.status(404).json({ success: false, data: null, message: "Recording not found!" });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get segments: ${errorMessage}!` });
  }
}

