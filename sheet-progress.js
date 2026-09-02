/* ============================================================
   sheet-progress.js — manual sheet ticks, kept across devices.

   515 of the 1,667 sheet problems are not on LeetCode, so they can only be
   ticked by hand. Those ticks used to live in chrome.storage.local, which is
   per-device and cleared with the extension — losing most of a sheet run.

   They now live in chrome.storage.sync, which follows the Chrome profile.
   Sync caps a single item at 8 KB and the whole area at 100 KB, and 515 keys
   of "sheet|title" is roughly 20 KB, so the set is split across numbered
   chunks. Writes are debounced because sync also limits writes per minute.
   ============================================================ */

const SheetProgress = (() => {
  const PREFIX = 'sheetDone_';
  const MAX_CHUNKS = 12;        // 12 x ~7 KB stays under the 100 KB area quota
  const CHUNK_BYTES = 7000;     // headroom under the 8192 per-item cap
  const DEBOUNCE_MS = 900;      // sync allows ~120 writes/minute
  const LEGACY_KEY = 'sheetManualDone';

  let timer = null;
  let pending = null;

  const chunkKeys = (n) => Array.from({ length: n }, (_, i) => PREFIX + i);

  /** Split entries into chunks that each stay under the per-item cap. */
  function chunk(entries) {
    const chunks = [[]];
    let size = 2;
    for (const entry of entries) {
      const cost = JSON.stringify(entry).length + 1;
      if (size + cost > CHUNK_BYTES && chunks[chunks.length - 1].length) {
        chunks.push([]);
        size = 2;
      }
      chunks[chunks.length - 1].push(entry);
      size += cost;
    }
    return chunks;
  }

  async function load() {
    const [sync, local] = await Promise.all([
      new Promise(r => chrome.storage.sync.get(chunkKeys(MAX_CHUNKS), d => r(d || {}))),
      new Promise(r => chrome.storage.local.get([LEGACY_KEY], d => r(d || {}))),
    ]);

    const entries = [];
    for (const key of chunkKeys(MAX_CHUNKS)) {
      if (Array.isArray(sync[key])) entries.push(...sync[key]);
    }

    // One-time migration: adopt anything the old local-only key still holds,
    // union rather than replace so a second device does not lose its ticks.
    const legacy = Array.isArray(local[LEGACY_KEY]) ? local[LEGACY_KEY] : [];
    if (legacy.length) {
      const merged = new Set([...entries, ...legacy]);
      const set = merged;
      await save(set);
      chrome.storage.local.remove(LEGACY_KEY);
      return set;
    }

    return new Set(entries);
  }

  /** Write immediately. Prefer schedule() from UI code. */
  async function save(set) {
    const chunks = chunk([...set]);
    if (chunks.length > MAX_CHUNKS) {
      console.warn('[LeetSync] Too many sheet ticks to sync; keeping a local copy.');
      chrome.storage.local.set({ [LEGACY_KEY]: [...set] });
      return false;
    }

    const payload = {};
    chunks.forEach((c, i) => { payload[PREFIX + i] = c; });
    const unused = chunkKeys(MAX_CHUNKS).slice(chunks.length);

    return new Promise(resolve => {
      chrome.storage.sync.set(payload, () => {
        if (chrome.runtime.lastError) {
          // Quota or rate limit — fall back so the tick is not simply lost.
          console.warn('[LeetSync] Sync write failed:', chrome.runtime.lastError.message);
          chrome.storage.local.set({ [LEGACY_KEY]: [...set] });
          return resolve(false);
        }
        if (unused.length) chrome.storage.sync.remove(unused);
        resolve(true);
      });
    });
  }

  /** Coalesce rapid ticking into one write. */
  function schedule(set) {
    pending = new Set(set);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot = pending;
      pending = null;
      save(snapshot);
    }, DEBOUNCE_MS);
  }

  /** Persist anything still queued — call before the popup closes. */
  function flush() {
    if (!pending) return;
    clearTimeout(timer);
    const snapshot = pending;
    pending = null;
    save(snapshot);
  }

  return { load, save, schedule, flush, PREFIX, MAX_CHUNKS, CHUNK_BYTES, chunk };
})();

/* ============================================================
   SheetData — where the sheets themselves come from.

   The bundled sheets.json is the floor: it always works, offline included.
   A copy is also published beside remote-config.json, so a corrected sheet
   can reach users without waiting on a Web Store review. The remote copy is
   cached and only adopted when it parses, looks like sheet data, and is not
   older than what is bundled — a malformed or truncated download must never
   be able to empty the Sheets tab.
   ============================================================ */

const SheetData = (() => {
  const REMOTE_URL = 'https://raw.githubusercontent.com/Deveshsamant/LeetSync/main/sheets.json';
  const CACHE_KEY = 'sheetsCache';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /** Reject anything that is not recognisably a sheets payload. */
  function isValid(data) {
    if (!data || !Array.isArray(data.sheets) || !data.sheets.length) return false;
    return data.sheets.every(s =>
      s && typeof s.id === 'string' && typeof s.name === 'string'
      && Array.isArray(s.groups) && s.groups.length
      && s.groups.every(g => Array.isArray(g.questions)));
  }

  const newer = (a, b) => String(a?.generatedAt || '') > String(b?.generatedAt || '');

  function readCache() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage) return resolve(null);
      chrome.storage.local.get([CACHE_KEY], d => resolve(d?.[CACHE_KEY] || null));
    });
  }

  async function fetchRemote() {
    try {
      const res = await fetch(`${REMOTE_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return isValid(data) ? data : null;
    } catch {
      return null;   // offline, blocked, or malformed — the bundle still works
    }
  }

  /** Refresh the cache for next time; never blocks the current render. */
  async function revalidate(current) {
    const remote = await fetchRemote();
    if (!remote || !newer(remote, current)) return;
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.set({
      [CACHE_KEY]: { fetchedAt: Date.now(), data: remote },
    });
  }

  async function load() {
    const bundled = await fetch('sheets.json').then(r => r.json()).catch(() => null);
    const cached = await readCache();

    let active = bundled;
    if (cached?.data && isValid(cached.data) && newer(cached.data, bundled)) {
      active = cached.data;
    }

    const stale = !cached || (Date.now() - (cached.fetchedAt || 0)) > MAX_AGE_MS;
    if (stale) revalidate(active);   // deliberately not awaited

    return active;
  }

  return { load, isValid, REMOTE_URL, CACHE_KEY, MAX_AGE_MS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SheetProgress, SheetData };
}
