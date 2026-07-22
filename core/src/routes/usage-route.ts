import express from "express";
import {
	getEntitlementsController,
	getUsageController,
	usageHeartbeatController,
} from "../controllers/usage-controller.ts";
import { authMiddleware } from "../middlewares/auth-middleware.ts";

const router = express.Router();

router.get("/", authMiddleware, getUsageController);
router.get("/entitlements", authMiddleware, getEntitlementsController);
router.post("/heartbeat", authMiddleware, usageHeartbeatController);

export default router;
