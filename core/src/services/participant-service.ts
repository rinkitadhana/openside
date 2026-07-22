import { TrackSource } from "livekit-server-sdk";
import { prisma } from "../db/index.ts";
import { getEntitlements } from "./entitlements-service.ts";
import {
	createLiveKitRoom,
	generateLiveKitToken,
	getLiveKitIdentity,
	getLiveKitRoomName,
	muteLiveKitParticipantTrack,
	removeLiveKitParticipant,
	updateLiveKitParticipantAttributes,
} from "./livekit-service.ts";
import { ensureSpaceFreshness } from "./space-service.ts";

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
			hostId: true,
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
	participantSessionId?: string,
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

	let space = await getSpaceIfLive(spaceId);
	if (!space) {
		throw new Error("SPACE_NOT_FOUND");
	}

	// An expired-but-still-LIVE row must be corrected (flipped to ENDED) before we
	// reject, so the record stops showing the meeting as live and a retry sees the
	// truth. Check expiry first so it gets the specific 410 rather than a generic
	// "not live".
	if (space.expiresAt && space.expiresAt.getTime() <= Date.now()) {
		await ensureSpaceFreshness(space);
		throw new Error("SPACE_EXPIRED");
	}

	// A SCHEDULED session is started by whoever shows up first - host or invitee.
	// Joining it provisions the LiveKit room and flips it LIVE, so nobody has to
	// wait for the host to explicitly "start" it before they can get in.
	if (space.status === "SCHEDULED") {
		const livekitRoomName =
			space.livekitRoomName || getLiveKitRoomName(spaceId);
		await prisma.space.update({
			where: { id: spaceId },
			data: { status: "LIVE", startTime: new Date(), livekitRoomName },
		});
		// No-op if the room already exists.
		await createLiveKitRoom({
			name: livekitRoomName,
			metadata: {
				spaceId: space.id,
				joinCode: space.joinCode,
				hostId: space.hostId,
			},
		});
		space = { ...space, status: "LIVE", livekitRoomName };
	}

	if (space.status !== "LIVE") {
		throw new Error("SPACE_NOT_LIVE");
	}

	const existingParticipant = await findExistingParticipant(
		spaceId,
		userId,
		participantSessionId,
	);

	// Enforce the host plan's concurrent-participant cap. Only gate joins that
	// would occupy a NEW active slot - a currently-active participant reconnecting
	// (reload/second tab) already holds their slot and must not be locked out.
	const wouldTakeNewSlot = !existingParticipant || !existingParticipant.isActive;
	if (wouldTakeNewSlot) {
		const { maxParticipants } = await getEntitlements(space.hostId);
		if (maxParticipants !== null) {
			const activeCount = await prisma.spaceParticipant.count({
				where: { spaceId, isActive: true },
			});
			if (activeCount >= maxParticipants) {
				throw new Error("SPACE_FULL");
			}
		}
	}

	const livekitRoomName = space.livekitRoomName || getLiveKitRoomName(spaceId);
	const legacyGuestIdentity = `guest:${spaceId}:${participantSessionId}`;
	const livekitIdentity =
		isGuest &&
		existingParticipant?.livekitIdentity &&
		existingParticipant.livekitIdentity !== legacyGuestIdentity
			? existingParticipant.livekitIdentity
			: getLiveKitIdentity({
					spaceId,
					participantSessionId,
					userId,
					isGuest,
				});

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

		return {
			participant: updatedParticipant,
			space: { ...space, livekitRoomName },
			livekit,
			isRejoin: true,
		};
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

	return {
		participant,
		space: { ...space, livekitRoomName },
		livekit,
		isRejoin: false,
	};
}

export async function leaveSpace(data: LeaveSpaceData) {
	const { spaceId, participantSessionId, userId } = data;

	// Find participant
	const participant = await findExistingParticipant(
		spaceId,
		userId,
		participantSessionId,
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

export async function getSpaceParticipants(spaceId: string, activeOnly = true) {
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

/** Fields that are safe to expose to other clients in a Space. */
export function toPublicParticipant<
	T extends {
		id: string;
		displayName: string | null;
		role: string;
		isActive: boolean;
		isGuest: boolean;
		joinedAt: Date;
		leftAt: Date | null;
		connectionState: string | null;
		user?: { id: string; name: string; avatar: string | null } | null;
	},
>(participant: T) {
	return {
		id: participant.id,
		displayName: participant.displayName ?? "Guest",
		role: participant.role,
		isActive: participant.isActive,
		isGuest: participant.isGuest,
		joinedAt: participant.joinedAt,
		leftAt: participant.leftAt,
		connectionState: participant.connectionState,
		user: participant.user ?? null,
	};
}

export async function updateParticipantRole(
	participantId: string,
	role: "CO_HOST" | "GUEST",
) {
	const participant = await prisma.spaceParticipant.findUnique({
		where: { id: participantId },
		select: {
			role: true,
			livekitIdentity: true,
			space: { select: { livekitRoomName: true } },
		},
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

	// Push the role live so the co-host badge and moderation controls take effect
	// immediately, without waiting for the participant to rejoin. `room_admin`
	// mirrors what the token grants for HOST/CO_HOST.
	await updateLiveKitParticipantAttributes({
		roomName: participant.space.livekitRoomName,
		identity: participant.livekitIdentity,
		attributes: {
			role,
			room_admin: role === "CO_HOST" ? "true" : "false",
		},
	});

	return updatedParticipant;
}

/**
 * Keep recording control alive when a host/co-host leaves mid-recording.
 *
 * We never stop a recording just because the host left - they may have dropped
 * by mistake. Instead, if a space has an ACTIVE recording session and no active
 * host or co-host remains, promote the longest-present active participant to
 * co-host so someone can still stop it. If a co-host is already present, or the
 * host rejoins, nothing changes. No-op when nothing is recording.
 */
export async function ensureRecordingController(
	spaceId: string,
): Promise<void> {
	const activeSession = await prisma.recordingSession.findFirst({
		where: { spaceId, status: "ACTIVE" },
		select: { id: true },
	});
	if (!activeSession) return;

	const controller = await prisma.spaceParticipant.findFirst({
		where: { spaceId, isActive: true, role: { in: ["HOST", "CO_HOST"] } },
		select: { id: true },
	});
	if (controller) return;

	const successor = await prisma.spaceParticipant.findFirst({
		where: { spaceId, isActive: true },
		orderBy: { joinedAt: "asc" },
		select: { id: true },
	});
	if (!successor) return;

	await updateParticipantRole(successor.id, "CO_HOST");
}

export async function isUserHostOrCoHost(
	spaceId: string,
	userId: string,
): Promise<boolean> {
	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: { hostId: true },
	});

	if (space?.hostId === userId) {
		return true;
	}

	const participant = await prisma.spaceParticipant.findFirst({
		where: {
			spaceId,
			userId,
			isActive: true,
			role: { in: ["HOST", "CO_HOST"] },
		},
		select: { id: true },
	});

	return !!participant;
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

export async function stopParticipantTrack(
	participantId: string,
	source: "camera" | "microphone",
	muted: boolean,
) {
	const participant = await prisma.spaceParticipant.findUnique({
		where: { id: participantId },
		select: {
			id: true,
			role: true,
			livekitIdentity: true,
			space: {
				select: {
					livekitRoomName: true,
				},
			},
		},
	});

	if (!participant) {
		throw new Error("PARTICIPANT_NOT_FOUND");
	}

	if (participant.role === "HOST") {
		throw new Error("CANNOT_MODERATE_HOST");
	}

	await muteLiveKitParticipantTrack({
		roomName: participant.space.livekitRoomName,
		identity: participant.livekitIdentity,
		source: source === "camera" ? TrackSource.CAMERA : TrackSource.MICROPHONE,
		muted,
	});

	return { participantId, source, muted };
}

export async function isUserHost(
	spaceId: string,
	userId: string,
): Promise<boolean> {
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
