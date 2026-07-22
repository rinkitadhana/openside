CREATE INDEX "Space_hostId_createdAt_idx" ON "Space"("hostId", "createdAt");
CREATE INDEX "SpaceParticipant_userId_joinedAt_idx" ON "SpaceParticipant"("userId", "joinedAt");
