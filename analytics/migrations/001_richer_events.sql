-- Applied to a database created before submission-level detail existed.
-- SQLite ADD COLUMN is metadata-only, so this is safe on a live table.
ALTER TABLE events ADD COLUMN status       TEXT;
ALTER TABLE events ADD COLUMN theme        TEXT;
ALTER TABLE events ADD COLUMN runtime_ms   INTEGER;
ALTER TABLE events ADD COLUMN memory_kb    INTEGER;
ALTER TABLE events ADD COLUMN tests_passed INTEGER;
ALTER TABLE events ADD COLUMN tests_total  INTEGER;
ALTER TABLE events ADD COLUMN code_len     INTEGER;
ALTER TABLE events ADD COLUMN code         TEXT;
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
