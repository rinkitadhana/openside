import type { Response } from "express";
import { prisma } from "../db/index.ts";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware.ts";
import { findOrCreateUser } from "../services/auth-service.ts";
import {
	LOW_CREDIT_WARNING_SECONDS,
	getEntitlements,
} from "../services/entitlements-service.ts";
import {
	type UsageSnapshot,
	getUsage,
	heartbeatSession,
	resolveSessionOwner,
} from "../services/usage-service.ts";

function serializeUsage(usage: UsageSnapshot) {
	return {
		plan: usage.plan,
		used: usage.used,
		limit: usage.limit,
		remaining: usage.remaining,
		resets_at: usage.resetsAt ? usage.resetsAt.toISOString() : null,
		exhausted: usage.exhausted,
		warning:
			usage.remaining !== null && usage.remaining <= LOW_CREDIT_WARNING_SECONDS,
	};
}

/** GET /api/usage -> { used, limit, remaining, resets_at, plan } */
export async function getUsageController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const usage = await getUsage(user.id);

		res.status(200).json({
			success: true,
			data: serializeUsage(usage),
			message: "Usage retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to load usage: ${errorMessage}!`,
		});
	}
}

/** GET /api/usage/entitlements - plan limits for client-side gating (UI only). */
export async function getEntitlementsController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const user = await findOrCreateUser(req.user);
		const entitlements = await getEntitlements(user.id);

		res.status(200).json({
			success: true,
			data: entitlements,
			message: "Entitlements retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Failed to load entitlements: ${errorMessage}!`,
		});
	}
}

/**
 * POST /api/usage/heartbeat { sessionId }
 *
 * Sent by the recording client every ~15s. Credits elapsed seconds to the
 * owner's usage period and returns the fresh snapshot; when credit hits 0 the
 * session is stopped server-side (captured media is kept) and `exhausted` tells
 * the client to stop, save, and show the upgrade CTA.
 */
export async function usageHeartbeatController(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	try {
		if (!req.user) {
			res.status(401).json({
				success: false,
				data: null,
				message: "Authentication required!",
			});
			return;
		}

		const { sessionId } = req.body;
		if (!sessionId || typeof sessionId !== "string") {
			res.status(400).json({
				success: false,
				data: null,
				message: "Session ID is required!",
			});
			return;
		}

		const session = await prisma.recordingSession.findUnique({
			where: { id: sessionId },
			select: { spaceId: true, userId: true },
		});

		if (!session) {
			res
				.status(404)
				.json({ success: false, data: null, message: "Session not found!" });
			return;
		}

		// Only the user whose credit the session burns may drive its meter.
		const user = await findOrCreateUser(req.user);
		const ownerUserId = await resolveSessionOwner(session);
		if (ownerUserId !== user.id) {
			res
				.status(403)
				.json({ success: false, data: null, message: "Not your session!" });
			return;
		}

		const usage = await heartbeatSession(sessionId);
		if (!usage) {
			// Unmetered (self-host) - nothing to report, nothing to enforce.
			res.status(200).json({
				success: true,
				data: null,
				message: "Session is not metered.",
			});
			return;
		}

		res.status(200).json({
			success: true,
			data: serializeUsage(usage),
			message: "Heartbeat recorded!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		res.status(500).json({
			success: false,
			data: null,
			message: `Heartbeat failed: ${errorMessage}!`,
		});
	}
}
