/**
 * Storage service - object-storage (R2) helpers for the recording pipeline.
 *
 * Upload model: the browser uploads chunk binaries DIRECTLY to R2 using a
 * short-lived presigned PUT URL, then registers the segment metadata via our
 * API. The Express server never touches the chunk bytes, which keeps it out of
 * the recording bandwidth path.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	type R2Infra,
	resolveR2CandidatesForKey,
	resolveR2ForKey,
	resolveR2ForRead,
} from "./infra-service.ts";

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

/** A recording chunk is a few seconds of media - even 4K at a high bitrate
 *  stays far below this. */
export const MAX_SEGMENT_BYTES = 100 * 1024 * 1024;

/** The containers the browser recorders produce (see the web's ext()). */
const SEGMENT_EXTS = new Set(["webm", "mp4", "mkv", "ogg", "pcm", "mov"]);

/** Video files a user can upload as a recording (sent as chunks of the file). */
export const UPLOAD_FILE_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
/** A recorder's mimeType, codecs included ("video/webm;codecs=vp9,opus"). */
const SEGMENT_CONTENT_TYPE =
	/^(?:(?:video|audio)\/(?:webm|mp4|x-matroska|ogg)|audio\/pcm-raw|application\/octet-stream)(?:\s*;[\w\s=.,"+-]*)?$/i;

export type SegmentUploadCheck =
	| { ok: true; ext: string; contentType: string; sizeBytes: number }
	| { ok: false; message: string };

/** Validate a chunk upload request: only recorder media, of a bounded size. */
export function checkSegmentUpload(body: {
	ext?: unknown;
	contentType?: unknown;
	sizeBytes?: unknown;
}): SegmentUploadCheck {
	const ext = body.ext === undefined ? "webm" : body.ext;
	if (typeof ext !== "string" || !SEGMENT_EXTS.has(ext)) {
		return { ok: false, message: "Unsupported file extension!" };
	}
	const contentType = body.contentType ?? "application/octet-stream";
	if (
		typeof contentType !== "string" ||
		!SEGMENT_CONTENT_TYPE.test(contentType)
	) {
		return { ok: false, message: "Unsupported content type!" };
	}
	const { sizeBytes } = body;
	if (
		typeof sizeBytes !== "number" ||
		!Number.isInteger(sizeBytes) ||
		sizeBytes <= 0 ||
		sizeBytes > MAX_SEGMENT_BYTES
	) {
		return { ok: false, message: "Chunk size is missing or too large!" };
	}
	return { ok: true, ext, contentType, sizeBytes };
}

/**
 * Presigned PUT URL for a direct browser → R2 upload. The content type and,
 * when given, the exact byte length are signed into the URL, so the upload
 * must match what was validated here (the presigner leaves Content-Type
 * unsigned unless told otherwise).
 */
export async function presignPut(
	key: string,
	contentType: string,
	contentLength?: number,
): Promise<string> {
	// Resolves from the recording session's infra stamp: the owner's own R2 for
	// self-hosted sessions, platform R2 otherwise.
	const r2 = await resolveR2ForKey(key);
	const command = new PutObjectCommand({
		Bucket: r2.bucket,
		Key: key,
		ContentType: contentType,
		...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
	});

	return getSignedUrl(r2.client, command, {
		expiresIn: PUT_URL_TTL_SECONDS,
		signableHeaders: new Set(["content-type", "content-length"]),
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
	const r2 = await resolveR2ForRead(key);
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
		const r2 = await resolveR2ForRead(key);
		await r2.client.send(
			new HeadObjectCommand({ Bucket: r2.bucket, Key: key }),
		);
		return true;
	} catch {
		return false;
	}
}

/** An object's size in bytes, or null if it can't be read. */
export async function objectSize(key: string): Promise<number | null> {
	try {
		const r2 = await resolveR2ForRead(key);
		const res = await r2.client.send(
			new HeadObjectCommand({ Bucket: r2.bucket, Key: key }),
		);
		return res.ContentLength ?? null;
	} catch {
		return null;
	}
}

/** Download an object into a Buffer (used by finalization). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
	const r2 = await resolveR2ForRead(key);
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

/** Download an object straight to a local file without buffering it in memory. */
export async function downloadObjectToFile(
	key: string,
	filePath: string,
): Promise<void> {
	const r2 = await resolveR2ForRead(key);
	const res = await r2.client.send(
		new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
	);
	await pipeline(res.Body as Readable, createWriteStream(filePath));
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

	// A batch can span owners and infra - group keys by bucket. Legacy keys
	// (made before infra stamping) are deleted from every bucket they could be
	// in; deleting a missing key is a no-op.
	const groups = new Map<string, { r2: R2Infra; keys: string[] }>();
	for (const key of keys) {
		for (const r2 of await resolveR2CandidatesForKey(key)) {
			const groupKey = `${r2.bucket}:${r2.selfHost}`;
			const group = groups.get(groupKey) ?? { r2, keys: [] };
			group.keys.push(key);
			groups.set(groupKey, group);
		}
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

// ── Bulk cleanup ───────────────────────────────────────────────────────────

/** Formats a master can be transcoded to and cached next to itself (see
 *  download-service's derivedKey). */
const CACHED_DOWNLOAD_EXTENSIONS = ["mp4", "webm", "mp3", "wav"];

/**
 * Add a stored key - and, for a master, every download format cached next to
 * it - to a delete set. Deleting a cache that was never made is a no-op.
 */
export function addStoredKey(
	keys: Set<string>,
	key: string | null | undefined,
	options: { withCachedFormats?: boolean } = {},
): void {
	if (!key) return;
	keys.add(key);
	if (!options.withCachedFormats) return;
	if (!/\.(?:mp4|webm|mp3|wav)$/i.test(key)) return;
	for (const extension of CACHED_DOWNLOAD_EXTENSIONS) {
		keys.add(key.replace(/\.[a-z0-9]+$/i, `.${extension}`));
	}
}

/**
 * The prefixes we're allowed to wipe: a whole space, one recording session, or
 * one track's chunks. Anything broader (a user's root, the bucket) is refused.
 * A track's folder is its cuid - never a kind folder like `combined/` or
 * `screen/`, which holds masters.
 */
const DELETABLE_PREFIX =
	/^(?:spaces\/[^/]+\/(?:sessions\/[^/]+\/(?:[^/]+\/c[a-z0-9]{20,}\/)?)?|screen\/[^/]+\/sessions\/[^/]+\/(?:c[a-z0-9]{20,}\/)?)$/;

/** Most objects one prefix delete will page through (1000 per page). */
const MAX_PREFIX_PAGES = 200;

export interface PrefixTarget {
	prefix: string;
	buckets: R2Infra[];
}

/**
 * Where a prefix's objects can live. Resolve this BEFORE deleting the rows a
 * self-host session's bucket is looked up from.
 */
export async function resolvePrefixTarget(
	prefix: string,
): Promise<PrefixTarget> {
	if (!DELETABLE_PREFIX.test(prefix) || prefix.includes("..")) {
		throw new Error(`Refusing to delete unscoped prefix "${prefix}"`);
	}
	return { prefix, buckets: await resolveR2CandidatesForKey(prefix) };
}

/**
 * Delete every object under each prefix, in every bucket it could be in. This
 * is what catches objects the database never knew about - a chunk uploaded
 * but never registered, a cached download format. Needs list permission on the
 * bucket; callers delete the keys they do know about first.
 */
export async function deletePrefixTargets(
	targets: PrefixTarget[],
): Promise<number> {
	let deleted = 0;
	const done = new Set<string>();
	for (const { prefix, buckets } of targets) {
		for (const r2 of buckets) {
			const id = `${r2.bucket}:${r2.selfHost}:${prefix}`;
			if (done.has(id)) continue;
			done.add(id);
			for (let page = 0; page < MAX_PREFIX_PAGES; page++) {
				// Deleting as we go, so the first page is always the next one.
				const listed = await r2.client.send(
					new ListObjectsV2Command({
						Bucket: r2.bucket,
						Prefix: prefix,
						MaxKeys: 1000,
					}),
				);
				const keys = (listed.Contents ?? []).flatMap((object) =>
					object.Key ? [object.Key] : [],
				);
				if (keys.length === 0) break;
				await r2.client.send(
					new DeleteObjectsCommand({
						Bucket: r2.bucket,
						Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
					}),
				);
				deleted += keys.length;
				if (!listed.IsTruncated) break;
			}
		}
	}
	return deleted;
}

/** The prefix holding one track's chunks, from one of its chunk keys. */
export function trackChunkPrefix(
	chunkKey: string,
	participantRecordingId: string,
): string | null {
	const marker = `/${participantRecordingId}/`;
	const index = chunkKey.indexOf(marker);
	if (index < 0) return null;
	const prefix = chunkKey.slice(0, index + marker.length);
	return DELETABLE_PREFIX.test(prefix) ? prefix : null;
}

/** The prefix holding everything a recording session stored. */
export function sessionStoragePrefix(session: {
	id: string;
	source: string;
	spaceId: string | null;
	userId: string | null;
}): string | null {
	if (session.source === "SCREEN_RECORDER") {
		return session.userId
			? `screen/${session.userId}/sessions/${session.id}/`
			: null;
	}
	return session.spaceId
		? `spaces/${session.spaceId}/sessions/${session.id}/`
		: null;
}
