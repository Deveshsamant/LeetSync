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

test('the endpoint is https and covered by a host permission', () => {
  // A configured endpoint with no matching host_permission fails silently at
  // runtime — the fetch is simply blocked — so the two must agree.
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  const endpoint = /const ENDPOINT = '([^']*)'/.exec(src)[1];
  if (!endpoint) return;                       // unconfigured is valid too

  assert.match(endpoint, /^https:\/\//, 'endpoint must be https');
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  const host = new URL(endpoint).host;
  const covered = manifest.host_permissions.some(p => p.includes(host));
  assert.ok(covered,
    `manifest has no host_permission for ${host}; every send would be blocked`);
});

test('consent is off until explicitly granted', () => {
  // Being configured must never imply being enabled.
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(src, /return on === true/,
    'isEnabled must require an explicit true, so absent storage means off');
  assert.match(src, /if \(!await isEnabled\(\)\) return;/,
    'track() must bail before touching storage when consent is absent');
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
    'client_ts', 'code', 'code_len', 'detail', 'difficulty', 'display_name',
    'event', 'install_id', 'language', 'memory_kb', 'runtime_ms', 'slug',
    'status', 'tests_passed', 'tests_total', 'theme', 'title', 'version',
  ]);
  assert.equal(JSON.stringify(row).includes('ghp_secret'), false);
});

test('a display name is optional and never invented', () => {
  // Absent means anonymous; the Worker must not substitute anything.
  assert.equal(clean({ installId: 'a', event: 'session' }).display_name, null);
  assert.equal(clean({ installId: 'a', event: 'session', name: '   ' }).display_name, null);
  assert.equal(clean({ installId: 'a', event: 'session', name: 'Devesh' }).display_name, 'Devesh');
  assert.equal(
    clean({ installId: 'a', event: 'session', name: 'x'.repeat(200) }).display_name.length, 40);
});

test('pick() never carries a display name from a caller', () => {
  // track() reads it from storage; a caller must not be able to set one.
  assert.deepEqual(Object.keys(Analytics.pick({ name: 'someone else', slug: 'two-sum' })), ['slug']);
});

test('withdrawing consent drops the queue and revokes code sharing', () => {
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(src, /remove\(\[QUEUE_KEY\]/,
    'setEnabled(false) must drop anything still waiting to be sent');
  assert.match(src, /setLocal\(\{ \[SHARE_CODE_KEY\]: false \}\)/,
    'setEnabled(false) must revoke code sharing, or re-enabling would resume it');
});

test('a username can be released, which is what undoes the identity', () => {
  // The username is reserved against other users and the reservation is held
  // by the install id, so consent alone cannot drop either — clearing the
  // name is the action that frees it.
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(src, /async function claimName/, 'claimName must exist');
  const worker = readFileSync(join(__dirname, '..', 'analytics', 'worker.js'), 'utf8');
  assert.match(worker, /if \(!name\) \{[\s\S]{0,200}DELETE FROM names WHERE install_id/,
    'an empty name must release whatever the install held');
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

// ── Solution code is a second, separate consent ──────────────

test('pick() never carries code, whatever the caller passes', () => {
  // track() attaches code itself, after its own consent check. If pick()
  // also passed it through, the usage toggle alone would ship source.
  const out = Analytics.pick({ code: 'class Solution { /* mine */ }', slug: 'two-sum' });
  assert.deepEqual(Object.keys(out), ['slug']);
});

test('code is attached only behind its own consent check', () => {
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(src, /await sharesCode\(\)/,
    'track() must consult sharesCode() before attaching source');
  assert.match(src, /sharesCode[\s\S]{0,260}?return on === true/,
    'sharesCode must require an explicit true, so absent storage means off');
  // Switching reporting off has to revoke code sharing too, or it would
  // silently resume the moment reporting came back on.
  assert.match(src, /setLocal\(\{ \[SHARE_CODE_KEY\]: false \}\)/,
    'setEnabled(false) must clear the code-sharing consent');
});

test('code sharing cannot outlive usage reporting', () => {
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(src, /on === true && await isEnabled\(\)/,
    'setShareCode must refuse while usage reporting is off');
});

test('client and worker agree on the code cap', () => {
  const worker = readFileSync(join(__dirname, '..', 'analytics', 'worker.js'), 'utf8');
  const cap = Number(/MAX_CODE\s*=\s*(\d+)/.exec(worker)[1]);
  assert.equal(Analytics.MAX_CODE, cap,
    'a client cap above the worker cap would silently truncate stored code');
});

// ── Numbers and enums ────────────────────────────────────────

test('pick() takes real numbers and refuses numeric strings', () => {
  assert.deepEqual(Analytics.pick({ runtimeMs: 52, memoryKb: 43110 }),
    { runtimeMs: 52, memoryKb: 43110 });
  // A number arriving as text means the caller is confused; guessing would
  // store a figure nobody measured.
  assert.deepEqual(Analytics.pick({ runtimeMs: '52', testsPassed: -3 }), {});
});

test('worker folds an unrecognised verdict into Other', () => {
  assert.equal(clean({ installId: 'a', event: 'submission', status: 'Accepted' }).status, 'Accepted');
  assert.equal(clean({ installId: 'a', event: 'submission', status: 'Wrong Answer' }).status, 'Wrong Answer');
  // Upstream is free to invent verdicts; none of them become new column values.
  assert.equal(clean({ installId: 'a', event: 'submission', status: 'Banana' }).status, 'Other');
  assert.equal(clean({ installId: 'a', event: 'submission' }).status, null);
});

test('worker accepts only the two real themes', () => {
  assert.equal(clean({ installId: 'a', event: 'session', theme: 'light' }).theme, 'light');
  assert.equal(clean({ installId: 'a', event: 'session', theme: 'cyberpunk' }).theme, null);
});

test('worker accepts the new event names', () => {
  for (const event of ['submission', 'session']) {
    assert.ok(clean({ installId: 'a', event }), `${event} must be storable`);
  }
});

test('worker truncates oversized code rather than rejecting the row', () => {
  const row = clean({ installId: 'a', event: 'push_ok', code: 'x'.repeat(50000) });
  assert.equal(row.code.length, 20000);
});

test('every column clean() emits exists in the schema', () => {
  // A field the Worker builds but the table lacks fails at INSERT, in
  // production, on a live batch.
  const schema = readFileSync(join(__dirname, '..', 'analytics', 'schema.sql'), 'utf8');
  const columns = new Set(schema
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .map(l => l.trim().split(/\s+/)[0].toLowerCase())
    .filter(Boolean));

  const row = clean({ installId: 'a', event: 'submission' });
  for (const key of Object.keys(row)) {
    assert.ok(columns.has(key), `clean() emits "${key}" but schema.sql has no such column`);
  }
});
