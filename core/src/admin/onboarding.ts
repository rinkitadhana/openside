import { Router } from "express";
import { Prisma, prisma } from "../db/index.ts";
import {
	HEARD_FROM,
	MONTHLY_HOURS,
	ROLES,
	USE_CASES,
} from "../lib/onboarding.ts";
import { daysAgo } from "./util.ts";

export const onboardingAdminRoutes = Router();

const WINDOWS = [7, 30, 90] as const;

type CountRow = { k: string; n: bigint };
type Breakdown = { key: string; count: number; percent: number }[];

/**
 * Every known answer in its list order (zeros included, so the dashboard shows
 * what nobody picked), then any unknown ids, sorted by count. `percent` is of
 * `base`: the people who answered that question.
 */
function breakdown(
	rows: CountRow[],
	known: readonly string[],
	base: number,
): Breakdown {
	const counts = new Map(rows.map((r) => [r.k, Number(r.n)]));
	const keys = [
		...known,
		...[...counts.keys()].filter((k) => !known.includes(k)),
	];
	return keys
		.map((key) => {
			const count = counts.get(key) ?? 0;
			return {
				key,
				count,
				percent: base > 0 ? Math.round((count / base) * 1000) / 10 : 0,
			};
		})
		.sort((a, b) => b.count - a.count);
}

const bucket = (key: string) => {
	const i = (MONTHLY_HOURS as readonly string[]).indexOf(key);
	return i < 0 ? MONTHLY_HOURS.length : i;
};

const texts = (rows: CountRow[]) =>
	rows.map((r) => ({ text: r.k, count: Number(r.n) }));

// GET /onboarding/stats?days=7|30|90 (omit for all time)
// Totals and per-answer counts for the signup onboarding questions, for users
// who signed up in the window. Percentages are of the people who answered each
// question; use cases are multi-select, so those can add up past 100.
onboardingAdminRoutes.get("/onboarding/stats", async (req, res) => {
	const days = Number.parseInt(String(req.query.days), 10);
	const window = (WINDOWS as readonly number[]).includes(days) ? days : null;
	const since = window
		? Prisma.sql`AND "createdAt" >= ${daysAgo(window)}`
		: Prisma.empty;
	// Finished onboarding without skipping.
	const answered = Prisma.sql`onboarding IS NOT NULL AND coalesce((onboarding->>'skipped')::boolean, false) = false ${since}`;

	const single = (field: string) =>
		prisma.$queryRaw<CountRow[]>`
			SELECT onboarding->>${field} AS k, count(*)::bigint AS n FROM "User"
			WHERE ${answered} AND onboarding->>${field} IS NOT NULL
			GROUP BY 1`;
	const otherText = (field: string) =>
		prisma.$queryRaw<CountRow[]>`
			SELECT lower(trim(onboarding->>${field})) AS k, count(*)::bigint AS n FROM "User"
			WHERE ${answered} AND onboarding->>${field} IS NOT NULL
			GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`;

	const [
		[totals],
		heardFrom,
		role,
		monthlyHours,
		useCases,
		heardFromOther,
		roleOther,
	] = await Promise.all([
		prisma.$queryRaw<
			{
				users: bigint;
				answered: bigint;
				skipped: bigint;
				pending: bigint;
				legacy: bigint;
				heard_from: bigint;
				role: bigint;
				use_cases: bigint;
				monthly_hours: bigint;
			}[]
		>`
				SELECT
					count(*)::bigint AS users,
					count(*) FILTER (WHERE onboarding IS NOT NULL AND coalesce((onboarding->>'skipped')::boolean, false) = false)::bigint AS answered,
					count(*) FILTER (WHERE coalesce((onboarding->>'skipped')::boolean, false))::bigint AS skipped,
					count(*) FILTER (WHERE "onboardedAt" IS NULL)::bigint AS pending,
					count(*) FILTER (WHERE "onboardedAt" IS NOT NULL AND onboarding IS NULL)::bigint AS legacy,
					count(*) FILTER (WHERE onboarding->>'heardFrom' IS NOT NULL AND coalesce((onboarding->>'skipped')::boolean, false) = false)::bigint AS heard_from,
					count(*) FILTER (WHERE onboarding->>'role' IS NOT NULL AND coalesce((onboarding->>'skipped')::boolean, false) = false)::bigint AS role,
					count(*) FILTER (WHERE jsonb_array_length(coalesce(onboarding->'useCases', '[]'::jsonb)) > 0 AND coalesce((onboarding->>'skipped')::boolean, false) = false)::bigint AS use_cases,
					count(*) FILTER (WHERE onboarding->>'monthlyHours' IS NOT NULL AND coalesce((onboarding->>'skipped')::boolean, false) = false)::bigint AS monthly_hours
				FROM "User" WHERE true ${since}`,
		single("heardFrom"),
		single("role"),
		single("monthlyHours"),
		prisma.$queryRaw<CountRow[]>`
				SELECT u.k, count(*)::bigint AS n
				FROM "User", jsonb_array_elements_text(coalesce(onboarding->'useCases', '[]'::jsonb)) AS u(k)
				WHERE ${answered}
				GROUP BY 1`,
		otherText("heardFromOther"),
		otherText("roleOther"),
	]);

	const n = (v: bigint | undefined) => Number(v ?? 0);
	const respondents = {
		heardFrom: n(totals?.heard_from),
		role: n(totals?.role),
		useCases: n(totals?.use_cases),
		monthlyHours: n(totals?.monthly_hours),
	};

	res.json({
		windowDays: window,
		totals: {
			users: n(totals?.users),
			answered: n(totals?.answered),
			skipped: n(totals?.skipped),
			pending: n(totals?.pending),
			legacy: n(totals?.legacy),
		},
		respondents,
		heardFrom: breakdown(heardFrom, HEARD_FROM, respondents.heardFrom),
		role: breakdown(role, ROLES, respondents.role),
		useCases: breakdown(useCases, USE_CASES, respondents.useCases),
		// Kept in bucket order (smallest to largest), not sorted by count.
		monthlyHours: breakdown(
			monthlyHours,
			MONTHLY_HOURS,
			respondents.monthlyHours,
		).sort((a, b) => bucket(a.key) - bucket(b.key)),
		other: {
			heardFrom: texts(heardFromOther),
			role: texts(roleOther),
		},
	});
});
