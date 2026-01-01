-- First action timestamp for SLA overdue semantics
-- overdue = (first_action_at IS NULL) AND (now > createdAt + SLA_MINUTES)

-- Add first_action_at if missing.
ALTER TABLE CallEvent ADD COLUMN first_action_at TEXT;

-- Backfill for historical rows so old leads don't incorrectly show overdue:
-- 1) If owner is set, treat as touched (set first_action_at to createdAt).
UPDATE CallEvent
SET first_action_at = COALESCE(first_action_at, createdAt)
WHERE (owner IS NOT NULL AND TRIM(owner) != '')
  AND first_action_at IS NULL
  AND createdAt IS NOT NULL;

-- 2) If outcome/result is set, treat as touched (prefer handled_at if it is already an ISO TEXT).
UPDATE CallEvent
SET first_action_at = COALESCE(
  first_action_at,
  CASE
    WHEN handled_at IS NOT NULL AND typeof(handled_at) = 'text' AND TRIM(CAST(handled_at AS TEXT)) != '' THEN CAST(handled_at AS TEXT)
    ELSE createdAt
  END
)
WHERE (outcome IS NOT NULL AND TRIM(outcome) != '')
  AND first_action_at IS NULL
  AND createdAt IS NOT NULL;


