import { prisma } from "../db/index.ts";

interface CreateFinalOutputData {
  recordingSessionId: string;
  spaceId: string;
  type: "COMPOSITE" | "PER_PARTICIPANT";
  mode?: "MIXED" | "VIDEO_ONLY" | "AUDIO_ONLY";
  targetParticipantId?: string;
  sourceRecordingId?: string;
}

interface UpdateFinalOutputData {
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
  thumbnailKey?: string;
  masterKey?: string;
  mimeType?: string;
  durationMs?: number;
  fileSize?: bigint;
  checksum?: string;
  status?: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  processingJobId?: string;
  errorMessage?: string;
}

interface CreateRenditionData {
  finalOutputId: string;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  container?: string;
  assetKey?: string;
  sizeBytes?: bigint;
  jobId?: string;
}

interface UpdateRenditionData {
  assetKey?: string;
  sizeBytes?: bigint;
  status?: "READY" | "GENERATING" | "FAILED";
}

// FinalOutput Operations

export async function createFinalOutput(data: CreateFinalOutputData) {
  const { recordingSessionId, spaceId, type, mode, targetParticipantId, sourceRecordingId } = data;

  // Verify recording session exists
  const session = await prisma.recordingSession.findUnique({
    where: { id: recordingSessionId },
    select: { id: true, spaceId: true },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (session.spaceId !== spaceId) {
    throw new Error("SESSION_SPACE_MISMATCH");
  }

  // If PER_PARTICIPANT, verify targetParticipantId exists
  if (type === "PER_PARTICIPANT" && targetParticipantId) {
    const participant = await prisma.spaceParticipant.findUnique({
      where: { id: targetParticipantId },
    });

    if (!participant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }
  }

  const finalOutput = await prisma.finalOutput.create({
    data: {
      recordingSessionId,
      spaceId,
      type,
      mode: mode || "MIXED",
      targetParticipantId,
      sourceRecordingId,
      status: "QUEUED",
    },
    include: {
      recordingSession: {
        select: {
          id: true,
          spaceRecordingSessionId: true,
          status: true,
        },
      },
      space: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  return finalOutput;
}

export async function updateFinalOutput(outputId: string, data: UpdateFinalOutputData) {
  const output = await prisma.finalOutput.findUnique({
    where: { id: outputId },
    select: { id: true },
  });

  if (!output) {
    throw new Error("OUTPUT_NOT_FOUND");
  }

  const updatedOutput = await prisma.finalOutput.update({
    where: { id: outputId },
    data,
    include: {
      recordingSession: {
        select: {
          id: true,
          spaceRecordingSessionId: true,
        },
      },
      renditions: true,
    },
  });

  return updatedOutput;
}

export async function getFinalOutputById(outputId: string) {
  const output = await prisma.finalOutput.findUnique({
    where: { id: outputId },
    include: {
      recordingSession: {
        select: {
          id: true,
          spaceRecordingSessionId: true,
          status: true,
          startedAt: true,
          stoppedAt: true,
        },
      },
      space: {
        select: {
          id: true,
          title: true,
          hostId: true,
        },
      },
      sourceRecording: {
        select: {
          id: true,
          type: true,
          participantId: true,
        },
      },
      renditions: {
        orderBy: { width: "desc" },
      },
    },
  });

  return output;
}

export async function getFinalOutputsBySessionId(sessionId: string) {
  // Verify session exists
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const outputs = await prisma.finalOutput.findMany({
    where: { recordingSessionId: sessionId },
    include: {
      renditions: {
        select: {
          id: true,
          width: true,
          height: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return outputs;
}

export async function getFinalOutputsBySpaceId(spaceId: string) {
  // Verify space exists
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true },
  });

  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  const outputs = await prisma.finalOutput.findMany({
    where: { spaceId },
    include: {
      recordingSession: {
        select: {
          id: true,
          spaceRecordingSessionId: true,
          startedAt: true,
          stoppedAt: true,
        },
      },
      renditions: {
        select: {
          id: true,
          width: true,
          height: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return outputs;
}

export async function deleteFinalOutput(outputId: string) {
  const output = await prisma.finalOutput.findUnique({
    where: { id: outputId },
    select: { id: true, status: true },
  });

  if (!output) {
    throw new Error("OUTPUT_NOT_FOUND");
  }

  if (output.status === "PROCESSING") {
    throw new Error("CANNOT_DELETE_PROCESSING_OUTPUT");
  }

  // Delete renditions first, then output
  await prisma.$transaction([
    prisma.finalOutputRendition.deleteMany({
      where: { finalOutputId: outputId },
    }),
    prisma.finalOutput.delete({
      where: { id: outputId },
    }),
  ]);

  return { deleted: true };
}

// Rendition Operations

export async function createRendition(data: CreateRenditionData) {
  const { finalOutputId, ...renditionData } = data;

  // Verify final output exists
  const output = await prisma.finalOutput.findUnique({
    where: { id: finalOutputId },
    select: { id: true },
  });

  if (!output) {
    throw new Error("OUTPUT_NOT_FOUND");
  }

  const rendition = await prisma.finalOutputRendition.create({
    data: {
      finalOutputId,
      ...renditionData,
      status: "GENERATING",
    },
  });

  return rendition;
}

export async function updateRendition(renditionId: string, data: UpdateRenditionData) {
  const rendition = await prisma.finalOutputRendition.findUnique({
    where: { id: renditionId },
    select: { id: true },
  });

  if (!rendition) {
    throw new Error("RENDITION_NOT_FOUND");
  }

  const updatedRendition = await prisma.finalOutputRendition.update({
    where: { id: renditionId },
    data,
  });

  return updatedRendition;
}

export async function getRenditionsByOutputId(outputId: string) {
  // Verify output exists
  const output = await prisma.finalOutput.findUnique({
    where: { id: outputId },
    select: { id: true },
  });

  if (!output) {
    throw new Error("OUTPUT_NOT_FOUND");
  }

  const renditions = await prisma.finalOutputRendition.findMany({
    where: { finalOutputId: outputId },
    orderBy: { width: "desc" },
  });

  return renditions;
}

export async function deleteRendition(renditionId: string) {
  const rendition = await prisma.finalOutputRendition.findUnique({
    where: { id: renditionId },
    select: { id: true, status: true },
  });

  if (!rendition) {
    throw new Error("RENDITION_NOT_FOUND");
  }

  if (rendition.status === "GENERATING") {
    throw new Error("CANNOT_DELETE_GENERATING_RENDITION");
  }

  await prisma.finalOutputRendition.delete({
    where: { id: renditionId },
  });

  return { deleted: true };
}

// Authorization helper
export async function canAccessFinalOutput(outputId: string, userId: string): Promise<boolean> {
  const output = await prisma.finalOutput.findUnique({
    where: { id: outputId },
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

  if (!output) return false;

  // Host can always access
  if (output.space.hostId === userId) return true;

  // Participant can access
  return output.space.participants.length > 0;
}
