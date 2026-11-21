-- Screen sessions made from an uploaded video file (not a live capture).
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "uploaded" BOOLEAN NOT NULL DEFAULT false;

-- Uploads made before this column existed carry the client's upl_ session id.
UPDATE "RecordingSession" SET "uploaded" = true
WHERE "source" = 'SCREEN_RECORDER' AND "spaceRecordingSessionId" LIKE 'upl\_%';
