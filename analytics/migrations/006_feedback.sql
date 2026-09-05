-- Feedback sent from the extension's Settings panel.
--
-- Three kinds, because "issue" and "suggestion" need reading in different
-- moods and a single free-text box makes that a sorting job later.
--
-- Unlike every other table here, a row is written because someone deliberately
-- typed it and pressed send — so it carries who they are, which is what makes
-- a bug report actionable. The extension says exactly that above the button.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,      -- feedback | issue | suggestion
  message     TEXT NOT NULL,
  install_id  TEXT,
  display_name TEXT,
  version     TEXT,
  created_at  INTEGER NOT NULL,
  handled     INTEGER NOT NULL DEFAULT 0
);

-- The list is always "newest first, unhandled matters most".
CREATE INDEX IF NOT EXISTS idx_feedback_new ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_open ON feedback(handled, created_at DESC);

-- One send per install per minute is enforced by reading this back; without an
-- index that check is a table scan on a public, unauthenticated endpoint.
CREATE INDEX IF NOT EXISTS idx_feedback_install ON feedback(install_id, created_at DESC);
