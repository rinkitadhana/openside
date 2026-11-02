-- Signup onboarding answers (see User.onboardedAt / User.onboarding).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboarding" JSONB;

-- Everyone who signed up before onboarding existed skips it.
UPDATE "User" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
