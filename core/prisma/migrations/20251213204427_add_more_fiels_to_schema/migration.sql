/*
  Warnings:

  - You are about to drop the column `fileKey` on the `ParticipantRecording` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[participantRecordingId,sequenceNumber]` on the table `RecordingSegment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sequenceNumber` to the `RecordingSegment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ParticipantRecording" DROP COLUMN "fileKey",
ADD COLUMN     "expectedSegments" INTEGER,
ADD COLUMN     "isComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedFileKey" TEXT,
ADD COLUMN     "uploadedSegments" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RecordingSegment" ADD COLUMN     "sequenceNumber" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "RecordingSegment_participantRecordingId_sequenceNumber_idx" ON "RecordingSegment"("participantRecordingId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingSegment_participantRecordingId_sequenceNumber_key" ON "RecordingSegment"("participantRecordingId", "sequenceNumber");
