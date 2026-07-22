import { prisma } from "../db/index.ts";
import { getEgressStatus } from "./egress-service.ts";
import {
	listLiveKitParticipantIdentities,
	liveKitRoomExists,
} from "./livekit-service.ts";
import { ensureRecordingController } from "./participant-service.ts";
import { stopActiveSpaceRecordingSessions } from "./recording-service.ts";

/**
 * A participant egress finished. Mark the matching CLOUD FinalOutput READY (or
 * FAILED). We stash the egress id in FinalOutput.processingJobId at start, so we
 * can look the output up here without an extra mapping table.
 */
export async function handleEgressEnded(
	egressId: string | undefined,
	status: string | undefined,
) {
	if (!egressId) return;

	const output = await prisma.finalOutput.findFirst({
		where: { variant: "CLOUD", processingJobId: egressId },
		select: { id: true, status: true },
	});

	if (!output || output.status === "READY") return;

	await prisma.finalOutput.update({
		where: { id: output.id },
		data: {
			status: status && status !== "EGRESS_COMPLETE" ? "FAILED" : "READY",
		},
	});
}

/**
 * Fallback for the egress_ended webhook: poll LiveKit for any CLOUD output still
 * waiting on its egress and resolve it. Makes cloud recording work without a
 * publicly reachable webhook URL (e.g. local dev behind no tunnel).
 */
export async function reconcilePendingEgress() {
	const outputs = await prisma.finalOutput.findMany({
		where: {
			variant: "CLOUD",
			status: { in: ["QUEUED", "PROCESSING"] },
			processingJobId: { not: null },
		},
		select: { id: true, processingJobId: true, spaceId: true },
	});

	if (outputs.length === 0) return;

	for (const output of outputs) {
		const status = await getEgressStatus(
			output.processingJobId,
			output.spaceId,
		);
		if (status === "EGRESS_COMPLETE") {
			await prisma.finalOutput.update({
				where: { id: output.id },
				data: { status: "READY" },
			});
		} else if (status === "EGRESS_FAILED" || status === "NOT_FOUND") {
			await prisma.finalOutput.update({
				where: { id: output.id },
				data: { status: "FAILED" },
			});
		}
	}
}

/**
 * LiveKit is the source of truth for presence. These handlers react to LiveKit
 * webhook events and reconcile our database so it stays in sync regardless of
 * how a participant left (Leave button, tab close, browser crash, network drop)
 * or how a room ended (host action, empty timeout).
 */

// A participant left the room - by any means (Leave, tab close, crash, drop).
export async function handleParticipantLeft(identity: string | undefined) {
	if (!identity) return;

	// Resolve who left before we flip them inactive, so we can hand off recording
	// control if they were the host/co-host.
	const leaver = await prisma.spaceParticipant.findFirst({
		where: { livekitIdentity: identity, isActive: true },
		select: { spaceId: true, role: true },
	});

	await prisma.spaceParticipant.updateMany({
		where: { livekitIdentity: identity, isActive: true },
		data: {
			isActive: false,
			leftAt: new Date(),
			connectionState: "disconnected",
		},
	});

	// If a controller left mid-recording, promote a successor so the recording
	// can still be stopped - we never stop it just because the host dropped.
	if (leaver && (leaver.role === "HOST" || leaver.role === "CO_HOST")) {
		await ensureRecordingController(leaver.spaceId).catch(() => undefined);
	}
}

// A participant (re)connected - repair presence in case the row was stale.
export async function handleParticipantJoined(identity: string | undefined) {
	if (!identity) return;

	await prisma.spaceParticipant.updateMany({
		where: { livekitIdentity: identity },
		data: {
			isActive: true,
			leftAt: null,
			lastConnectedAt: new Date(),
			connectionState: "connected",
		},
	});
}

// The room ended - empty timeout or explicit delete. End the space and clear
// any remaining active participants.
export async function handleRoomFinished(roomName: string | undefined) {
	if (!roomName) return;

	const space = await prisma.space.findUnique({
		where: { livekitRoomName: roomName },
		select: { id: true, status: true, startTime: true },
	});

	if (!space) return;

	if (space.status === "ENDED") {
		// Backstop: an earlier end path may have flipped the space to ENDED
		// without stopping its recording sessions. An orphaned ACTIVE session is
		// billed wall-clock time by the usage sweep, so stop it even here.
		await stopActiveSpaceRecordingSessions(space.id);
		return;
	}

	const endTime = new Date();
	const duration = space.startTime
		? endTime.getTime() - space.startTime.getTime()
		: 0;

	// Sessions still recording when the room ends (host closed everything, or
	// the room was reaped): stop them first - meters the final stretch, shuts
	// down cloud egress and kicks finalization.
	await stopActiveSpaceRecordingSessions(space.id);

	await prisma.$transaction([
		prisma.space.update({
			where: { id: space.id },
			data: {
				status: "ENDED",
				recordingStatus: "STOPPED",
				endTime,
				duration,
				endedReason: "ROOM_FINISHED",
			},
		}),
		prisma.spaceParticipant.updateMany({
			where: { spaceId: space.id, isActive: true },
			data: { isActive: false, leftAt: endTime },
		}),
	]);
}

/**
 * Safety net for missed webhooks (server downtime, network blips). Compares our
 * DB against LiveKit's actual state and fixes drift:
 *  - a LIVE space whose LiveKit room no longer exists  -> mark ENDED
 *  - an active participant no longer in the LiveKit room -> mark left
 */
export async function reconcileLiveKitState() {
	// First, end any LIVE space whose expiry has passed. This keeps records honest
	// even for spaces LiveKit never had (or already reaped) a room for, so users
	// don't see expired meetings lingering as "live".
	const now = new Date();
	const expiredSpaces = await prisma.space.findMany({
		where: { status: "LIVE", expiresAt: { lte: now } },
		select: { id: true },
	});

	if (expiredSpaces.length > 0) {
		const expiredIds = expiredSpaces.map((space) => space.id);

		// Stop in-flight recordings before the spaces flip to ENDED so no session
		// outlives its space and keeps accruing metered usage.
		for (const spaceId of expiredIds) {
			await stopActiveSpaceRecordingSessions(spaceId);
		}

		await prisma.$transaction([
			prisma.space.updateMany({
				where: { id: { in: expiredIds }, status: "LIVE" },
				data: { status: "ENDED", endTime: now, endedReason: "EXPIRED" },
			}),
			prisma.spaceParticipant.updateMany({
				where: { spaceId: { in: expiredIds }, isActive: true },
				data: { isActive: false, leftAt: now },
			}),
		]);
	}

	const liveSpaces = await prisma.space.findMany({
		where: { status: "LIVE", livekitRoomName: { not: null } },
		select: { id: true, livekitRoomName: true, startTime: true },
	});

	if (liveSpaces.length === 0) return;

	for (const space of liveSpaces) {
		const roomName = space.livekitRoomName as string;

		// Room is gone -> space should be ended. Checked per-space (not one bulk
		// list) because self-hosted spaces live on their host's own LiveKit.
		let exists: boolean;
		try {
			exists = await liveKitRoomExists(roomName);
		} catch (error) {
			// Can't reach that LiveKit right now - don't end a space on a blip.
			console.error(`[Reconcile] room check failed for ${roomName}:`, error);
			continue;
		}

		if (!exists) {
			await handleRoomFinished(roomName);
			continue;
		}

		// Room exists -> mark any DB-active participant who isn't actually in it.
		const liveIdentities = await listLiveKitParticipantIdentities(roomName);

		const activeParticipants = await prisma.spaceParticipant.findMany({
			where: {
				spaceId: space.id,
				isActive: true,
				livekitIdentity: { not: null },
			},
			select: { id: true, livekitIdentity: true },
		});

		const staleIds = activeParticipants
			.filter((p) => !liveIdentities.has(p.livekitIdentity as string))
			.map((p) => p.id);

		if (staleIds.length > 0) {
			await prisma.spaceParticipant.updateMany({
				where: { id: { in: staleIds } },
				data: {
					isActive: false,
					leftAt: new Date(),
					connectionState: "disconnected",
				},
			});
			// A host that dropped without a webhook is caught here - make sure an
			// active recording still has a controller. No-op if one remains.
			await ensureRecordingController(space.id).catch(() => undefined);
		}
	}
}
