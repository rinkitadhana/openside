/**
 * Storage service - object-storage (R2) helpers for the recording pipeline.
 *
 * Upload model: the browser uploads chunk binaries DIRECTLY to R2 using a
 * short-lived presigned PUT URL, then registers the segment metadata via our
 * API. The Express server never touches the chunk bytes, which keeps it out of
 * the recording bandwidth path.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolveR2ForKey } from "./infra-service.ts";

/** Local recording track kinds (per participant). "pcm" is a headerless raw
 *  24-bit PCM mic capture uploaded alongside the combined video master; its
 *  segments are byte-concatenated and wrapped in a WAV header at finalization. */
export type TrackType = "combined" | "audio" | "screen" | "camera" | "pcm";

const PUT_URL_TTL_SECONDS = 60 * 10; // 10 min - generous for a slow chunk upload
const GET_URL_TTL_SECONDS = 60 * 10; // 10 min - only needs to start playback/download; a leaked link dies fast

/**
 * Deterministic object key for a recording chunk.
 * spaces/{spaceId}/sessions/{recordingSessionId}/{participantId}/{participantRecordingId}/{trackType}/{seq}.{ext}
 *
 * The recording id is part of the key because a single participant can have
 * multiple recordings of the same trackType in one session (e.g. sharing their
 * screen, stopping, then sharing again - each share is its own "screen"
 * recording whose sequence restarts at 0). Without it, the second share's chunks
 * overwrite the first's.
 */
export function buildSegmentKey(params: {
	spaceId: string;
	recordingSessionId: string;
	participantId: string;
	participantRecordingId: string;
	trackType: TrackType;
	sequenceNumber: number;
	ext?: string;
}): string {
	const {
		spaceId,
		recordingSessionId,
		participantId,
		participantRecordingId,
		trackType,
		sequenceNumber,
	} = params;
	const ext = params.ext ?? "webm";
	return `spaces/${spaceId}/sessions/${recordingSessionId}/${participantId}/${participantRecordingId}/${trackType}/${sequenceNumber}.${ext}`;
}

/**
 * Deterministic object key for a SCREEN_RECORDER chunk (single user, no space).
 * screen/{userId}/sessions/{recordingSessionId}/{participantRecordingId}/{trackType}/{seq}.{ext}
 *
 * The recording id is part of the key for the same reason as buildSegmentKey:
 * two recordings of the same trackType in one session (e.g. a retried start)
 * must never overwrite each other's chunks.
 */
export function buildScreenSegmentKey(params: {
	userId: string;
	recordingSessionId: string;
	participantRecordingId: string;
	trackType: TrackType;
	sequenceNumber: number;
	ext?: string;
}): string {
	const {
		userId,
		recordingSessionId,
		participantRecordingId,
		trackType,
		sequenceNumber,
	} = params;
	const ext = params.ext ?? "webm";
	return `screen/${userId}/sessions/${recordingSessionId}/${participantRecordingId}/${trackType}/${sequenceNumber}.${ext}`;
}

/** Presigned PUT URL for a direct browser → R2 upload. */
export async function presignPut(
	key: string,
	contentType: string,
): Promise<string> {
	// Keys are owner-scoped, so this presigns against the owner's own R2 when
	// they self-host, and platform R2 otherwise.
	const r2 = await resolveR2ForKey(key);
	const command = new PutObjectCommand({
		Bucket: r2.bucket,
		Key: key,
		ContentType: contentType,
	});

	return getSignedUrl(r2.client, command, {
		expiresIn: PUT_URL_TTL_SECONDS,
	});
}

/**
 * Presigned GET URL for downloading/playing a stored object. Pass a
 * `downloadName` to force a browser download (Content-Disposition: attachment)
 * with that filename; omit it for inline playback (preview).
 */
export async function presignGet(
	key: string,
	opts?: { downloadName?: string },
): Promise<string> {
	const r2 = await resolveR2ForKey(key);
	const command = new GetObjectCommand({
		Bucket: r2.bucket,
		Key: key,
		ResponseContentDisposition: opts?.downloadName
			? `attachment; filename="${opts.downloadName.replace(/"/g, "")}"`
			: undefined,
	});

	return getSignedUrl(r2.client, command, {
		expiresIn: GET_URL_TTL_SECONDS,
	});
}

/** Whether an object exists in the bucket (used to cache transcodes). */
export async function objectExists(key: string): Promise<boolean> {
	try {
		const r2 = await resolveR2ForKey(key);
		await r2.client.send(
			new HeadObjectCommand({ Bucket: r2.bucket, Key: key }),
		);
		return true;
	} catch {
		return false;
	}
}

/** Download an object into a Buffer (used by finalization). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
	const r2 = await resolveR2ForKey(key);
	const res = await r2.client.send(
		new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
	);

	const stream = res.Body as Readable;
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** Upload a local file stream to R2 without loading the whole file in memory. */
export async function putFileObject(
	key: string,
	filePath: string,
	contentType: string,
): Promise<void> {
	const fileStat = await stat(filePath);
	const r2 = await resolveR2ForKey(key);
	await r2.client.send(
		new PutObjectCommand({
			Bucket: r2.bucket,
			Key: key,
			Body: createReadStream(filePath),
			ContentType: contentType,
			ContentLength: fileStat.size,
		}),
	);
}

/** Delete a batch of objects (used by finalization/cleanup). */
export async function deleteObjects(keys: string[]): Promise<void> {
	if (keys.length === 0) return;

	// A batch can span owners (in principle) - group keys by resolved bucket.
	const groups = new Map<
		string,
		{ r2: Awaited<ReturnType<typeof resolveR2ForKey>>; keys: string[] }
	>();
	for (const key of keys) {
		const r2 = await resolveR2ForKey(key);
		const groupKey = `${r2.bucket}:${r2.selfHost}`;
		const group = groups.get(groupKey) ?? { r2, keys: [] };
		group.keys.push(key);
		groups.set(groupKey, group);
	}

	for (const { r2, keys: groupKeys } of groups.values()) {
		// S3/R2 DeleteObjects accepts up to 1000 keys per request.
		for (let i = 0; i < groupKeys.length; i += 1000) {
			const batch = groupKeys.slice(i, i + 1000);
			await r2.client.send(
				new DeleteObjectsCommand({
					Bucket: r2.bucket,
					Delete: { Objects: batch.map((Key) => ({ Key })) },
				}),
			);
		}
	}
}
