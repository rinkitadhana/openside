import { randomUUID } from "node:crypto";
import {
	AccessToken,
	RoomServiceClient,
	TrackSource,
	type VideoGrant,
	WebhookReceiver,
} from "livekit-server-sdk";
import {
	type LiveKitInfra,
	resolveLiveKitForRoom,
	resolveLiveKitForSpace,
} from "./infra-service.ts";

type LiveKitParticipantRole = "HOST" | "CO_HOST" | "GUEST";

interface TokenParticipant {
	id: string;
	displayName: string | null;
	isGuest: boolean;
	role: LiveKitParticipantRole;
	livekitIdentity: string | null;
	user?: {
		avatar?: string | null;
	} | null;
}

interface TokenSpace {
	id: string;
	livekitRoomName: string | null;
}

interface GenerateTokenInput {
	space: TokenSpace;
	participant: TokenParticipant;
}

const DEFAULT_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const DEFAULT_MAX_PARTICIPANTS = 50;
const DEFAULT_ROOM_API_TIMEOUT_MS = 8_000;

const withTimeout = async <T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> => {
	let timeoutHandle: NodeJS.Timeout | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeoutHandle = setTimeout(
					() => reject(new Error(`${operation}_TIMEOUT`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
	}
};

function getLiveKitConfig() {
	const url = process.env.LIVEKIT_URL;
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;

	if (!url || !apiKey || !apiSecret) {
		throw new Error("LIVEKIT_NOT_CONFIGURED");
	}

	return { url, apiKey, apiSecret };
}

function getRoomServiceClient(infra: LiveKitInfra) {
	const serviceUrl = infra.url
		.replace(/^wss:\/\//, "https://")
		.replace(/^ws:\/\//, "http://");

	return new RoomServiceClient(serviceUrl, infra.apiKey, infra.apiSecret);
}

let webhookReceiver: WebhookReceiver | null = null;

export function getWebhookReceiver() {
	if (!webhookReceiver) {
		const { apiKey, apiSecret } = getLiveKitConfig();
		webhookReceiver = new WebhookReceiver(apiKey, apiSecret);
	}

	return webhookReceiver;
}

export function getLiveKitRoomName(spaceId: string) {
	return `space:${spaceId}`;
}

export function getLiveKitIdentity(input: {
	spaceId: string;
	participantSessionId: string;
	userId?: string | null;
	isGuest: boolean;
}) {
	if (!input.isGuest && input.userId) {
		return `user:${input.spaceId}:${input.userId}`;
	}

	// LiveKit identities are visible to everyone in a room. They must never
	// contain the guest's participant session ID, which is used internally to
	// associate upload/rejoin requests with that browser.
	return `guest:${input.spaceId}:${randomUUID()}`;
}

export function getLiveKitPublicConfig() {
	const { url } = getLiveKitConfig();
	return { url };
}

export async function createLiveKitRoom(input: {
	name: string;
	metadata?: Record<string, unknown>;
}) {
	// Room names are space-scoped, so this lands on the host's own LiveKit when
	// they self-host and on the platform's otherwise.
	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(input.name),
	);
	const requestTimeoutMs =
		Number(process.env.LIVEKIT_ROOM_API_TIMEOUT_MS) ||
		DEFAULT_ROOM_API_TIMEOUT_MS;
	const emptyTimeout =
		Number(process.env.LIVEKIT_ROOM_EMPTY_TIMEOUT_SECONDS) ||
		DEFAULT_EMPTY_TIMEOUT_SECONDS;
	const maxParticipants =
		Number(process.env.LIVEKIT_ROOM_MAX_PARTICIPANTS) ||
		DEFAULT_MAX_PARTICIPANTS;

	try {
		const createPromise = roomClient.createRoom({
			name: input.name,
			emptyTimeout,
			maxParticipants,
			metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
		});

		return await withTimeout(
			createPromise,
			requestTimeoutMs,
			"LIVEKIT_CREATE_ROOM",
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "LIVEKIT_CREATE_ROOM_TIMEOUT"
		) {
			// LiveKit creates a room when the first participant connects. Do not hold
			// the API response open indefinitely when explicit pre-provisioning is slow.
			console.warn("[livekit/createRoom] Provisioning timed out; continuing", {
				roomName: input.name,
				timeoutMs: requestTimeoutMs,
			});
			return;
		}

		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("already exists")
		) {
			const [existingRoom] = await withTimeout(
				roomClient.listRooms([input.name]),
				requestTimeoutMs,
				"LIVEKIT_LIST_ROOMS",
			);
			return existingRoom;
		}

		throw error;
	}
}

export async function deleteLiveKitRoom(roomName: string | null | undefined) {
	if (!roomName) return;

	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(roomName),
	);

	try {
		await roomClient.deleteRoom(roomName);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("not found")
		) {
			return;
		}

		throw error;
	}
}

export async function removeLiveKitParticipant(input: {
	roomName: string | null | undefined;
	identity: string | null | undefined;
}) {
	if (!input.roomName || !input.identity) return;

	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(input.roomName),
	);

	try {
		await roomClient.removeParticipant(input.roomName, input.identity);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("not found")
		) {
			return;
		}

		throw error;
	}
}

export async function updateLiveKitParticipantAttributes(input: {
	roomName: string | null | undefined;
	identity: string | null | undefined;
	attributes: Record<string, string>;
}) {
	if (!input.roomName || !input.identity) return;

	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(input.roomName),
	);

	try {
		await roomClient.updateParticipant(input.roomName, input.identity, {
			attributes: input.attributes,
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("not found")
		) {
			return;
		}

		throw error;
	}
}

export async function muteLiveKitParticipantTrack(input: {
	roomName: string | null | undefined;
	identity: string | null | undefined;
	source: TrackSource.CAMERA | TrackSource.MICROPHONE;
	muted: boolean;
}) {
	if (!input.roomName || !input.identity) return;

	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(input.roomName),
	);

	try {
		const participant = await roomClient.getParticipant(
			input.roomName,
			input.identity,
		);
		const track = participant.tracks.find(
			(publishedTrack) => publishedTrack.source === input.source,
		);

		if (!track?.sid) return;

		await roomClient.mutePublishedTrack(
			input.roomName,
			input.identity,
			track.sid,
			input.muted,
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("not found")
		) {
			return;
		}

		throw error;
	}
}

/** Whether a room currently exists - checked on the room's own LiveKit. */
export async function liveKitRoomExists(roomName: string): Promise<boolean> {
	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(roomName),
	);
	const rooms = await roomClient.listRooms([roomName]);
	return rooms.length > 0;
}

export async function listLiveKitParticipantIdentities(
	roomName: string,
): Promise<Set<string>> {
	const roomClient = getRoomServiceClient(
		await resolveLiveKitForRoom(roomName),
	);

	try {
		const participants = await roomClient.listParticipants(roomName);
		return new Set(participants.map((participant) => participant.identity));
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.toLowerCase().includes("not found")
		) {
			return new Set();
		}

		throw error;
	}
}

export async function generateLiveKitToken(input: GenerateTokenInput) {
	// Token must be minted with the keys of whichever LiveKit hosts this space -
	// the space host's own deployment when they self-host, ours otherwise.
	const { apiKey, apiSecret, url } = await resolveLiveKitForSpace(
		input.space.id,
	);
	const ttl =
		Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS;
	const roomName =
		input.space.livekitRoomName || getLiveKitRoomName(input.space.id);
	const identity =
		input.participant.livekitIdentity || `participant:${input.participant.id}`;
	const isAdmin =
		input.participant.role === "HOST" || input.participant.role === "CO_HOST";
	const displayName = input.participant.displayName || "Guest";
	const attributes = {
		spaceId: input.space.id,
		spaceParticipantId: input.participant.id,
		role: input.participant.role,
		isGuest: String(input.participant.isGuest),
		room_admin: isAdmin ? "true" : "false",
		avatar: input.participant.user?.avatar || "",
		deafened: "false",
	};

	const token = new AccessToken(apiKey, apiSecret, {
		identity,
		name: displayName,
		ttl,
		attributes,
		metadata: JSON.stringify(attributes),
	});

	const grant: VideoGrant = {
		room: roomName,
		roomJoin: true,
		roomAdmin: isAdmin,
		canPublish: true,
		canSubscribe: true,
		canPublishData: true,
		canUpdateOwnMetadata: true,
		canPublishSources: [
			TrackSource.CAMERA,
			TrackSource.MICROPHONE,
			TrackSource.SCREEN_SHARE,
			TrackSource.SCREEN_SHARE_AUDIO,
		],
	};

	token.addGrant(grant);

	return {
		url,
		room: roomName,
		token: await token.toJwt(),
		expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
	};
}
