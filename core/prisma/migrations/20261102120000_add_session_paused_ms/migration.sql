-- Total resumed pause time of a space take (see RecordingSession.pausedMs).
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "pausedMs" INTEGER NOT NULL DEFAULT 0;
