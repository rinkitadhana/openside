import express from "express";
import { livekitWebhookController } from "../controllers/livekit-controller.ts";

const router = express.Router();

// LiveKit posts the webhook as application/webhook+json. We must read the raw
// body (not JSON-parsed) because the WebhookReceiver validates the signature
// against the exact bytes. Accept any content-type to be safe.
router.post("/webhook", express.raw({ type: "*/*" }), livekitWebhookController);

export default router;
