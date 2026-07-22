-- AlterTable: screen-recorder layout config + finalized output keys
ALTER TABLE "RecordingSession"
  ADD COLUMN "composition" JSONB,
  ADD COLUMN "outputs" JSONB;
