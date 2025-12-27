-- Ensure createdAt index exists (performance for dashboard ORDER BY createdAt DESC)
CREATE INDEX IF NOT EXISTS idx_callevent_createdAt ON CallEvent (createdAt);


