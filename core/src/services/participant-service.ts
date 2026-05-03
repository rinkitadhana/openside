import { prisma } from "../db/index.ts";
import {
  generateLiveKitToken,
  getLiveKitIdentity,
  getLiveKitRoomName,
  removeLiveKitParticipant,
} from "./livekit-service.ts";

interface JoinSpaceData {
  spaceId: string;
  participantSessionId: string;
  displayName: string;
  userId?: string;
  isGuest: boolean;
}

interface LeaveSpaceData {
  spaceId: string;
  participantSessionId?: string;
  userId?: string;
}

export async function getSpaceIfLive(spaceId: string) {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      joinCode: true,
      livekitRoomName: true,
      expiresAt: true,
      host: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  return space;
}

export async function findExistingParticipant(
  spaceId: string,
  userId?: string,
  participantSessionId?: string
) {
  // Authenticated user: find by userId only (prevents joining multiple times)
  if (userId) {
    return await prisma.spaceParticipant.findFirst({
      where: {
        spaceId,
        userId,
      },
    });
  }
  // Guest user: find by sessionId (allows multiple joins with different sessions)
  if (participantSessionId) {
    return await prisma.spaceParticipant.findFirst({
      where: {
        spaceId,
        participantSessionId,
      },
    });
  }

  return null;
}


export async function joinSpace(data: JoinSpaceData) {
  const { spaceId, participantSessionId, displayName, userId, isGuest } = data;

  const space = await getSpaceIfLive(spaceId);
  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  if (space.status !== "LIVE") {
    throw new Error("SPACE_NOT_LIVE");
  }

  if (space.expiresAt && space.expiresAt.getTime() <= Date.now()) {
    throw new Error("SPACE_EXPIRED");
  }

  const livekitRoomName = space.livekitRoomName || getLiveKitRoomName(spaceId);
  const livekitIdentity = getLiveKitIdentity({
    spaceId,
    participantSessionId,
    userId,
    isGuest,
  });

  const existingParticipant = await findExistingParticipant(
    spaceId,
    userId,
    participantSessionId
  );

  if (existingParticipant) {
    const updatedParticipant = await prisma.spaceParticipant.update({
      where: { id: existingParticipant.id },
      data: {
        isActive: true,
        leftAt: null,
        // Don't overwrite original joinedAt - preserve when user first joined
        participantSessionId,
        livekitIdentity,
        displayName,
        lastConnectedAt: new Date(),
        connectionState: "connected",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    const livekit = await generateLiveKitToken({
      space: { ...space, livekitRoomName },
      participant: updatedParticipant,
    });

    return { participant: updatedParticipant, space: { ...space, livekitRoomName }, livekit, isRejoin: true };
  }

  // Create new participant
  const participant = await prisma.spaceParticipant.create({
    data: {
      spaceId,
      participantSessionId,
      livekitIdentity,
      displayName,
      userId: userId || null,
      isGuest,
      isActive: true,
      role: "GUEST",
      lastConnectedAt: new Date(),
      connectionState: "connected",
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  const livekit = await generateLiveKitToken({
    space: { ...space, livekitRoomName },
    participant,
  });

  return { participant, space: { ...space, livekitRoomName }, livekit, isRejoin: false };
}


export async function leaveSpace(data: LeaveSpaceData) {
  const { spaceId, participantSessionId, userId } = data;

  // Find participant
  const participant = await findExistingParticipant(
    spaceId,
    userId,
    participantSessionId
  );

  if (!participant) {
    throw new Error("PARTICIPANT_NOT_FOUND");
  }

  if (!participant.isActive) {
    throw new Error("PARTICIPANT_ALREADY_LEFT");
  }

  // Update participant to inactive
  const updatedParticipant = await prisma.spaceParticipant.update({
    where: { id: participant.id },
    data: {
      isActive: false,
      leftAt: new Date(),
      connectionState: "disconnected",
    },
  });

  return updatedParticipant;
}

export async function getSpaceParticipants(
  spaceId: string,
  activeOnly: boolean = true
) {
  // Verify space exists
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true },
  });

  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  const participants = await prisma.spaceParticipant.findMany({
    where: {
      spaceId,
      ...(activeOnly && { isActive: true }),
    },
    select: {
      id: true,
      displayName: true,
      role: true,
      isActive: true,
      isGuest: true,
      joinedAt: true,
      leftAt: true,
      participantSessionId: true,
      livekitIdentity: true,
      connectionState: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
    orderBy: {
      joinedAt: "asc",
    },
  });

  return participants;
}

export async function updateParticipantRole(
  participantId: string,
  role: "CO_HOST" | "GUEST"
) {
  const participant = await prisma.spaceParticipant.findUnique({
    where: { id: participantId },
    select: { role: true },
  });

  if (!participant) {
    throw new Error("PARTICIPANT_NOT_FOUND");
  }

  if (participant.role === "HOST") {
    throw new Error("CANNOT_CHANGE_HOST_ROLE");
  }

  const updatedParticipant = await prisma.spaceParticipant.update({
    where: { id: participantId },
    data: { role },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  return updatedParticipant;
}

export async function kickParticipant(participantId: string) {
  const participant = await prisma.spaceParticipant.findUnique({
    where: { id: participantId },
    select: { role: true, isActive: true },
  });

  if (!participant) {
    throw new Error("PARTICIPANT_NOT_FOUND");
  }

  if (participant.role === "HOST") {
    throw new Error("CANNOT_KICK_HOST");
  }

  if (!participant.isActive) {
    throw new Error("PARTICIPANT_ALREADY_LEFT");
  }

  const kickedParticipant = await prisma.spaceParticipant.update({
    where: { id: participantId },
    data: {
      isActive: false,
      leftAt: new Date(),
      connectionState: "removed",
    },
  });

  const fullParticipant = await prisma.spaceParticipant.findUnique({
    where: { id: participantId },
    include: {
      space: {
        select: {
          livekitRoomName: true,
        },
      },
    },
  });

  await removeLiveKitParticipant({
    roomName: fullParticipant?.space.livekitRoomName,
    identity: fullParticipant?.livekitIdentity,
  });

  return kickedParticipant;
}

export async function isUserHost(spaceId: string, userId: string): Promise<boolean> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { hostId: true },
  });

  return space?.hostId === userId;
}

export async function getParticipantById(participantId: string) {
  const participant = await prisma.spaceParticipant.findUnique({
    where: { id: participantId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  return participant;
}
