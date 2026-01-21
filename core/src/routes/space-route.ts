import express from "express";
import { authMiddleware } from "../middlewares/auth-middleware";
import {
  createSpaceController,
  updateSpaceController,
  endSpaceController,
  getSpaceByIdController,
  getSpaceByJoinCodeController,
  getUserSpacesController,
} from "../controllers/space-controller";

const router = express.Router();

router.post("/create", authMiddleware, createSpaceController);
router.get("/user", authMiddleware, getUserSpacesController);
router.get("/code/:joinCode", getSpaceByJoinCodeController);
router.patch("/:spaceId", authMiddleware, updateSpaceController);
router.post("/:spaceId/end", authMiddleware, endSpaceController);
router.get("/:spaceId", authMiddleware, getSpaceByIdController);

export default router;

