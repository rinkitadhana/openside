-- Profile customization + recording preferences on User
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
ALTER TABLE "User" ADD COLUMN "brandColor" TEXT;
ALTER TABLE "User" ADD COLUMN "profileCustomized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "cloudBackupEnabled" BOOLEAN NOT NULL DEFAULT false;
