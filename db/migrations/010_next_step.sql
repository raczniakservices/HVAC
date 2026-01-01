-- Next step (operator workflow)
-- - stored per event
-- - setting next_step counts as first_action_at (write-once) in app logic

ALTER TABLE CallEvent ADD COLUMN next_step TEXT;



