/*
  Warnings:

  - You are about to drop the column `guestName` on the `SpaceParticipant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SpaceParticipant" DROP COLUMN "guestName",
ADD COLUMN     "displayName" TEXT;
