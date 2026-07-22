/**
 * Self-host (bring-your-own-keys) settings.
 *
 * Users paste their own LiveKit + R2 credentials in Settings. Keys are
 * validated live on save (a bad key is rejected, not stored broken), encrypted
 * at rest with AES-256-GCM, and NEVER returned to the client - reads get
 * masked values only. While enabled + validated, the user's spaces and screen
 * recordings run entirely on their infra: no metering, no watermark, no
 * retention sweeps. Their keys, their bill.
 */

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { RoomServiceClient } from "livekit-server-sdk";
import { prisma } from "../db/index.ts";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto.ts";
import { invalidateInfraCache } from "./infra-service.ts";

export interface SelfHostInput {
	livekitUrl: string;
	livekitApiKey: string;
	livekitApiSecret: string;
	r2AccountId: string;
	r2AccessKeyId: string;
	r2SecretAccessKey: string;
	r2Bucket: string;
}

export interface SelfHostView {
	enabled: boolean;
	livekitUrl: string;
	livekitApiKey: string; // masked
	r2AccountId: string;
	r2AccessKeyId: string; // masked
	r2Bucket: string;
	lastValidatedAt: Date | null;
}

const VALIDATE_TIMEOUT_MS = 10_000;

const withTimeout = async <T>(
	promise: Promise<T>,
	label: string,
): Promise<T> => {
	let handle: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				handle = setTimeout(
					() => reject(new Error(`${label}_TIMEOUT`)),
					VALIDATE_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (handle) clearTimeout(handle);
	}
};

/** Live-check the LiveKit keys: list rooms with them. Throws on bad keys. */
async function validateLiveKit(input: SelfHostInput): Promise<void> {
	const serviceUrl = input.livekitUrl
		.replace(/^wss:\/\//, "https://")
		.replace(/^ws:\/\//, "http://");

	const client = new RoomServiceClient(
		serviceUrl,
		input.livekitApiKey,
		input.livekitApiSecret,
	);

	try {
		await withTimeout(client.listRooms(), "LIVEKIT_VALIDATE");
	} catch (error) {
		console.warn("[SelfHost] LiveKit validation failed:", error);
		throw new Error("LIVEKIT_KEYS_INVALID");
	}
}

/** Live-check the R2 keys: HeadBucket on the given bucket. Throws on failure. */
async function validateR2(input: SelfHostInput): Promise<void> {
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${input.r2AccountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: input.r2AccessKeyId,
			secretAccessKey: input.r2SecretAccessKey,
		},
	});

	try {
		await withTimeout(
			client.send(new HeadBucketCommand({ Bucket: input.r2Bucket })),
			"R2_VALIDATE",
		);
	} catch (error) {
		console.warn("[SelfHost] R2 validation failed:", error);
		throw new Error("R2_KEYS_INVALID");
	} finally {
		client.destroy();
	}
}

function toView(config: {
	enabled: boolean;
	livekitUrl: string;
	livekitApiKey: string;
	r2AccountId: string;
	r2AccessKeyId: string;
	r2Bucket: string;
	lastValidatedAt: Date | null;
}): SelfHostView {
	const mask = (encrypted: string) => {
		try {
			return maskSecret(decryptSecret(encrypted));
		} catch {
			return "••••••••";
		}
	};

	return {
		enabled: config.enabled,
		livekitUrl: config.livekitUrl,
		livekitApiKey: mask(config.livekitApiKey),
		r2AccountId: config.r2AccountId,
		r2AccessKeyId: mask(config.r2AccessKeyId),
		r2Bucket: config.r2Bucket,
		lastValidatedAt: config.lastValidatedAt,
	};
}

export async function getSelfHostView(
	userId: string,
): Promise<SelfHostView | null> {
	const config = await prisma.selfHostConfig.findUnique({ where: { userId } });
	return config ? toView(config) : null;
}

/** Validate then store (encrypted). Replaces any existing config. */
export async function saveSelfHostConfig(
	userId: string,
	input: SelfHostInput,
): Promise<SelfHostView> {
	await validateLiveKit(input);
	await validateR2(input);

	const now = new Date();
	const data = {
		enabled: true,
		livekitUrl: input.livekitUrl.trim(),
		livekitApiKey: encryptSecret(input.livekitApiKey),
		livekitApiSecret: encryptSecret(input.livekitApiSecret),
		r2AccountId: input.r2AccountId.trim(),
		r2AccessKeyId: encryptSecret(input.r2AccessKeyId),
		r2SecretAccessKey: encryptSecret(input.r2SecretAccessKey),
		r2Bucket: input.r2Bucket.trim(),
		lastValidatedAt: now,
	};

	const config = await prisma.selfHostConfig.upsert({
		where: { userId },
		update: data,
		create: { userId, ...data },
	});

	invalidateInfraCache(userId);
	return toView(config);
}

export async function setSelfHostEnabled(
	userId: string,
	enabled: boolean,
): Promise<SelfHostView> {
	const config = await prisma.selfHostConfig.update({
		where: { userId },
		data: { enabled },
	});

	invalidateInfraCache(userId);
	return toView(config);
}

export async function deleteSelfHostConfig(userId: string): Promise<void> {
	await prisma.selfHostConfig
		.delete({ where: { userId } })
		.catch(() => undefined);
	invalidateInfraCache(userId);
}
