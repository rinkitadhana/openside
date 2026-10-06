/**
 * Media worker process.
 *
 * In the default mode this is a traditional always-on BullMQ consumer. With
 * WORKER_SERVERLESS=true it exposes POST /wake, drains both media queues, then
 * closes every Redis/database connection so Railway can scale it to zero.
 */

import "./lib/load-env.ts";
import { type Server, createServer } from "node:http";
import { type Job, type Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import { prisma } from "./db/index.ts";
import { logFfmpegAvailability } from "./lib/ffmpeg-check.ts";
import {
	FINALIZE_QUEUE,
	type FinalizeJob,
	TRANSCODE_QUEUE,
	type TranscodeJob,
	closeQueueConnections,
	createConnection,
	getFinalizeQueue,
	getTranscodeQueue,
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

const concurrency = Number(process.env.WORKER_CONCURRENCY) || 2;
const serverless = process.env.WORKER_SERVERLESS === "true";
const idleGraceMs = Number(process.env.WORKER_IDLE_GRACE_MS) || 30_000;
const pollIntervalMs = 1000;
const wakeSecret = process.env.WORKER_WAKE_SECRET;

if (serverless && process.env.NODE_ENV === "production" && !wakeSecret) {
	console.error(
		"[Worker] WORKER_WAKE_SECRET is required when WORKER_SERVERLESS=true in production.",
	);
	process.exit(1);
}

async function processFinalizeJob(job: Job<FinalizeJob>): Promise<void> {
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
		session.participantRecordings.map((recording) => ({
			id: recording.id,
			complete: recording.isComplete,
			uploaded: recording.uploadedSegments,
			expected: recording.expectedSegments,
		})),
	);

	if (session.source === "SCREEN_RECORDER") {
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
}

async function processTranscodeJob(job: Job<TranscodeJob>): Promise<void> {
	const { masterKey, targetKey, format } = job.data;
	console.log(
		`[Worker:transcode] picked job ${job.id}: ${masterKey} -> ${targetKey} (${format})`,
	);
	await transcodeToR2(masterKey, targetKey, format as DownloadFormat);
}

interface Consumers {
	workers: Array<Worker<FinalizeJob> | Worker<TranscodeJob>>;
	connections: IORedis[];
}

function attachWorkerLogs(
	name: "finalize" | "transcode",
	worker: Worker<FinalizeJob> | Worker<TranscodeJob>,
): void {
	worker.on("completed", (job) =>
		console.log(`[Worker:${name}] completed ${job.id}`, job.data),
	);
	worker.on("failed", (job, error) =>
		console.error(`[Worker:${name}] failed ${job?.id}:`, job?.data, error),
	);
	worker.on("error", (error) =>
		console.error(`[Worker:${name}] worker error:`, error),
	);
	worker.on("stalled", (jobId) =>
		console.warn(`[Worker:${name}] stalled ${jobId}`),
	);
}

function createConsumers(): Consumers {
	const finalizeConnection = createConnection();
	const transcodeConnection = createConnection();
	const finalizeWorker = new Worker<FinalizeJob>(
		FINALIZE_QUEUE,
		processFinalizeJob,
		{ connection: finalizeConnection, concurrency },
	);
	const transcodeWorker = new Worker<TranscodeJob>(
		TRANSCODE_QUEUE,
		processTranscodeJob,
		{ connection: transcodeConnection, concurrency },
	);

	attachWorkerLogs("finalize", finalizeWorker);
	attachWorkerLogs("transcode", transcodeWorker);

	return {
		workers: [finalizeWorker, transcodeWorker],
		connections: [finalizeConnection, transcodeConnection],
	};
}

async function closeConsumers(consumers: Consumers): Promise<void> {
	await Promise.allSettled(consumers.workers.map((worker) => worker.close()));
	await Promise.allSettled(
		consumers.connections.map(async (connection) => {
			if (connection.status !== "end") {
				await connection.quit().catch(() => connection.disconnect());
			}
		}),
	);
}

async function pendingCount(
	queue: Queue<FinalizeJob> | Queue<TranscodeJob>,
): Promise<number> {
	const [waiting, active, delayed, prioritized, waitingChildren] =
		await Promise.all([
			queue.getWaitingCount(),
			queue.getActiveCount(),
			queue.getDelayedCount(),
			queue.getPrioritizedCount(),
			queue.getWaitingChildrenCount(),
		]);
	return waiting + active + delayed + prioritized + waitingChildren;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let activeConsumers: Consumers | null = null;
let drainPromise: Promise<void> | null = null;
let wakeRequested = false;
let shuttingDown = false;
let httpServer: Server | null = null;

async function waitUntilQueuesAreQuiet(): Promise<void> {
	const finalizeQueue = getFinalizeQueue();
	const transcodeQueue = getTranscodeQueue();
	let emptySince: number | null = null;

	while (!shuttingDown) {
		const totalPending =
			(await pendingCount(finalizeQueue)) +
			(await pendingCount(transcodeQueue));

		if (totalPending === 0) {
			emptySince ??= Date.now();
			if (Date.now() - emptySince >= idleGraceMs) return;
		} else {
			emptySince = null;
		}

		await delay(pollIntervalMs);
	}
}

async function drainCycle(): Promise<void> {
	console.log("[Worker] wake received; draining media queues.");
	activeConsumers = createConsumers();
	try {
		await waitUntilQueuesAreQuiet();
	} finally {
		const consumers = activeConsumers;
		activeConsumers = null;
		if (consumers) await closeConsumers(consumers);
		await closeQueueConnections();
		await prisma.$disconnect();
	}
	console.log("[Worker] queues idle; outbound connections closed.");
}

function requestDrain(): void {
	wakeRequested = true;
	if (drainPromise) return;

	drainPromise = (async () => {
		while (wakeRequested && !shuttingDown) {
			wakeRequested = false;
			await drainCycle();
		}
	})()
		.catch((error) => console.error("[Worker] drain failed:", error))
		.finally(() => {
			drainPromise = null;
			// Cover a wake arriving between the loop's final check and cleanup.
			if (wakeRequested && !shuttingDown) requestDrain();
		});
}

function isAuthorized(authorization: string | undefined): boolean {
	if (!wakeSecret) return true;
	return authorization === `Bearer ${wakeSecret}`;
}

function startWakeServer(): void {
	const port = Number(process.env.WORKER_PORT || process.env.PORT) || 4001;
	httpServer = createServer((request, response) => {
		if (request.method === "GET" && request.url === "/health") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({ ok: true, draining: Boolean(drainPromise) }),
			);
			return;
		}

		if (request.method === "POST" && request.url === "/wake") {
			if (!isAuthorized(request.headers.authorization)) {
				response.writeHead(401, { "content-type": "application/json" });
				response.end(JSON.stringify({ ok: false }));
				return;
			}

			requestDrain();
			response.writeHead(202, { "content-type": "application/json" });
			response.end(JSON.stringify({ ok: true }));
			return;
		}

		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: false }));
	});

	httpServer.listen(port, "::", () => {
		console.log(`[Worker] serverless wake endpoint listening on port ${port}.`);
	});
}

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[Worker] ${signal} received, draining active work...`);

	const consumers = activeConsumers;
	activeConsumers = null;
	if (consumers) await closeConsumers(consumers);
	await drainPromise?.catch(() => undefined);
	await closeQueueConnections();
	await prisma.$disconnect();
	await new Promise<void>((resolve) => {
		if (!httpServer) return resolve();
		httpServer.close(() => resolve());
	});
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (serverless) {
	startWakeServer();
} else {
	activeConsumers = createConsumers();
	console.log(
		`[Worker] up in always-on mode - concurrency ${concurrency} per queue.`,
	);
}

logFfmpegAvailability("Worker");
