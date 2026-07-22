-- AlterTable: user-provided metadata for recordings (mainly screen recordings)
ALTER TABLE "RecordingSession"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "description" TEXT;
