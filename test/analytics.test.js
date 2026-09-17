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
  // A configured endpoint with no matching host permission fails silently at
  // runtime — the fetch is simply blocked — so the two must agree.
  //
  // Optional counts. Since 2.2.0 the Worker's origin lives in
  // optional_host_permissions so that it stays out of Chrome's install
  // dialog, and analytics.js asks for it at the point reporting is switched
  // on. What must not happen is the endpoint appearing in neither list.
  const src = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  const endpoint = /const ENDPOINT = '([^']*)'/.exec(src)[1];
  if (!endpoint) return;                       // unconfigured is valid too

  assert.match(endpoint, /^https:\/\//, 'endpoint must be https');
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  const host = new URL(endpoint).host;
  const declared = [
    ...(manifest.host_permissions || []),
    ...(manifest.optional_host_permissions || []),
  ];
  assert.ok(declared.some(p => p.includes(host)),
    `manifest declares ${host} in neither host_permissions nor `
    + 'optional_host_permissions; every send would be blocked');
});

test('an optional origin is gated and asked for', () => {
  // Declaring it optional is only half of it. If the origin is optional then
  // every send has to check first — an ungranted fetch is blocked, and a
  // caller that never asks leaves reporting permanently silent with no
  // symptom the user could report.
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  if (!(manifest.optional_host_permissions || []).length) return;

  const analytics = readFileSync(join(__dirname, '..', 'analytics.js'), 'utf8');
  assert.match(analytics, /chrome\.permissions\.contains/,
    'analytics.js must check the optional origin before sending');
  assert.match(analytics, /chrome\.permissions\.request/,
    'analytics.js must expose a way to ask for the optional origin');
  assert.ok(!/await fetch\(/.test(analytics),
    'every send must go through the permission gate, not raw fetch()');

  const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');
  assert.ok(/requestHost\(\)/.test(popup) || /permissions\.request/.test(popup),
    'the popup must ask for the origin when reporting is switched on');
});

test('the consent step saves the switches before it asks the browser', () => {
  // Two releases got the order wrong in two different ways, and both showed
  // up in the database rather than in a test.
  //
  // 2.2.0 claimed the username at step 2 and asked for the permission at step
  // 4; the claim went through the permission gate and nobody could pass step
  // 2. 2.2.1 moved the request up but still AWAITED it before saving the
  // switches -- and for every new user, nothing after that await ran: the
  // names table filled while consent never arrived.
  //
  // So the rule is checked as an order of statements inside finishConsent:
  // persist first, then request, then claim.
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  if (!(manifest.optional_host_permissions || []).length) return;

  const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');
  const start = popup.indexOf('async function finishConsent(');
  assert.ok(start > 0, 'finishConsent not found');
  const body = popup.slice(start, popup.indexOf('\n  }\n', start));

  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i >= 0, `finishConsent no longer contains ${needle}`);
    return i;
  };
  const persist = at('Analytics.setEnabled(');
  const request = at('grantOptional(');
  const claim = at("type: 'CLAIM_NAME'");

  assert.ok(persist < request,
    'finishConsent asks for the permission before saving the switches; '
    + 'the save is lost to the prompt and reporting reads as off');
  assert.ok(request < claim,
    'finishConsent claims the username before the origin can have been granted');

  // And the save must not sit behind an await of the request.
  const between = body.slice(persist, request);
  assert.ok(!/\bawait\b/.test(between),
    'there is an await between issuing the save and issuing the request; '
    + 'the request must be in the same tick as the click');

  // Step 2 is the token only now. A claim there would be before the repo is
  // known, so a returning user could not be recognised first.
  const s2 = popup.indexOf("getElementById('wizNext2').addEventListener");
  const s2body = popup.slice(s2, popup.indexOf('\n  });\n', s2));
  assert.ok(!s2body.includes('CLAIM_NAME'),
    'step 2 claims the username; that belongs on step 4, after the repository is read');
});

test('nothing in the popup awaits a permission prompt before persisting', () => {
  // The prompt closes the popup. Anything awaited after
  // chrome.permissions.request() in popup context may never run, and three
  // releases each lost something different to that: the username claim
  // (2.2.0), the consent switches (2.2.1), and Settings' own reporting
  // switch (2.2.2). Every handler that can raise the prompt must issue its
  // storage write before it issues the request.
  const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');

  const handler = (anchor) => {
    const start = popup.indexOf(anchor);
    assert.ok(start > 0, `handler not found: ${anchor}`);
    return popup.slice(start, popup.indexOf('\n  });\n', start));
  };

  for (const [anchor, persist] of [
    ["analyticsToggle.addEventListener('click'", 'Analytics.setEnabled('],
    ["pingToggle.addEventListener('click'", 'Analytics.setPing('],
  ]) {
    const body = handler(anchor);
    const p = body.indexOf(persist);
    const r = body.indexOf('requestHost(');
    assert.ok(p >= 0 && r >= 0, `${anchor}: expected both ${persist} and requestHost()`);
    assert.ok(p < r, `${anchor}: requests the permission before persisting; the save is lost to the prompt`);
    assert.ok(!/\bawait\b/.test(body.slice(p, r)),
      `${anchor}: awaits between the save and the request; the request must be in the click's tick`);
  }
});

test('the setup wizard only renders as a tab', () => {
  // The popup shows a launcher; the wizard runs in popup.html?setup=1. That is
  // the structural fix for the prompt closing the popup, and it only holds if
  // the popup never shows the wizard itself.
  const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');
  const html = readFileSync(join(__dirname, '..', 'popup.html'), 'utf8');
  assert.match(popup, /IN_SETUP_TAB = new URLSearchParams\(location\.search\)\.get\('setup'\) === '1'/,
    'popup.js does not read the setup flag');
  assert.ok(html.includes('id="setupLauncher"') && html.includes('id="setupLaunch"'),
    'popup.html has no setup launcher');
  // In the gate, the popup branch must return before showing the wizard.
  const gate = popup.slice(popup.indexOf("chrome.storage.sync.get(['githubToken', 'githubRepo', 'wizardStep']"));
  const popupBranch = gate.slice(0, gate.indexOf("wizardOverlay.style.display = 'flex'"));
  assert.match(popupBranch, /if \(!IN_SETUP_TAB\)/, 'the gate does not branch on IN_SETUP_TAB before showing the wizard');
  assert.match(popupBranch, /setupLauncher\.style\.display = 'flex'/, 'the popup branch does not show the launcher');
  assert.match(popupBranch, /return;/, 'the popup branch does not return before the wizard is shown');

  const bg = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(bg, /details\.reason === 'install'[\s\S]{0,200}popup\.html\?setup=1/,
    'a fresh install does not open the setup tab');
});

test('entering the consent step reads the repository before asking for a name', () => {
  const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');
  assert.match(popup, /if \(step === 4\) prepareConsentStep\(\)/,
    'step 4 does not run prepareConsentStep on entry');
  const start = popup.indexOf('function prepareConsentStep(');
  const body = popup.slice(start, popup.indexOf('\n  }\n', start));
  assert.match(body, /SYNC_DEVICES/, 'prepareConsentStep does not read the shared document');
  assert.match(body, /write: false/, 'the read on entering step 4 must not publish');
});

test('optional permissions are never assumed present', () => {
  // chrome.notifications is undefined until the optional permission is
  // granted, so a bare call throws and takes the rest of the handler with it.
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  if (!(manifest.optional_permissions || []).includes('notifications')) return;

  const background = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  const bare = background.split('\n').filter(
    line => /chrome\.notifications\.create\(/.test(line)
      && !/if \(!chrome\.notifications/.test(line));
  // The one inside notify() is guarded by the line above it; anything else is
  // an unguarded call site.
  assert.equal(bare.length, 1,
    `expected notifications to be reached only through notify(); found ${bare.length}`);
  assert.match(background, /function notify\(/,
    'background.js must funnel notifications through a guarded helper');
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
  assert.equal(clean({ event: 'push_ok' }), null);
  assert.equal(clean({ event: 'push_ok', installId: '   ' }), null);
});

test('worker stores no field outside the schema', () => {
  const row = clean({
    installId: 'a', event: 'push_ok',
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
  assert.equal(clean({ installId: 'a', event: 'theme' }).display_name, null);
  assert.equal(clean({ installId: 'a', event: 'theme', name: '   ' }).display_name, null);
  assert.equal(clean({ installId: 'a', event: 'theme', name: 'Devesh' }).display_name, 'Devesh');
  assert.equal(
    clean({ installId: 'a', event: 'theme', name: 'x'.repeat(200) }).display_name.length, 40);
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
  assert.equal(clean({ installId: 'a', event: 'theme', theme: 'light' }).theme, 'light');
  assert.equal(clean({ installId: 'a', event: 'theme', theme: 'cyberpunk' }).theme, null);
});

test('worker accepts the new event names', () => {
  for (const event of ['submission', 'theme']) {
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

// ── Failure alerting ─────────────────────────────────────────
// checkFailures is not exported either, so it is evaluated from source with
// a stubbed database and fetch. Nothing leaves the process.

const checkFailures = (() => {
  const start = workerSrc.indexOf('const MAX_BATCH');
  const end = workerSrc.indexOf('export default');
  return eval(`${workerSrc.slice(start, end)}; checkFailures`);
})();

/** A database that answers the two queries checkFailures makes. */
function stubEnv({ ok, failed, installs, lastAlertTs, webhook = 'https://example.invalid/hook' }) {
  const sent = [];
  const rowsFor = (sql) => {
    if (sql.includes('lastAlertTs') || sql.includes('FROM meta')) {
      return lastAlertTs === undefined ? [] : [{ value: String(lastAlertTs) }];
    }
    if (sql.includes("event='push_fail'") && sql.includes('GROUP BY reason')) {
      return [{ reason: 'auth', n: failed }];
    }
    return [{ ok, failed, installs }];
  };
  const env = {
    ALERT_WEBHOOK: webhook,
    DB: {
      prepare: (sql) => ({
        bind: () => ({ all: async () => ({ results: rowsFor(sql) }), run: async () => ({}) }),
        all: async () => ({ results: rowsFor(sql) }),
        run: async () => ({}),
      }),
    },
  };
  return { env, sent };
}

test('no webhook means the check does nothing at all', async () => {
  // null, not undefined: a default parameter would fire on undefined and
  // hand the stub a webhook after all.
  const { env } = stubEnv({ ok: 0, failed: 99, installs: 9, webhook: null });
  const out = await checkFailures(env);
  assert.equal(out.skipped, 'no webhook configured');
});

test('a tiny sample is not a signal', async () => {
  // Two pushes, both failed, is 100% — and means nothing.
  const { env } = stubEnv({ ok: 0, failed: 2, installs: 1 });
  const out = await checkFailures(env);
  assert.equal(out.quiet, true);
  assert.equal(out.total, 2);
});

test('a healthy failure rate does not alert', async () => {
  const { env } = stubEnv({ ok: 95, failed: 5, installs: 2 });
  const out = await checkFailures(env);
  assert.equal(out.healthy, true);
});

test('a spike alerts, and says how bad and why', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  try {
    const { env } = stubEnv({ ok: 10, failed: 40, installs: 7 });
    const out = await checkFailures(env);
    assert.equal(out.alerted, true);
    assert.equal(out.failed, 40);
    assert.equal(out.total, 50);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    // Both keys, so one URL works for Slack or Discord unchanged.
    assert.equal(body.text, body.content);
    assert.match(body.text, /40 of 50 pushes failed/);
    assert.match(body.text, /7 installs/);
    assert.match(body.text, /auth/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an ongoing outage does not alert every hour', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls.push(1); return { ok: true }; };
  try {
    const { env } = stubEnv({ ok: 10, failed: 40, installs: 7, lastAlertTs: Date.now() - 60000 });
    const out = await checkFailures(env);
    assert.equal(out.suppressed, true);
    assert.equal(calls.length, 0, 'nothing should be sent inside the cooldown');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a webhook that throws does not escape the cron', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  try {
    const { env } = stubEnv({ ok: 10, failed: 40, installs: 7 });
    const out = await checkFailures(env);
    assert.match(out.error, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/**
 * `tab` and `session` were 91% of everything stored and answered nothing —
 * which panel someone opened does not tell you whether the product works.
 * They are refused here as well as unsent, so an extension that has not
 * updated stops adding to the pile.
 */
test('the retired noisy events are refused', () => {
  for (const event of ['tab', 'session']) {
    assert.equal(clean({ installId: 'a', event }), null, `${event} should be dropped`);
  }
});

test('the events worth keeping still pass', () => {
  for (const event of ['install', 'update', 'push_ok', 'push_fail', 'submission',
                       'sheet', 'tracker', 'export', 'import', 'theme',
                       'readme_theme', 'repo_setup', 'ping']) {
    assert.ok(clean({ installId: 'a', event }), `${event} should be accepted`);
  }
});
