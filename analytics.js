/* ============================================================
   analytics.js — opt-in usage reporting.

   Off by default. Nothing is queued, stored or sent until the user turns it
   on in Settings, and turning it off clears the queue and forgets the
   install id, so re-enabling starts a new one.

   What is sent: a random install id, the extension version, which feature
   was used, and — because problem-level detail was asked for — the LeetCode
   slug, title, difficulty and language of pushed solutions.

   What is never sent: the GitHub token, the repository name, the GitHub
   username, or any error text (failures are reduced to a category, since
   messages can contain a repo path).

   Loaded by both the service worker (importScripts) and the popup (<script>).
   The service worker owns the queue; the popup forwards through it, so there
   is only ever one writer.
   ============================================================ */

const Analytics = (() => {
  // The deployed Worker. Being configured does not mean anything is sent —
  // the consent check below still gates every call. Empty disables it wholly.
  const ENDPOINT = 'https://leetsync-analytics.devsamant1744.workers.dev';

  const CONSENT_KEY = 'analyticsEnabled';
  const ID_KEY = 'analyticsInstallId';
  const QUEUE_KEY = 'analyticsQueue';

  const MAX_QUEUE = 200;   // events kept while offline; oldest dropped past this
  const BATCH = 50;        // must match the Worker's MAX_BATCH

  const isWorker = typeof window === 'undefined';
  const configured = () => typeof ENDPOINT === 'string' && ENDPOINT.startsWith('https://');

  const local = (keys) => new Promise(r => chrome.storage.local.get(keys, d => r(d || {})));
  const setLocal = (obj) => new Promise(r => chrome.storage.local.set(obj, r));

  async function isEnabled() {
    const { [CONSENT_KEY]: on } = await local([CONSENT_KEY]);
    return on === true;                       // absent means off
  }

  /** Random, not derived from anything about the user or their account. */
  async function installId() {
    const data = await local([ID_KEY]);
    if (data[ID_KEY]) return data[ID_KEY];
    const id = (crypto.randomUUID && crypto.randomUUID())
      || Math.random().toString(36).slice(2) + Date.now().toString(36);
    await setLocal({ [ID_KEY]: id });
    return id;
  }

  const version = () => {
    try { return chrome.runtime.getManifest().version; } catch { return null; }
  };

  /**
   * Record one event. A no-op unless an endpoint is configured and the user
   * has opted in — the disabled path touches no storage at all.
   */
  async function track(event, fields = {}) {
    if (!configured()) return;
    if (!await isEnabled()) return;

    if (!isWorker) {
      // Popup: hand to the service worker so the queue has a single writer.
      try { chrome.runtime.sendMessage({ type: 'TRACK', event, fields }); } catch { /* popup closing */ }
      return;
    }

    const entry = {
      event,
      ts: Date.now(),
      installId: await installId(),
      version: version(),
      ...pick(fields),
    };

    const { [QUEUE_KEY]: queue = [] } = await local([QUEUE_KEY]);
    queue.push(entry);
    // Keep the newest; an old backlog is worth less than a bounded store.
    await setLocal({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
  }

  /** Only these fields ever leave the device. */
  function pick(fields) {
    const out = {};
    for (const key of ['slug', 'title', 'difficulty', 'language', 'detail']) {
      if (typeof fields[key] === 'string' && fields[key]) {
        out[key] = fields[key].slice(0, 200);
      }
    }
    return out;
  }

  /** Send what is queued. Anything not accepted stays for the next attempt. */
  async function flush() {
    if (!configured() || !isWorker) return;
    if (!await isEnabled()) return;

    const { [QUEUE_KEY]: queue = [] } = await local([QUEUE_KEY]);
    if (!queue.length) return;

    const batch = queue.slice(0, BATCH);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) return;                       // keep the queue, try later
      await setLocal({ [QUEUE_KEY]: queue.slice(batch.length) });
    } catch {
      // Offline or blocked — the queue survives, capped at MAX_QUEUE.
    }
  }

  /** Turning it off must leave nothing behind. */
  async function setEnabled(on) {
    await setLocal({ [CONSENT_KEY]: on === true });
    if (on) {
      // Created here rather than on the first event, so settings can show it
      // immediately for a deletion request.
      await installId();
      return;
    }
    await new Promise(r => chrome.storage.local.remove([QUEUE_KEY, ID_KEY], r));
  }

  return { track, flush, isEnabled, setEnabled, configured, CONSENT_KEY, QUEUE_KEY, ID_KEY, pick, MAX_QUEUE, BATCH };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Analytics };
