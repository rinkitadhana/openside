/**
 * Entitlements - the single server-side source of truth for what a user's plan
 * allows. EVERY gate (recording start, metering, egress backup, watermark,
 * retention, resolution) reads from getEntitlements. The client is never
 * trusted for plan or remaining minutes.
 *
 * Plans:
 *  - DEMO      free. 15 min lifetime recording credit, watermark, no cloud
 *              backup, 1080p, files auto-delete after 48h.
 *  - SELF_HOST free. User's own LiveKit + R2 keys (Settings). No limits, no
 *              watermark, never metered. Derived: DEMO/PRO user with an
 *              enabled, validated SelfHostConfig.
 *  - PRO       $15/mo on our keys. 20 hrs/month hard cap, 4K, 48kHz,
 *              multitrack, no watermark, cloud backup opt-in per session,
 *              30-day retention.
 */

import { prisma } from "../db/index.ts";

export type EffectivePlan = "demo" | "pro" | "selfhost";

export interface Entitlements {
	plan: EffectivePlan;
	/** Whether recording seconds count against a capped usage period. */
	metered: boolean;
	/** Cap in seconds for the current period (null = unlimited). */
	recordingSecondsLimit: number | null;
	/** When the usage period rolls over (null = never - DEMO credit is lifetime). */
	resetsAt: Date | null;
	/** Burn a watermark into finalized outputs. */
	watermark: boolean;
	/** Whether the per-session cloud-backup opt-in toggle is available. */
	cloudBackupAllowed: boolean;
	/** Max capture resolution (height) the client should record at. */
	maxVideoHeight: number;
	maxAudioSampleRate: number;
	multitrack: boolean;
	/** Hours before recordings are auto-deleted (null = keep forever). */
	retentionHours: number | null;
	/** Max concurrent participants (incl. host) allowed in a Space the user hosts
	 *  (null = unlimited, bounded only by the LiveKit room cap). */
	maxParticipants: number | null;
}

// DO NOT relax the PRO cap, the backup-off default, or the 30-day retention -
// they're what keep infra cost under $10 on a $15 sub.
export const DEMO_RECORDING_SECONDS = 15 * 60;
export const PRO_RECORDING_SECONDS = 20 * 60 * 60;
export const DEMO_RETENTION_HOURS = 48;
export const PRO_RETENTION_HOURS = 30 * 24;
/** Concurrent-participant caps per plan (host counts as one). Self-host is
 *  unlimited (null) - only the LiveKit room cap applies there. */
export const DEMO_MAX_PARTICIPANTS = 2;
export const PRO_MAX_PARTICIPANTS = 5;
/** Warn the client when this little metered credit remains. */
export const LOW_CREDIT_WARNING_SECONDS = 2 * 60;

type UserForEntitlements = {
	id: string;
	plan: "DEMO" | "PRO";
	currentPeriodEnd: Date | null;
	selfHostConfig: { enabled: boolean; lastValidatedAt: Date | null } | null;
};

const USER_SELECT = {
	id: true,
	plan: true,
	currentPeriodEnd: true,
	selfHostConfig: { select: { enabled: true, lastValidatedAt: true } },
} as const;

function isProActive(user: UserForEntitlements): boolean {
	if (user.plan !== "PRO") return false;
	// Canceled subscriptions keep PRO until the paid period lapses. No period end
	// on record (legacy/manual PRO) means no expiry to enforce.
	return !user.currentPeriodEnd || user.currentPeriodEnd.getTime() > Date.now();
}

function buildEntitlements(user: UserForEntitlements): Entitlements {
	const selfHost =
		!!user.selfHostConfig?.enabled && !!user.selfHostConfig.lastValidatedAt;

	if (selfHost) {
		return {
			plan: "selfhost",
			metered: false,
			recordingSecondsLimit: null,
			resetsAt: null,
			watermark: false,
			cloudBackupAllowed: true, // their keys, their bill
			maxVideoHeight: 2160,
			maxAudioSampleRate: 48000,
			multitrack: true,
			retentionHours: null,
			maxParticipants: null,
		};
	}

	if (isProActive(user)) {
		return {
			plan: "pro",
			metered: true,
			recordingSecondsLimit: PRO_RECORDING_SECONDS,
			resetsAt: user.currentPeriodEnd,
			watermark: false,
			cloudBackupAllowed: true, // OFF by default; per-session opt-in
			maxVideoHeight: 2160,
			maxAudioSampleRate: 48000,
			multitrack: true,
			retentionHours: PRO_RETENTION_HOURS,
			maxParticipants: PRO_MAX_PARTICIPANTS,
		};
	}

	return {
		plan: "demo",
		metered: true,
		recordingSecondsLimit: DEMO_RECORDING_SECONDS,
		resetsAt: null,
		watermark: true,
		cloudBackupAllowed: false,
		maxVideoHeight: 1080,
		maxAudioSampleRate: 48000,
		multitrack: false,
		retentionHours: DEMO_RETENTION_HOURS,
		maxParticipants: DEMO_MAX_PARTICIPANTS,
	};
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: USER_SELECT,
	});

	if (!user) {
		throw new Error("USER_NOT_FOUND");
	}

	// Lazily downgrade a lapsed PRO (canceled sub past its period end) so the
	// stored plan converges with reality even if a webhook was missed.
	if (user.plan === "PRO" && !isProActive(user)) {
		await prisma.user
			.update({ where: { id: user.id }, data: { plan: "DEMO" } })
			.catch(() => undefined);
	}

	return buildEntitlements(user);
}

/**
 * Whether a recording session's outputs must carry the DEMO watermark -
 * decided by the OWNER's plan (space host, or the session's user for screen
 * recordings). Fails closed on lookup errors: better an unexpected watermark
 * than a free unwatermarked export.
 */
export async function sessionNeedsWatermark(owner: {
	spaceId: string | null;
	userId: string | null;
}): Promise<boolean> {
	try {
		let ownerUserId = owner.userId;
		if (owner.spaceId) {
			const space = await prisma.space.findUnique({
				where: { id: owner.spaceId },
				select: { hostId: true },
			});
			ownerUserId = space?.hostId ?? null;
		}

		if (!ownerUserId) return true;

		const entitlements = await getEntitlements(ownerUserId);
		return entitlements.watermark;
	} catch (error) {
		console.error(
			"[Entitlements] watermark lookup failed, defaulting on:",
			error,
		);
		return true;
	}
}
