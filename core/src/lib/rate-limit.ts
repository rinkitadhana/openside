/**
 * HTTP rate limiting (express-rate-limit).
 *
 * STORE: if REDIS_URL is set we back the counters with Redis so limits hold
 * across the whole API fleet; otherwise we fall back to the in-memory store
 * (fine for single-instance / local dev, just not shared between instances).
 * This mirrors the queue's graceful-degradation model.
 *
 * PROXY: behind Railway/Cloudflare the real client IP is in X-Forwarded-For, so
 * `trust proxy` must be configured for the per-IP key to be the caller and not
 * the proxy. We trust a fixed hop COUNT (not `true`) so a client can't spoof
 * X-Forwarded-For to dodge the limit. Tune with TRUST_PROXY_HOPS.
 */

import { type Options, rateLimit } from "express-rate-limit";
import IORedis from "ioredis";
import { RedisStore } from "rate-limit-redis";

/** Number of reverse proxies in front of the app (Express `trust proxy`). */
export function getTrustProxyHops(): number {
	const raw = process.env.TRUST_PROXY_HOPS;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	// Default to 1: the typical single platform proxy (Railway/Cloudflare/etc.).
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

// A dedicated Redis connection for the limiter counters. Kept separate from the
// BullMQ connection so limiter traffic never contends with the job queue.
const redisUrl = process.env.REDIS_URL;
const limiterRedis = redisUrl
	? new IORedis(redisUrl, { maxRetriesPerRequest: null })
	: null;

if (limiterRedis) {
	// Don't let a Redis blip crash the API; the limiter degrades to memory.
	limiterRedis.on("error", (err) => {
		console.error("Rate-limit Redis error:", err.message);
	});
}

function buildStore(prefix: string): Options["store"] | undefined {
	if (!limiterRedis) return undefined; // in-memory default
	return new RedisStore({
		prefix: `rl:${prefix}:`,
		sendCommand: (command: string, ...args: string[]) =>
			limiterRedis.call(command, ...args) as never,
	});
}

const jsonMessage = (message: string) => ({ success: false, data: null, message });

/**
 * Build a limiter with a shared (Redis or memory) store. `name` namespaces the
 * Redis keys so different limiters don't share a bucket.
 */
export function createRateLimiter(
	name: string,
	{ windowMs, limit }: { windowMs: number; limit: number },
) {
	return rateLimit({
		windowMs,
		limit,
		standardHeaders: "draft-7",
		legacyHeaders: false,
		store: buildStore(name),
		message: jsonMessage("Too many requests, please slow down and try again."),
	});
}

/**
 * Broad backstop for all authenticated/general API traffic. Generous on
 * purpose - the app polls (transcode status, participant lists), so this only
 * catches runaway/abusive volume, not normal use.
 */
export const apiLimiter = createRateLimiter("api", {
	windowMs: 60_000,
	limit: Number(process.env.RATE_LIMIT_API_PER_MIN) || 600,
});

/**
 * Strict limiter for unauthenticated, abuse-prone endpoints (public join,
 * public comment posting, email-sending invites). Low enough to blunt spam and
 * enumeration, high enough to survive a shared office NAT.
 */
export const sensitiveLimiter = createRateLimiter("sensitive", {
	windowMs: 60_000,
	limit: Number(process.env.RATE_LIMIT_SENSITIVE_PER_MIN) || 20,
});
