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

const MAX_BATCH = 50;             // events per request
const MAX_BODY = 64 * 1024;       // 64 KB — a full batch is far smaller
const EVENTS = new Set([
  'install', 'update', 'push_ok', 'push_fail', 'tab', 'sheet', 'tracker',
  'export', 'import', 'theme', 'repo_setup',
]);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Unknown']);

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

  return {
    install_id: installId,
    event,
    version: str(raw.version, 16),
    slug: str(raw.slug, 128),
    title: str(raw.title, 200),
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty : null,
    language: str(raw.language, 32),
    detail: str(raw.detail, 200),
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

/** Everything the dashboard renders, in one round trip. */
async function summary(env, days) {
  const since = Date.now() - days * 86400000;

  const [totals, daily, events, problems, difficulty, languages, versions, failures, sheets] =
    await Promise.all([
      all(env, `SELECT COUNT(*) AS events, COUNT(DISTINCT install_id) AS installs,
                       MIN(ts) AS first_seen, MAX(ts) AS last_seen
                FROM events WHERE ts >= ?`, since),
      all(env, `SELECT date(ts/1000,'unixepoch') AS day,
                       COUNT(DISTINCT install_id) AS installs, COUNT(*) AS events
                FROM events WHERE ts >= ? GROUP BY day ORDER BY day`, since),
      all(env, `SELECT event, COUNT(*) AS n, COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? GROUP BY event ORDER BY n DESC`, since),
      all(env, `SELECT slug, title, difficulty, COUNT(*) AS pushes,
                       COUNT(DISTINCT install_id) AS installs
                FROM events WHERE ts >= ? AND event='push_ok' AND slug IS NOT NULL
                GROUP BY slug ORDER BY pushes DESC LIMIT 25`, since),
      all(env, `SELECT COALESCE(difficulty,'Unknown') AS difficulty, COUNT(*) AS n
                FROM events WHERE ts >= ? AND event='push_ok'
                GROUP BY difficulty ORDER BY n DESC`, since),
      all(env, `SELECT language, COUNT(*) AS n FROM events
                WHERE ts >= ? AND event='push_ok' AND language IS NOT NULL
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
    ]);

  return {
    days,
    generatedAt: Date.now(),
    totals: totals[0] || { events: 0, installs: 0 },
    daily, events, problems, difficulty, languages, versions, failures, sheets,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });

    const url = new URL(request.url);

    if (url.pathname === '/api/summary') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
      try {
        return json(await summary(env, days));
      } catch (error) {
        return json({ error: 'query failed', detail: String(error).slice(0, 200) }, 500);
      }
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

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
        (ts, client_ts, install_id, event, version, slug, title, difficulty, language, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      await env.DB.batch(rows.map(r => stmt.bind(
        now, r.client_ts, r.install_id, r.event, r.version,
        r.slug, r.title, r.difficulty, r.language, r.detail
      )));
    } catch (error) {
      // The extension retries, so a failure here must be visible to it.
      return json({ error: 'write failed', detail: String(error).slice(0, 200) }, 500);
    }

    return json({ ok: true, stored: rows.length });
  },
};
