-- LeetSync analytics schema (Cloudflare D1 / SQLite)
--
-- Deliberately narrow: there is no column for an IP address, a GitHub
-- username, a repository name or a token, so none can be stored even by
-- accident. install_id is a random UUID generated on the device and is not
-- derived from anything about the user.
--
-- `code` is the one column holding user-authored content. It is written only
-- when the device has the separate code-sharing consent switched on; usage
-- reporting alone never fills it.

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,   -- server receive time (ms)
  client_ts    INTEGER,            -- when the device queued it (ms)
  install_id   TEXT    NOT NULL,   -- random per-install UUID
  event        TEXT    NOT NULL,   -- submission, push_ok, tab, session, ...
  version      TEXT,               -- extension version
  slug         TEXT,               -- leetcode problem slug
  title        TEXT,               -- leetcode problem title
  difficulty   TEXT,               -- Easy | Medium | Hard | Unknown
  language     TEXT,               -- cpp, java, python3, ...
  detail       TEXT,               -- small free-form label, e.g. tab name
  status       TEXT,               -- Accepted | Wrong Answer | ... | Other
  theme        TEXT,               -- dark | light
  runtime_ms   INTEGER,            -- reported runtime
  memory_kb    INTEGER,            -- reported memory
  tests_passed INTEGER,
  tests_total  INTEGER,
  code_len     INTEGER,            -- length of the solution, always
  code         TEXT,               -- the solution itself, only under consent
  display_name TEXT                -- optional name the user typed for themselves
);

CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_event   ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_install ON events(install_id);
CREATE INDEX IF NOT EXISTS idx_events_slug    ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_status  ON events(status);

-- Claimed usernames. Separate from events so a name is unique across the
-- whole install base rather than per row, and so releasing one is a delete
-- rather than a rewrite of every event that carried it.
CREATE TABLE IF NOT EXISTS names (
  name_key   TEXT PRIMARY KEY,   -- lowercased, so casing cannot fork a claim
  name       TEXT NOT NULL,      -- as the user typed it
  install_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_names_install ON names(install_id);

-- Worker bookkeeping. Not analytics data: currently only the timestamp of the
-- last alert, so a sustained failure does not alert once an hour forever.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Broadcast messages: one thing the developer says to every user at once.
-- A row per message, so each has a stable id — the extension shows a broadcast
-- once and remembers which id it dismissed, and a reused row would either
-- re-show an old message or swallow a new one with the same text.
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  message    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info',  -- info | warn | success
  url        TEXT,                          -- optional "read more"
  created_at INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_announcements_live
  ON announcements(active, created_at DESC);

-- Feedback from the extension's Settings panel. Three kinds, because an issue
-- and a suggestion need reading in different moods. Unlike every other table
-- here a row is written because someone deliberately typed it, so it carries
-- who they are — which is what makes a bug report actionable.
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

CREATE INDEX IF NOT EXISTS idx_feedback_new ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_open ON feedback(handled, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_install ON feedback(install_id, created_at DESC);
