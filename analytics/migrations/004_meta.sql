-- Small key/value store for the Worker's own bookkeeping — currently just the
-- last time an alert fired, so an ongoing outage does not alert every hour.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
