-- Recording preferences and immutable per-session snapshots. Every clause is
-- idempotent so this migration is safe to re-run on partially migrated hosts.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "videoResolution" INTEGER NOT NULL DEFAULT 2160;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "audioSampleRate" INTEGER NOT NULL DEFAULT 48000;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "noiseSuppression" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "autoGainControl" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "echoCancellation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recordingMode" TEXT NOT NULL DEFAULT 'VIDEO_AND_AUDIO';

ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "videoResolution" INTEGER NOT NULL DEFAULT 2160;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "audioSampleRate" INTEGER NOT NULL DEFAULT 48000;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "noiseSuppression" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "autoGainControl" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "echoCancellation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "recordingMode" TEXT NOT NULL DEFAULT 'VIDEO_AND_AUDIO';
