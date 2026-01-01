-- Lead Truth Ledger: followups + email logs
-- Keep this migration table-safe (no ALTER TABLE), so existing DBs won't fail startup.

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('call_attempt','voicemail_left','text_sent','spoke_to_customer','note')),
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES CallEvent(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_followups_event_id ON followups (event_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NULL,
  email_type TEXT NOT NULL CHECK (
    email_type IN (
      'internal_inbound',
      'internal_overdue',
      'customer_form_confirmation',
      'customer_booking_confirmation',
      'test'
    )
  ),
  to_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  provider TEXT DEFAULT 'resend',
  provider_message_id TEXT,
  error_text TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES CallEvent(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_event_id ON email_logs (event_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs (created_at DESC);


