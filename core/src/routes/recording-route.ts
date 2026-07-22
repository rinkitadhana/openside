import express from "express";
import {
	createParticipantRecordingController,
	createSegmentController,
	deleteSessionController,
	finalizeSessionController,
	getActiveSessionBySpaceIdController,
	getParticipantRecordingByIdController,
	getRecordingsBySessionIdController,
	getSegmentsByRecordingIdController,
	getSessionByIdController,
	getSessionsBySpaceIdController,
	markRecordingCompleteController,
	presignSegmentUploadController,
	renameSessionController,
	shareSpaceSessionController,
	startSessionController,
	stopSessionController,
	unshareSpaceSessionController,
	updateParticipantRecordingController,
} from "../controllers/recording-controller";
import {
	createScreenCommentController,
	createScreenRecordingController,
	createScreenSegmentController,
	createSharedCommentController,
	deleteScreenCommentController,
	deleteScreenSessionController,
	getScreenOutputUrlController,
	getSharedFinalOutputDownloadController,
	getSharedFinalOutputUrlController,
	getSharedOutputUrlController,
	getSharedRecordingController,
	listScreenCommentsController,
	listScreenRecordingsController,
	listSharedCommentsController,
	markScreenRecordingCompleteController,
	presignScreenSegmentController,
	renameScreenSessionController,
	shareScreenSessionController,
	startScreenSessionController,
	stopScreenSessionController,
	unshareScreenSessionController,
} from "../controllers/screen-recording-controller";
import {
	authMiddleware,
	optionalAuthMiddleware,
} from "../middlewares/auth-middleware";
import { sensitiveLimiter } from "../lib/rate-limit";

const router = express.Router();

// Screen Recorder Routes (single-user, owned by the authenticated user)
router.post(
	"/screen/session/start",
	authMiddleware,
	startScreenSessionController,
);
router.post(
	"/screen/session/:sessionId/stop",
	authMiddleware,
	stopScreenSessionController,
);
router.patch(
	"/screen/:sessionId",
	authMiddleware,
	renameScreenSessionController,
);
router.delete(
	"/screen/:sessionId",
	authMiddleware,
	deleteScreenSessionController,
);
router.post(
	"/screen/recording",
	authMiddleware,
	createScreenRecordingController,
);
router.post(
	"/screen/recording/:recordingId/complete",
	authMiddleware,
	markScreenRecordingCompleteController,
);
router.post(
	"/screen/segment/presign",
	authMiddleware,
	presignScreenSegmentController,
);
router.post("/screen/segment", authMiddleware, createScreenSegmentController);
router.get(
	"/screen/recordings",
	authMiddleware,
	listScreenRecordingsController,
);
router.get(
	"/screen/:sessionId/output/:kind/url",
	authMiddleware,
	getScreenOutputUrlController,
);

// Share links + comments (owner side)
router.post(
	"/screen/:sessionId/share",
	authMiddleware,
	shareScreenSessionController,
);
router.delete(
	"/screen/:sessionId/share",
	authMiddleware,
	unshareScreenSessionController,
);
router.get(
	"/screen/:sessionId/comments",
	authMiddleware,
	listScreenCommentsController,
);
router.post(
	"/screen/:sessionId/comments",
	authMiddleware,
	createScreenCommentController,
);
router.delete(
	"/screen/comment/:commentId",
	authMiddleware,
	deleteScreenCommentController,
);

// PUBLIC share-link routes. Holding the token IS the authorization, so these
// are deliberately unauthenticated; optionalAuth only lets a signed-in visitor
// have their comment attributed to their account.
router.get(
	"/shared/:token",
	optionalAuthMiddleware,
	getSharedRecordingController,
);
router.get(
	"/shared/:token/output/:kind/url",
	optionalAuthMiddleware,
	getSharedOutputUrlController,
);
router.get(
	"/shared/:token/final-output/:outputId/url",
	optionalAuthMiddleware,
	getSharedFinalOutputUrlController,
);
router.get(
	"/shared/:token/final-output/:outputId/download",
	optionalAuthMiddleware,
	getSharedFinalOutputDownloadController,
);
router.get(
	"/shared/:token/comments",
	optionalAuthMiddleware,
	listSharedCommentsController,
);
router.post(
	"/shared/:token/comments",
	sensitiveLimiter,
	optionalAuthMiddleware,
	createSharedCommentController,
);

// RecordingSession Routes
router.post("/session/start", authMiddleware, startSessionController);
router.post(
	"/session/:sessionId/share",
	authMiddleware,
	shareSpaceSessionController,
);
router.delete(
	"/session/:sessionId/share",
	authMiddleware,
	unshareSpaceSessionController,
);
router.post("/session/:sessionId/stop", authMiddleware, stopSessionController);
router.patch("/session/:sessionId", authMiddleware, renameSessionController);
router.delete("/session/:sessionId", authMiddleware, deleteSessionController);
router.get("/session/:sessionId", authMiddleware, getSessionByIdController);
router.get(
	"/space/:spaceId/active-session",
	optionalAuthMiddleware,
	getActiveSessionBySpaceIdController,
);
router.get(
	"/space/:spaceId/sessions",
	authMiddleware,
	getSessionsBySpaceIdController,
);
router.post(
	"/session/:sessionId/finalize",
	authMiddleware,
	finalizeSessionController,
);

// ParticipantRecording Routes
router.post(
	"/participant",
	optionalAuthMiddleware,
	createParticipantRecordingController,
);
router.patch(
	"/participant/:recordingId",
	optionalAuthMiddleware,
	updateParticipantRecordingController,
);
router.get(
	"/participant/:recordingId",
	authMiddleware,
	getParticipantRecordingByIdController,
);
router.get(
	"/session/:sessionId/recordings",
	authMiddleware,
	getRecordingsBySessionIdController,
);
router.post(
	"/participant/:recordingId/complete",
	optionalAuthMiddleware,
	markRecordingCompleteController,
);

// RecordingSegment Routes
router.post(
	"/segment/presign",
	optionalAuthMiddleware,
	presignSegmentUploadController,
);
router.post("/segment", optionalAuthMiddleware, createSegmentController);
router.get(
	"/participant/:recordingId/segments",
	authMiddleware,
	getSegmentsByRecordingIdController,
);

export default router;
