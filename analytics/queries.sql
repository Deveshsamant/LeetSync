-- Handy queries. Run with:
--   npx wrangler d1 execute leetsync-analytics --remote --command "..."

-- Daily active installs
SELECT date(ts/1000,'unixepoch') AS day, COUNT(DISTINCT install_id) AS installs
FROM events GROUP BY day ORDER BY day DESC LIMIT 30;

-- Which features actually get used
SELECT event, COUNT(*) AS n, COUNT(DISTINCT install_id) AS installs
FROM events GROUP BY event ORDER BY n DESC;

-- Which tabs people open
SELECT detail AS tab, COUNT(*) AS opens
FROM events WHERE event='tab' GROUP BY tab ORDER BY opens DESC;

-- Most-pushed problems
SELECT slug, title, difficulty, COUNT(*) AS pushes
FROM events WHERE event='push_ok' AND slug IS NOT NULL
GROUP BY slug ORDER BY pushes DESC LIMIT 25;

-- Difficulty mix
SELECT difficulty, COUNT(*) AS n
FROM events WHERE event='push_ok' GROUP BY difficulty;

-- Language mix
SELECT language, COUNT(*) AS n
FROM events WHERE event='push_ok' AND language IS NOT NULL
GROUP BY language ORDER BY n DESC;

-- Why pushes fail
SELECT detail AS reason, COUNT(*) AS n
FROM events WHERE event='push_fail' GROUP BY reason ORDER BY n DESC;

-- Which sheets people work through
SELECT detail AS sheet, COUNT(DISTINCT install_id) AS installs
FROM events WHERE event='sheet' GROUP BY sheet ORDER BY installs DESC;

-- Version adoption
SELECT version, COUNT(DISTINCT install_id) AS installs
FROM events GROUP BY version ORDER BY installs DESC;
