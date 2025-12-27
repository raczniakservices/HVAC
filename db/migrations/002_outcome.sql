-- Add outcome tracking for "Recovered vs Lost" demo metrics
-- NOTE: applied once via SchemaMigration table in migration runner

ALTER TABLE CallEvent ADD COLUMN outcome TEXT;
ALTER TABLE CallEvent ADD COLUMN outcomeAt TEXT;


