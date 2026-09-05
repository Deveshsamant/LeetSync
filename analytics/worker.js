/**
 * LeetSync analytics collector — Cloudflare Worker + D1.
 *
 * Accepts batched events from the extension and writes them to D1. Nothing
 * else: no cookies, no IP storage, no third party. The extension only sends
 * anything once the user has switched analytics on.
 *
 * Deploy:
 *   npx wrangler d1 create leetsync-analytics
 *   npx wrangler d1 execute leetsync-analytics --remote --file=schema.sql
 *   npx wrangler deploy
 */

const MAX_BATCH = 50;              // events per request
const MAX_BODY = 2 * 1024 * 1024;  // a batch carrying code can reach ~1 MB
const MAX_CODE = 20000;            // must match the client's cap
const MAX_NAME = 40;               // must match the client's cap
const EVENTS = new Set([
  'install', 'update', 'push_ok', 'push_fail', 'tab', 'sheet', 'tracker',
  'export', 'import', 'theme', 'repo_setup', 'submission', 'session',
  // Sent without the usage-reporting consent, and carries nothing but an
  // install id and a version. Every other event here implies a consent.
  'ping',
]);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Unknown']);
const THEMES = new Set(['dark', 'light']);
// LeetCode's verdicts. Anything outside this becomes 'Other' rather than
// being stored verbatim, so a changed upstream string cannot inject values.
const STATUSES = new Set([
  'Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded',
  'Output Limit Exceeded', 'Runtime Error', 'Compile Error', 'Internal Error',
  'Unknown',
]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    // authorization must be listed or the dashboard's preflight fails and
    // every read is blocked by the browser before it is even sent.
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
  },
});

/** Trim to a sane length; anything unexpected becomes null rather than throwing. */
const str = (v, max) =>
  (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;

/** Numbers only — a numeric field arriving as text is a bug, not a value. */
const num = (v, max) =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0)
    ? Math.min(Math.round(v), max) : null;

/**
 * Accept only the fields the schema knows about. A client that starts sending
 * something new cannot widen what gets stored without the Worker being updated
 * too — which is what keeps the privacy policy honest.
 */
function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const event = str(raw.event, 32);
  if (!event || !EVENTS.has(event)) return null;

  const installId = str(raw.installId, 64);
  if (!installId) return null;

  const difficulty = str(raw.difficulty, 16);
  const status = str(raw.status, 32);
  const theme = str(raw.theme, 16);

  return {
    install_id: installId,
    event,
    version: str(raw.version, 16),
    slug: str(raw.slug, 128),
    title: str(raw.title, 200),
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty : null,
    language: str(raw.language, 32),
    detail: str(raw.detail, 200),
    status: status ? (STATUSES.has(status) ? status : 'Other') : null,
    theme: THEMES.has(theme) ? theme : null,
    runtime_ms: num(raw.runtimeMs, 3600000),
    memory_kb: num(raw.memoryKb, 8388608),
    tests_passed: num(raw.testsPassed, 1000000),
    tests_total: num(raw.testsTotal, 1000000),
    code_len: num(raw.codeLen, 10000000),
    // Present only when the device has the separate code-sharing consent on;
    // the client omits it otherwise, so there is nothing here to strip.
    code: str(raw.code, MAX_CODE),
    // Optional and user-typed. The only field here a person chose to be
    // identified by, so it is capped and otherwise treated like any label.
    display_name: str(raw.name, MAX_NAME),
    client_ts: Number.isFinite(raw.ts) ? Math.floor(raw.ts) : null,
  };
}

/**
 * Read API for the dashboard.
 *
 * Ingest is open because it is write-only and every field is validated, but
 * reading is the whole dataset, so it needs the shared key. Set it once with:
 *   wrangler secret put DASHBOARD_KEY
 * Without the secret configured the read API stays closed rather than open.
 */
function authorised(request, env) {
  const expected = env.DASHBOARD_KEY;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const given = header.replace(/^Bearer\s+/i, '');
  if (given.length !== expected.length) return false;
  // Constant-time-ish: compare every character regardless of early mismatch.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const all = async (env, sql, ...binds) =>
  (await env.DB.prepare(sql).bind(...binds).all()).results || [];

/** Everything the dashboard's overview renders, in one round trip. */
async function summary(env, days) {
  const since = Date.now() - days * 86400000;

  // The window immediately before this one, same length, so every headline
  // figure can be shown as a change rather than a number without context.
  const prevSince = since - days * 86400000;

  const [totals, daily, events, problems, difficulty, languages, versions,
         failures, sheets, statuses, themes, perf, previous, funnel] =
    await Promise.all([
      all(env, `SELECT COUNT(*) AS events, COUNT(DISTINCT install_id) AS installs,
                       MIN(ts) AS first_seen, MAX(ts) AS last_seen
                FROM events WHERE ts >= ?`, since),
      // Days are bucketed in UTC, which the dashboard says out loud rather
      // than quietly mixing them with the viewer's local clock.
      all(env, `SELECT date(ts/1000,'unixepoch') AS day,
                       COUNT(DISTINCT install_id) AS installs, COUNT(*) AS events,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       SUM(CASE WHEN event='push_fail' THEN 1 ELSE 0 END) AS failures,
                       COUNT(DISTINCT slug) AS problems
                FROM events WHERE ts >= ? GROUP BY day ORDER BY day`, since),
      all(env, `SELECT event, COUNT(*) AS n, COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? GROUP BY event ORDER BY n DESC`, since),
      // Title and difficulty ride on push_ok rows, so MAX() fills them in for
      // the submission rows of the same slug, which carry only the slug.
      all(env, `SELECT slug,
                       MAX(title) AS title,
                       MAX(difficulty) AS difficulty,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS attempts,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? AND slug IS NOT NULL
                GROUP BY slug ORDER BY attempts DESC, pushes DESC LIMIT 50`, since),
      all(env, `SELECT COALESCE(difficulty,'Unknown') AS difficulty, COUNT(*) AS n
                FROM events WHERE ts >= ? AND event='push_ok'
                GROUP BY difficulty ORDER BY n DESC`, since),
      all(env, `SELECT language, COUNT(*) AS n FROM events
                WHERE ts >= ? AND event='submission' AND language IS NOT NULL
                GROUP BY language ORDER BY n DESC LIMIT 12`, since),
      all(env, `SELECT COALESCE(version,'unknown') AS version,
                       COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? GROUP BY version ORDER BY installs DESC`, since),
      all(env, `SELECT COALESCE(detail,'other') AS reason, COUNT(*) AS n
                FROM events WHERE ts >= ? AND event='push_fail'
                GROUP BY reason ORDER BY n DESC`, since),
      all(env, `SELECT detail AS sheet, COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? AND event='sheet' AND detail IS NOT NULL
                GROUP BY sheet ORDER BY installs DESC LIMIT 10`, since),
      all(env, `SELECT status, COUNT(*) AS n, COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? AND event='submission' AND status IS NOT NULL
                GROUP BY status ORDER BY n DESC`, since),
      // Each install counted once, at the theme it is on now — what people
      // sit on, not everything they have tried. A switch records the theme it
      // switched to, so "now" updates the moment someone changes it rather
      // than waiting for their next popup open.
      all(env, `SELECT theme, COUNT(*) AS installs FROM (
                  SELECT install_id, theme, MAX(ts) FROM events
                  WHERE ts >= ? AND theme IS NOT NULL GROUP BY install_id
                ) GROUP BY theme ORDER BY installs DESC`, since),
      // Difficulty arrives on push_ok rows while runtime and memory arrive on
      // submission rows, so this has to resolve difficulty through the slug —
      // asking one row for both would match nothing.
      all(env, `SELECT d.difficulty AS difficulty,
                       AVG(CASE WHEN e.status='Accepted' THEN e.runtime_ms END) AS avg_runtime,
                       AVG(CASE WHEN e.status='Accepted' THEN e.memory_kb END) AS avg_memory,
                       AVG(e.code_len) AS avg_code_len,
                       SUM(CASE WHEN e.status='Accepted' THEN 1 ELSE 0 END) AS n
                FROM events e
                JOIN (SELECT slug, MAX(difficulty) AS difficulty FROM events
                      WHERE difficulty IS NOT NULL GROUP BY slug) d ON d.slug = e.slug
                WHERE e.ts >= ?
                GROUP BY d.difficulty`, since),
      all(env, `SELECT COUNT(*) AS events, COUNT(DISTINCT install_id) AS installs,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       SUM(CASE WHEN event='push_fail' THEN 1 ELSE 0 END) AS failures
                FROM events WHERE ts >= ? AND ts < ?`, prevSince, since),
      // Each stage counts installs, not events, so one very busy user cannot
      // make a stage look healthier than it is.
      all(env, `SELECT
                  COUNT(DISTINCT install_id) AS reached_install,
                  COUNT(DISTINCT CASE WHEN event='repo_setup' THEN install_id END) AS reached_repo,
                  COUNT(DISTINCT CASE WHEN event='submission' THEN install_id END) AS reached_submit,
                  COUNT(DISTINCT CASE WHEN event='push_ok' THEN install_id END) AS reached_push
                FROM events WHERE ts >= ?`, since),
    ]);

  return {
    days,
    generatedAt: Date.now(),
    totals: totals[0] || { events: 0, installs: 0 },
    previous: previous[0] || { events: 0, installs: 0 },
    funnel: funnel[0] || {},
    daily, events, problems, difficulty, languages, versions, failures, sheets,
    statuses, themes, perf,
  };
}

/**
 * Weekly retention cohorts.
 *
 * Deliberately not limited by the dashboard's range: retention is about what
 * happened to people after they arrived, so cutting the history at 30 days
 * would report every cohort as having churned. The range only decides how far
 * back the listed cohorts start.
 */
async function retention(env, days) {
  const since = Date.now() - days * 86400000;
  const WEEK = 604800000;
  const rows = await all(env, `
    WITH firsts AS (
      SELECT install_id, MIN(ts) AS first_ts FROM events GROUP BY install_id
    )
    SELECT strftime('%Y-W%W', f.first_ts/1000, 'unixepoch') AS cohort,
           MIN(f.first_ts) AS started,
           COUNT(DISTINCT f.install_id) AS size,
           COUNT(DISTINCT CASE WHEN e.ts >= f.first_ts + ? THEN f.install_id END) AS week1,
           COUNT(DISTINCT CASE WHEN e.ts >= f.first_ts + ? THEN f.install_id END) AS week2,
           COUNT(DISTINCT CASE WHEN e.ts >= f.first_ts + ? THEN f.install_id END) AS week4
    FROM firsts f JOIN events e ON e.install_id = f.install_id
    WHERE f.first_ts >= ?
    GROUP BY cohort ORDER BY started DESC LIMIT 12`,
    WEEK, WEEK * 2, WEEK * 4, since);
  return { days, generatedAt: Date.now(), cohorts: rows };
}

/** Everything about one problem, for the drill-down. */
async function problemDetail(env, slug, days) {
  const since = Date.now() - days * 86400000;
  const [totals, statuses, languages, installs, daily] = await Promise.all([
    all(env, `SELECT MAX(title) AS title, MAX(difficulty) AS difficulty,
                     SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS attempts,
                     SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                     SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                     COUNT(DISTINCT install_id) AS installs,
                     AVG(CASE WHEN status='Accepted' THEN runtime_ms END) AS avg_runtime,
                     AVG(CASE WHEN status='Accepted' THEN memory_kb END) AS avg_memory
              FROM events WHERE ts >= ? AND slug = ?`, since, slug),
    all(env, `SELECT status, COUNT(*) AS n FROM events
              WHERE ts >= ? AND slug = ? AND status IS NOT NULL
              GROUP BY status ORDER BY n DESC`, since, slug),
    all(env, `SELECT language, COUNT(*) AS n FROM events
              WHERE ts >= ? AND slug = ? AND language IS NOT NULL
              GROUP BY language ORDER BY n DESC LIMIT 10`, since, slug),
    all(env, `SELECT install_id, MAX(display_name) AS display_name,
                     SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS attempts,
                     SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                     MAX(ts) AS last_ts
              FROM events WHERE ts >= ? AND slug = ?
              GROUP BY install_id ORDER BY attempts DESC LIMIT 100`, since, slug),
    all(env, `SELECT date(ts/1000,'unixepoch') AS day, COUNT(*) AS n,
                     SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted
              FROM events WHERE ts >= ? AND slug = ? AND event='submission'
              GROUP BY day ORDER BY day`, since, slug),
  ]);
  const names = await nameMap(env);
  return {
    slug, days, generatedAt: Date.now(),
    totals: totals[0] || {}, statuses, languages, daily,
    installs: installs.map(r => ({ ...r, display_name: named(names, r) })),
  };
}

/**
 * The `names` table is the authority on who an install is; per-event
 * display_name is only a copy carried by whatever events happened after the
 * claim. Reading the table means a name claimed today labels the install's
 * whole history instead of leaving every earlier row anonymous — and an
 * install that has claimed a name but not reported since is still named.
 */
async function nameMap(env) {
  const rows = await all(env, 'SELECT install_id, name FROM names');
  return new Map(rows.map(r => [r.install_id, r.name]));
}

const named = (names, row) => names.get(row.install_id) || row.display_name || null;

/** One row per install, for the user list. */
async function users(env, days) {
  const since = Date.now() - days * 86400000;
  const [rows, themeRows] = await Promise.all([
    all(env, `SELECT install_id,
                     COUNT(*) AS events,
                     MIN(ts) AS first_seen, MAX(ts) AS last_seen,
                     SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                     SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                     SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                     COUNT(DISTINCT slug) AS problems,
                     MAX(version) AS version,
                     MAX(display_name) AS display_name,
                     SUM(CASE WHEN code IS NULL THEN 0 ELSE 1 END) AS code_shared
              FROM events WHERE ts >= ?
              GROUP BY install_id ORDER BY last_seen DESC LIMIT 200`, since),
    all(env, `SELECT install_id, theme, MAX(ts) FROM events
              WHERE ts >= ? AND theme IS NOT NULL GROUP BY install_id`, since),
  ]);
  const themeOf = new Map(themeRows.map(r => [r.install_id, r.theme]));
  const names = await nameMap(env);
  return {
    days,
    generatedAt: Date.now(),
    users: rows.map(r => ({
      ...r,
      display_name: named(names, r),
      theme: themeOf.get(r.install_id) || null,
    })),
  };
}

/** One install's activity, newest first. Code is fetched separately. */
async function userDetail(env, installId, limit) {
  const [profile, timeline, langs] = await Promise.all([
    all(env, `SELECT COUNT(*) AS events, MIN(ts) AS first_seen, MAX(ts) AS last_seen,
                     SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                     SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                     SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                     COUNT(DISTINCT slug) AS problems, MAX(version) AS version,
                     MAX(display_name) AS display_name
              FROM events WHERE install_id = ?`, installId),
    all(env, `SELECT id, ts, event, slug, title, difficulty, language, status,
                     detail, version, theme, runtime_ms, memory_kb,
                     tests_passed, tests_total, code_len,
                     CASE WHEN code IS NULL THEN 0 ELSE 1 END AS has_code
              FROM events WHERE install_id = ? ORDER BY ts DESC LIMIT ?`, installId, limit),
    all(env, `SELECT language, COUNT(*) AS n FROM events
              WHERE install_id = ? AND language IS NOT NULL
              GROUP BY language ORDER BY n DESC LIMIT 8`, installId),
  ]);
  const names = await nameMap(env);
  const row = profile[0] || {};
  return {
    installId,
    generatedAt: Date.now(),
    profile: { ...row, display_name: names.get(installId) || row.display_name || null },
    timeline,
    languages: langs,
  };
}

/** The raw event feed, newest first. */
async function activity(env, days, limit) {
  const since = Date.now() - days * 86400000;
  const rows = await all(env,
    `SELECT id, ts, install_id, display_name, event, slug, title, difficulty,
            language, status, detail, version, runtime_ms, memory_kb,
            tests_passed, tests_total, code_len,
            CASE WHEN code IS NULL THEN 0 ELSE 1 END AS has_code
     FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?`, since, limit);
  const names = await nameMap(env);
  return {
    days,
    generatedAt: Date.now(),
    rows: rows.map(r => ({ ...r, display_name: named(names, r) })),
  };
}

/**
 * Everything that happened on one UTC day.
 *
 * `date` is compared against the same date() expression the daily series is
 * grouped by, so a row shown in the chart and a row shown here can never
 * disagree about which day it belongs to.
 */
async function dayDetail(env, date) {
  const D = `date(ts/1000,'unixepoch') = ?`;

  const [totals, hourly, statuses, problems, languages, installs, difficulty] =
    await Promise.all([
      all(env, `SELECT COUNT(*) AS events, COUNT(DISTINCT install_id) AS installs,
                       COUNT(DISTINCT slug) AS problems,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       SUM(CASE WHEN event='push_fail' THEN 1 ELSE 0 END) AS failures
                FROM events WHERE ${D}`, date),
      all(env, `SELECT strftime('%H', ts/1000, 'unixepoch') AS hour, COUNT(*) AS n,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted
                FROM events WHERE ${D} GROUP BY hour ORDER BY hour`, date),
      all(env, `SELECT status, COUNT(*) AS n FROM events
                WHERE ${D} AND event='submission' AND status IS NOT NULL
                GROUP BY status ORDER BY n DESC`, date),
      all(env, `SELECT slug, MAX(title) AS title, MAX(difficulty) AS difficulty,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS attempts,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ${D} AND slug IS NOT NULL
                GROUP BY slug ORDER BY attempts DESC, pushes DESC LIMIT 50`, date),
      all(env, `SELECT language, COUNT(*) AS n FROM events
                WHERE ${D} AND language IS NOT NULL
                GROUP BY language ORDER BY n DESC LIMIT 10`, date),
      all(env, `SELECT install_id, MAX(display_name) AS display_name, COUNT(*) AS events,
                       SUM(CASE WHEN event='submission' THEN 1 ELSE 0 END) AS submissions,
                       SUM(CASE WHEN status='Accepted' THEN 1 ELSE 0 END) AS accepted,
                       SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS pushes,
                       MIN(ts) AS first_ts, MAX(ts) AS last_ts
                FROM events WHERE ${D}
                GROUP BY install_id ORDER BY events DESC LIMIT 100`, date),
      all(env, `SELECT COALESCE(difficulty,'Unknown') AS difficulty, COUNT(*) AS n
                FROM events WHERE ${D} AND event='push_ok'
                GROUP BY difficulty ORDER BY n DESC`, date),
    ]);

  const names = await nameMap(env);
  return {
    date,
    generatedAt: Date.now(),
    totals: totals[0] || { events: 0, installs: 0 },
    hourly, statuses, problems, languages, difficulty,
    installs: installs.map(r => ({ ...r, display_name: named(names, r) })),
  };
}

/**
 * Broadcasts — the developer speaking to every user at once.
 *
 * The read is public because every extension polls it, and it deliberately
 * returns one row and nothing else: no counts, no history, nothing about who
 * has seen it. Writing needs the dashboard key.
 *
 * Sending deactivates whatever came before, so there is only ever one live
 * message. Two at once would race for the same modal and the loser would
 * never be seen.
 */
const ANNOUNCE_TYPES = new Set(['info', 'warn', 'success']);
const MAX_ANNOUNCE = 400;

async function liveAnnouncement(env) {
  const rows = await all(env,
    `SELECT id, title, message, type, url, created_at
     FROM announcements WHERE active = 1
     ORDER BY created_at DESC, id DESC LIMIT 1`);
  return { announcement: rows[0] || null };
}

async function sendAnnouncement(env, body) {
  const message = str(body && body.message, MAX_ANNOUNCE);
  if (!message) return json({ error: 'message is required' }, 400);

  const title = str(body && body.title, 80);
  const url = str(body && body.url, 300);
  if (url && !/^https:\/\//i.test(url)) {
    // The extension renders this as a link, so anything but https is refused
    // here rather than left for the client to decide.
    return json({ error: 'url must be https' }, 400);
  }
  const rawType = str(body && body.type, 20);
  const type = ANNOUNCE_TYPES.has(rawType) ? rawType : 'info';

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE announcements SET active = 0 WHERE active = 1'),
    env.DB.prepare(`INSERT INTO announcements (title, message, type, url, created_at, active)
                    VALUES (?, ?, ?, ?, ?, 1)`).bind(title, message, type, url, now),
  ]);
  return json(await liveAnnouncement(env));
}

async function clearAnnouncements(env) {
  await env.DB.prepare('UPDATE announcements SET active = 0 WHERE active = 1').run();
  return json({ announcement: null, cleared: true });
}

/** What was sent, for the dashboard's own history list. */
async function announcementHistory(env, limit) {
  return {
    rows: await all(env,
      `SELECT id, title, message, type, url, created_at, active
       FROM announcements ORDER BY created_at DESC, id DESC LIMIT ?`, limit),
  };
}

/**
 * Public leaderboard.
 *
 * Hard 10, Medium 5, Easy 3 — scored per problem, not per event, so
 * re-submitting the same question cannot farm points. A problem counts from
 * the first time it was solved, which is also what places it in the daily and
 * weekly boards.
 *
 * Only installs that switched usage reporting on can appear at all: every
 * other install sends nothing but `ping`, which carries no slug and so never
 * reaches the solves table below. That is the participation rule enforced by
 * the data rather than by a flag someone could forget to check.
 *
 * Names, never ids. The board is world-readable, so an install with no chosen
 * username shows as "Anonymous" instead of leaking an identifier that could be
 * correlated across requests. A caller still gets its own rank by sending its
 * own id, which it obviously already knows.
 *
 * Windows are UTC days, matching how ts is stored.
 */
const POINTS = { Hard: 10, Medium: 5, Easy: 3 };

const SOLVES_CTE = `
  WITH solves AS (
    SELECT install_id, slug,
           MIN(ts) AS first_ts,
           MAX(difficulty) AS difficulty
    FROM events
    WHERE slug IS NOT NULL
      AND (event = 'push_ok' OR status = 'Accepted')
    GROUP BY install_id, slug
  ),
  scored AS (
    SELECT install_id, first_ts,
           CASE difficulty
             WHEN 'Hard' THEN ${POINTS.Hard}
             WHEN 'Medium' THEN ${POINTS.Medium}
             WHEN 'Easy' THEN ${POINTS.Easy}
             ELSE 0
           END AS points,
           difficulty
    FROM solves
  )`;

/** One board. `since` of 0 means all time. */
async function board(env, since, limit) {
  return all(env, `${SOLVES_CTE}
    SELECT install_id,
           SUM(points) AS points,
           COUNT(*) AS solved,
           SUM(CASE WHEN difficulty = 'Hard' THEN 1 ELSE 0 END) AS hard,
           SUM(CASE WHEN difficulty = 'Medium' THEN 1 ELSE 0 END) AS medium,
           SUM(CASE WHEN difficulty = 'Easy' THEN 1 ELSE 0 END) AS easy,
           MAX(first_ts) AS last_ts
    FROM scored
    WHERE first_ts >= ?
    GROUP BY install_id
    HAVING points > 0
    ORDER BY points DESC, solved DESC, last_ts ASC
    LIMIT ?`, since, limit);
}

const startOfUtcDay = (now) => Date.UTC(
  new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());

async function leaderboard(env, installId, limit) {
  const now = Date.now();
  const dayStart = startOfUtcDay(now);
  const weekStart = dayStart - 6 * 86400000;      // today plus the six before it

  const [names, allTime, weekly, daily] = await Promise.all([
    nameMap(env),
    board(env, 0, 200),
    board(env, weekStart, 200),
    board(env, dayStart, 200),
  ]);

  const shape = (rows) => {
    const ranked = rows.map((row, i) => ({
      rank: i + 1,
      name: names.get(row.install_id) || null,
      points: row.points,
      solved: row.solved,
      hard: row.hard,
      medium: row.medium,
      easy: row.easy,
    }));
    const mine = installId
      ? ranked[rows.findIndex(r => r.install_id === installId)] || null
      : null;
    return {
      top: ranked.slice(0, limit).map(r => ({ ...r, name: r.name || 'Anonymous' })),
      you: mine,
      players: ranked.length,
    };
  };

  return {
    generatedAt: now,
    points: POINTS,
    // Stated rather than implied: a client showing "today" needs to know whose
    // midnight it is before it labels the column.
    window: { dayStart, weekStart, timezone: 'UTC' },
    allTime: shape(allTime),
    weekly: shape(weekly),
    daily: shape(daily),
  };
}

/**
 * Usernames must be unique across every install, so the check cannot live on
 * the device — two people would happily pick the same one offline. This is
 * the authority: a name belongs to whichever install holds its row.
 *
 * Reachable without the dashboard key, like ingest, because the extension
 * calls it during setup. It answers only "is this name yours or taken", never
 * who holds it.
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,22}[A-Za-z0-9]$/;

async function claimName(env, rawName, rawInstall) {
  const name = str(rawName, MAX_NAME);
  const installId = str(rawInstall, 64);
  if (!installId) return json({ ok: false, reason: 'install id required' }, 400);

  // An empty name releases whatever this install held.
  if (!name) {
    await env.DB.prepare('DELETE FROM names WHERE install_id = ?').bind(installId).run();
    return json({ ok: true, name: null, released: true });
  }
  if (!NAME_RE.test(name)) {
    return json({
      ok: false,
      reason: 'invalid',
      detail: '3 to 24 characters: letters, digits, space, dot, underscore or hyphen.',
    });
  }

  const key = name.toLowerCase();
  const held = await all(env, 'SELECT install_id, name FROM names WHERE name_key = ?', key);

  if (held.length && held[0].install_id !== installId) {
    return json({ ok: false, reason: 'taken' });
  }

  // Free whatever else this install held, then claim. INSERT OR IGNORE keeps
  // a race from throwing; the confirming read below decides the winner.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM names WHERE install_id = ? AND name_key != ?').bind(installId, key),
    env.DB.prepare(`INSERT OR IGNORE INTO names (name_key, name, install_id, claimed_at)
                    VALUES (?, ?, ?, ?)`).bind(key, name, installId, Date.now()),
    env.DB.prepare('UPDATE names SET name = ? WHERE name_key = ? AND install_id = ?')
      .bind(name, key, installId),
  ]);

  const confirm = await all(env, 'SELECT install_id FROM names WHERE name_key = ?', key);
  if (!confirm.length || confirm[0].install_id !== installId) {
    return json({ ok: false, reason: 'taken' });
  }
  return json({ ok: true, name });
}

/**
 * Hourly push-failure check.
 *
 * A bad release breaks pushes for everyone at once, and the dashboard only
 * shows that if someone opens it. This is the part that comes to you.
 *
 * Deliberately quiet: it needs a webhook configured, a real sample to judge
 * (a single failed push out of two is not a signal), and it will not fire
 * again within the cooldown, or a sustained outage would alert every hour.
 */
const ALERT_WINDOW_MS = 3600000;
const ALERT_MIN_PUSHES = 5;      // below this the rate is noise
const ALERT_THRESHOLD = 0.35;    // fraction of pushes failing
const ALERT_COOLDOWN_MS = 21600000;  // 6 hours

async function readMeta(env, key) {
  const rows = await all(env, 'SELECT value FROM meta WHERE key = ?', key);
  return rows.length ? rows[0].value : null;
}

async function checkFailures(env) {
  const webhook = env.ALERT_WEBHOOK;
  if (!webhook) return { skipped: 'no webhook configured' };

  const since = Date.now() - ALERT_WINDOW_MS;
  const rows = await all(env, `
    SELECT SUM(CASE WHEN event='push_ok' THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN event='push_fail' THEN 1 ELSE 0 END) AS failed,
           COUNT(DISTINCT CASE WHEN event='push_fail' THEN install_id END) AS installs
    FROM events WHERE ts >= ? AND event IN ('push_ok','push_fail')`, since);

  const ok = (rows[0] && rows[0].ok) || 0;
  const failed = (rows[0] && rows[0].failed) || 0;
  const installs = (rows[0] && rows[0].installs) || 0;
  const total = ok + failed;
  if (total < ALERT_MIN_PUSHES) return { quiet: true, total };

  const rate = failed / total;
  if (rate < ALERT_THRESHOLD) return { healthy: true, rate };

  const last = Number(await readMeta(env, 'lastAlertTs')) || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return { suppressed: true, rate };

  // Which reasons, so the message says something actionable.
  const reasons = await all(env, `
    SELECT COALESCE(detail,'other') AS reason, COUNT(*) AS n
    FROM events WHERE ts >= ? AND event='push_fail'
    GROUP BY reason ORDER BY n DESC`, since);
  const breakdown = reasons.map(r => `${r.reason} ×${r.n}`).join(', ') || 'unknown';

  const text = `LeetSync: ${failed} of ${total} pushes failed in the last hour`
    + ` (${Math.round(rate * 100)}%), across ${installs} install${installs === 1 ? '' : 's'}.`
    + ` Reasons: ${breakdown}.`;

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Both keys, so one webhook URL works for Slack or Discord unchanged.
      body: JSON.stringify({ text, content: text }),
    });
    await env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .bind('lastAlertTs', String(Date.now())).run();
    return { alerted: true, rate, failed, total };
  } catch (error) {
    // Never throw out of a cron: a failed alert must not retry-storm.
    console.error('[LeetSync] alert failed:', error && error.message);
    return { error: String(error).slice(0, 200) };
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkFailures(env).then(
      (r) => console.log('[LeetSync] failure check:', JSON.stringify(r)),
      (e) => console.error('[LeetSync] failure check threw:', e && e.message)
    ));
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });

    const url = new URL(request.url);
    const int = (name, dflt, lo, hi) =>
      Math.min(Math.max(Number(url.searchParams.get(name)) || dflt, lo), hi);

    // Sending is the one write the dashboard makes, so it carries the key.
    // It has to be matched before the /api/ read block below, which answers
    // every other /api/ path and 404s the ones it does not recognise.
    if (url.pathname === '/api/announcement' && request.method === 'POST') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }
      try {
        return payload && payload.clear === true
          ? await clearAnnouncements(env)
          : await sendAnnouncement(env, payload);
      } catch (error) {
        return json({ error: 'server', detail: String(error).slice(0, 200) }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      const days = int('days', 30, 1, 365);
      try {
        if (url.pathname === '/api/summary') return json(await summary(env, days));
        if (url.pathname === '/api/users') return json(await users(env, days));
        if (url.pathname === '/api/activity') {
          return json(await activity(env, days, int('limit', 200, 1, 1000)));
        }

        if (url.pathname === '/api/retention') return json(await retention(env, days));

        // The same check the hourly cron runs, on demand — so it can be
        // verified without waiting an hour or faking a clock.
        if (url.pathname === '/api/check-failures') return json(await checkFailures(env));

        if (url.pathname === '/api/problem') {
          const slug = str(url.searchParams.get('slug'), 128);
          if (!slug) return json({ error: 'slug required' }, 400);
          return json(await problemDetail(env, slug, days));
        }

        if (url.pathname === '/api/day') {
          const date = str(url.searchParams.get('date'), 10);
          // Anything but YYYY-MM-DD would compare against date() and quietly
          // return an empty day rather than an error, which reads as "nothing
          // happened" — so reject the shape up front.
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return json({ error: 'date must be YYYY-MM-DD' }, 400);
          }
          return json(await dayDetail(env, date));
        }

        if (url.pathname === '/api/user') {
          const id = str(url.searchParams.get('id'), 64);
          if (!id) return json({ error: 'id required' }, 400);
          return json(await userDetail(env, id, int('limit', 300, 1, 1000)));
        }

        if (url.pathname === '/api/code') {
          const id = Number(url.searchParams.get('id'));
          if (!Number.isFinite(id)) return json({ error: 'id required' }, 400);
          const rows = await all(env,
            `SELECT id, ts, install_id, slug, title, language, status, code
             FROM events WHERE id = ?`, Math.floor(id));
          if (!rows.length) return json({ error: 'not found' }, 404);
          if (rows[0].code === null) return json({ error: 'no code stored for this event' }, 404);
          return json(rows[0]);
        }

        if (url.pathname === '/api/announcements') {
          return json(await announcementHistory(env, int('limit', 20, 1, 100)));
        }

        return json({ error: 'unknown endpoint' }, 404);
      } catch (error) {
        return json({ error: 'query failed', detail: String(error).slice(0, 200) }, 500);
      }
    }

    // Public: every extension and the dashboard poll this for the current
    // broadcast. One row, and nothing about who has read it.
    if (url.pathname === '/announcement') {
      try {
        return json(await liveAnnouncement(env));
      } catch (error) {
        return json({ error: 'server', detail: String(error).slice(0, 200) }, 500);
      }
    }

    // Public like ingest: every user's extension reads this, and it returns
    // names and scores only — no install ids, no events.
    if (url.pathname === '/leaderboard') {
      try {
        const mine = str(url.searchParams.get('installId'), 64);
        return json(await leaderboard(env, mine, int('limit', 10, 1, 50)));
      } catch (error) {
        return json({ error: 'server', detail: String(error).slice(0, 200) }, 500);
      }
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    // Claiming a name is a client operation, so it sits outside the read API
    // and its key. It is still write-only from the caller's point of view.
    if (url.pathname === '/claim-name') {
      let claim;
      try {
        claim = await request.json();
      } catch {
        return json({ ok: false, reason: 'invalid json' }, 400);
      }
      try {
        return await claimName(env, claim && claim.name, claim && claim.installId);
      } catch (error) {
        return json({ ok: false, reason: 'server', detail: String(error).slice(0, 200) }, 500);
      }
    }

    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BODY) return json({ error: 'payload too large' }, 413);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const incoming = Array.isArray(body?.events) ? body.events : [];
    if (!incoming.length) return json({ ok: true, stored: 0 });

    const rows = incoming.slice(0, MAX_BATCH).map(clean).filter(Boolean);
    if (!rows.length) return json({ ok: true, stored: 0 });

    const now = Date.now();
    const stmt = env.DB.prepare(
      `INSERT INTO events
        (ts, client_ts, install_id, event, version, slug, title, difficulty,
         language, detail, status, theme, runtime_ms, memory_kb,
         tests_passed, tests_total, code_len, code, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      await env.DB.batch(rows.map(r => stmt.bind(
        now, r.client_ts, r.install_id, r.event, r.version,
        r.slug, r.title, r.difficulty, r.language, r.detail,
        r.status, r.theme, r.runtime_ms, r.memory_kb,
        r.tests_passed, r.tests_total, r.code_len, r.code, r.display_name
      )));
    } catch (error) {
      // The extension retries, so a failure here must be visible to it.
      return json({ error: 'write failed', detail: String(error).slice(0, 200) }, 500);
    }

    return json({ ok: true, stored: rows.length });
  },
};
