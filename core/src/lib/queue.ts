/**
 * Job queue (BullMQ + Redis) for heavy media work.
 *
 * The API server must NEVER run ffmpeg in-process - it should only enqueue a
 * job. A separate worker fleet (see `src/worker.ts`) consumes these queues and
 * scales independently of the API.
 *
 * GRACEFUL FALLBACK:
 * If REDIS_URL isn't set, `enqueue*` returns false and the caller runs the work
 * in-process (the old behaviour). This keeps local dev and any not-yet-migrated
 * deploy working without Redis - you only get the scaling benefit once REDIS_URL
 * is configured AND the worker process is running.
 */

import { type JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

export const FINALIZE_QUEUE = "finalize";
export const TRANSCODE_QUEUE = "transcode";

export interface FinalizeJob {
	recordingSessionId: string;
}

export interface TranscodeJob {
	masterKey: string;
	targetKey: string;
	/** DownloadFormat ("mp4" | "mp3" | "wav" | "webm"); typed loosely to avoid a
	 *  circular import with download-service. */
	format: string;
}

/** Whether the queue is usable (Redis configured). */
export function isQueueConfigured(): boolean {
	return Boolean(redisUrl);
}

/**
 * A fresh Redis connection. Workers need their own (they issue blocking
 * commands), so each Worker should call this rather than share one.
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createConnection(): IORedis {
	if (!redisUrl) {
		throw new Error("REDIS_URL is not set - cannot create a Redis connection.");
	}
	return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

// Queues (producer side) can share a single cached connection.
let producerConnection: IORedis | null = null;
let finalizeQueue: Queue<FinalizeJob> | null = null;
let transcodeQueue: Queue<TranscodeJob> | null = null;

function getProducerConnection(): IORedis {
	if (!producerConnection) producerConnection = createConnection();
	return producerConnection;
}

export function getFinalizeQueue(): Queue<FinalizeJob> {
	if (!finalizeQueue) {
		finalizeQueue = new Queue<FinalizeJob>(FINALIZE_QUEUE, {
			connection: getProducerConnection(),
		});
	}
	return finalizeQueue;
}

export function getTranscodeQueue(): Queue<TranscodeJob> {
	if (!transcodeQueue) {
		transcodeQueue = new Queue<TranscodeJob>(TRANSCODE_QUEUE, {
			connection: getProducerConnection(),
		});
	}
	return transcodeQueue;
}

const DEFAULT_JOB_OPTS: JobsOptions = {
	attempts: 3,
	backoff: { type: "exponential", delay: 5000 },
	// Keep recent terminal jobs for visibility, then auto-prune.
	removeOnComplete: { age: 3600, count: 1000 },
	removeOnFail: { age: 24 * 3600 },
};

function safeJobId(prefix: string, value: string): string {
	return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Enqueue a session finalization. Deduped by jobId so the same session can't be
 * finalized twice concurrently (replaces the old in-memory `inFlight` guard,
 * which broke across multiple API replicas). Returns false if Redis isn't
 * configured, signalling the caller to fall back to in-process work.
 */
export async function enqueueFinalize(
	recordingSessionId: string,
): Promise<boolean> {
	if (!isQueueConfigured()) return false;
	await getFinalizeQueue().add(
		"finalize",
		{ recordingSessionId },
		{
			jobId: safeJobId("finalize", recordingSessionId),
			...DEFAULT_JOB_OPTS,
			// Remove immediately on success so a later track completion can enqueue a
			// fresh finalize for the same session. With the default retention, the
			// dedup jobId would swallow that follow-up run and the straggler track
			// would never finalize (until the recovery sweep). While a job is active,
			// re-adds are still ignored, so this keeps concurrent dedup intact.
			removeOnComplete: true,
		},
	);
	return true;
}

/**
 * Enqueue an on-demand transcode. Deduped by the target R2 key so two requests
 * for the same MP4/MP3/WAV don't double-encode. Returns false if Redis isn't
 * configured.
 */
export async function enqueueTranscode(job: TranscodeJob): Promise<boolean> {
	if (!isQueueConfigured()) return false;
	await getTranscodeQueue().add("transcode", job, {
		jobId: safeJobId("transcode", job.targetKey),
		...DEFAULT_JOB_OPTS,
	});
	return true;
}
