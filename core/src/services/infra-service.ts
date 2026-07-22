/**
 * Infra resolution - which LiveKit + R2 a given user/space/object runs on.
 *
 * SELF_HOST users bring their own LiveKit + R2 keys (stored encrypted in
 * SelfHostConfig); everyone else runs on the platform's env-configured infra.
 * Recording object keys and room names are owner-scoped by construction
 * (`spaces/{spaceId}/…`, `screen/{userId}/…`, `space:{spaceId}`), so callers
 * don't need to thread config around - the storage/LiveKit/egress services
 * resolve the right target from the key/room they're already given.
 *
 * Lookups are cached briefly; call invalidateInfraCache(userId) after a
 * settings change.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../db/index.ts";
import { decryptSecret } from "../lib/crypto.ts";
import { R2_BUCKET, getR2Client } from "../lib/r2-client.ts";

export interface LiveKitInfra {
	url: string;
	apiKey: string;
	apiSecret: string;
	selfHost: boolean;
}

export interface R2Infra {
	client: S3Client;
	bucket: string;
	selfHost: boolean;
}

export interface SelfHostCredentials {
	livekitUrl: string;
	livekitApiKey: string;
	livekitApiSecret: string;
	r2AccountId: string;
	r2AccessKeyId: string;
	r2SecretAccessKey: string;
	r2Bucket: string;
}

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

const selfHostCache = new Map<string, CacheEntry<SelfHostCredentials | null>>();
const spaceHostCache = new Map<string, CacheEntry<string | null>>();
const s3ClientCache = new Map<string, S3Client>();

function readCache<T>(
	map: Map<string, CacheEntry<T>>,
	key: string,
): T | undefined {
	const entry = map.get(key);
	if (!entry || entry.expiresAt < Date.now()) {
		map.delete(key);
		return undefined;
	}
	return entry.value;
}

function writeCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T) {
	map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateInfraCache(userId: string) {
	selfHostCache.delete(userId);
}

export function getEnvLiveKitInfra(): LiveKitInfra {
	const url = process.env.LIVEKIT_URL;
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;

	if (!url || !apiKey || !apiSecret) {
		throw new Error("LIVEKIT_NOT_CONFIGURED");
	}

	return { url, apiKey, apiSecret, selfHost: false };
}

export function getEnvR2Infra(): R2Infra {
	return { client: getR2Client(), bucket: R2_BUCKET, selfHost: false };
}

/** Decrypted self-host credentials for a user, or null when not active. */
export async function getSelfHostCredentials(
	userId: string,
): Promise<SelfHostCredentials | null> {
	const cached = readCache(selfHostCache, userId);
	if (cached !== undefined) return cached;

	const config = await prisma.selfHostConfig.findUnique({
		where: { userId },
	});

	let credentials: SelfHostCredentials | null = null;
	if (config?.enabled && config.lastValidatedAt) {
		try {
			credentials = {
				livekitUrl: config.livekitUrl,
				livekitApiKey: decryptSecret(config.livekitApiKey),
				livekitApiSecret: decryptSecret(config.livekitApiSecret),
				r2AccountId: config.r2AccountId,
				r2AccessKeyId: decryptSecret(config.r2AccessKeyId),
				r2SecretAccessKey: decryptSecret(config.r2SecretAccessKey),
				r2Bucket: config.r2Bucket,
			};
		} catch (error) {
			console.error(
				`[Infra] failed to decrypt self-host config for ${userId} - falling back to platform infra:`,
				error,
			);
		}
	}

	writeCache(selfHostCache, userId, credentials);
	return credentials;
}

function buildS3Client(creds: SelfHostCredentials): S3Client {
	const cacheKey = `${creds.r2AccountId}:${creds.r2AccessKeyId}:${creds.r2Bucket}`;
	const existing = s3ClientCache.get(cacheKey);
	if (existing) return existing;

	const client = new S3Client({
		region: "auto",
		endpoint: `https://${creds.r2AccountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: creds.r2AccessKeyId,
			secretAccessKey: creds.r2SecretAccessKey,
		},
	});

	s3ClientCache.set(cacheKey, client);
	return client;
}

export async function resolveLiveKitForUser(
	userId: string | null | undefined,
): Promise<LiveKitInfra> {
	if (!userId) return getEnvLiveKitInfra();

	const creds = await getSelfHostCredentials(userId);
	if (!creds) return getEnvLiveKitInfra();

	return {
		url: creds.livekitUrl,
		apiKey: creds.livekitApiKey,
		apiSecret: creds.livekitApiSecret,
		selfHost: true,
	};
}

export async function resolveR2ForUser(
	userId: string | null | undefined,
): Promise<R2Infra> {
	if (!userId) return getEnvR2Infra();

	const creds = await getSelfHostCredentials(userId);
	if (!creds) return getEnvR2Infra();

	return {
		client: buildS3Client(creds),
		bucket: creds.r2Bucket,
		selfHost: true,
	};
}

async function getSpaceHostId(spaceId: string): Promise<string | null> {
	const cached = readCache(spaceHostCache, spaceId);
	if (cached !== undefined) return cached;

	const space = await prisma.space.findUnique({
		where: { id: spaceId },
		select: { hostId: true },
	});

	const hostId = space?.hostId ?? null;
	writeCache(spaceHostCache, spaceId, hostId);
	return hostId;
}

/** Room names are `space:{spaceId}` - infra follows the space's host. */
export async function resolveLiveKitForRoom(
	roomName: string | null | undefined,
): Promise<LiveKitInfra> {
	const spaceId = roomName?.startsWith("space:") ? roomName.slice(6) : null;
	if (!spaceId) return getEnvLiveKitInfra();

	const hostId = await getSpaceHostId(spaceId);
	return resolveLiveKitForUser(hostId);
}

export async function resolveLiveKitForSpace(
	spaceId: string,
): Promise<LiveKitInfra> {
	const hostId = await getSpaceHostId(spaceId);
	return resolveLiveKitForUser(hostId);
}

export interface R2RawCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	bucket: string;
	selfHost: boolean;
}

/**
 * Raw R2 credentials (for LiveKit egress S3Upload, which can't take an
 * S3Client). Space-scoped: the host's own bucket when they self-host.
 */
export async function resolveR2CredentialsForSpace(
	spaceId: string,
): Promise<R2RawCredentials> {
	const hostId = await getSpaceHostId(spaceId);
	const creds = hostId ? await getSelfHostCredentials(hostId) : null;

	if (creds) {
		return {
			accessKeyId: creds.r2AccessKeyId,
			secretAccessKey: creds.r2SecretAccessKey,
			endpoint: `https://${creds.r2AccountId}.r2.cloudflarestorage.com`,
			bucket: creds.r2Bucket,
			selfHost: true,
		};
	}

	return {
		accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
		endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		bucket: R2_BUCKET,
		selfHost: false,
	};
}

/**
 * Storage keys are owner-scoped:
 *   spaces/{spaceId}/…  -> the space host's R2 (or platform default)
 *   screen/{userId}/…   -> that user's R2 (or platform default)
 * Anything else lives on platform R2.
 */
export async function resolveR2ForKey(key: string): Promise<R2Infra> {
	const spaceMatch = key.match(/^spaces\/([^/]+)\//);
	if (spaceMatch?.[1]) {
		const hostId = await getSpaceHostId(spaceMatch[1]);
		return resolveR2ForUser(hostId);
	}

	const screenMatch = key.match(/^screen\/([^/]+)\//);
	if (screenMatch?.[1]) {
		return resolveR2ForUser(screenMatch[1]);
	}

	return getEnvR2Infra();
}
