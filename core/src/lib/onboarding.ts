/**
 * Signup onboarding questions. The client renders these ids; the server only
 * stores answers that are on the list, so the data stays clean for analysis.
 */

export const HEARD_FROM = [
	"google",
	"ai_assistant",
	"x",
	"linkedin",
	"reddit",
	"product_hunt",
	"friend",
	"other",
] as const;

export const ROLES = [
	"podcaster",
	"creator",
	"founder",
	"marketer",
	"educator",
	"developer",
	"agency",
	"other",
] as const;

export const USE_CASES = [
	"podcasts",
	"interviews",
	"video_content",
	"webinars",
	"meetings",
	"tutorials",
	"courses",
	"other",
] as const;

export const MONTHLY_HOURS = [
	"under_2",
	"2_5",
	"5_10",
	"10_20",
	"20_50",
	"50_plus",
] as const;

/** Free-text "Other" answers are capped at this length. */
const OTHER_MAX = 120;

export interface OnboardingAnswers {
	heardFrom: string | null;
	heardFromOther: string | null;
	role: string | null;
	roleOther: string | null;
	useCases: string[];
	monthlyHours: string | null;
	skipped: boolean;
}

const pick = (value: unknown, allowed: readonly string[]): string | null =>
	typeof value === "string" && allowed.includes(value) ? value : null;

const pickMany = (value: unknown, allowed: readonly string[]): string[] =>
	Array.isArray(value)
		? [...new Set(value)].filter(
				(item): item is string =>
					typeof item === "string" && allowed.includes(item),
			)
		: [];

const text = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().slice(0, OTHER_MAX);
	return trimmed || null;
};

/** Keep only known answers; anything else is dropped, never rejected. */
export function sanitizeOnboarding(body: unknown): OnboardingAnswers {
	const input = (body ?? {}) as Record<string, unknown>;
	const heardFrom = pick(input.heardFrom, HEARD_FROM);
	const role = pick(input.role, ROLES);
	return {
		heardFrom,
		heardFromOther: heardFrom === "other" ? text(input.heardFromOther) : null,
		role,
		roleOther: role === "other" ? text(input.roleOther) : null,
		useCases: pickMany(input.useCases, USE_CASES),
		monthlyHours: pick(input.monthlyHours, MONTHLY_HOURS),
		skipped: input.skipped === true,
	};
}
