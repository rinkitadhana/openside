/**
 * User profile + recording preferences.
 *
 * Name and avatar are user-editable in-app (email stays the
 * Clerk login identity and is read-only). The first in-app edit sets
 * profileCustomized so the Clerk sync stops overwriting these values.
 *
 * Avatars are uploaded straight to R2 (avatars/{userId}/…) and surfaced to the
 * client as a freshly presigned GET URL - presigning is a local HMAC (no
 * network), so it's cheap to do on every read.
 */

import { prisma } from "../db/index.ts";
import {
	type RecordingMode,
	clampAudioSampleRate,
	clampFps,
	clampRecordingMode,
	clampVideoResolution,
} from "../lib/recording-constants.ts";
import { deleteObjects, presignGet, presignPut } from "./storage-service.ts";

const AVATAR_CONTENT_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

export interface PublicProfile {
	id: string;
	name: string;
	email: string;
	avatar: string | null;
	plan: "DEMO" | "PRO";
	cloudBackupEnabled: boolean;
	targetFps: number;
	videoResolution: number;
	audioSampleRate: number;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	echoCancellation: boolean;
	recordingMode: RecordingMode;
}

type ProfileRow = {
	id: string;
	name: string;
	email: string;
	avatar: string | null;
	avatarKey: string | null;
	plan: "DEMO" | "PRO";
	cloudBackupEnabled: boolean;
	targetFps: number;
	videoResolution: number;
	audioSampleRate: number;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	echoCancellation: boolean;
	recordingMode: string;
};

const PROFILE_SELECT = {
	id: true,
	name: true,
	email: true,
	avatar: true,
	avatarKey: true,
	plan: true,
	cloudBackupEnabled: true,
	targetFps: true,
	videoResolution: true,
	audioSampleRate: true,
	noiseSuppression: true,
	autoGainControl: true,
	echoCancellation: true,
	recordingMode: true,
} as const;

/** Shape a user row for the client, resolving the avatar to a usable URL. */
export async function toPublicProfile(row: ProfileRow): Promise<PublicProfile> {
	// A user-uploaded avatar lives in R2 and needs a presigned GET; otherwise
	// fall back to the Clerk image URL stored on the row.
	const avatar = row.avatarKey
		? await presignGet(row.avatarKey).catch(() => null)
		: (row.avatar ?? null);

	return {
		id: row.id,
		name: row.name,
		email: row.email,
		avatar,
		plan: row.plan,
		cloudBackupEnabled: row.cloudBackupEnabled,
		targetFps: row.targetFps,
		videoResolution: row.videoResolution,
		audioSampleRate: row.audioSampleRate,
		noiseSuppression: row.noiseSuppression,
		autoGainControl: row.autoGainControl,
		echoCancellation: row.echoCancellation,
		recordingMode: clampRecordingMode(row.recordingMode),
	};
}

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
	const row = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: PROFILE_SELECT,
	});
	return toPublicProfile(row);
}

/** Deterministic avatar key. Random suffix busts caches + avoids ext clashes. */
export function buildAvatarKey(userId: string, ext: string): string {
	const suffix = Math.random().toString(36).slice(2, 10);
	return `avatars/${userId}/${suffix}.${ext}`;
}

/**
 * Presign a direct browser → R2 avatar upload. Rejects non-image content
 * types. Returns the key the client sends back to updateProfile.
 */
export async function presignAvatarUpload(
	userId: string,
	contentType: string,
): Promise<{ url: string; key: string }> {
	const ext = AVATAR_CONTENT_TYPES[contentType];
	if (!ext) {
		throw new Error("UNSUPPORTED_AVATAR_TYPE");
	}

	const key = buildAvatarKey(userId, ext);
	const url = await presignPut(key, contentType);
	return { url, key };
}

interface UpdateProfileInput {
	name?: string;
	/** R2 key returned from presignAvatarUpload after the upload completed. */
	avatarKey?: string | null;
}

export async function updateProfile(
	userId: string,
	input: UpdateProfileInput,
): Promise<PublicProfile> {
	const existing = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { avatarKey: true },
	});

	const data: {
		profileCustomized: boolean;
		name?: string;
		avatarKey?: string | null;
		avatar?: string | null;
	} = { profileCustomized: true };

	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new Error("NAME_REQUIRED");
		if (name.length > 60) throw new Error("NAME_TOO_LONG");
		data.name = name;
	}

	if (input.avatarKey !== undefined) {
		if (input.avatarKey === null) {
			// Removing the avatar entirely (revert to initials).
			data.avatarKey = null;
			data.avatar = null;
		} else {
			// Only accept a key inside this user's own avatar namespace.
			if (!input.avatarKey.startsWith(`avatars/${userId}/`)) {
				throw new Error("INVALID_AVATAR_KEY");
			}
			data.avatarKey = input.avatarKey;
			// Drop the stale Clerk URL now that an uploaded avatar takes over.
			data.avatar = null;
		}
	}

	const updated = await prisma.user.update({
		where: { id: userId },
		data,
		select: PROFILE_SELECT,
	});

	// Clean up the previous avatar object once its replacement is committed.
	const previousKey = existing.avatarKey;
	if (
		input.avatarKey !== undefined &&
		previousKey &&
		previousKey !== updated.avatarKey
	) {
		await deleteObjects([previousKey]).catch(() => undefined);
	}

	return toPublicProfile(updated);
}

export async function updateRecordingSettings(
	userId: string,
	settings: {
		cloudBackupEnabled?: boolean;
		targetFps?: number;
		videoResolution?: number;
		audioSampleRate?: number;
		noiseSuppression?: boolean;
		autoGainControl?: boolean;
		echoCancellation?: boolean;
		recordingMode?: RecordingMode;
	},
): Promise<PublicProfile> {
	const data: {
		cloudBackupEnabled?: boolean;
		targetFps?: number;
		videoResolution?: number;
		audioSampleRate?: number;
		noiseSuppression?: boolean;
		autoGainControl?: boolean;
		echoCancellation?: boolean;
		recordingMode?: RecordingMode;
	} = {};
	if (settings.cloudBackupEnabled !== undefined) {
		data.cloudBackupEnabled = settings.cloudBackupEnabled;
	}
	// Only 24 or 30 are valid; anything else clamps to the default.
	if (settings.targetFps !== undefined) {
		data.targetFps = clampFps(settings.targetFps);
	}
	if (settings.videoResolution !== undefined) {
		data.videoResolution = clampVideoResolution(settings.videoResolution);
	}
	if (settings.audioSampleRate !== undefined) {
		data.audioSampleRate = clampAudioSampleRate(settings.audioSampleRate);
	}
	if (settings.noiseSuppression !== undefined) {
		data.noiseSuppression = settings.noiseSuppression;
	}
	if (settings.autoGainControl !== undefined) {
		data.autoGainControl = settings.autoGainControl;
	}
	if (settings.echoCancellation !== undefined) {
		data.echoCancellation = settings.echoCancellation;
	}
	if (settings.recordingMode !== undefined) {
		data.recordingMode = clampRecordingMode(settings.recordingMode);
	}

	const updated = await prisma.user.update({
		where: { id: userId },
		data,
		select: PROFILE_SELECT,
	});
	return toPublicProfile(updated);
}
