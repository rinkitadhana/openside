import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { auditLog, requireAdminKey } from "./auth.ts";
import { billingAdminRoutes } from "./billing.ts";
import { onboardingAdminRoutes } from "./onboarding.ts";
import { queueAdminRoutes } from "./queue.ts";
import { statsAdminRoutes } from "./stats.ts";
import { usersAdminRoutes } from "./users.ts";

/**
 * Admin API, mounted at /admin/v1. Authenticated by one static server-to-server
 * key (see auth.ts) and consumed only by the admin dashboard backend.
 * Accounts, plans, usage, billing, signup onboarding answers and queue health only. Nothing about what
 * people record or host: no recordings, meetings, titles, participants, comments,
 * join codes, share tokens or stored credentials.
 */
export const adminRoutes = Router();

adminRoutes.use(auditLog);
adminRoutes.use(requireAdminKey);
adminRoutes.use((_req, res, next) => {
	res.set("Cache-Control", "no-store");
	next();
});
adminRoutes.use(statsAdminRoutes);
adminRoutes.use(usersAdminRoutes);
adminRoutes.use(onboardingAdminRoutes);
adminRoutes.use(queueAdminRoutes);
adminRoutes.use(billingAdminRoutes);

adminRoutes.use((_req, res) => {
	res.status(404).json({ error: "Not found" });
});

adminRoutes.use(
	(err: unknown, _req: Request, res: Response, _next: NextFunction) => {
		console.error("[admin] error:", err);
		res.status(500).json({ error: "Server error" });
	},
);
