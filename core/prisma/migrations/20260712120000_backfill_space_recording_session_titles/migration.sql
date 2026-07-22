-- Every project recording has a persisted session title. Existing project
-- sessions are numbered in the same chronological order used by the UI.
WITH numbered_sessions AS (
  SELECT
    "id",
    CONCAT(
      'Recording ',
      ROW_NUMBER() OVER (
        PARTITION BY "spaceId"
        ORDER BY "startedAt" ASC, "createdAt" ASC, "id" ASC
      )
    ) AS "title"
  FROM "RecordingSession"
  WHERE "source" = 'SPACE'
)
UPDATE "RecordingSession" AS session
SET "title" = numbered_sessions."title"
FROM numbered_sessions
WHERE session."id" = numbered_sessions."id";
