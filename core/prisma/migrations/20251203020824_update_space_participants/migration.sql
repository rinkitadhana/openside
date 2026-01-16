/*
  Warnings:

  - You are about to drop the column `displayName` on the `SpaceParticipant` table. All the data in the column will be lost.
  - You are about to drop the column `isUnAuthenticated` on the `SpaceParticipant` table. All the data in the column will be lost.
  - Made the column `participantSessionId` on table `SpaceParticipant` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "SpaceParticipant" DROP COLUMN "displayName",
DROP COLUMN "isUnAuthenticated",
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "isGuest" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "participantSessionId" SET NOT NULL;
