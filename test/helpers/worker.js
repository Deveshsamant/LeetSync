const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

/**
 * The real service worker, in a sandbox.
 *
 * Loads background.js as Chrome would -- importScripts and all -- against a
 * stub of chrome.* and a fake GitHub, so tests can call the functions for
 * real instead of reading their source as text. See background-runtime.test.js
 * for why that matters.
 */

const ROOT = join(__dirname, '..', '..');

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
// ── The first push, end to end ────────────────────────────────

/**
 * A GitHub that starts empty and remembers what is committed to it. GETs of
 * anything not yet written answer 404, which is what a brand-new user's
 * repository looks like; PUTs are recorded and then readable.
 *
 * Options play the setups that pass a read and fail a write:
 *   scopes     X-OAuth-Scopes on every answer, as GitHub sends for classic
 *              tokens. Omit it and no header is sent, as for fine-grained.
 *   writable   false: every write answers 404, as GitHub does for a token
 *              without the scope, or a repository it is not granted
 *   exists     false: the repository itself answers 404
 *   isPrivate  what the repository reports
 *   name       its full_name
 */
function fakeGitHub({ scopes, writable = true, exists = true, isPrivate = false,
                      name = 'someone/leetcode-solutions' } = {}) {
  const files = new Map();
  const commits = [];
  const fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    const headers = { 'content-type': 'application/json' };
    if (scopes !== undefined) headers['x-oauth-scopes'] = scopes;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

    if (path === '/user') return json({ login: name.split('/')[0] });

    const repoPath = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (repoPath && !exists) return json({ message: 'Not Found' }, 404);

    const m = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      const file = decodeURIComponent(m[1]);
      if (method === 'PUT') {
        if (!writable) return json({ message: 'Not Found' }, 404);
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
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      return json({ full_name: name, html_url: `https://github.com/${name}`,
                    default_branch: 'main', private: isPrivate });
    }
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

module.exports = { makeChrome, loadWorker, fakeGitHub, loadWorkerWithGitHub, firstSolve, twoSum };
