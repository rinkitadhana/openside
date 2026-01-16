import express from "express";
import { authMiddleware, optionalAuthMiddleware } from "../middlewares/auth-middleware";
import {
  startSessionController,
  stopSessionController,
  getSessionByIdController,
  getSessionsBySpaceIdController,
  createParticipantRecordingController,
  updateParticipantRecordingController,
  getParticipantRecordingByIdController,
  getRecordingsBySessionIdController,
  markRecordingCompleteController,
  createSegmentController,
  getSegmentsByRecordingIdController,
} from "../controllers/recording-controller";

const router = express.Router();

// RecordingSession Routes
router.post("/session/start", authMiddleware, startSessionController);
router.post("/session/:sessionId/stop", authMiddleware, stopSessionController);
router.get("/session/:sessionId", authMiddleware, getSessionByIdController);
router.get("/space/:spaceId/sessions", authMiddleware, getSessionsBySpaceIdController);

// ParticipantRecording Routes
router.post("/participant", optionalAuthMiddleware, createParticipantRecordingController);
router.patch("/participant/:recordingId", optionalAuthMiddleware, updateParticipantRecordingController);
router.get("/participant/:recordingId", authMiddleware, getParticipantRecordingByIdController);
router.get("/session/:sessionId/recordings", authMiddleware, getRecordingsBySessionIdController);
router.post("/participant/:recordingId/complete", optionalAuthMiddleware, markRecordingCompleteController);

// RecordingSegment Routes
router.post("/segment", optionalAuthMiddleware, createSegmentController);
router.get("/participant/:recordingId/segments", authMiddleware, getSegmentsByRecordingIdController);

export default router;
