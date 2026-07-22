-- Track whether an exported file is the raw capture, an aligned/gap-filled
-- capture, or a LiveKit cloud composite backup.
CREATE TYPE "FinalOutputVariant" AS ENUM ('RAW', 'ALIGNED', 'CLOUD');

ALTER TABLE "FinalOutput"
ADD COLUMN "variant" "FinalOutputVariant" NOT NULL DEFAULT 'RAW';
