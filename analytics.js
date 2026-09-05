/* ============================================================
   analytics.js — opt-in usage reporting.

   Off by default. Nothing is queued, stored or sent until the user turns it
   on in Settings, and turning it off clears the queue and forgets the
   install id, so re-enabling starts a new one.

   What is sent once usage reporting is on: a random install id, the
   extension version, which feature was used, the chosen theme, and — for
   each submission — the LeetCode slug, title, difficulty, language, verdict
   ("Accepted", "Wrong Answer", ...), runtime, memory and testcase counts.

   What is never sent: the GitHub token, the repository name, the GitHub
   username, or any error text (failures are reduced to a category, since
   messages can contain a repo path).

   Solution source code is a SEPARATE opt-in (see sharesCode). Usage
   reporting does not carry it and enabling usage reporting does not enable
   it, because code is user-authored content rather than a usage signal.

   Loaded by both the service worker (importScripts) and the popup (<script>).
   The service worker owns the queue; the popup forwards through it, so there
   is only ever one writer.
   ============================================================ */

const Analytics = (() => {
  // The deployed Worker. Being configured does not mean anything is sent —
  // the consent check below still gates every call. Empty disables it wholly.
  const ENDPOINT = 'https://leetsync-analytics.devsamant1744.workers.dev';

  const CONSENT_KEY = 'analyticsEnabled';
  const SHARE_CODE_KEY = 'analyticsShareCode';
  const ID_KEY = 'analyticsInstallId';
  const QUEUE_KEY = 'analyticsQueue';
  const NAME_KEY = 'analyticsDisplayName';
  const PING_KEY = 'analyticsPing';
  const PING_AT_KEY = 'analyticsPingAt';

  const PING_EVERY = 12 * 60 * 60 * 1000;  // at most twice a day

  const MAX_QUEUE = 200;   // events kept while offline; oldest dropped past this
  const BATCH = 50;        // must match the Worker's MAX_BATCH
  const MAX_CODE = 20000;  // characters of source, when code sharing is on
  const MAX_NAME = 40;     // characters of a display name

  const isWorker = typeof window === 'undefined';
  const configured = () => typeof ENDPOINT === 'string' && ENDPOINT.startsWith('https://');

  const local = (keys) => new Promise(r => chrome.storage.local.get(keys, d => r(d || {})));
  const setLocal = (obj) => new Promise(r => chrome.storage.local.set(obj, r));

  async function isEnabled() {
    const { [CONSENT_KEY]: on } = await local([CONSENT_KEY]);
    return on === true;                       // absent means off
  }

  /**
   * The one thing sent without the usage-reporting consent: that this install
   * was used, and which version it is on. No problem, no verdict, no theme, no
   * feature — an install id and a clock reading, which is what separates "some
   * of my users are dormant" from "some of my users declined reporting".
   *
   * It is disclosed at setup and in Settings with its own switch, and off
   * means off: no id is created and nothing is sent.
   */
  async function pingEnabled() {
    const { [PING_KEY]: on } = await local([PING_KEY]);
    return on !== false;                      // absent means on
  }

  async function setPing(on) {
    await setLocal({ [PING_KEY]: on === true });
  }

  /**
   * Send the activity ping, at most twice a day.
   *
   * Skipped entirely when full reporting is on, because those events already
   * carry a timestamp and a second signal would only inflate the counts. Not
   * queued either: a ping that cannot be sent is worthless by the time the
   * connection returns, so it is dropped rather than stored.
   */
  async function heartbeat() {
    if (!configured() || !await pingEnabled()) return false;
    if (await isEnabled()) return false;

    const { [PING_AT_KEY]: last } = await local([PING_AT_KEY]);
    const now = Date.now();
    if (typeof last === 'number' && now - last < PING_EVERY) return false;

    // Written before the request, not after: a failing endpoint must not turn
    // into a retry on every service-worker wake-up.
    await setLocal({ [PING_AT_KEY]: now });
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          events: [{ event: 'ping', ts: now, installId: await installId(), version: version() }],
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send feedback, an issue or a suggestion.
   *
   * Not gated on the usage-reporting consent, because this is not telemetry:
   * the user typed it and pressed send. It does carry the install id, the
   * version and the chosen username, since a bug report without a version is
   * not actionable and a suggestion nobody can reply to is a dead end — and
   * the panel says so above the button rather than leaving it to be found out.
   */
  async function sendFeedback(kind, message) {
    if (!configured()) return { ok: false, reason: 'unconfigured' };
    try {
      const res = await fetch(`${ENDPOINT}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          message: String(message || '').slice(0, 2000),
          installId: await installId(),
          name: await displayName(),
          version: version(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        return { ok: false, reason: 'too_soon', retryAfterMs: body.retryAfterMs || 60000 };
      }
      if (!res.ok) return { ok: false, reason: body.error || 'server' };
      return { ok: true };
    } catch {
      return { ok: false, reason: 'offline' };
    }
  }

  /**
   * The current broadcast, or null.
   *
   * A plain read that sends nothing — no install id, no consent needed, and
   * the server learns nothing about who asked beyond the request itself. It
   * replaces polling a config file in the repo, so a message can go out
   * without shipping a commit.
   */
  async function announcement() {
    if (!configured()) return null;
    try {
      const res = await fetch(`${ENDPOINT}/announcement`);
      if (!res.ok) return null;
      const body = await res.json();
      return (body && body.announcement) || null;
    } catch {
      return null;
    }
  }

  /**
   * The public leaderboard. Readable by anyone — being ranked is what needs
   * the consent, not looking.
   *
   * The install id is sent only when usage reporting is on. Without it the
   * caller has no rows on the board to be found in, so there is nothing to
   * look up, and sending an identifier for someone who declined reporting is
   * exactly the thing that consent is protecting them from.
   */
  async function leaderboard(limit = 10) {
    if (!configured()) return null;
    const params = new URLSearchParams({ limit: String(limit) });
    if (await isEnabled()) params.set('installId', await installId());
    try {
      const res = await fetch(`${ENDPOINT}/leaderboard?${params}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Second, independent consent. Source code is the user's own work and can
   * carry names or notes in comments, so it needs its own yes — one the
   * general usage toggle never grants.
   */
  async function sharesCode() {
    const { [SHARE_CODE_KEY]: on } = await local([SHARE_CODE_KEY]);
    return on === true;
  }

  /**
   * A name the user typed for themselves, or null.
   *
   * Unlike the install id this is not anonymous, which is the point — it is
   * what lets a person be recognised instead of read as a hex string. It is
   * therefore always optional, never prefilled, and never derived from the
   * GitHub account, and it goes out only while usage reporting is on.
   */
  async function displayName() {
    const { [NAME_KEY]: name } = await local([NAME_KEY]);
    return (typeof name === 'string' && name.trim())
      ? name.trim().slice(0, MAX_NAME) : null;
  }

  /** Empty clears it; past events already sent keep whatever they carried. */
  async function setDisplayName(name) {
    const cleaned = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
    await setLocal({ [NAME_KEY]: cleaned });
    return cleaned;
  }

  /**
   * Reserve a username with the server, which is the only place uniqueness
   * can be decided — two devices offline would happily pick the same one.
   *
   * This necessarily tells the server that an install wants a name, and setup
   * asks for one before any usage-reporting consent exists, so the wizard says
   * as much rather than doing it quietly. Nothing else is sent: no token, no
   * repository, no events.
   *
   * Resolves to { ok, reason?, name? }. Only a confirmed claim is stored.
   */
  async function claimName(name) {
    const wanted = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
    if (!configured()) {
      // No endpoint means no shared namespace to collide in.
      await setLocal({ [NAME_KEY]: wanted });
      return { ok: true, name: wanted || null };
    }
    try {
      const res = await fetch(`${ENDPOINT}/claim-name`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: wanted, installId: await installId() }),
      });
      const body = await res.json();
      if (body && body.ok) await setLocal({ [NAME_KEY]: body.name || '' });
      return body || { ok: false, reason: 'server' };
    } catch (error) {
      return { ok: false, reason: 'offline', detail: error && error.message };
    }
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

    // Attached only under its own consent, and only when a caller offered it.
    if (typeof fields.code === 'string' && fields.code && await sharesCode()) {
      entry.code = fields.code.slice(0, MAX_CODE);
    }

    // Carried on every event so the dashboard can name a row without having
    // to join back to whichever event happened to introduce the name.
    const name = await displayName();
    if (name) entry.name = name;

    const { [QUEUE_KEY]: queue = [] } = await local([QUEUE_KEY]);
    queue.push(entry);
    // Keep the newest; an old backlog is worth less than a bounded store.
    await setLocal({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
  }

  // Only these fields ever leave the device. `code` is deliberately absent:
  // it is handled above, behind its own consent check.
  const TEXT_FIELDS = ['slug', 'title', 'difficulty', 'language', 'detail', 'status', 'theme'];
  const NUM_FIELDS = ['runtimeMs', 'memoryKb', 'testsPassed', 'testsTotal', 'codeLen'];

  function pick(fields) {
    const out = {};
    for (const key of TEXT_FIELDS) {
      if (typeof fields[key] === 'string' && fields[key]) {
        out[key] = fields[key].slice(0, 200);
      }
    }
    for (const key of NUM_FIELDS) {
      // Strings are not coerced: a number field arriving as text means the
      // caller is confused, and guessing would store a wrong figure.
      if (typeof fields[key] !== 'number' || !Number.isFinite(fields[key])) continue;
      if (fields[key] < 0) continue;
      out[key] = Math.round(fields[key]);
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
      if (!res.ok) {
        // Keep the queue and try later, but say so: a silent failure here is
        // indistinguishable from "nothing was ever recorded", which makes an
        // empty dashboard impossible to diagnose.
        console.warn('[LeetSync] analytics rejected:', res.status, await res.text().catch(() => ''));
        return;
      }
      await setLocal({ [QUEUE_KEY]: queue.slice(batch.length) });
    } catch (error) {
      // Offline or blocked — the queue survives, capped at MAX_QUEUE.
      console.warn('[LeetSync] analytics could not send:', error && error.message);
    }
  }

  /**
   * One-shot self-check for "the dashboard is empty and I do not know why".
   * Run Analytics.debug() in the service worker console: it reports consent,
   * the queue, and what the endpoint actually says right now.
   */
  async function debug() {
    const data = await local([CONSENT_KEY, SHARE_CODE_KEY, ID_KEY, QUEUE_KEY]);
    const state = {
      endpointConfigured: configured(),
      endpoint: ENDPOINT,
      reportingEnabled: data[CONSENT_KEY] === true,
      codeSharingEnabled: data[SHARE_CODE_KEY] === true,
      installId: data[ID_KEY] || '(none)',
      queued: (data[QUEUE_KEY] || []).length,
      context: isWorker ? 'service worker' : 'page',
    };
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      state.endpointReachable = res.ok;
      state.endpointStatus = res.status;
    } catch (error) {
      state.endpointReachable = false;
      state.endpointError = error && error.message;
    }
    console.log('[LeetSync] analytics state:', state);
    return state;
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
    // Off means nothing more is sent: the queue goes, and code sharing is
    // revoked so re-enabling cannot silently resume it.
    //
    // The install id and username stay. The username is chosen at setup, is
    // reserved against every other user, and the reservation is held by the
    // install id — dropping the id here would strand the name with nothing
    // able to release it. Clearing the username in Settings releases it, and
    // that is the action that undoes the identity.
    await setLocal({ [SHARE_CODE_KEY]: false });
    await new Promise(r => chrome.storage.local.remove([QUEUE_KEY], r));
  }

  /** Code sharing cannot be switched on while usage reporting is off. */
  async function setShareCode(on) {
    const allowed = on === true && await isEnabled();
    await setLocal({ [SHARE_CODE_KEY]: allowed });
    return allowed;
  }

  return {
    track, flush, isEnabled, setEnabled, sharesCode, setShareCode, configured, debug,
    displayName, setDisplayName, claimName, pingEnabled, setPing, heartbeat,
    leaderboard, announcement, sendFeedback,
    CONSENT_KEY, SHARE_CODE_KEY, QUEUE_KEY, ID_KEY, NAME_KEY, PING_KEY,
    pick, MAX_QUEUE, BATCH, MAX_CODE, MAX_NAME,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Analytics };
