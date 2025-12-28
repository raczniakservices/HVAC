-- Twilio duration fields (seconds)
-- Twilio sends these on status callbacks (typically on "completed"):
-- - CallDuration (total call length)
-- - DialCallDuration (length of the dialed leg, when using <Dial>)

ALTER TABLE CallEvent ADD COLUMN callDurationSec INTEGER;
ALTER TABLE CallEvent ADD COLUMN dialCallDurationSec INTEGER;


