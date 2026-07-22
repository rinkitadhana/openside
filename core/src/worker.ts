/**
 * Media worker process.
 *
 * Consumes the BullMQ queues and runs the heavy ffmpeg work (session
 * finalization + on-demand transcodes) OFF the API server. Run one or more of
 * these as their own service, scaled on queue depth. Requires REDIS_URL.
 *
 *   node dist/worker.js        (prod)
 *   pnpm worker:dev            (local, watch mode)
 */

import "./lib/load-env.ts";
import { type Job, Worker } from "bullmq";
import { prisma } from "./db/index.ts";
import { logFfmpegAvailability } from "./lib/ffmpeg-check.ts";
import {
	FINALIZE_QUEUE,
	type FinalizeJob,
	TRANSCODE_QUEUE,
	type TranscodeJob,
	createConnection,
	isQueueConfigured,
} from "./lib/queue.ts";
import {
	type DownloadFormat,
	transcodeToR2,
} from "./services/download-service.ts";
import { finalizeSession } from "./services/finalization-service.ts";
import { finalizeScreenSession } from "./services/screen-finalization-service.ts";

if (!isQueueConfigured()) {
	console.error(
		"[Worker] REDIS_URL is not set. The worker has nothing to connect to - " +
			"set REDIS_URL and restart.",
	);
	process.exit(1);
}

// Heavy ffmpeg jobs are CPU-bound, so keep concurrency modest per worker and
// scale by running MORE worker processes/containers instead.
const concurrency = Number(process.env.WORKER_CONCURRENCY) || 2;

const finalizeWorker = new Worker<FinalizeJob>(
	FINALIZE_QUEUE,
	async (job: Job<FinalizeJob>) => {
		const { recordingSessionId } = job.data;
		console.log(
			`[Worker:finalize] picked job ${job.id} for session ${recordingSessionId}`,
		);

		const session = await prisma.recordingSession.findUnique({
			where: { id: recordingSessionId },
			select: {
				source: true,
				status: true,
				userId: true,
				spaceId: true,
				participantRecordings: {
					select: {
						id: true,
						isComplete: true,
						uploadedSegments: true,
						expectedSegments: true,
					},
				},
			},
		});

		if (!session) {
			console.warn(`[Worker:finalize] session ${recordingSessionId} not found`);
			return;
		}

		console.log(
			`[Worker:finalize] session ${recordingSessionId} source=${session.source} status=${session.status} recordings=${session.participantRecordings.length}`,
			session.participantRecordings.map((r) => ({
				id: r.id,
				complete: r.isComplete,
				uploaded: r.uploadedSegments,
				expected: r.expectedSegments,
			})),
		);

		if (session?.source === "SCREEN_RECORDER") {
			console.log(
				`[Worker:finalize] routing ${recordingSessionId} to screen finalizer`,
			);
			await finalizeScreenSession(recordingSessionId);
			return;
		}

		console.log(
			`[Worker:finalize] routing ${recordingSessionId} to meeting finalizer`,
		);
		await finalizeSession(recordingSessionId);
	},
	{ connection: createConnection(), concurrency },
);

const transcodeWorker = new Worker<TranscodeJob>(
	TRANSCODE_QUEUE,
	async (job: Job<TranscodeJob>) => {
		const { masterKey, targetKey, format } = job.data;
		console.log(
			`[Worker:transcode] picked job ${job.id}: ${masterKey} -> ${targetKey} (${format})`,
		);
		await transcodeToR2(masterKey, targetKey, format as DownloadFormat);
	},
	{ connection: createConnection(), concurrency },
);

for (const [name, worker] of [
	["finalize", finalizeWorker],
	["transcode", transcodeWorker],
] as const) {
	worker.on("completed", (job) =>
		console.log(`[Worker:${name}] completed ${job.id}`, job?.data),
	);
	worker.on("failed", (job, err) =>
		console.error(`[Worker:${name}] failed ${job?.id}:`, job?.data, err),
	);
	worker.on("error", (err) =>
		console.error(`[Worker:${name}] worker error:`, err),
	);
	worker.on("stalled", (jobId) =>
		console.warn(`[Worker:${name}] stalled ${jobId}`),
	);
}

console.log(`[Worker] up - concurrency ${concurrency} per queue.`);
logFfmpegAvailability("Worker");

// Graceful shutdown so in-flight jobs finish (or are re-queued) cleanly.
async function shutdown(signal: string) {
	console.log(`[Worker] ${signal} received, draining…`);
	await Promise.allSettled([finalizeWorker.close(), transcodeWorker.close()]);
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
