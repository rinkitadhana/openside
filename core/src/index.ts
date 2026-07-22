import "./lib/load-env.ts";
import { createServer } from "node:http";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { logFfmpegAvailability } from "./lib/ffmpeg-check.ts";
import { apiLimiter, getTrustProxyHops } from "./lib/rate-limit.ts";
import authRouter from "./routes/auth-route.ts";
import billingRouter from "./routes/billing-route.ts";
import finalOutputRouter from "./routes/final-output-route.ts";
import livekitRouter from "./routes/livekit-route.ts";
import participantRouter from "./routes/participant-route.ts";
import recordingRouter from "./routes/recording-route.ts";
import settingsRouter from "./routes/settings-route.ts";
import spaceRouter from "./routes/space-route.ts";
import usageRouter from "./routes/usage-route.ts";
import {
	reconcileLiveKitState,
	reconcilePendingEgress,
} from "./services/livekit-webhook-service.ts";
import { reconcileStaleRecordingSessions } from "./services/recording-service.ts";
import { sweepExpiredRecordings } from "./services/retention-service.ts";
import { sweepActiveRecordingUsage } from "./services/usage-service.ts";
import { initSocket } from "./sockets/index.ts";

const app = express();
const PORT = process.env.PORT || 4000;

// Trust a fixed number of proxy hops so req.ip is the real client behind the
// platform proxy - required for the per-IP rate limiter to key on the caller
// rather than the proxy. A hop COUNT (not `true`) keeps X-Forwarded-For
// unspoofable past our own proxies.
app.set("trust proxy", getTrustProxyHops());

// CORS must run before the routers so browser routes (e.g. billing checkout)
// get the headers on their preflight. It doesn't touch the body, so it's safe
// ahead of the raw-body webhook routers below.
app.use(
	cors({
		origin: process.env.WEB_URL || "http://localhost:3000",
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
		allowedHeaders: ["Content-Type", "Authorization"],
		credentials: true,
		optionsSuccessStatus: 204, // for legacy browser support
	}),
);

// LiveKit webhooks must be mounted BEFORE express.json(): the WebhookReceiver
// verifies the signature against the raw request body, so it cannot be parsed.
app.use("/api/livekit", livekitRouter);

// Polar webhooks also verify the signature against the raw body - mount the
// billing router before express.json() too (only its /webhook route uses raw).
app.use("/api/billing", billingRouter);

//middlewares
app.use(express.json());

// Broad per-IP rate-limit backstop for the JSON API. Mounted here so the
// signature-verified webhook routers above (raw body) are never throttled.
app.use("/api", apiLimiter);

//routes
app.get("/", (req: Request, res: Response) => {
	res.send("Openside is live :D");
});
app.use("/api/auth", authRouter);
app.use("/api/recording", recordingRouter);
app.use("/api/space", spaceRouter);
app.use("/api/participant", participantRouter);
app.use("/api/output", finalOutputRouter);
app.use("/api/usage", usageRouter);
app.use("/api/settings", settingsRouter);

const httpServer = createServer(app);

initSocket(httpServer);

// Safety net: periodically reconcile our DB with LiveKit's actual room state in
// case any webhook was missed (server downtime, network blip). Webhooks do the
// real-time work; this just catches drift.
const RECONCILE_INTERVAL_MS =
	Number(process.env.LIVEKIT_RECONCILE_INTERVAL_MS) || 5 * 60 * 1000;

setInterval(() => {
	reconcileLiveKitState().catch((error) => {
		console.error("LiveKit reconcile sweep failed:", error);
	});
}, RECONCILE_INTERVAL_MS).unref();

// Mark per-participant cloud recordings READY even if the egress_ended webhook
// never arrives (e.g. local dev without a public webhook URL). Cheap: only
// queries LiveKit for CLOUD outputs still awaiting their egress.
const EGRESS_POLL_INTERVAL_MS =
	Number(process.env.EGRESS_POLL_INTERVAL_MS) || 30 * 1000;

setInterval(() => {
	reconcilePendingEgress().catch((error) => {
		console.error("Egress reconcile sweep failed:", error);
	});
}, EGRESS_POLL_INTERVAL_MS).unref();

// If a browser crashes or loses network after the host stops recording, some
// participant recordings may never send their final "complete" request. After
// a grace period, mark those tracks terminal so the rest of the session can
// finalize instead of staying stuck forever.
const RECORDING_RECOVERY_INTERVAL_MS =
	Number(process.env.RECORDING_RECOVERY_INTERVAL_MS) || 60 * 1000;

setInterval(() => {
	reconcileStaleRecordingSessions().catch((error) => {
		console.error("Recording recovery sweep failed:", error);
	});
}, RECORDING_RECOVERY_INTERVAL_MS).unref();

// Metering sweep: credit ACTIVE recording sessions and force-stop the ones
// whose owner's credit ran out. The client heartbeat is the fast path; this
// makes crashed tabs still count and keeps the cap enforced server-side.
const USAGE_SWEEP_INTERVAL_MS =
	Number(process.env.USAGE_SWEEP_INTERVAL_MS) || 60 * 1000;

setInterval(() => {
	sweepActiveRecordingUsage().catch((error) => {
		console.error("Usage metering sweep failed:", error);
	});
}, USAGE_SWEEP_INTERVAL_MS).unref();

// Retention sweep: delete recordings past their plan's retention window
// (demo 48h, pro 30 days, self-host never).
const RETENTION_SWEEP_INTERVAL_MS =
	Number(process.env.RETENTION_SWEEP_INTERVAL_MS) || 15 * 60 * 1000;

setInterval(() => {
	sweepExpiredRecordings().catch((error) => {
		console.error("Retention sweep failed:", error);
	});
}, RETENTION_SWEEP_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT} :D`);
	logFfmpegAvailability("API");
});
