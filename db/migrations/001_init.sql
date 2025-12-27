-- Call events for missed-call visibility demo
CREATE TABLE IF NOT EXISTS CallEvent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  callerNumber TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('missed', 'answered')),
  source TEXT NOT NULL DEFAULT 'simulator',
  followedUp INTEGER NOT NULL DEFAULT 0,
  followedUpAt TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_CallEvent_createdAt ON CallEvent (createdAt DESC);


