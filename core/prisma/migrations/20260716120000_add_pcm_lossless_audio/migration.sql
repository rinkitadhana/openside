-- Lossless raw-PCM audio pipeline.
--
-- RecordingSegment gains the audio format for headerless "pcm" segments so the
-- finalizer can write a valid WAV header. Nullable: every existing (WebM) segment
-- and all non-PCM tracks leave these NULL. ADD COLUMN with no default is a
-- metadata-only change in Postgres (no table rewrite), safe on a large table.
--
-- IF NOT EXISTS: a dev database had these columns applied out-of-band via
-- `prisma db push` before this migration existed, so the migration must be a
-- no-op there while still creating the columns on fresh/prod databases.
ALTER TABLE "RecordingSegment" ADD COLUMN IF NOT EXISTS "sampleRate" INTEGER;
ALTER TABLE "RecordingSegment" ADD COLUMN IF NOT EXISTS "bitDepth" INTEGER;
ALTER TABLE "RecordingSegment" ADD COLUMN IF NOT EXISTS "channelCount" INTEGER;

-- FinalOutput gains the back-link to the lossless WAV master built from the
-- participant's PCM track. Nullable: legacy outputs and screen-share outputs
-- (no mic PCM) stay NULL and download WAV via the old on-demand extraction.
ALTER TABLE "FinalOutput" ADD COLUMN IF NOT EXISTS "audioWavKey" TEXT;
