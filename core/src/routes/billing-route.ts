import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware.ts";
import { authMiddleware } from "../middlewares/auth-middleware.ts";
import { findOrCreateUser } from "../services/auth-service.ts";
import {
	createCustomerPortal,
	createProCheckout,
	processPolarWebhook,
	verifyPolarWebhook,
} from "../services/polar-service.ts";

const router = express.Router();

// NOTE: this router is mounted BEFORE express.json() (see index.ts) because
// signature verification needs the raw body. Non-webhook routes parse JSON via
// the router-level middleware below their raw sibling.

router.post(
	"/webhook",
	express.raw({ type: "*/*", limit: "1mb" }),
	async (req: Request, res: Response): Promise<void> => {
		const rawBody = req.body as Buffer;

		const verified = verifyPolarWebhook({
			rawBody,
			headers: {
				id: req.header("webhook-id") ?? undefined,
				timestamp: req.header("webhook-timestamp") ?? undefined,
				signature: req.header("webhook-signature") ?? undefined,
			},
		});

		if (!verified) {
			res.status(403).json({ success: false, message: "Invalid signature" });
			return;
		}

		try {
			const event = JSON.parse(rawBody.toString("utf8"));
			const deliveryId = req.header("webhook-id") as string;
			await processPolarWebhook(deliveryId, event);
			res.status(200).json({ success: true });
		} catch (error) {
			console.error("[Polar] webhook processing failed:", error);
			// Non-2xx makes Polar retry - the dedupe table keeps retries safe.
			res.status(500).json({ success: false });
		}
	},
);

router.use(express.json());

router.post(
	"/checkout",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const url = await createProCheckout(user);
			res
				.status(200)
				.json({ success: true, data: { url }, message: "Checkout created!" });
		} catch (error) {
			console.error("[Polar] checkout failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to create checkout. Try again in a moment!",
			});
		}
	},
);

router.post(
	"/portal",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response): Promise<void> => {
		try {
			if (!req.user) {
				res.status(401).json({
					success: false,
					data: null,
					message: "Authentication required!",
				});
				return;
			}
			const user = await findOrCreateUser(req.user);
			const url = await createCustomerPortal(user.id);
			res.status(200).json({
				success: true,
				data: { url },
				message: "Portal session created!",
			});
		} catch (error) {
			console.error("[Polar] portal failed:", error);
			res.status(500).json({
				success: false,
				data: null,
				message: "Failed to open the billing portal. Try again in a moment!",
			});
		}
	},
);

export default router;
