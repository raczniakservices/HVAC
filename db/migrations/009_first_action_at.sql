-- First action timestamp for SLA overdue semantics
-- overdue = (first_action_at IS NULL) AND (now > createdAt + SLA_MINUTES)

-- Add first_action_at if missing.
ALTER TABLE CallEvent ADD COLUMN first_action_at TEXT;

-- Backfill for historical rows so old leads don't incorrectly show overdue:
-- If outcome/result is set, treat as touched.
-- NOTE: Do not reference columns that may not exist yet in older DBs.
UPDATE CallEvent
SET first_action_at = COALESCE(
  first_action_at,
  createdAt
)
WHERE (outcome IS NOT NULL AND TRIM(outcome) != '')
  AND first_action_at IS NULL
  AND createdAt IS NOT NULL;



