import express from "express";
import {
	activateSpaceController,
	createSpaceController,
	deleteSpaceController,
	endSpaceController,
	getSpaceByIdController,
	getSpaceByJoinCodeController,
	getUserSpacesController,
	scheduleSpaceController,
	sendSpaceInviteController,
	updateSpaceController,
} from "../controllers/space-controller";
import {
	authMiddleware,
	optionalAuthMiddleware,
} from "../middlewares/auth-middleware";
import { sensitiveLimiter } from "../lib/rate-limit";

const router = express.Router();

router.post("/create", authMiddleware, createSpaceController);
router.post("/schedule", authMiddleware, scheduleSpaceController);
router.get("/user", authMiddleware, getUserSpacesController);
router.get("/code/:joinCode", getSpaceByJoinCodeController);
router.post("/:spaceId/activate", authMiddleware, activateSpaceController);
router.post(
	"/:spaceId/invite",
	sensitiveLimiter,
	authMiddleware,
	sendSpaceInviteController,
);
router.patch("/:spaceId", authMiddleware, updateSpaceController);
router.delete("/:spaceId", authMiddleware, deleteSpaceController);
router.post("/:spaceId/end", optionalAuthMiddleware, endSpaceController);
router.get("/:spaceId", authMiddleware, getSpaceByIdController);

export default router;
