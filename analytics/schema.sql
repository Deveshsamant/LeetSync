-- LeetSync analytics schema (Cloudflare D1 / SQLite)
--
-- Deliberately narrow: there is no column for an IP address, a GitHub
-- username, a repository name or a token, so none can be stored even by
-- accident. install_id is a random UUID generated on the device and is not
-- derived from anything about the user.

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,   -- server receive time (ms)
  client_ts  INTEGER,            -- when the device queued it (ms)
  install_id TEXT    NOT NULL,   -- random per-install UUID
  event      TEXT    NOT NULL,   -- push_ok, tab, sheet, ...
  version    TEXT,               -- extension version
  slug       TEXT,               -- leetcode problem slug
  title      TEXT,               -- leetcode problem title
  difficulty TEXT,               -- Easy | Medium | Hard | Unknown
  language   TEXT,               -- cpp, java, python3, ...
  detail     TEXT                -- small free-form label, e.g. tab name
);

CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_event   ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_install ON events(install_id);
CREATE INDEX IF NOT EXISTS idx_events_slug    ON events(slug);
