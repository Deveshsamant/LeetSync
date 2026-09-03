-- Optional, user-entered name shown instead of the random install id.
-- Never derived from the GitHub account; blank unless the user typed one.
ALTER TABLE events ADD COLUMN display_name TEXT;
