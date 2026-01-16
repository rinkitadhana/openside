import express from "express";
import { authMiddleware, optionalAuthMiddleware } from "../middlewares/auth-middleware";
import {
  joinSpaceController,
  leaveSpaceController,
  getParticipantsController,
  updateRoleController,
  kickParticipantController,
} from "../controllers/participant-controller";

const router = express.Router();

router.post("/:spaceId/join", optionalAuthMiddleware, joinSpaceController);
router.post("/:spaceId/leave", optionalAuthMiddleware, leaveSpaceController);
router.get("/:spaceId/list", getParticipantsController);
router.patch("/:spaceId/participant/:participantId/role", authMiddleware, updateRoleController);
router.post("/:spaceId/participant/:participantId/kick", authMiddleware, kickParticipantController);

export default router;