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

type MaintenanceTask = {
	name: string;
	intervalMs: number;
	run: () => Promise<unknown>;
	nextRunAt: number;
	running: boolean;
};

const maintenanceTasks: MaintenanceTask[] = [
	{
		name: "LiveKit reconcile sweep",
		intervalMs:
			Number(process.env.LIVEKIT_RECONCILE_INTERVAL_MS) || 5 * 60 * 1000,
		run: reconcileLiveKitState,
		nextRunAt: 0,
		running: false,
	},
	{
		name: "Egress reconcile sweep",
		intervalMs: Number(process.env.EGRESS_POLL_INTERVAL_MS) || 30 * 1000,
		run: reconcilePendingEgress,
		nextRunAt: 0,
		running: false,
	},
	{
		name: "Recording recovery sweep",
		intervalMs: Number(process.env.RECORDING_RECOVERY_INTERVAL_MS) || 60 * 1000,
		run: reconcileStaleRecordingSessions,
		nextRunAt: 0,
		running: false,
	},
	{
		name: "Usage metering sweep",
		intervalMs: Number(process.env.USAGE_SWEEP_INTERVAL_MS) || 60 * 1000,
		run: sweepActiveRecordingUsage,
		nextRunAt: 0,
		running: false,
	},
	{
		name: "Retention sweep",
		intervalMs:
			Number(process.env.RETENTION_SWEEP_INTERVAL_MS) || 15 * 60 * 1000,
		run: sweepExpiredRecordings,
		nextRunAt: 0,
		running: false,
	},
];

// Run housekeeping opportunistically while real traffic is using the API.
// With no HTTP or Socket.IO activity, this creates no timers or outbound
// traffic, allowing Railway Serverless to put the API to sleep.
function runDueMaintenance(): void {
	const now = Date.now();
	for (const task of maintenanceTasks) {
		if (task.running || now < task.nextRunAt) continue;
		task.running = true;
		task.nextRunAt = now + task.intervalMs;
		void task
			.run()
			.catch((error) => console.error(`${task.name} failed:`, error))
			.finally(() => {
				task.running = false;
			});
	}
}

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

app.use((_req, _res, next) => {
	runDueMaintenance();
	next();
});

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

initSocket(httpServer, runDueMaintenance);

httpServer.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT} :D`);
	logFfmpegAvailability("API");
});
