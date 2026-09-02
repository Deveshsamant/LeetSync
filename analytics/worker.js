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
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });
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
