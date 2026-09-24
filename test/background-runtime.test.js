const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

/**
 * Runs the real service worker in a sandbox.
 *
 * Every other test here reads the source as text, and that is how 2.2.0
 * shipped a push path that threw on every new user's first solve: the
 * notification helper was named `notify`, and checkAchievements already had a
 * parameter called `notify`, so inside it `notify(...)` called a boolean.
 * Nothing that only reads text would ever see that. So this file loads
 * background.js as Chrome would -- importScripts and all -- against a stub of
 * the extension APIs, and calls the functions for real.
 */

const ROOT = join(__dirname, '..');

/** A chrome.* stand-in: real storage, everything else absorbed. */
function makeChrome(local = {}, sync = {}) {
  const calls = [];
  const area = (bag) => ({
    get(keys, cb) {
      const list = keys == null ? Object.keys(bag)
        : Array.isArray(keys) ? keys
          : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = Object.fromEntries(list.filter(k => k in bag).map(k => [k, bag[k]]));
      if (cb) { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(obj, cb) { Object.assign(bag, obj); if (cb) cb(); return Promise.resolve(); },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => delete bag[k]);
      if (cb) cb(); return Promise.resolve();
    },
  });

  // Anything not modelled: a function that records its call and resolves.
  const absorb = (path) => new Proxy(function () {}, {
    get: (_t, key) => (key === 'then' ? undefined : absorb(`${path}.${String(key)}`)),
    apply: (_t, _this, args) => {
      calls.push({ path, args });
      // A listener is registered, not called: invoking it here would fire
      // onAlarm with no alarm. Anything else taking a function is the
      // callback form of a query, which answers "nothing".
      const cb = args.find(a => typeof a === 'function');
      if (cb && !path.endsWith('.addListener')) cb(undefined);
      return Promise.resolve(undefined);
    },
  });

  const chrome = new Proxy({
    storage: { local: area(local), sync: area(sync) },
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '0.0.0-test' }),
      getURL: (p) => p,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage() {},
    },
    notifications: {
      create: (...args) => { calls.push({ path: 'chrome.notifications.create', args }); },
    },
    permissions: {
      contains: (q, cb) => (cb ? cb(false) : Promise.resolve(false)),
      request: (q, cb) => (cb ? cb(false) : Promise.resolve(false)),
    },
  }, { get: (t, key) => (key in t ? t[key] : absorb(`chrome.${String(key)}`)) });

  return { chrome, calls, local, sync };
}

function loadWorker(env) {
  const context = vm.createContext({
    chrome: env.chrome,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('network disabled in tests')),
    crypto: globalThis.crypto,
    TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    self: undefined,
  });
  context.self = context;
  context.importScripts = (...files) => {
    for (const f of files) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), context, { filename: f });
  };
  vm.runInContext(readFileSync(join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  return context;
}

const firstSolve = () => ({
  solvedProblems: {
    1: { number: 1, title: 'Two Sum', difficulty: 'Easy', language: 'C++',
         date: new Date().toISOString().slice(0, 10) },
  },
  streakData: { currentStreak: 1, longestStreak: 1, solveHistory: [new Date().toISOString().slice(0, 10)] },
  pushCount: 1,
});

test('a new user s first solve unlocks achievements without throwing', async () => {
  // The exact 2.2.0-2.2.3 failure: nothing unlocked yet, one problem solved,
  // notifications on. Before the fix this rejected with
  // "notify is not a function" -- after the commit had already landed.
  const env = makeChrome(firstSolve());
  const worker = loadWorker(env);

  const unlocked = await worker.checkAchievements();
  assert.ok(Array.isArray(unlocked) && unlocked.length > 0,
    'expected a first solve to unlock at least one achievement');

  const announced = env.calls.filter(c => c.path === 'chrome.notifications.create');
  assert.equal(announced.length, unlocked.length,
    'each newly unlocked achievement should be announced once');
  assert.ok(Object.keys(env.local.achievements || {}).length >= unlocked.length,
    'the unlocks must be saved');
});

test('restores unlock silently, and a second run unlocks nothing new', async () => {
  const env = makeChrome(firstSolve());
  const worker = loadWorker(env);

  const first = await worker.checkAchievements({ notify: false });
  assert.ok(first.length > 0);
  assert.equal(env.calls.filter(c => c.path === 'chrome.notifications.create').length, 0,
    'notify:false must not announce anything');

  const again = await worker.checkAchievements();
  assert.equal(again.length, 0, 'nothing is unlocked twice');
});

test('without the notifications permission, unlocking still succeeds', async () => {
  // chrome.notifications is undefined until the optional permission is
  // granted. The helper must check rather than assume.
  const env = makeChrome(firstSolve());
  delete env.chrome.notifications;
  const bare = new Proxy(env.chrome, {
    get: (t, key) => (key === 'notifications' ? undefined : t[key]),
  });
  const worker = loadWorker({ ...env, chrome: bare });
  const unlocked = await worker.checkAchievements();
  assert.ok(unlocked.length > 0);
});

// ── The first push, end to end ────────────────────────────────

/**
 * A GitHub that starts empty and remembers what is committed to it. GETs of
 * anything not yet written answer 404, which is what a brand-new user's
 * repository looks like; PUTs are recorded and then readable.
 */
function fakeGitHub() {
  const files = new Map();
  const commits = [];
  const fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
    const m = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      const file = decodeURIComponent(m[1]);
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        files.set(file, body.content);
        commits.push({ file, message: body.message });
        return json({ content: { path: file, sha: `sha-${commits.length}` }, commit: { sha: `c-${commits.length}` } }, 201);
      }
      if (files.has(file)) return json({ path: file, sha: 'sha-existing', content: files.get(file), encoding: 'base64' });
      // A folder listing for a folder that has files under it.
      const children = [...files.keys()].filter(f => f.startsWith(file + '/'));
      if (children.length) return json(children.map(f => ({ name: f.slice(file.length + 1), path: f, type: 'file', sha: 'x' })));
      return json({ message: 'Not Found' }, 404);
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return json({ default_branch: 'main', private: false });
    return json({ message: 'Not Found' }, 404);
  };
  return { fetch, files, commits };
}

function loadWorkerWithGitHub(env, gh) {
  const context = vm.createContext({
    chrome: env.chrome,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: gh.fetch, Response, Headers,
    crypto: globalThis.crypto,
    TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  });
  context.self = context;
  context.importScripts = (...files) => {
    for (const f of files) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), context, { filename: f });
  };
  vm.runInContext(readFileSync(join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  return context;
}

const twoSum = {
  number: 1, title: 'Two Sum', difficulty: 'Easy', tags: ['Array', 'Hash Table'],
  description: '<p>Given an array of integers…</p>', url: 'https://leetcode.com/problems/two-sum/',
  language: 'C++', code: 'class Solution {\npublic:\n  vector<int> twoSum() { return {}; }\n};\n',
  runtime: '0 ms', memory: '12 MB', timestamp: Date.now(),
};

test('a brand-new user s first push succeeds, commits, and unlocks', async () => {
  // Nothing solved, nothing unlocked, an empty repository: the first thing
  // every new user does. 2.2.0-2.2.3 committed the files here and then
  // reported failure, because the achievement it had just unlocked threw.
  const env = makeChrome({}, { githubToken: 'ghp_test', githubRepo: 'someone/leetcode-solutions' });
  const gh = fakeGitHub();
  const worker = loadWorkerWithGitHub(env, gh);

  const result = await worker.pushToGitHub(twoSum);

  assert.equal(result.success, true, 'the push must report success');
  assert.ok(gh.commits.some(c => /problems\/0001-Two-Sum\/sol1\./.test(c.file)),
    'the solution file was not committed: ' + gh.commits.map(c => c.file).join(', '));
  assert.ok(env.local.solvedProblems && env.local.solvedProblems[1], 'the solve is recorded locally');
  assert.ok(Object.keys(env.local.achievements || {}).length > 0,
    'a first solve unlocks something, and the unlock is saved');
});

test('a fault after the commit does not turn the push into a failure', async () => {
  // Whatever goes wrong in bookkeeping, the file is already on GitHub, and
  // "This submission was not saved" would be false.
  const env = makeChrome({}, { githubToken: 'ghp_test', githubRepo: 'someone/leetcode-solutions' });
  const gh = fakeGitHub();
  const worker = loadWorkerWithGitHub(env, gh);
  worker.checkAchievements = async () => { throw new Error('bookkeeping exploded'); };

  const result = await worker.pushToGitHub(twoSum);
  assert.equal(result.success, true);
  assert.ok(gh.commits.length > 0);
});
