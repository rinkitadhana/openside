/**
 * Polar billing. Our DB is the source of truth, driven by webhooks:
 *
 *   subscription.created / .active   -> plan=pro, sync billing period
 *   subscription.updated             -> sync status/period/cancel flag
 *   subscription.canceled            -> keep pro until period end (flag only)
 *   subscription.revoked             -> downgrade immediately
 *   order.paid                       -> renewal: sync the new billing period,
 *                                       which rolls the usage window
 *
 * Webhooks are verified (Standard Webhooks HMAC-SHA256) and idempotent -
 * deliveries dedupe on the webhook-id header via ProcessedWebhookEvent.
 *
 * Env: POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_PRO_PRODUCT_ID,
 *      POLAR_SERVER ("sandbox" | "production", default sandbox).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import axios from "axios";
import { prisma } from "../db/index.ts";

function getPolarApiBase(): string {
	return process.env.POLAR_SERVER === "production"
		? "https://api.polar.sh"
		: "https://sandbox-api.polar.sh";
}

function getPolarAccessToken(): string {
	const token = process.env.POLAR_ACCESS_TOKEN;
	if (!token) throw new Error("POLAR_NOT_CONFIGURED");
	return token;
}

const polarApi = () =>
	axios.create({
		baseURL: `${getPolarApiBase()}/v1`,
		headers: { Authorization: `Bearer ${getPolarAccessToken()}` },
		timeout: 10_000,
	});

// Webhook signature verification (Standard Webhooks spec)

/**
 * Verify a Polar webhook delivery. Signed content is `${id}.${timestamp}.${body}`
 * with HMAC-SHA256 keyed by the base64 secret (after the optional whsec_ prefix).
 * The signature header holds space-separated `v1,<base64>` entries.
 */
export function verifyPolarWebhook(params: {
	rawBody: Buffer;
	headers: {
		id: string | undefined;
		timestamp: string | undefined;
		signature: string | undefined;
	};
}): boolean {
	const secretRaw = process.env.POLAR_WEBHOOK_SECRET;
	const { id, timestamp, signature } = params.headers;
	if (!secretRaw || !id || !timestamp || !signature) return false;

	// The timestamp header must be a valid number, but we don't reject on age:
	// retries and manual redeliveries reuse the original timestamp, so an
	// age-based cutoff would drop legitimate deliveries after a brief outage.
	// Replay is already prevented by the ProcessedWebhookEvent dedupe table.
	if (!Number.isFinite(Number(timestamp))) return false;

	const signedContent = `${id}.${timestamp}.${params.rawBody.toString("utf8")}`;

	// Polar signs with the endpoint's secret, but the key derivation depends on
	// how the endpoint was configured: the Standard Webhooks scheme base64-decodes
	// the secret after stripping the `whsec_` prefix, while a "Raw"-style secret is
	// used as the literal string. Accept a match under any derivation so either
	// configuration verifies.
	const stripped = secretRaw.startsWith("whsec_")
		? secretRaw.slice(6)
		: secretRaw;
	const keyCandidates = [
		Buffer.from(secretRaw, "utf8"), // raw secret string, prefix included
		Buffer.from(stripped, "base64"), // Standard Webhooks base64 secret
		Buffer.from(stripped, "utf8"), // raw secret string, prefix stripped
	];

	for (const entry of signature.split(" ")) {
		const [version, sig] = entry.split(",");
		if (version !== "v1" || !sig) continue;
		const candidate = Buffer.from(sig, "base64");
		for (const key of keyCandidates) {
			const expected = createHmac("sha256", key).update(signedContent).digest();
			if (
				candidate.length === expected.length &&
				timingSafeEqual(candidate, expected)
			) {
				return true;
			}
		}
	}

	return false;
}

// Webhook event handling

interface PolarSubscription {
	id: string;
	status: string;
	customer_id?: string;
	current_period_start?: string | null;
	current_period_end?: string | null;
	cancel_at_period_end?: boolean;
	metadata?: Record<string, unknown>;
	customer?: { id?: string; email?: string; external_id?: string | null };
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/**
 * Resolve which of our users a Polar object belongs to. Preference order:
 * checkout metadata.userId -> customer external_id (we set it to user.id) ->
 * previously stored polarCustomerId -> customer email.
 */
async function resolveUserForSubscription(sub: PolarSubscription) {
	const metadataUserId =
		typeof sub.metadata?.userId === "string" ? sub.metadata.userId : null;
	if (metadataUserId) {
		const user = await prisma.user.findUnique({
			where: { id: metadataUserId },
		});
		if (user) return user;
	}

	const externalId = sub.customer?.external_id;
	if (externalId) {
		const user = await prisma.user.findUnique({ where: { id: externalId } });
		if (user) return user;
	}

	const customerId = sub.customer_id ?? sub.customer?.id;
	if (customerId) {
		const user = await prisma.user.findUnique({
			where: { polarCustomerId: customerId },
		});
		if (user) return user;
	}

	const email = sub.customer?.email;
	if (email) {
		const user = await prisma.user.findUnique({ where: { email } });
		if (user) return user;
	}

	return null;
}

function subscriptionBillingFields(sub: PolarSubscription) {
	return {
		polarSubscriptionId: sub.id,
		polarCustomerId: sub.customer_id ?? sub.customer?.id ?? undefined,
		subscriptionStatus: sub.status,
		currentPeriodStart: sub.current_period_start
			? new Date(sub.current_period_start)
			: null,
		currentPeriodEnd: sub.current_period_end
			? new Date(sub.current_period_end)
			: null,
		cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
	};
}

async function applySubscription(sub: PolarSubscription, eventType: string) {
	const user = await resolveUserForSubscription(sub);
	if (!user) {
		console.error(
			`[Polar] ${eventType}: could not match subscription ${sub.id} to a user`,
		);
		return;
	}

	if (eventType === "subscription.revoked") {
		// Access ends NOW (refund/chargeback/failed payment past dunning).
		await prisma.user.update({
			where: { id: user.id },
			data: {
				plan: "DEMO",
				subscriptionStatus: sub.status,
				cancelAtPeriodEnd: false,
			},
		});
		console.log(`[Polar] revoked - ${user.id} downgraded to DEMO`);
		return;
	}

	const isActive = ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status);
	// "canceled" keeps PRO until the paid period lapses - the entitlements layer
	// downgrades once currentPeriodEnd passes. Never flip plan early here.
	const keepsAccessUntilPeriodEnd =
		sub.cancel_at_period_end === true || sub.status === "canceled";

	await prisma.user.update({
		where: { id: user.id },
		data: {
			...subscriptionBillingFields(sub),
			...(isActive || keepsAccessUntilPeriodEnd ? { plan: "PRO" } : {}),
		},
	});

	console.log(
		`[Polar] ${eventType} - user ${user.id} status=${sub.status} periodEnd=${sub.current_period_end}`,
	);
}

interface PolarWebhookEvent {
	type: string;
	data: Record<string, unknown>;
}

/**
 * Process one verified webhook delivery, exactly once. Returns false when this
 * delivery id was already processed (caller should still 200).
 */
export async function processPolarWebhook(
	deliveryId: string,
	event: PolarWebhookEvent,
): Promise<boolean> {
	try {
		await prisma.processedWebhookEvent.create({
			data: { id: deliveryId, type: event.type },
		});
	} catch (error) {
		// Unique violation -> redelivery of an event we already handled.
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: string }).code === "P2002"
		) {
			return false;
		}
		throw error;
	}

	switch (event.type) {
		case "subscription.created":
		case "subscription.active":
		case "subscription.updated":
		case "subscription.uncanceled":
		case "subscription.canceled":
		case "subscription.revoked":
			await applySubscription(
				event.data as unknown as PolarSubscription,
				event.type,
			);
			break;

		case "order.paid": {
			// Renewal payment: the embedded subscription carries the NEW billing
			// period; syncing it rolls the usage window onto a fresh period row.
			const order = event.data as { subscription?: PolarSubscription };
			if (order.subscription) {
				await applySubscription(order.subscription, event.type);
			}
			break;
		}

		default:
			// Ignore everything else (still recorded for dedupe).
			break;
	}

	return true;
}

// Checkout + customer portal

/** Create a Polar checkout for the Pro plan; returns the hosted checkout URL. */
export async function createProCheckout(user: {
	id: string;
	email: string;
}): Promise<string> {
	const productId = process.env.POLAR_PRO_PRODUCT_ID;
	if (!productId) throw new Error("POLAR_NOT_CONFIGURED");

	const successUrl = `${process.env.WEB_URL || "http://localhost:3000"}/dashboard/settings?checkout=success`;

	// Trailing slash is required - Polar 307-redirects /checkouts to /checkouts/,
	// and the redirect drops the authed POST body.
	const { data } = await polarApi().post("/checkouts/", {
		products: [productId],
		external_customer_id: user.id,
		customer_email: user.email,
		metadata: { userId: user.id },
		success_url: successUrl,
	});

	if (!data?.url) throw new Error("POLAR_CHECKOUT_FAILED");
	return data.url as string;
}

/** Customer portal URL (manage/cancel subscription, invoices). */
export async function createCustomerPortal(userId: string): Promise<string> {
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { id: true, polarCustomerId: true },
	});

	// Trailing slash required (see checkout note) - avoids Polar's 307 redirect.
	const { data } = await polarApi().post("/customer-sessions/", {
		...(user.polarCustomerId
			? { customer_id: user.polarCustomerId }
			: { external_customer_id: user.id }),
	});

	if (!data?.customer_portal_url) throw new Error("POLAR_PORTAL_FAILED");
	return data.customer_portal_url as string;
}
