-- Add "lead leak prevention" primitives:
-- - ownership (assignedTo)
-- - SLA tracking (slaMinutes, slaDueAt, slaBreachedAt, escalatedAt)
-- - automation event log (dry-run notifications / escalations)

ALTER TABLE CallEvent ADD COLUMN assignedTo TEXT;
ALTER TABLE CallEvent ADD COLUMN slaMinutes INTEGER;
ALTER TABLE CallEvent ADD COLUMN slaDueAt TEXT;
ALTER TABLE CallEvent ADD COLUMN slaBreachedAt TEXT;
ALTER TABLE CallEvent ADD COLUMN escalatedAt TEXT;

CREATE TABLE IF NOT EXISTS AutomationEvent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  callEventId INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'logged',
  dedupeKey TEXT NOT NULL UNIQUE,
  payload TEXT,
  FOREIGN KEY (callEventId) REFERENCES CallEvent(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_AutomationEvent_createdAt
  ON AutomationEvent (createdAt DESC);



