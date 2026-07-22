-- Add LiveKit room and participant state needed for the SFU-backed call stack.

ALTER TABLE "Space"
ADD COLUMN "livekitRoomName" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "endedReason" TEXT;

ALTER TABLE "SpaceParticipant"
ADD COLUMN "livekitIdentity" TEXT,
ADD COLUMN "lastConnectedAt" TIMESTAMP(3),
ADD COLUMN "connectionState" TEXT;

CREATE UNIQUE INDEX "Space_livekitRoomName_key" ON "Space"("livekitRoomName");
CREATE UNIQUE INDEX "SpaceParticipant_livekitIdentity_key" ON "SpaceParticipant"("livekitIdentity");
