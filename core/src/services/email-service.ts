import nodemailer, { type Transporter } from "nodemailer";
import { buildIcs } from "../lib/ics";

// Fallback when the scheduler doesn't pass an explicit meeting length.
const DEFAULT_MEETING_DURATION_MINUTES = 60;

let transporter: Transporter | null = null;

// Build (once) an SMTP transport from env. Returns null when SMTP isn't
// configured so invite sending is skipped instead of crashing the schedule call.
function getTransport(): Transporter | null {
	const host = process.env.SMTP_HOST;
	const user = process.env.SMTP_USER;
	const pass = process.env.SMTP_PASS;
	if (!host || !user || !pass) return null;
	if (!transporter) {
		const port = Number(process.env.SMTP_PORT) || 465;
		transporter = nodemailer.createTransport({
			host,
			port,
			// Port 465 uses implicit TLS (SSL); 587 and others upgrade via STARTTLS.
			secure: port === 465,
			auth: { user, pass },
		});
	}
	return transporter;
}

interface ScheduledInviteParams {
	spaceId: string;
	title: string;
	description?: string | null;
	joinCode: string;
	scheduledFor: Date;
	durationMinutes?: number;
	invitees: string[];
	hostName: string;
	hostEmail?: string | null;
}

function formatWhen(date: Date): string {
	return date.toLocaleString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	});
}

function inviteHtml(params: {
	title: string;
	description?: string | null;
	when: string;
	joinUrl: string;
	hostName: string;
}): string {
	const { title, description, when, joinUrl, hostName } = params;
	return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">${title}</h2>
    <p style="margin:0 0 16px;color:#555">${hostName} invited you to a meeting on Openside.</p>
    ${description ? `<p style="margin:0 0 16px;color:#333">${description}</p>` : ""}
    <p style="margin:0 0 8px"><strong>When:</strong> ${when}</p>
    <a href="${joinUrl}" style="display:inline-block;margin-top:12px;background:#15803d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Join space</a>
    <p style="margin:16px 0 0;color:#888;font-size:13px">Or paste this link: <br/>${joinUrl}</p>
    <p style="margin:16px 0 0;color:#aaa;font-size:12px">A calendar invite (.ics) is attached.</p>
  </div>`;
}

/**
 * Email each invitee a meeting invite with a join link and an .ics attachment.
 * Best-effort and non-fatal: if SMTP isn't configured (no SMTP_* vars) or a
 * send fails, we log and move on so scheduling the meeting still succeeds. The
 * .ics attachment lets recipients add it to any calendar (Google/Apple/Outlook).
 */
export async function sendScheduledInvites(
	params: ScheduledInviteParams,
): Promise<{ sent: number; skipped: boolean }> {
	const invitees = params.invitees.filter((email) => email?.includes("@"));
	if (invitees.length === 0) {
		return { sent: 0, skipped: true };
	}

	const transport = getTransport();
	const from = process.env.EMAIL_FROM;

	if (!transport || !from) {
		console.warn(
			"[email] SMTP_* or EMAIL_FROM not set - skipping invite emails.",
		);
		return { sent: 0, skipped: true };
	}

	const webUrl = (process.env.WEB_URL ?? "").replace(/\/$/, "");
	const joinUrl = `${webUrl}/${params.joinCode}`;
	const start = params.scheduledFor;
	const durationMs =
		(params.durationMinutes ?? DEFAULT_MEETING_DURATION_MINUTES) * 60 * 1000;
	const end = new Date(start.getTime() + durationMs);
	const when = formatWhen(start);

	const ics = buildIcs({
		uid: `${params.spaceId}@openside`,
		title: params.title,
		description: params.description ?? undefined,
		start,
		end,
		url: joinUrl,
		organizerName: params.hostName,
		organizerEmail: params.hostEmail ?? undefined,
	});

	const icsBase64 = Buffer.from(ics, "utf-8").toString("base64");
	const html = inviteHtml({
		title: params.title,
		description: params.description,
		when,
		joinUrl,
		hostName: params.hostName,
	});

	let sent = 0;
	await Promise.all(
		invitees.map(async (to) => {
			try {
				// nodemailer rejects the promise on a failed send, so a thrown error
				// (bad auth, recipient refused, etc.) lands in the catch below and is
				// never miscounted as sent.
				await transport.sendMail({
					from,
					to,
					subject: `Invite: ${params.title} - ${when}`,
					html,
					attachments: [
						{
							filename: "invite.ics",
							content: icsBase64,
							encoding: "base64",
							contentType: "text/calendar; method=REQUEST",
						},
					],
				});
				sent += 1;
			} catch (error) {
				console.error(`[email] Failed to send invite to ${to}:`, error);
			}
		}),
	);

	return { sent, skipped: false };
}

interface SpaceInviteParams {
	to: string;
	title: string;
	description?: string | null;
	joinCode: string;
	hostName: string;
}

function liveInviteHtml(params: {
	title: string;
	description?: string | null;
	joinUrl: string;
	hostName: string;
}): string {
	const { title, description, joinUrl, hostName } = params;
	return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">${title}</h2>
    <p style="margin:0 0 16px;color:#555">${hostName} invited you to join a meeting on Openside.</p>
    ${description ? `<p style="margin:0 0 16px;color:#333">${description}</p>` : ""}
    <a href="${joinUrl}" style="display:inline-block;margin-top:12px;background:#15803d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Join space</a>
    <p style="margin:16px 0 0;color:#888;font-size:13px">Or paste this link: <br/>${joinUrl}</p>
  </div>`;
}

/**
 * Email a single recipient an invite to join a space right now (no scheduled
 * time, no .ics - just a join link). Best-effort: returns { skipped: true }
 * when SMTP isn't configured, and throws only on a genuine send failure so the
 * caller can surface an error to the host.
 */
export async function sendSpaceInvite(
	params: SpaceInviteParams,
): Promise<{ sent: number; skipped: boolean }> {
	const to = params.to.trim().toLowerCase();
	if (!to.includes("@")) {
		return { sent: 0, skipped: true };
	}

	const transport = getTransport();
	const from = process.env.EMAIL_FROM;

	if (!transport || !from) {
		console.warn(
			"[email] SMTP_* or EMAIL_FROM not set - skipping invite email.",
		);
		return { sent: 0, skipped: true };
	}

	const webUrl = (process.env.WEB_URL ?? "").replace(/\/$/, "");
	const joinUrl = `${webUrl}/${params.joinCode}`;
	const html = liveInviteHtml({
		title: params.title,
		description: params.description,
		joinUrl,
		hostName: params.hostName,
	});

	await transport.sendMail({
		from,
		to,
		subject: `${params.hostName} invited you to ${params.title}`,
		html,
	});

	return { sent: 1, skipped: false };
}
