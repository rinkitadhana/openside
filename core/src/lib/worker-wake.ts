const wakeUrl = process.env.WORKER_WAKE_URL?.replace(/\/$/, "");
const wakeSecret = process.env.WORKER_WAKE_SECRET;

const RETRY_DELAYS_MS = [0, 250, 500, 1000, 2000];
const REQUEST_TIMEOUT_MS = 10_000;

let warnedMissingUrl = false;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wake the media worker after a job has been durably added to Redis.
 *
 * Railway may return a transient 502 while restoring a sleeping service, so
 * cold-start failures are retried. A wake failure never removes the queued job;
 * it remains in Redis for the next wake/recovery attempt.
 */
export async function wakeMediaWorker(): Promise<void> {
	if (!wakeUrl) {
		if (!warnedMissingUrl) {
			warnedMissingUrl = true;
			console.warn(
				"[WorkerWake] WORKER_WAKE_URL is not set; assuming an always-on worker.",
			);
		}
		return;
	}

	let lastError: unknown;
	for (const retryDelay of RETRY_DELAYS_MS) {
		if (retryDelay > 0) await delay(retryDelay);

		try {
			const response = await fetch(`${wakeUrl}/wake`, {
				method: "POST",
				headers: wakeSecret
					? { authorization: `Bearer ${wakeSecret}` }
					: undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});

			if (response.ok) return;

			const message = `worker wake returned ${response.status}`;
			if (response.status === 401 || response.status === 403) {
				throw new Error(`${message}; check WORKER_WAKE_SECRET`);
			}
			lastError = new Error(message);
		} catch (error) {
			lastError = error;
			if (
				error instanceof Error &&
				error.message.includes("WORKER_WAKE_SECRET")
			) {
				break;
			}
		}
	}

	console.error(
		"[WorkerWake] queued job is waiting, but the worker could not be woken:",
		lastError,
	);
}
