/**
 * Generates preview-popup.html: the real popup with a stubbed chrome API
 * injected ahead of popup.js, so the UI can be opened in a plain browser.
 *
 *   node scripts/make-preview.mjs   then open /preview-popup.html
 *
 * Derived from popup.html on every run, so it cannot drift. Not packaged.
 *
 * The names must NOT start with an underscore. Chrome reserves that prefix at
 * the top level of an extension and refuses to load the whole extension if it
 * finds one — "Could not load manifest" — which is a confusing way to discover
 * that a dev-only preview file exists. test/wiring.test.js enforces this.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const stub = `
<script>
// ── Dev-only chrome stub. Sample data mirrors the real message shapes. ──
(function () {
  const solved = [
    { number: 88, title: 'Merge Sorted Array', difficulty: 'Easy', language: 'Java', date: '2026-09-02' },
    { number: 27, title: 'Remove Element', difficulty: 'Easy', language: 'Java', date: '2026-09-02' },
    { number: 26, title: 'Remove Duplicates from Sorted Array', difficulty: 'Easy', language: 'Python', date: '2026-09-01' },
    { number: 1,  title: 'Two Sum', difficulty: 'Easy', language: 'Java', date: '2026-09-01' },
    { number: 121, title: 'Best Time to Buy and Sell Stock', difficulty: 'Easy', language: 'Python', date: '2026-08-31' },
    { number: 169, title: 'Majority Element', difficulty: 'Easy', language: 'C++', date: '2026-08-30' },
    { number: 42, title: 'Trapping Rain Water', difficulty: 'Hard', language: 'C++', date: '2026-08-29' },
    { number: 55, title: 'Jump Game', difficulty: 'Medium', language: 'Java', date: '2026-08-28' }
  ];
  const localStore = {};
  // ?theme= and ?tab= let a capture script drive the preview without having
  // to reach into the page. Defaults match a normal dev open.
  const params = new URLSearchParams(location.search);
  const wantTheme = params.get('theme') === 'light' ? 'light' : 'dark';
  const wantTab = params.get('tab');
  const store = { githubToken: 'ghp_preview', githubRepo: 'Deveshsamant/leetcode-solutions', uiTheme: wantTheme };
  const reply = {
    GET_PROBLEMS:     { success: true, problems: solved },
    GET_STATS:        { pushCount: 11, solvedCount: solved.length, lastPush: new Date(Date.now() - 43e6).toISOString() },
    GET_STREAK:       { currentStreak: 3, longestStreak: 9, solveHistory: ['2026-09-02','2026-09-01','2026-08-31','2026-08-31','2026-08-30'] },
    GET_ACHIEVEMENTS: { unlocked: {
      first_blood: true, on_fire: true, deca: true, easy_rider: true,
      medium_rare: true, night_owl: true, polyglot: true
    } },
    GET_QUEUE_STATUS: { queueLength: 0, items: [] },
    GET_THEME:        { theme: wantTheme },
    GET_SOLUTIONS:    { success: true, solutions: [] },
    ENSURE_REPO:      { success: true, created: false, fullName: 'Deveshsamant/leetcode-solutions',
                        url: 'https://github.com/Deveshsamant/leetcode-solutions', private: false }
  };
  window.chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      getManifest: () => ({ version: '1.5.0' }),
      sendMessage: (msg, cb) => setTimeout(() => cb && cb(reply[msg.type] ?? { success: true }), 10),
      onMessage: { addListener() {} }
    },
    // chrome.storage is asynchronous. Calling back synchronously would run
    // these callbacks during module evaluation and trip the const TDZ, which
    // never happens in the real extension.
    storage: {
      sync: {
        // Honour the requested keys, as the real API does — returning
        // everything hides bugs where code assumes the query filtered.
        get: (k, cb) => setTimeout(() => {
          if (!k) return cb(store);
          const keys = Array.isArray(k) ? k : [k];
          cb(Object.fromEntries(keys.filter(x => x in store).map(x => [x, store[x]])));
        }, 0),
        set: (o, cb) => { Object.assign(store, o); setTimeout(() => cb && cb(), 0); },
        remove: (k, cb) => setTimeout(() => cb && cb(), 0)
      },
      // Backed by a real in-memory object so consent and queue flows behave
      // as they do in the extension.
      local: {
        get: (k, cb) => setTimeout(() => {
          if (!k) return cb(localStore);
          const keys = Array.isArray(k) ? k : [k];
          cb(Object.fromEntries(keys.filter(x => x in localStore).map(x => [x, localStore[x]])));
        }, 0),
        set: (o, cb) => { Object.assign(localStore, o); setTimeout(() => cb && cb(), 0); },
        remove: (k, cb) => {
          (Array.isArray(k) ? k : [k]).forEach(x => delete localStore[x]);
          setTimeout(() => cb && cb(), 0);
        }
      }
    },
    tabs: { create: ({ url }) => window.open(url, '_blank') }
  };

  // Select the requested tab once the popup has wired its own handlers, and
  // flag readiness so a capture waits for paint rather than a fixed delay.
  if (wantTab) {
    window.addEventListener('load', () => setTimeout(() => {
      const tab = document.querySelector(\`[data-tab="\${wantTab}"]\`);
      if (tab) tab.click();
      setTimeout(() => { document.documentElement.dataset.previewReady = '1'; }, 450);
    }, 350));
  } else {
    window.addEventListener('load', () => setTimeout(() => {
      document.documentElement.dataset.previewReady = '1';
    }, 700));
  }
}());
</script>
`;

function build(source, scriptTag, out) {
  const html = readFileSync(source, 'utf8');
  if (!html.includes(scriptTag)) {
    throw new Error(`${source} no longer loads its script the expected way`);
  }
  writeFileSync(out, html.replace(scriptTag, stub + scriptTag));
  console.log(`Wrote ${out}`);
}

build('popup.html', '<script src="popup.js"></script>', 'preview-popup.html');
build('tracker.html', '<script src="tracker.js"></script>', 'preview-tracker.html');
