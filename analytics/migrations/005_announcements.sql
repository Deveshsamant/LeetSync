-- Broadcast messages: one thing the developer says to every user at once.
--
-- Kept as a table rather than a single row so a message has a stable id. The
-- extension shows a broadcast once and remembers which id it dismissed, and a
-- reused row would either re-show an old message or silently swallow a new
-- one with the same text.
--
-- `active` is a column rather than a delete, so a message can be withdrawn
-- without losing what was sent or when.
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  message    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info',  -- info | warn | success
  url        TEXT,                          -- optional "read more"
  created_at INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);

-- Every read asks the same question: what is the newest live message?
CREATE INDEX IF NOT EXISTS idx_announcements_live
  ON announcements(active, created_at DESC);
