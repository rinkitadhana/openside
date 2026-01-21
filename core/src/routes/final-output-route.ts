import express from "express";
import { authMiddleware } from "../middlewares/auth-middleware";
import {
  createFinalOutputController,
  updateFinalOutputController,
  getFinalOutputByIdController,
  getFinalOutputsBySessionIdController,
  getFinalOutputsBySpaceIdController,
  deleteFinalOutputController,
  createRenditionController,
  updateRenditionController,
  getRenditionsByOutputIdController,
  deleteRenditionController,
} from "../controllers/final-output-controller";

const router = express.Router();

// FinalOutput Routes
router.post("/", authMiddleware, createFinalOutputController);
router.patch("/:outputId", authMiddleware, updateFinalOutputController);
router.get("/:outputId", authMiddleware, getFinalOutputByIdController);
router.delete("/:outputId", authMiddleware, deleteFinalOutputController);
router.get("/session/:sessionId", authMiddleware, getFinalOutputsBySessionIdController);
router.get("/space/:spaceId", authMiddleware, getFinalOutputsBySpaceIdController);

// Rendition Routes
router.post("/rendition", authMiddleware, createRenditionController);
router.patch("/rendition/:renditionId", authMiddleware, updateRenditionController);
router.get("/:outputId/renditions", authMiddleware, getRenditionsByOutputIdController);
router.delete("/rendition/:renditionId", authMiddleware, deleteRenditionController);

export default router;
