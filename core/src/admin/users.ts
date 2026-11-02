import { Router } from "express";
import { Prisma, prisma } from "../db/index.ts";
import {
	HEARD_FROM,
	MONTHLY_HOURS,
	ROLES,
	USE_CASES,
} from "../lib/onboarding.ts";
import {
	DEMO_RECORDING_SECONDS,
	PRO_RECORDING_SECONDS,
} from "../services/entitlements-service.ts";
import { purgeRecordingSessionCascade } from "../services/recording-service.ts";
import { deleteSpace } from "../services/space-service.ts";
import { deleteObjects } from "../services/storage-service.ts";
import {
	hasCursor,
	keysetPage,
	keysetWhere,
	limitOf,
	offsetOf,
	str,
} from "./util.ts";

export const usersAdminRoutes = Router();

const SELF_HOST: Prisma.UserWhereInput = {
	selfHostConfig: { is: { enabled: true, lastValidatedAt: { not: null } } },
};
const proActive = (): Prisma.UserWhereInput => ({
	plan: "PRO",
	OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
});

type UserRow = {
	id: string;
	name: string;
	email: string;
	avatar: string | null;
	plan: "DEMO" | "PRO";
	subscriptionStatus: string | null;
	polarSubscriptionId: string | null;
	cancelAtPeriodEnd: boolean;
	currentPeriodEnd: Date | null;
	createdAt: Date;
	onboardedAt: Date | null;
	onboarding: Prisma.JsonValue;
	selfHostConfig: { enabled: boolean; lastValidatedAt: Date | null } | null;
};

const USER_SELECT = {
	id: true,
	name: true,
	email: true,
	avatar: true,
	plan: true,
	subscriptionStatus: true,
	polarSubscriptionId: true,
	cancelAtPeriodEnd: true,
	currentPeriodEnd: true,
	createdAt: true,
	onboardedAt: true,
	onboarding: true,
	selfHostConfig: { select: { enabled: true, lastValidatedAt: true } },
} satisfies Prisma.UserSelect;

/**
 * Signup onboarding answers, plus flat "question:answer" tags for filtering
 * (e.g. "heardFrom:google", "useCase:podcasts"). Accounts from before
 * onboarding have onboardedAt set but no answers.
 */
function onboardingOf(u: UserRow) {
	const raw = (
		u.onboarding &&
		typeof u.onboarding === "object" &&
		!Array.isArray(u.onboarding)
			? u.onboarding
			: {}
	) as Record<string, unknown>;
	const one = (value: unknown) => (typeof value === "string" ? value : null);
	const many = (value: unknown) =>
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	const answers = {
		completedAt: u.onboardedAt,
		answered: u.onboarding !== null,
		heardFrom: one(raw.heardFrom),
		heardFromOther: one(raw.heardFromOther),
		role: one(raw.role),
		roleOther: one(raw.roleOther),
		useCases: many(raw.useCases),
		monthlyHours: one(raw.monthlyHours),
	};
	const tags = [
		answers.heardFrom && `heardFrom:${answers.heardFrom}`,
		answers.role && `role:${answers.role}`,
		...answers.useCases.map((useCase) => `useCase:${useCase}`),
		answers.monthlyHours && `monthlyHours:${answers.monthlyHours}`,
	].filter((tag): tag is string => !!tag);
	return { onboarding: answers, tags };
}

const listed = <T extends string>(value: string, allowed: readonly T[]) =>
	(allowed as readonly string[]).includes(value) ? (value as T) : null;

/** ?heardFrom=&role=&useCase=&monthlyHours=&onboarded=answered|pending|none */
function onboardingFilters(query: Record<string, unknown>) {
	const and: Prisma.UserWhereInput[] = [];
	const heardFrom = listed(str(query.heardFrom), HEARD_FROM);
	if (heardFrom)
		and.push({ onboarding: { path: ["heardFrom"], equals: heardFrom } });
	const role = listed(str(query.role), ROLES);
	if (role) and.push({ onboarding: { path: ["role"], equals: role } });
	const useCase = listed(str(query.useCase), USE_CASES);
	if (useCase)
		and.push({ onboarding: { path: ["useCases"], array_contains: [useCase] } });
	const monthlyHours = listed(str(query.monthlyHours), MONTHLY_HOURS);
	if (monthlyHours)
		and.push({ onboarding: { path: ["monthlyHours"], equals: monthlyHours } });
	const onboarded = str(query.onboarded);
	// answered: filled it in. pending: signed up, hasn't yet. none: from
	// before onboarding existed (marked done, no answers).
	if (onboarded === "answered")
		and.push({ onboarding: { not: Prisma.DbNull } });
	else if (onboarded === "pending") and.push({ onboardedAt: null });
	else if (onboarded === "none")
		and.push({
			onboardedAt: { not: null },
			onboarding: { equals: Prisma.DbNull },
		});
	return and;
}

/** Same rules as the app's entitlements, so the admin sees what the user gets. */
function effectivePlan(u: UserRow): "demo" | "pro" | "selfhost" {
	if (u.selfHostConfig?.enabled && u.selfHostConfig.lastValidatedAt)
		return "selfhost";
	if (
		u.plan === "PRO" &&
		(!u.currentPeriodEnd || u.currentPeriodEnd.getTime() > Date.now())
	)
		return "pro";
	return "demo";
}

const limitFor = (plan: "demo" | "pro" | "selfhost") =>
	plan === "selfhost"
		? null
		: plan === "pro"
			? PRO_RECORDING_SECONDS
			: DEMO_RECORDING_SECONDS;

async function latestUsage(ids: string[]): Promise<Map<string, number>> {
	if (!ids.length) return new Map();
	const rows = await prisma.usagePeriod.findMany({
		where: { userId: { in: ids } },
		orderBy: { periodStart: "desc" },
		select: { userId: true, secondsUsed: true },
	});
	const out = new Map<string, number>();
	for (const r of rows)
		if (!out.has(r.userId)) out.set(r.userId, r.secondsUsed);
	return out;
}

function serialize(u: UserRow, usage: Map<string, number>) {
	const plan = effectivePlan(u);
	return {
		id: u.id,
		name: u.name,
		email: u.email,
		avatar: u.avatar,
		plan,
		storedPlan: u.plan,
		subscriptionStatus: u.subscriptionStatus,
		hasSubscription: !!u.polarSubscriptionId,
		cancelAtPeriodEnd: u.cancelAtPeriodEnd,
		currentPeriodEnd: u.currentPeriodEnd,
		selfHost: plan === "selfhost",
		createdAt: u.createdAt,
		usedSeconds: usage.get(u.id) ?? 0,
		limitSeconds: limitFor(plan),
		...onboardingOf(u),
	};
}

// The onboarding answers a user can have, for building filter controls.
usersAdminRoutes.get("/users/onboarding-options", (_req, res) => {
	res.json({
		heardFrom: HEARD_FROM,
		role: ROLES,
		useCase: USE_CASES,
		monthlyHours: MONTHLY_HOURS,
		onboarded: ["answered", "pending", "none"],
	});
});

// GET /users?q=&plan=all|demo|pro|selfhost&sort=newest|usage&cursor=&limit=
//   &heardFrom=&role=&useCase=&monthlyHours=&onboarded=answered|pending|none
usersAdminRoutes.get("/users", async (req, res) => {
	const q = str(req.query.q);
	const and: Prisma.UserWhereInput[] = [];
	if (q) {
		and.push({
			OR: [
				{ name: { contains: q, mode: "insensitive" } },
				{ email: { contains: q, mode: "insensitive" } },
			],
		});
	}
	const plan = str(req.query.plan);
	if (plan === "selfhost") and.push(SELF_HOST);
	else if (plan === "pro") and.push(proActive(), { NOT: SELF_HOST });
	else if (plan === "demo") and.push({ NOT: SELF_HOST }, { NOT: proActive() });
	and.push(...onboardingFilters(req.query));
	const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};
	const limit = limitOf(req);
	const total = hasCursor(req)
		? undefined
		: req.query.sort === "usage"
			? (
					await prisma.usagePeriod.groupBy({
						by: ["userId"],
						where: { user: where },
					})
				).length
			: await prisma.user.count({ where });

	let rows: UserRow[];
	let nextCursor: string | number | null;
	if (req.query.sort === "usage") {
		// Most recorded time first; only users who recorded appear here.
		const skip = offsetOf(req);
		const grouped = await prisma.usagePeriod.groupBy({
			by: ["userId"],
			where: { user: where },
			_sum: { secondsUsed: true },
			orderBy: { _sum: { secondsUsed: "desc" } },
			skip,
			take: limit + 1,
		});
		const ids = grouped.slice(0, limit).map((g) => g.userId);
		const found = await prisma.user.findMany({
			where: { id: { in: ids } },
			select: USER_SELECT,
		});
		const byId = new Map(found.map((u) => [u.id, u]));
		rows = ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as UserRow] : []));
		nextCursor = grouped.length > limit ? skip + limit : null;
	} else {
		const found = await prisma.user.findMany({
			where: {
				AND: [where, keysetWhere(req, "createdAt") as Prisma.UserWhereInput],
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: limit + 1,
			select: USER_SELECT,
		});
		const paged = keysetPage(found, limit, (u) => u.createdAt);
		rows = paged.page;
		nextCursor = paged.nextCursor;
	}

	const ids = rows.map((r) => r.id);
	const usage = await latestUsage(ids);
	res.json({
		total,
		nextCursor,
		users: rows.map((u) => serialize(u, usage)),
	});
});

usersAdminRoutes.get("/users/:id", async (req, res) => {
	const id = String(req.params.id);
	const user = await prisma.user.findUnique({
		where: { id },
		select: {
			...USER_SELECT,
			usagePeriods: { orderBy: { periodStart: "desc" }, take: 12 },
		},
	});
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return;
	}

	const usage = await latestUsage([id]);

	res.json({
		user: {
			...serialize(user, usage),
			usageHistory: user.usagePeriods.map((p) => ({
				periodStart: p.periodStart.getTime() === 0 ? null : p.periodStart,
				periodEnd: p.periodEnd,
				secondsUsed: p.secondsUsed,
			})),
		},
	});
});

// PATCH /users/:id  { plan?: "DEMO"|"PRO", days?: number|null, resetUsage?: true, creditSeconds?: number }
usersAdminRoutes.patch("/users/:id", async (req, res) => {
	const id = String(req.params.id);
	const body = (req.body ?? {}) as Record<string, unknown>;
	const user = await prisma.user.findUnique({
		where: { id },
		select: {
			id: true,
			plan: true,
			polarSubscriptionId: true,
			currentPeriodStart: true,
			currentPeriodEnd: true,
		},
	});
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return;
	}

	const data: Prisma.UserUpdateInput = {};
	if (body.plan === "DEMO") data.plan = "DEMO";
	else if (body.plan === "PRO") {
		data.plan = "PRO";
		// A paying subscriber's period comes from Polar; a manual grant needs its own end date.
		if (!user.polarSubscriptionId) {
			const days = body.days;
			if (
				days !== null &&
				!(
					typeof days === "number" &&
					Number.isInteger(days) &&
					days >= 1 &&
					days <= 3650
				)
			) {
				res
					.status(400)
					.json({ error: "days must be 1-3650, or null for no expiry" });
				return;
			}
			data.currentPeriodStart = new Date();
			data.currentPeriodEnd =
				days === null
					? null
					: new Date(Date.now() + (days as number) * 86_400_000);
		}
	} else if (body.plan !== undefined) {
		res.status(400).json({ error: "plan must be DEMO or PRO" });
		return;
	}

	const credit = body.creditSeconds;
	const wantsUsage = body.resetUsage === true || credit !== undefined;
	if (
		credit !== undefined &&
		!(
			typeof credit === "number" &&
			Number.isInteger(credit) &&
			Math.abs(credit) <= 360_000
		)
	) {
		res.status(400).json({
			error: "creditSeconds must be a whole number within ±100 hours",
		});
		return;
	}
	if (!Object.keys(data).length && !wantsUsage) {
		res
			.status(400)
			.json({ error: "Nothing to update (plan, resetUsage, creditSeconds)" });
		return;
	}

	if (Object.keys(data).length)
		await prisma.user.update({ where: { id }, data });

	if (wantsUsage) {
		// The row the app currently meters against: newest period, or the lifetime row for DEMO.
		const fresh = await prisma.user.findUniqueOrThrow({
			where: { id },
			select: { plan: true, currentPeriodStart: true, currentPeriodEnd: true },
		});
		const row =
			(await prisma.usagePeriod.findFirst({
				where: { userId: id },
				orderBy: { periodStart: "desc" },
			})) ??
			(await prisma.usagePeriod.create({
				data:
					fresh.plan === "PRO"
						? {
								userId: id,
								periodStart: fresh.currentPeriodStart ?? new Date(),
								periodEnd: fresh.currentPeriodEnd,
								secondsUsed: 0,
							}
						: {
								userId: id,
								periodStart: new Date(0),
								periodEnd: null,
								secondsUsed: 0,
							},
			}));
		// A negative secondsUsed is bonus credit: remaining = limit - used.
		const next =
			body.resetUsage === true ? 0 : row.secondsUsed - (credit as number);
		await prisma.usagePeriod.update({
			where: { id: row.id },
			data: { secondsUsed: next },
		});
	}

	res.json({ ok: true });
});

// DELETE /users/:id: removes the account and everything stored under it.
// Their sign-in account (Clerk) is not touched: logging in again starts a fresh profile.
usersAdminRoutes.delete("/users/:id", async (req, res) => {
	const id = String(req.params.id);
	const user = await prisma.user.findUnique({
		where: { id },
		select: { id: true, avatarKey: true },
	});
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return;
	}

	// Recordings first (rows + stored files), then the spaces that held them.
	const sessions = await prisma.recordingSession.findMany({
		where: { OR: [{ userId: id }, { space: { hostId: id } }] },
		select: { id: true },
	});
	for (const s of sessions) await purgeRecordingSessionCascade(s.id);
	const spaces = await prisma.space.findMany({
		where: { hostId: id },
		select: { id: true },
	});
	for (const s of spaces) await deleteSpace(s.id, id);

	await prisma.$transaction([
		prisma.spaceParticipant.updateMany({
			where: { userId: id },
			data: { userId: null },
		}),
		prisma.recordingComment.deleteMany({ where: { userId: id } }),
		prisma.usagePeriod.deleteMany({ where: { userId: id } }),
		prisma.selfHostConfig.deleteMany({ where: { userId: id } }),
		prisma.user.delete({ where: { id } }),
	]);
	if (user.avatarKey) await deleteObjects([user.avatarKey]).catch(() => {});

	res.json({
		ok: true,
		recordingsDeleted: sessions.length,
		spacesDeleted: spaces.length,
	});
});
