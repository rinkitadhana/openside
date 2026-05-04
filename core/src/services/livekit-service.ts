import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  type VideoGrant,
} from "livekit-server-sdk";

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

function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    throw new Error("LIVEKIT_NOT_CONFIGURED");
  }

  return { url, apiKey, apiSecret };
}

function getRoomServiceClient() {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const serviceUrl = url
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  return new RoomServiceClient(serviceUrl, apiKey, apiSecret);
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

  return `guest:${input.spaceId}:${input.participantSessionId}`;
}

export function getLiveKitPublicConfig() {
  const { url } = getLiveKitConfig();
  return { url };
}

export async function createLiveKitRoom(input: {
  name: string;
  metadata?: Record<string, unknown>;
}) {
  const roomClient = getRoomServiceClient();
  const emptyTimeout =
    Number(process.env.LIVEKIT_ROOM_EMPTY_TIMEOUT_SECONDS) ||
    DEFAULT_EMPTY_TIMEOUT_SECONDS;
  const maxParticipants =
    Number(process.env.LIVEKIT_ROOM_MAX_PARTICIPANTS) ||
    DEFAULT_MAX_PARTICIPANTS;

  try {
    return await roomClient.createRoom({
      name: input.name,
      emptyTimeout,
      maxParticipants,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("already exists")) {
      const [existingRoom] = await roomClient.listRooms([input.name]);
      return existingRoom;
    }

    throw error;
  }
}

export async function deleteLiveKitRoom(roomName: string | null | undefined) {
  if (!roomName) return;

  const roomClient = getRoomServiceClient();

  try {
    await roomClient.deleteRoom(roomName);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
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

  const roomClient = getRoomServiceClient();

  try {
    await roomClient.removeParticipant(input.roomName, input.identity);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
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

  const roomClient = getRoomServiceClient();

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
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      return;
    }

    throw error;
  }
}

export async function generateLiveKitToken(input: GenerateTokenInput) {
  const { apiKey, apiSecret, url } = getLiveKitConfig();
  const ttl =
    Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS) ||
    DEFAULT_TOKEN_TTL_SECONDS;
  const roomName = input.space.livekitRoomName || getLiveKitRoomName(input.space.id);
  const identity =
    input.participant.livekitIdentity ||
    `participant:${input.participant.id}`;
  const isAdmin = input.participant.role === "HOST" || input.participant.role === "CO_HOST";
  const displayName = input.participant.displayName || "Guest";
  const attributes = {
    spaceId: input.space.id,
    spaceParticipantId: input.participant.id,
    role: input.participant.role,
    isGuest: String(input.participant.isGuest),
    room_admin: isAdmin ? "true" : "false",
    avatar: input.participant.user?.avatar || "",
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
    canUpdateOwnMetadata: false,
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
