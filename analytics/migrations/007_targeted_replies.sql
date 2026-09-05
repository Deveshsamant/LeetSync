-- Replying to one person who wrote in.
--
-- A reply is a broadcast with an audience of one, so it reuses the
-- announcements table rather than inventing a parallel delivery: the same
-- modal, the same tone, and the same "seen once" rule keyed by row id. A row
-- with target_install NULL is what it always was — everybody.
--
-- feedback_id ties the reply to what it answers, so the dashboard and the app
-- can show a thread rather than two unrelated lists.
ALTER TABLE announcements ADD COLUMN target_install TEXT;
ALTER TABLE announcements ADD COLUMN feedback_id INTEGER;

-- The extension asks "is there anything for me?" on every open: either a
-- global message or one addressed to this install.
CREATE INDEX IF NOT EXISTS idx_announcements_target
  ON announcements(target_install, active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_feedback
  ON announcements(feedback_id);
