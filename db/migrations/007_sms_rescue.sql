-- SMS rescue fields for missed-call text-back + YES callback trigger
ALTER TABLE CallEvent ADD COLUMN rescueSmsSentAt TEXT;
ALTER TABLE CallEvent ADD COLUMN rescueSmsSid TEXT;
ALTER TABLE CallEvent ADD COLUMN rescueSmsBody TEXT;

ALTER TABLE CallEvent ADD COLUMN rescueInboundSmsAt TEXT;
ALTER TABLE CallEvent ADD COLUMN rescueInboundSmsBody TEXT;

ALTER TABLE CallEvent ADD COLUMN rescueYesAt TEXT;

ALTER TABLE CallEvent ADD COLUMN rescueCallbackPlacedAt TEXT;
ALTER TABLE CallEvent ADD COLUMN rescueCallbackCallSid TEXT;


