import { prisma } from "../db/index.ts";

interface CreateSpaceData {
  title: string;
  description?: string;
  joinCode: string;
  hostId: string;
  hostName: string;
  hostParticipantSessionId: string;
}

interface UpdateSpaceData {
  title?: string;
  description?: string;
}

export async function verifySpaceHost(spaceId: string, userId: string): Promise<boolean> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { hostId: true },
  });

  return space?.hostId === userId;
}

export async function isJoinCodeUnique(joinCode: string): Promise<boolean> {
  const existingSpace = await prisma.space.findUnique({
    where: { joinCode },
  });

  return !existingSpace;
}

export async function createSpace(data: CreateSpaceData) {
  const { title, description, joinCode, hostId, hostName, hostParticipantSessionId } = data;

  const isUnique = await isJoinCodeUnique(joinCode);
  if (!isUnique) {
    throw new Error("JOIN_CODE_EXISTS");
  }

  const space = await prisma.space.create({
    data: {
      title,
      description,
      joinCode,
      hostId,
      status: "LIVE",
      startTime: new Date(),
      participants: {
        create: {
          userId: hostId,
          participantSessionId: hostParticipantSessionId,
          displayName: hostName,
          role: "HOST",
          isActive: true,
          isGuest: false,
        },
      },
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      participants: {
        where: { isActive: true },
        include: {
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
  });

  return space;
}

export async function updateSpace(spaceId: string, data: UpdateSpaceData) {
  const space = await prisma.space.update({
    where: { id: spaceId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
    },
  });

  return space;
}

export async function endSpace(spaceId: string) {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { startTime: true, status: true },
  });

  if (!space) {
    throw new Error("SPACE_NOT_FOUND");
  }

  if (space.status !== "LIVE") {
    throw new Error("SPACE_NOT_LIVE");
  }

  const endTime = new Date();
  const duration = space.startTime
    ? endTime.getTime() - space.startTime.getTime()
    : 0;

  const [updatedSpace] = await prisma.$transaction([
    prisma.space.update({
      where: { id: spaceId },
      data: {
        endTime,
        duration,
        status: "ENDED",
      },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        participants: {
          include: {
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
    }),
    prisma.spaceParticipant.updateMany({
      where: {
        spaceId,
        isActive: true,
      },
      data: {
        isActive: false,
        leftAt: endTime,
      },
    }),
  ]);

  return updatedSpace;
}

export async function getSpaceById(spaceId: string) {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      participants: {
        where: { isActive: true },
        include: {
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
  });

  return space;
}

export async function getSpaceByJoinCode(joinCode: string) {
  const space = await prisma.space.findUnique({
    where: { joinCode },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startTime: true,
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

export async function isUserParticipant(spaceId: string, userId: string): Promise<boolean> {
  const participant = await prisma.spaceParticipant.findFirst({
    where: {
      spaceId,
      userId,
    },
  });

  return !!participant;
}

export async function getUserSpaces(userId: string, filter?: "hosted" | "participated" | "all") {
  const filterType = filter || "all";

  if (filterType === "hosted") {
    // Spaces where user is the host
    return await prisma.space.findMany({
      where: { hostId: userId },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        participants: {
          where: { isActive: true },
          select: {
            id: true,
            displayName: true,
            role: true,
          },
        },
        _count: {
          select: {
            participants: true,
            recordingSessions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (filterType === "participated") {
    // Spaces where user participated (not as host)
    const participations = await prisma.spaceParticipant.findMany({
      where: {
        userId,
        space: {
          hostId: { not: userId },
        },
      },
      include: {
        space: {
          include: {
            host: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
            _count: {
              select: {
                participants: true,
                recordingSessions: true,
              },
            },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    return participations.map((p) => ({
      ...p.space,
      participantRole: p.role,
      participantJoinedAt: p.joinedAt,
    }));
  }

  // All spaces (hosted + participated)
  const [hostedSpaces, participatedSpaces] = await Promise.all([
    prisma.space.findMany({
      where: { hostId: userId },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            participants: true,
            recordingSessions: true,
          },
        },
      },
    }),
    prisma.spaceParticipant.findMany({
      where: {
        userId,
        space: {
          hostId: { not: userId },
        },
      },
      include: {
        space: {
          include: {
            host: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
            _count: {
              select: {
                participants: true,
                recordingSessions: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const hosted = hostedSpaces.map((s) => ({
    ...s,
    userRole: "HOST" as const,
  }));

  const participated = participatedSpaces.map((p) => ({
    ...p.space,
    userRole: p.role,
    participantJoinedAt: p.joinedAt,
  }));

  // Combine and sort by createdAt
  return [...hosted, ...participated].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

