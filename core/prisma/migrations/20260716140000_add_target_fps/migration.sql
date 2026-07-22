-- Session-level constant frame rate (CFR normalization target).
--
-- User.targetFps: per-user recording preference (24 or 30) edited in
-- Settings -> Recording; becomes the session target when the user hosts.
-- RecordingSession.targetFps: snapshot of the host's preference at start so
-- every participant's master is normalized to the same constant frame rate.
--
-- Both default to 30 so every existing user and session behaves as "Standard
-- (web)" without a backfill. IF NOT EXISTS because this DB has drifted from
-- migration history via `prisma db push` before - the migration must no-op
-- where the columns already exist while still creating them on fresh/prod DBs.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "targetFps" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "targetFps" INTEGER NOT NULL DEFAULT 30;
