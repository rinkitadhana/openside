-- Public share links for recordings + comments left on them. Every clause is
-- idempotent so this migration is safe to re-run on partially migrated hosts.

ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "RecordingSession" ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "RecordingSession_shareToken_key" ON "RecordingSession"("shareToken");

CREATE TABLE IF NOT EXISTS "RecordingComment" (
    "id" TEXT NOT NULL,
    "recordingSessionId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecordingComment_recordingSessionId_createdAt_idx" ON "RecordingComment"("recordingSessionId", "createdAt");

-- ADD CONSTRAINT has no IF NOT EXISTS, so swallow the duplicate.
DO $$ BEGIN
    ALTER TABLE "RecordingComment"
    ADD CONSTRAINT "RecordingComment_recordingSessionId_fkey" FOREIGN KEY ("recordingSessionId") REFERENCES "RecordingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "RecordingComment"
    ADD CONSTRAINT "RecordingComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
