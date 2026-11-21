/**
 * Entitlements - the single server-side source of truth for what a user's plan
 * allows. EVERY gate (recording start, metering, egress backup, watermark,
 * retention, resolution) reads from getEntitlements. The client is never
 * trusted for plan or remaining minutes.
 *
 * Plans:
 *  - DEMO      free. 15 min lifetime recording credit, watermark, no cloud
 *              backup, no video upload, 720p / 24fps / 44.1kHz,
 *              2 participants, files auto-delete after 48h.
 *  - SELF_HOST free. User's own LiveKit + R2 keys (Settings). No limits, no
 *              watermark, never metered. Derived: DEMO/PRO user with an
 *              enabled, validated SelfHostConfig.
 *  - PRO       $15/mo on our keys. 20 hrs/month hard cap, 4K, 48kHz,
 *              multitrack, no watermark, cloud backup opt-in per session,
 *              30-day retention.
 */

import { prisma } from "../db/index.ts";
import { DEMO_FPS } from "../lib/recording-constants.ts";

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
	/** Max video resolution, as its short side (720 = 720p). Enforced at
	 *  capture AND when masters are encoded. */
	maxVideoHeight: number;
	/** Max frame rate: Spaces clamp to 24/30 below this, the screen recorder
	 *  captures up to it. */
	maxFps: number;
	maxAudioSampleRate: number;
	multitrack: boolean;
	/** Upload an existing video file as a recording (share link, comments). */
	videoUpload: boolean;
	/** Largest video file that can be uploaded, in bytes (0 = no uploads). */
	maxUploadBytes: number;
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
const PRO_RETENTION_HOURS = 30 * 24;
/** Concurrent-participant caps per plan (host counts as one). Self-host is
 *  unlimited (null) - only the LiveKit room cap applies there. */
const DEMO_MAX_PARTICIPANTS = 2;
const PRO_MAX_PARTICIPANTS = 5;
/** Upload size caps. Pro is lower: every upload is encoded and stored on our
 *  infra. Self-host files land in the user's own bucket. */
const PRO_MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const SELFHOST_MAX_UPLOAD_BYTES = 5 * 1024 ** 3;
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

/**
 * `selfHosted` pins the infra being judged: true = the user's own keys, false =
 * platform (their paid plan, or DEMO). Omitted/null = the user's current
 * self-host switch.
 */
function buildEntitlements(
	user: UserForEntitlements,
	selfHosted?: boolean | null,
): Entitlements {
	const selfHost =
		selfHosted ??
		(!!user.selfHostConfig?.enabled && !!user.selfHostConfig.lastValidatedAt);

	if (selfHost) {
		return {
			plan: "selfhost",
			metered: false,
			recordingSecondsLimit: null,
			resetsAt: null,
			watermark: false,
			cloudBackupAllowed: true, // their keys, their bill
			maxVideoHeight: 2160,
			maxFps: 60,
			maxAudioSampleRate: 48000,
			multitrack: true,
			videoUpload: true,
			maxUploadBytes: SELFHOST_MAX_UPLOAD_BYTES,
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
			maxFps: 60,
			maxAudioSampleRate: 48000,
			multitrack: true,
			videoUpload: true,
			maxUploadBytes: PRO_MAX_UPLOAD_BYTES,
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
		maxVideoHeight: 720,
		maxFps: DEMO_FPS,
		maxAudioSampleRate: 44100,
		multitrack: false,
		videoUpload: false,
		maxUploadBytes: 0,
		retentionHours: DEMO_RETENTION_HOURS,
		maxParticipants: DEMO_MAX_PARTICIPANTS,
	};
}

/**
 * What the user may do. Pass `selfHosted` to judge a specific space/recording
 * by the infra it was stamped on (see infra-service) rather than the user's
 * current switch - a Pro user can flip between their own keys and ours, and
 * each recording keeps the limits of the side it actually ran on.
 */
export async function getEntitlements(
	userId: string,
	selfHosted?: boolean | null,
): Promise<Entitlements> {
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

	return buildEntitlements(user, selfHosted);
}

/** Whether the user has a live Pro subscription, regardless of self-host. */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: USER_SELECT,
	});
	return !!user && isProActive(user);
}

/** What finalization must enforce on a session's outputs. */
export interface SessionOutputLimits {
	watermark: boolean;
	/** Plan resolution ceiling (short side) - also binds screen shares, which
	 *  the host's camera preference doesn't. */
	maxVideoHeight: number;
}

/** The strictest plan's limits - used when the owner can't be resolved. */
const FAIL_CLOSED_LIMITS: SessionOutputLimits = {
	watermark: true,
	maxVideoHeight: 720,
};

/**
 * The output limits of a recording session - decided by the OWNER's plan
 * (space host, or the session's user for screen recordings) on the infra the
 * session ran on. Fails closed on lookup errors: better an unexpected
 * watermark or a smaller file than a free export beyond the plan.
 */
export async function sessionOutputLimits(owner: {
	spaceId: string | null;
	userId: string | null;
	selfHosted?: boolean | null;
}): Promise<SessionOutputLimits> {
	try {
		let ownerUserId = owner.userId;
		if (owner.spaceId) {
			const space = await prisma.space.findUnique({
				where: { id: owner.spaceId },
				select: { hostId: true },
			});
			ownerUserId = space?.hostId ?? null;
		}

		if (!ownerUserId) return FAIL_CLOSED_LIMITS;

		const entitlements = await getEntitlements(ownerUserId, owner.selfHosted);
		return {
			watermark: entitlements.watermark,
			maxVideoHeight: entitlements.maxVideoHeight,
		};
	} catch (error) {
		console.error(
			"[Entitlements] output-limit lookup failed, using the strictest plan:",
			error,
		);
		return FAIL_CLOSED_LIMITS;
	}
}

/** Whether a recording session's outputs must carry the DEMO watermark. */
export async function sessionNeedsWatermark(owner: {
	spaceId: string | null;
	userId: string | null;
	selfHosted?: boolean | null;
}): Promise<boolean> {
	return (await sessionOutputLimits(owner)).watermark;
}
