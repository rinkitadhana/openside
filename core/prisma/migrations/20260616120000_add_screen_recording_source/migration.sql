-- CreateEnum
CREATE TYPE "RecordingSource" AS ENUM ('SPACE', 'SCREEN_RECORDER');

-- AlterTable: RecordingSession gains source/userId and spaceId becomes nullable
ALTER TABLE "RecordingSession"
  ADD COLUMN "source" "RecordingSource" NOT NULL DEFAULT 'SPACE',
  ADD COLUMN "userId" TEXT,
  ALTER COLUMN "spaceId" DROP NOT NULL;

-- AlterTable: ParticipantRecording.participantId becomes nullable
ALTER TABLE "ParticipantRecording"
  ALTER COLUMN "participantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RecordingSession"
  ADD CONSTRAINT "RecordingSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "RecordingSession_userId_idx" ON "RecordingSession"("userId");
CREATE INDEX "RecordingSession_source_idx" ON "RecordingSession"("source");
