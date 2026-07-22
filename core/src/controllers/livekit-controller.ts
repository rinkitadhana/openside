import type { Request, Response } from "express";
import { EgressStatus, type WebhookEvent } from "livekit-server-sdk";
import { getWebhookReceiver } from "../services/livekit-service.ts";
import {
	handleEgressEnded,
	handleParticipantJoined,
	handleParticipantLeft,
	handleRoomFinished,
} from "../services/livekit-webhook-service.ts";

export async function livekitWebhookController(
	req: Request,
	res: Response,
): Promise<void> {
	let event: WebhookEvent;

	try {
		const receiver = getWebhookReceiver();
		// req.body is the raw string body (express.raw on this route). The receiver
		// verifies the signature against these exact bytes via the Authorization
		// header, so we never trust an unsigned/forged payload.
		const body =
			typeof req.body === "string"
				? req.body
				: (req.body?.toString("utf8") ?? "");
		event = await receiver.receive(body, req.get("Authorization"));
	} catch (error) {
		console.error("Rejected LiveKit webhook (invalid signature):", error);
		res
			.status(401)
			.json({ success: false, message: "Invalid webhook signature" });
		return;
	}

	try {
		switch (event.event) {
			case "participant_left":
			case "participant_connection_aborted":
				await handleParticipantLeft(event.participant?.identity);
				break;
			case "participant_joined":
				await handleParticipantJoined(event.participant?.identity);
				break;
			case "room_finished":
				await handleRoomFinished(event.room?.name);
				break;
			case "egress_ended": {
				const statusValue = event.egressInfo?.status;
				const statusName =
					typeof statusValue === "number"
						? EgressStatus[statusValue]
						: undefined;
				await handleEgressEnded(event.egressInfo?.egressId, statusName);
				break;
			}
			default:
				// Other events (room_started, track_*, egress_started/updated) need no DB sync.
				break;
		}
	} catch (error) {
		console.error(`Error handling LiveKit webhook "${event.event}":`, error);
		// Swallow: LiveKit retries on non-2xx, but a failed DB write here is caught
		// by the periodic reconcile sweep, so we ack to avoid retry storms.
	}

	res.status(200).json({ success: true });
}
