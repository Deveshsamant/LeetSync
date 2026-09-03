-- One row per claimed username. name_key is the lowercased form, so "Devesh"
-- and "devesh" cannot both be claimed; `name` keeps the casing as typed.
CREATE TABLE IF NOT EXISTS names (
  name_key   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  install_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_names_install ON names(install_id);
