/*
  Warnings:

  - You are about to drop the column `recordingSessionId` on the `RecordingSegment` table. All the data in the column will be lost.
  - You are about to drop the column `recordingSessionId` on the `RecordingSession` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[spaceRecordingSessionId]` on the table `RecordingSession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `spaceRecordingSessionId` to the `RecordingSegment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `spaceRecordingSessionId` to the `RecordingSession` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "RecordingSegment_recordingSessionId_idx";

-- DropIndex
DROP INDEX "RecordingSession_recordingSessionId_key";

-- AlterTable
ALTER TABLE "RecordingSegment" DROP COLUMN "recordingSessionId",
ADD COLUMN     "spaceRecordingSessionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RecordingSession" DROP COLUMN "recordingSessionId",
ADD COLUMN     "spaceRecordingSessionId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "RecordingSegment_spaceRecordingSessionId_idx" ON "RecordingSegment"("spaceRecordingSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingSession_spaceRecordingSessionId_key" ON "RecordingSession"("spaceRecordingSessionId");
