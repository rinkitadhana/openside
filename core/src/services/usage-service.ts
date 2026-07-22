/**
 * Usage metering - recording seconds per billing period.
 *
 * A usage period row is (userId, periodStart, periodEnd, secondsUsed):
 *  - DEMO: one lifetime row (periodEnd null) - the 15 min credit never resets.
 *  - PRO: rows anchored to the Polar billing anniversary; order.paid /
 *    subscription webhooks advance currentPeriodStart, which rolls usage onto a
 *    fresh row automatically on next write.
 *  - SELF_HOST: never metered, no rows.
 *
 * Seconds are credited by advancing RecordingSession.lastMeteredAt: the client
 * heartbeats while recording, and a server sweep meters every ACTIVE session
 * once a minute - so a crashed tab still counts what actually ran, and the cap
 * is enforced even with no client alive.
 */

import { prisma } from "../db/index.ts";
import { type Entitlements, getEntitlements } from "./entitlements-service.ts";
import {
	stopRecordingSession,
	stopScreenRecordingSession,
} from "./recording-service.ts";

/** DEMO's lifetime credit lives on a single fixed-anchor row. */
const LIFETIME_PERIOD_START = new Date(0);

export interface UsageSnapshot {
	plan: Entitlements["plan"];
	used: number;
	limit: number | null;
	remaining: number | null;
	resetsAt: Date | null;
	exhausted: boolean;
}

function currentPeriodBounds(
	entitlements: Entitlements,
	billing: { currentPeriodStart: Date | null; currentPeriodEnd: Date | null },
): { periodStart: Date; periodEnd: Date | null } {
	if (entitlements.plan === "pro" && billing.currentPeriodStart) {
		return {
			periodStart: billing.currentPeriodStart,
			periodEnd: billing.currentPeriodEnd,
		};
	}

	if (entitlements.plan === "pro") {
		// PRO without Polar period data (shouldn't happen - webhooks set it).
		// Fall back to calendar months so the cap still applies.
		const now = new Date();
		return {
			periodStart: new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
			),
			periodEnd: new Date(
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
			),
		};
	}

	return { periodStart: LIFETIME_PERIOD_START, periodEnd: null };
}

async function getOrCreateCurrentPeriod(
	userId: string,
	entitlements: Entitlements,
) {
	const billing = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { currentPeriodStart: true, currentPeriodEnd: true },
	});

	const { periodStart, periodEnd } = currentPeriodBounds(entitlements, billing);

	return await prisma.usagePeriod.upsert({
		where: { userId_periodStart: { userId, periodStart } },
		update: {},
		create: { userId, periodStart, periodEnd, secondsUsed: 0 },
	});
}

function toSnapshot(
	entitlements: Entitlements,
	secondsUsed: number,
): UsageSnapshot {
	const limit = entitlements.recordingSecondsLimit;
	const remaining = limit === null ? null : Math.max(0, limit - secondsUsed);

	return {
		plan: entitlements.plan,
		used: secondsUsed,
		limit,
		remaining,
		resetsAt: entitlements.resetsAt,
		exhausted: remaining !== null && remaining <= 0,
	};
}

export async function getUsage(userId: string): Promise<UsageSnapshot> {
	const entitlements = await getEntitlements(userId);

	if (!entitlements.metered) {
		return toSnapshot(entitlements, 0);
	}

	const period = await getOrCreateCurrentPeriod(userId, entitlements);
	return toSnapshot(entitlements, period.secondsUsed);
}

/** The user whose credit a recording session burns (space host or owner). */
export async function resolveSessionOwner(session: {
	spaceId: string | null;
	userId: string | null;
}): Promise<string | null> {
	if (session.spaceId) {
		const space = await prisma.space.findUnique({
			where: { id: session.spaceId },
			select: { hostId: true },
		});
		return space?.hostId ?? null;
	}

	return session.userId;
}

/**
 * Gate for starting a recording: throws USAGE_EXHAUSTED when the owner's
 * metered credit is spent. Returns the owner's entitlements for further gating
 * (cloud backup, etc.).
 */
export async function assertCanRecord(
	ownerUserId: string,
): Promise<Entitlements> {
	const entitlements = await getEntitlements(ownerUserId);
	if (!entitlements.metered) return entitlements;

	const usage = await getUsage(ownerUserId);
	if (usage.exhausted) {
		throw new Error("USAGE_EXHAUSTED");
	}

	return entitlements;
}

type MeterableSession = {
	id: string;
	source: "SPACE" | "SCREEN_RECORDER";
	spaceId: string | null;
	userId: string | null;
	status: string;
	startedAt: Date;
	lastMeteredAt: Date | null;
};

const METER_SESSION_SELECT = {
	id: true,
	source: true,
	spaceId: true,
	userId: true,
	status: true,
	startedAt: true,
	lastMeteredAt: true,
} as const;

/**
 * Credit the elapsed recording time since the last meter tick to the owner's
 * current usage period. Returns the owner's usage snapshot (null when the
 * session isn't metered - self-host or unresolvable owner).
 */
export async function meterSession(
	session: MeterableSession,
	now: Date = new Date(),
): Promise<UsageSnapshot | null> {
	// Owner + space liveness in one lookup. A SPACE session whose space is no
	// longer LIVE is an orphan (its end path failed to stop it) - never credit
	// its wall-clock time; the sweep stops it.
	let ownerUserId: string | null;
	let creditable = true;
	if (session.spaceId) {
		const space = await prisma.space.findUnique({
			where: { id: session.spaceId },
			select: { hostId: true, status: true },
		});
		ownerUserId = space?.hostId ?? null;
		creditable = space?.status === "LIVE";
	} else {
		ownerUserId = session.userId;
	}
	if (!ownerUserId) return null;

	const entitlements = await getEntitlements(ownerUserId);
	if (!entitlements.metered) return null;

	const from = session.lastMeteredAt ?? session.startedAt;
	const deltaSeconds = Math.floor((now.getTime() - from.getTime()) / 1000);

	const period = await getOrCreateCurrentPeriod(ownerUserId, entitlements);

	if (deltaSeconds <= 0 || session.status !== "ACTIVE" || !creditable) {
		return toSnapshot(entitlements, period.secondsUsed);
	}

	// Claim the stretch first, conditional on lastMeteredAt being unchanged: a
	// concurrent meter (client heartbeat racing the server sweep) then claims
	// nothing and the delta can never be credited twice.
	const claimed = await prisma.recordingSession.updateMany({
		where: {
			id: session.id,
			status: "ACTIVE",
			lastMeteredAt: session.lastMeteredAt,
		},
		data: {
			// Advance by whole seconds so sub-second remainders carry forward.
			lastMeteredAt: new Date(from.getTime() + deltaSeconds * 1000),
			meteredSeconds: { increment: deltaSeconds },
		},
	});

	if (claimed.count === 0) {
		return toSnapshot(entitlements, period.secondsUsed);
	}

	const updatedPeriod = await prisma.usagePeriod.update({
		where: { id: period.id },
		data: { secondsUsed: { increment: deltaSeconds } },
	});

	return toSnapshot(entitlements, updatedPeriod.secondsUsed);
}

export async function meterSessionById(
	sessionId: string,
): Promise<UsageSnapshot | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: METER_SESSION_SELECT,
	});

	if (!session) return null;
	return meterSession(session as MeterableSession);
}

/**
 * Stop a session whose owner's credit hit 0 - the recording is stopped but
 * everything captured so far is SAVED (chunks are already uploaded; stop kicks
 * off normal finalization). The client sees `exhausted` on its next heartbeat
 * and shows the upgrade CTA.
 */
async function stopExhaustedSession(session: MeterableSession): Promise<void> {
	console.warn(
		`[Usage] credit exhausted - stopping session ${session.id} (captured audio/video is kept)`,
	);

	if (session.source === "SCREEN_RECORDER" && session.userId) {
		await stopScreenRecordingSession(session.id, session.userId).catch(
			(error) =>
				console.error(
					`[Usage] failed to stop screen session ${session.id}:`,
					error,
				),
		);
		return;
	}

	await stopRecordingSession(session.id).catch((error) =>
		console.error(`[Usage] failed to stop session ${session.id}:`, error),
	);
}

/**
 * Server-side metering sweep: credit every ACTIVE session's elapsed time and
 * force-stop the ones whose owner ran out of credit. Runs on an interval so
 * crashed tabs still count and the cap holds with no client alive.
 */
export async function sweepActiveRecordingUsage(): Promise<void> {
	const sessions = await prisma.recordingSession.findMany({
		where: { status: "ACTIVE" },
		select: { ...METER_SESSION_SELECT, space: { select: { status: true } } },
		take: 200,
	});

	for (const session of sessions) {
		try {
			// Leak guard: a SPACE session still ACTIVE after its space ended was
			// orphaned by a failed/missed end path. Stop it instead of metering -
			// otherwise it burns the owner's credit at wall-clock rate forever.
			if (session.spaceId && session.space?.status !== "LIVE") {
				console.warn(
					`[Usage] session ${session.id} still ACTIVE but its space is ${session.space?.status ?? "gone"} - stopping orphaned session`,
				);
				await stopRecordingSession(session.id).catch((error) =>
					console.error(
						`[Usage] failed to stop orphaned session ${session.id}:`,
						error,
					),
				);
				continue;
			}

			const usage = await meterSession(session as MeterableSession);
			if (usage?.exhausted) {
				await stopExhaustedSession(session as MeterableSession);
			}
		} catch (error) {
			console.error(`[Usage] metering sweep failed for ${session.id}:`, error);
		}
	}
}

/**
 * Heartbeat entry point: meter, and enforce the cap immediately (stop + save)
 * when credit hits zero mid-recording.
 */
export async function heartbeatSession(
	sessionId: string,
): Promise<UsageSnapshot | null> {
	const session = await prisma.recordingSession.findUnique({
		where: { id: sessionId },
		select: METER_SESSION_SELECT,
	});

	if (!session) return null;

	const usage = await meterSession(session as MeterableSession);
	if (usage?.exhausted && session.status === "ACTIVE") {
		await stopExhaustedSession(session as MeterableSession);
	}

	return usage;
}
