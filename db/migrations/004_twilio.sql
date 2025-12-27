-- Twilio ingestion fields (CallSid, To, raw status, direction)
-- This enables upsert-by-CallSid so repeated webhooks don't create duplicates.

ALTER TABLE CallEvent ADD COLUMN callSid TEXT;
ALTER TABLE CallEvent ADD COLUMN toNumber TEXT;
ALTER TABLE CallEvent ADD COLUMN twilioStatus TEXT;
ALTER TABLE CallEvent ADD COLUMN direction TEXT;

-- Only one row per CallSid (NULLs allowed for non-Twilio sources)
CREATE UNIQUE INDEX IF NOT EXISTS idx_CallEvent_callSid_unique
  ON CallEvent (callSid)
  WHERE callSid IS NOT NULL;


