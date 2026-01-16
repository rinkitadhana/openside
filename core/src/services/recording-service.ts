import { prisma, type RecordingType } from "../db/index.ts";

interface StartSessionData {
  spaceId: string;
  spaceRecordingSessionId: string;
}

interface CreateParticipantRecordingData {
  recordingSessionId: string;
  participantId: string;
  type: RecordingType;
  isScreenShare?: boolean;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

interface UpdateParticipantRecordingData {
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
  videoQuality?: "P360" | "P480" | "P720" | "P1080" | "P1440" | "P2160";
  audioQuality?: "SR_22050" | "SR_44100" | "SR_48000" | "SR_96000";
  videoLabel?: string;
  audioLabel?: string;
  startOffsetMs?: number;
  durationMs?: number;
  expectedSegments?: number;
}

interface CreateSegmentData {
  participantRecordingId: string;
  spaceRecordingSessionId: string;
  spaceId: string;
  participantId: string;
  sequenceNumber: number;
  assetKey: string;
  startMs: number;
  durationMs: number;
  sizeBytes: bigint;
  checksum?: string;
}

// Helper Functions

export async function isHostOrCoHost(spaceId: string, participantId: string): Promise<boolean> {
  const participant = await prisma.spaceParticipant.findFirst({
    where: {
      id: participantId,
      spaceId,
      role: { in: ["HOST", "CO_HOST"] },
      isActive: true,
    },
  });

  return !!participant;
}

export async function isActiveParticipant(spaceId: string, participantId: string): Promise<boolean> {
  const participant = await prisma.spaceParticipant.findFirst({
    where: {
      id: participantId,
      spaceId,
      isActive: true,
    },
  });

  return !!participant;
}

export async function getParticipantBySessionId(
  spaceId: string,
  participantSessionId: string
) {
  return await prisma.spaceParticipant.findFirst({
    where: {
      spaceId,
      participantSessionId,
      isActive: true,
    },
  });
}

// RecordingSession Operations

export async function startRecordingSession(data: StartSessionData) {
  const { spaceId, spaceRecordingSessionId } = data;

  // Check if space exists and is live
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, status: true, recordingStatus: true },
  });

  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  if (space.status !== "LIVE") {
    throw new Error("SPACE_NOT_LIVE");
  }

  if (space.recordingStatus === "RECORDING") {
    throw new Error("RECORDING_ALREADY_ACTIVE");
  }

  // Create recording session and update space recording status
  const [session] = await prisma.$transaction([
    prisma.recordingSession.create({
      data: {
        spaceId,
        spaceRecordingSessionId,
        status: "ACTIVE",
        startedAt: new Date(),
      },
      include: {
        space: {
          select: {
            id: true,
            title: true,
            joinCode: true,
          },
        },
      },
    }),
    prisma.space.update({
      where: { id: spaceId },
      data: { recordingStatus: "RECORDING" },
    }),
  ]);

  return session;
}

export async function stopRecordingSession(sessionId: string) {
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, spaceId: true },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (session.status !== "ACTIVE") {
    throw new Error("SESSION_NOT_ACTIVE");
  }

  // Stop session and update space recording status
  const [updatedSession] = await prisma.$transaction([
    prisma.recordingSession.update({
      where: { id: sessionId },
      data: {
        status: "STOPPED",
        stoppedAt: new Date(),
      },
      include: {
        space: {
          select: {
            id: true,
            title: true,
            joinCode: true,
          },
        },
        participantRecordings: {
          select: {
            id: true,
            participantId: true,
            type: true,
            status: true,
            uploadedSegments: true,
          },
        },
      },
    }),
    prisma.space.update({
      where: { id: session.spaceId },
      data: { recordingStatus: "STOPPED" },
    }),
  ]);

  return updatedSession;
}

export async function getRecordingSessionById(sessionId: string) {
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    include: {
      space: {
        select: {
          id: true,
          title: true,
          joinCode: true,
          hostId: true,
        },
      },
      participantRecordings: {
        include: {
          participant: {
            select: {
              id: true,
              displayName: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return session;
}

export async function getRecordingSessionsBySpaceId(spaceId: string) {
  // Verify space exists
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true },
  });

  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  const sessions = await prisma.recordingSession.findMany({
    where: { spaceId },
    include: {
      participantRecordings: {
        select: {
          id: true,
          participantId: true,
          type: true,
          status: true,
          isComplete: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  return sessions;
}

export async function getActiveSessionBySpaceId(spaceId: string) {
  return await prisma.recordingSession.findFirst({
    where: {
      spaceId,
      status: "ACTIVE",
    },
  });
}

// ParticipantRecording Operations

export async function createParticipantRecording(data: CreateParticipantRecordingData) {
  const { recordingSessionId, participantId, type, isScreenShare, ...metadata } = data;

  // Verify recording session exists and is active
  const session = await prisma.recordingSession.findUnique({
    where: { id: recordingSessionId },
    select: { id: true, status: true, spaceId: true },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (session.status !== "ACTIVE") {
    throw new Error("SESSION_NOT_ACTIVE");
  }

  // Verify participant exists and belongs to the space
  const participant = await prisma.spaceParticipant.findFirst({
    where: {
      id: participantId,
      spaceId: session.spaceId,
    },
  });

  if (!participant) {
    throw new Error("PARTICIPANT_NOT_FOUND");
  }

  // Create participant recording and update participant's hasRecording flag
  const [recording] = await prisma.$transaction([
    prisma.participantRecording.create({
      data: {
        recordingSessionId,
        participantId,
        type,
        isScreenShare: isScreenShare ?? false,
        status: "UPLOADING",
        ...metadata,
      },
      include: {
        participant: {
          select: {
            id: true,
            displayName: true,
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
        recordingSession: {
          select: {
            id: true,
            spaceRecordingSessionId: true,
            spaceId: true,
          },
        },
      },
    }),
    prisma.spaceParticipant.update({
      where: { id: participantId },
      data: { hasRecording: true },
    }),
  ]);

  return recording;
}

export async function updateParticipantRecording(
  recordingId: string,
  data: UpdateParticipantRecordingData
) {
  const recording = await prisma.participantRecording.findUnique({
    where: { id: recordingId },
    select: { id: true },
  });

  if (!recording) {
    throw new Error("RECORDING_NOT_FOUND");
  }

  const updatedRecording = await prisma.participantRecording.update({
    where: { id: recordingId },
    data: {
      ...data,
      lastChunkAt: new Date(),
    },
    include: {
      participant: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  return updatedRecording;
}

export async function getParticipantRecordingById(recordingId: string) {
  const recording = await prisma.participantRecording.findUnique({
    where: { id: recordingId },
    include: {
      participant: {
        select: {
          id: true,
          displayName: true,
          spaceId: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      },
      recordingSession: {
        select: {
          id: true,
          spaceRecordingSessionId: true,
          spaceId: true,
          status: true,
        },
      },
      segments: {
        select: {
          id: true,
          sequenceNumber: true,
          status: true,
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });

  return recording;
}

export async function getRecordingsBySessionId(sessionId: string) {
  // Verify session exists
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const recordings = await prisma.participantRecording.findMany({
    where: { recordingSessionId: sessionId },
    include: {
      participant: {
        select: {
          id: true,
          displayName: true,
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return recordings;
}

export async function markRecordingComplete(recordingId: string, expectedSegments: number) {
  const recording = await prisma.participantRecording.findUnique({
    where: { id: recordingId },
    select: { id: true, uploadedSegments: true, status: true },
  });

  if (!recording) {
    throw new Error("RECORDING_NOT_FOUND");
  }

  if (recording.status === "READY") {
    throw new Error("RECORDING_ALREADY_COMPLETE");
  }

  const isComplete = recording.uploadedSegments >= expectedSegments;

  const updatedRecording = await prisma.participantRecording.update({
    where: { id: recordingId },
    data: {
      expectedSegments,
      isComplete,
      status: isComplete ? "UPLOADED" : "UPLOADING",
    },
    include: {
      participant: {
        select: {
          id: true,
          displayName: true,
        },
      },
      segments: {
        select: {
          id: true,
          sequenceNumber: true,
          status: true,
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });

  return updatedRecording;
}

// RecordingSegment Operations

export async function createSegment(data: CreateSegmentData) {
  const { participantRecordingId, ...segmentData } = data;

  // Verify participant recording exists
  const recording = await prisma.participantRecording.findUnique({
    where: { id: participantRecordingId },
    select: { id: true, uploadedSegments: true },
  });

  if (!recording) {
    throw new Error("RECORDING_NOT_FOUND");
  }

  // Create segment and increment uploadedSegments counter
  const [segment] = await prisma.$transaction([
    prisma.recordingSegment.create({
      data: {
        participantRecordingId,
        ...segmentData,
        status: "UPLOADED",
      },
    }),
    prisma.participantRecording.update({
      where: { id: participantRecordingId },
      data: {
        uploadedSegments: { increment: 1 },
        lastChunkAt: new Date(),
      },
    }),
  ]);

  return segment;
}

export async function getSegmentsByRecordingId(recordingId: string) {
  // Verify recording exists
  const recording = await prisma.participantRecording.findUnique({
    where: { id: recordingId },
    select: { id: true },
  });

  if (!recording) {
    throw new Error("RECORDING_NOT_FOUND");
  }

  const segments = await prisma.recordingSegment.findMany({
    where: { participantRecordingId: recordingId },
    orderBy: { sequenceNumber: "asc" },
  });

  return segments;
}

// Authorization Helpers

export async function canAccessRecordingSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: {
      space: {
        select: {
          hostId: true,
          participants: {
            where: { userId },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!session) return false;

  // Host can always access
  if (session.space.hostId === userId) return true;

  // Participant can access
  return session.space.participants.length > 0;
}

export async function getRecordingOwnerParticipantId(recordingId: string): Promise<string | null> {
  const recording = await prisma.participantRecording.findUnique({
    where: { id: recordingId },
    select: { participantId: true },
  });

  return recording?.participantId ?? null;
}

