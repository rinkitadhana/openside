-- Plans: FREE -> DEMO, BUSINESS -> PRO (enum recreated to drop BUSINESS)
CREATE TYPE "PlanType_new" AS ENUM ('DEMO', 'PRO');
ALTER TABLE "User" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "plan" TYPE "PlanType_new"
  USING (
    CASE "plan"::text
      WHEN 'FREE' THEN 'DEMO'
      WHEN 'BUSINESS' THEN 'PRO'
      ELSE "plan"::text
    END::"PlanType_new"
  );
DROP TYPE "PlanType";
ALTER TYPE "PlanType_new" RENAME TO "PlanType";
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'DEMO';

-- Polar billing state on User
ALTER TABLE "User" ADD COLUMN "polarCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "polarSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN "subscriptionStatus" TEXT;
ALTER TABLE "User" ADD COLUMN "currentPeriodStart" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_polarCustomerId_key" ON "User"("polarCustomerId");
CREATE UNIQUE INDEX "User_polarSubscriptionId_key" ON "User"("polarSubscriptionId");

-- Metering + cloud-backup opt-in on RecordingSession
ALTER TABLE "RecordingSession" ADD COLUMN "lastMeteredAt" TIMESTAMP(3);
ALTER TABLE "RecordingSession" ADD COLUMN "meteredSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RecordingSession" ADD COLUMN "cloudBackup" BOOLEAN NOT NULL DEFAULT false;

-- Usage periods
CREATE TABLE "UsagePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "secondsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsagePeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsagePeriod_userId_periodStart_key" ON "UsagePeriod"("userId", "periodStart");
CREATE INDEX "UsagePeriod_userId_periodEnd_idx" ON "UsagePeriod"("userId", "periodEnd");

ALTER TABLE "UsagePeriod" ADD CONSTRAINT "UsagePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Self-host (BYO LiveKit + R2) config
CREATE TABLE "SelfHostConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "livekitUrl" TEXT NOT NULL,
    "livekitApiKey" TEXT NOT NULL,
    "livekitApiSecret" TEXT NOT NULL,
    "r2AccountId" TEXT NOT NULL,
    "r2AccessKeyId" TEXT NOT NULL,
    "r2SecretAccessKey" TEXT NOT NULL,
    "r2Bucket" TEXT NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfHostConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SelfHostConfig_userId_key" ON "SelfHostConfig"("userId");

ALTER TABLE "SelfHostConfig" ADD CONSTRAINT "SelfHostConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Polar webhook dedupe
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);
