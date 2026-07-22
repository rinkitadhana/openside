-- AlterEnum
ALTER TYPE "SpaceStatus" ADD VALUE 'SCHEDULED';

-- DropForeignKey
ALTER TABLE "ParticipantRecording" DROP CONSTRAINT "ParticipantRecording_participantId_fkey";

-- DropForeignKey
ALTER TABLE "RecordingSession" DROP CONSTRAINT "RecordingSession_spaceId_fkey";

-- AlterTable
ALTER TABLE "RecordingSession" ADD COLUMN     "egressId" TEXT;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "invitees" TEXT[],
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "RecordingSession" ADD CONSTRAINT "RecordingSession_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantRecording" ADD CONSTRAINT "ParticipantRecording_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "SpaceParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
