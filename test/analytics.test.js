const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { Analytics } = require('../analytics.js');

/**
 * The privacy promise is only as good as the code that enforces it, so these
 * assert the two places data can leak: what the client puts on an event, and
 * what the Worker is willing to store.
 */

// ── Client-side field allowlist ──────────────────────────────

test('only allowlisted fields survive pick()', () => {
  const out = Analytics.pick({
    slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy',
    language: 'cpp', detail: 'dash',
    // none of these may pass
    githubToken: 'ghp_secret', repo: 'me/solutions', username: 'devesh',
    email: 'a@b.c', url: 'https://github.com/me/solutions', error: 'boom',
  });
  assert.deepEqual(Object.keys(out).sort(),
    ['detail', 'difficulty', 'language', 'slug', 'title']);
});

test('pick() drops non-strings and empties rather than coercing', () => {
  const out = Analytics.pick({ slug: '', title: null, difficulty: 42, language: {}, detail: 'ok' });
  assert.deepEqual(out, { detail: 'ok' });
});

test('pick() caps field length', () => {
  const out = Analytics.pick({ title: 'x'.repeat(5000) });
  assert.equal(out.title.length, 200);
});

test('analytics ships disabled — no endpoint configured', () => {
  // A real endpoint must be a deliberate edit, never the default.
  assert.equal(Analytics.configured(), false,
    'ENDPOINT is set; analytics would be live for everyone on install');
});

test('client batch size matches the worker limit', () => {
  const worker = readFileSync(join(__dirname, '..', 'analytics', 'worker.js'), 'utf8');
  const cap = Number(/MAX_BATCH\s*=\s*(\d+)/.exec(worker)[1]);
  assert.equal(Analytics.BATCH, cap,
    'a client batch larger than the worker cap would silently drop events');
});

// ── Worker-side validation ───────────────────────────────────
// clean() is not exported, so it is evaluated from source.

const workerSrc = readFileSync(join(__dirname, '..', 'analytics', 'worker.js'), 'utf8');
const clean = (() => {
  const start = workerSrc.indexOf('const MAX_BATCH');
  const end = workerSrc.indexOf('export default');
  return eval(`${workerSrc.slice(start, end)}; clean`);
})();

test('worker keeps a well-formed event', () => {
  const row = clean({
    installId: 'abc', event: 'push_ok', version: '1.6.0',
    slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', language: 'cpp', ts: 123,
  });
  assert.equal(row.event, 'push_ok');
  assert.equal(row.slug, 'two-sum');
  assert.equal(row.difficulty, 'Easy');
  assert.equal(row.client_ts, 123);
});

test('worker rejects unknown event names', () => {
  assert.equal(clean({ installId: 'a', event: 'exfiltrate' }), null);
  assert.equal(clean({ installId: 'a', event: '' }), null);
  assert.equal(clean({ installId: 'a' }), null);
});

test('worker requires an install id', () => {
  assert.equal(clean({ event: 'tab' }), null);
  assert.equal(clean({ event: 'tab', installId: '   ' }), null);
});

test('worker stores no field outside the schema', () => {
  const row = clean({
    installId: 'a', event: 'tab',
    githubToken: 'ghp_secret', repo: 'me/solutions', ip: '1.2.3.4', email: 'a@b.c',
  });
  assert.deepEqual(Object.keys(row).sort(), [
    'client_ts', 'detail', 'difficulty', 'event', 'install_id',
    'language', 'slug', 'title', 'version',
  ]);
  assert.equal(JSON.stringify(row).includes('ghp_secret'), false);
});

test('worker normalises an unexpected difficulty to null', () => {
  assert.equal(clean({ installId: 'a', event: 'push_ok', difficulty: 'Impossible' }).difficulty, null);
});

test('worker truncates oversized strings', () => {
  const row = clean({ installId: 'a', event: 'push_ok', title: 'x'.repeat(9000) });
  assert.equal(row.title.length, 200);
});

test('the schema has no column for identifying data', () => {
  const schema = readFileSync(join(__dirname, '..', 'analytics', 'schema.sql'), 'utf8');
  // Strip "--" comments: they discuss what is deliberately absent, so
  // scanning them would flag the very notes that document the omission.
  const columns = schema
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .map(l => l.trim().split(/\s+/)[0].toLowerCase())
    .filter(Boolean);

  for (const forbidden of ['ip', 'ip_address', 'email', 'username', 'user', 'token', 'repo', 'repository']) {
    assert.equal(columns.includes(forbidden), false,
      `schema.sql defines a "${forbidden}" column`);
  }
  // and confirm the expected ones are all there
  for (const expected of ['install_id', 'event', 'slug', 'difficulty']) {
    assert.ok(columns.includes(expected), `schema.sql is missing "${expected}"`);
  }
});
