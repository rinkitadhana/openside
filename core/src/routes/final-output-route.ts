import express from "express";
import {
	createFinalOutputController,
	createRenditionController,
	deleteFinalOutputController,
	deleteRenditionController,
	getDownloadUrlController,
	getFinalOutputByIdController,
	getFinalOutputsBySessionIdController,
	getFinalOutputsBySpaceIdController,
	getRenditionsByOutputIdController,
	updateFinalOutputController,
	updateRenditionController,
} from "../controllers/final-output-controller";
import { authMiddleware } from "../middlewares/auth-middleware";

const router = express.Router();

// FinalOutput Routes
router.post("/", authMiddleware, createFinalOutputController);
router.patch("/:outputId", authMiddleware, updateFinalOutputController);
router.get("/:outputId", authMiddleware, getFinalOutputByIdController);
router.delete("/:outputId", authMiddleware, deleteFinalOutputController);
router.get(
	"/session/:sessionId",
	authMiddleware,
	getFinalOutputsBySessionIdController,
);
router.get(
	"/space/:spaceId",
	authMiddleware,
	getFinalOutputsBySpaceIdController,
);
router.get("/:outputId/download", authMiddleware, getDownloadUrlController);

// Rendition Routes
router.post("/rendition", authMiddleware, createRenditionController);
router.patch(
	"/rendition/:renditionId",
	authMiddleware,
	updateRenditionController,
);
router.get(
	"/:outputId/renditions",
	authMiddleware,
	getRenditionsByOutputIdController,
);
router.delete(
	"/rendition/:renditionId",
	authMiddleware,
	deleteRenditionController,
);

export default router;
