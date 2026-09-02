/* ============================================================
   tracker.js — full-page study tracker.

   This is an extension page, so it reads the same chrome.storage the popup
   does. Problems solved through LeetSync tick themselves; everything else
   (GeeksforGeeks, takeUforward articles) can be ticked by hand and is kept
   in chrome.storage.local alongside.
   ============================================================ */

const HAS_CHROME = typeof chrome !== 'undefined' && !!chrome.storage;

let data = null;
let sheet = null;
let solvedIds = new Set();
let manualDone = new Set();

const filters = { search: '', status: 'all', level: 'all' };

const $ = (id) => document.getElementById(id);
// A problem shown in the combined view keeps the id of the sheet it came
// from, so a tick made there is the same tick as in that sheet.
const manualKey = (sheetId, q) => `${q._sheet || sheetId}|${q.title}`;

const ALL_ID = '__all';

/**
 * A virtual sheet of every problem across all sheets, deduplicated and
 * grouped by difficulty. The sheets overlap heavily — Two Sum is in most of
 * them — so seven separate bars never answer "what have I actually covered".
 */
function buildAllSheets(data) {
  const order = ['Easy', 'Medium', 'Hard', 'Unknown'];
  const buckets = new Map(order.map(k => [k, []]));
  const seen = new Map();

  for (const sheet of data.sheets) {
    for (const group of sheet.groups) {
      for (const q of group.questions) {
        const key = q.id != null ? `id:${q.id}` : `t:${q.title.trim().toLowerCase()}`;
        if (seen.has(key)) {
          seen.get(key)._sheets.add(sheet.name);
          continue;
        }
        const copy = { ...q, _sheet: sheet.id, _sheets: new Set([sheet.name]) };
        seen.set(key, copy);
        (buckets.get(q.difficulty) || buckets.get('Unknown')).push(copy);
      }
    }
  }

  const groups = order
    .map(level => ({ name: level, questions: buckets.get(level) }))
    .filter(g => g.questions.length);
  const count = groups.reduce((n, g) => n + g.questions.length, 0);

  return {
    id: ALL_ID,
    name: 'All sheets',
    source: '',
    count,
    trackable: groups.reduce(
      (n, g) => n + g.questions.filter(q => q.id != null).length, 0),
    groups,
  };
}
const isAuto = (q) => q.id != null && solvedIds.has(q.id);
const isDone = (sheetId, q) => isAuto(q) || manualDone.has(manualKey(sheetId, q));
const urlFor = (q) => (q.slug ? `https://leetcode.com/problems/${q.slug}/` : q.url || null);

// ── Loading ──────────────────────────────────────────────────

function solvedFromExtension() {
  return new Promise((resolve) => {
    if (!HAS_CHROME || !chrome.runtime?.sendMessage) return resolve(new Set());
    try {
      chrome.runtime.sendMessage({ type: 'GET_PROBLEMS' }, (res) => {
        if (chrome.runtime.lastError || !res?.success) return resolve(new Set());
        resolve(new Set((res.problems || []).map((p) => Number(p.number)).filter(Boolean)));
      });
    } catch { resolve(new Set()); }
  });
}

function readLocal(keys) {
  return new Promise((resolve) => {
    if (!HAS_CHROME) return resolve({});
    chrome.storage.local.get(keys, (d) => resolve(d || {}));
  });
}

function readSync(keys) {
  return new Promise((resolve) => {
    if (!HAS_CHROME) return resolve({});
    chrome.storage.sync.get(keys, (d) => resolve(d || {}));
  });
}

// Chunked into chrome.storage.sync so ticks follow the profile rather than
// dying with the install. Debounced: sync limits writes per minute.
function saveManual() {
  if (!HAS_CHROME) return;
  SheetProgress.schedule(manualDone);
}

// The tab can be closed mid-debounce, so flush anything still queued.
window.addEventListener('pagehide', () => { if (HAS_CHROME) SheetProgress.flush(); });

// ── Theme ────────────────────────────────────────────────────

function applyTheme(name) {
  document.body.classList.toggle('theme-light', name === 'light');
}

$('tkTheme').addEventListener('click', () => {
  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  applyTheme(next);
  if (HAS_CHROME) chrome.storage.sync.set({ uiTheme: next });
});

// ── Rendering ────────────────────────────────────────────────

function renderSheetTabs() {
  const nav = $('tkSheets');
  nav.innerHTML = '';
  data.sheets.forEach((s) => {
    const done = s.groups.reduce(
      (n, g) => n + g.questions.filter((q) => isDone(s.id, q)).length, 0);
    const btn = document.createElement('button');
    btn.className = 'tk-sheet-btn' + (s.id === sheet.id ? ' active' : '');
    btn.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'tk-sheet-name';
    name.textContent = s.name;
    const meta = document.createElement('span');
    meta.className = 'tk-sheet-meta';
    meta.textContent = `${done} / ${s.count}`;
    btn.append(name, meta);
    btn.addEventListener('click', () => selectSheet(s.id));
    nav.appendChild(btn);
  });
}

function renderOverview() {
  const all = sheet.groups.flatMap((g) => g.questions);
  const done = all.filter((q) => isDone(sheet.id, q)).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  $('tkDone').textContent = done;
  $('tkTotal').textContent = all.length;
  $('tkPct').textContent = `${pct}%`;
  $('tkTracked').textContent = sheet.trackable ?? all.filter((q) => q.id != null).length;
  $('tkBar').style.width = `${pct}%`;

  const counts = { Easy: [0, 0], Medium: [0, 0], Hard: [0, 0], Unknown: [0, 0] };
  all.forEach((q) => {
    const k = counts[q.difficulty] ? q.difficulty : 'Unknown';
    counts[k][1]++;
    if (isDone(sheet.id, q)) counts[k][0]++;
  });
  const bd = $('tkBreakdown');
  bd.innerHTML = '';
  Object.entries(counts).forEach(([level, [d, t]]) => {
    if (!t) return;
    const el = document.createElement('span');
    el.innerHTML = `${level} <b>${d}/${t}</b>`;
    bd.appendChild(el);
  });

  const src = $('tkSource');
  if (sheet.source) {
    src.href = sheet.source;
    src.textContent = sheet.source.replace(/^https?:\/\//, '');
  } else {
    src.removeAttribute('href');
    src.textContent = '';
  }

  const offline = all.length - (sheet.trackable ?? 0);
  $('tkFooterNote').textContent = offline
    ? `${offline} problems are not on LeetCode — tick those by hand.`
    : 'Every problem here ticks itself when you solve it.';
}

function matches(q, sheetId) {
  if (filters.search && !q.title.toLowerCase().includes(filters.search)) return false;
  if (filters.level !== 'all' && q.difficulty !== filters.level) return false;
  if (filters.status === 'done' && !isDone(sheetId, q)) return false;
  if (filters.status === 'todo' && isDone(sheetId, q)) return false;
  return true;
}

function renderList() {
  const list = $('tkList');
  list.innerHTML = '';
  let shown = 0;

  sheet.groups.forEach((group, index) => {
    const visible = group.questions.filter((q) => matches(q, sheet.id));
    if (!visible.length) return;
    shown += visible.length;

    const done = group.questions.filter((q) => isDone(sheet.id, q)).length;
    const pct = group.questions.length ? (done / group.questions.length) * 100 : 0;

    const wrap = document.createElement('section');
    // Filtering implies intent to look, so open groups when a filter is on.
    const filtering = filters.search || filters.status !== 'all' || filters.level !== 'all';
    wrap.className = 'tk-group' + (index === 0 || filtering ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'tk-group-head';
    head.innerHTML = `<span class="tk-caret">▶</span>`;
    const name = document.createElement('span');
    name.className = 'tk-group-name';
    name.textContent = group.name;
    const bar = document.createElement('span');
    bar.className = 'tk-group-bar';
    bar.innerHTML = `<span style="width:${pct}%"></span>`;
    const count = document.createElement('span');
    count.className = 'tk-group-count';
    count.textContent = `${done} / ${group.questions.length}`;
    head.append(name, bar, count);
    head.addEventListener('click', () => wrap.classList.toggle('open'));

    const rows = document.createElement('div');
    rows.className = 'tk-rows';
    visible.forEach((q) => rows.appendChild(renderRow(q)));

    wrap.append(head, rows);
    list.appendChild(wrap);
  });

  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'tk-empty';
    empty.textContent = 'No problems match these filters.';
    list.appendChild(empty);
  }
}

function renderRow(q) {
  const row = document.createElement('div');
  row.className = 'tk-row' + (isDone(sheet.id, q) ? ' done' : '');

  const auto = isAuto(q);
  const tick = document.createElement('button');
  tick.className = 'tk-tick';
  tick.type = 'button';
  tick.disabled = auto;
  tick.title = auto ? 'Synced from your pushed solutions' : 'Mark as done';
  tick.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4,12.5 9.5,18 20,6.5"></polyline></svg>';
  tick.addEventListener('click', () => {
    const key = manualKey(sheet.id, q);
    if (manualDone.has(key)) manualDone.delete(key); else manualDone.add(key);
    saveManual();
    row.classList.toggle('done', isDone(sheet.id, q));
    renderOverview();
    renderSheetTabs();
    refreshGroupCounts();
  });

  const num = document.createElement('span');
  num.className = 'tk-num';
  num.textContent = q.id != null ? `#${q.id}` : '—';

  const title = document.createElement('span');
  title.className = 'tk-title';
  const url = urlFor(q);
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = q.title;
    title.appendChild(a);
  } else {
    title.textContent = q.title;
  }

  const level = document.createElement('span');
  level.className = `tk-level ${String(q.difficulty).toLowerCase()}`;
  level.textContent = q.difficulty;

  row.append(tick, num, title, level);

  if (q.paid) {
    const pro = document.createElement('span');
    pro.className = 'tk-tag pro';
    pro.textContent = 'PRO';
    row.appendChild(pro);
  } else if (!q.slug) {
    const off = document.createElement('span');
    off.className = 'tk-tag';
    off.textContent = 'OFF-LC';
    off.title = 'Not a LeetCode problem — tick it by hand';
    row.appendChild(off);
  }

  // In the combined view, show how many sheets a problem appears in.
  if (sheet.id === ALL_ID && q._sheets && q._sheets.size > 1) {
    const tag = document.createElement('span');
    tag.className = 'tk-tag';
    tag.textContent = `${q._sheets.size} SHEETS`;
    tag.title = [...q._sheets].join('\n');
    row.appendChild(tag);
  }

  const open = document.createElement('span');
  open.className = 'tk-open';
  open.textContent = url ? '↗' : '';
  row.appendChild(open);

  return row;
}

function refreshGroupCounts() {
  document.querySelectorAll('.tk-group').forEach((wrap, i) => {
    const group = sheet.groups.filter(
      (g) => g.questions.some((q) => matches(q, sheet.id)))[i];
    if (!group) return;
    const done = group.questions.filter((q) => isDone(sheet.id, q)).length;
    wrap.querySelector('.tk-group-count').textContent = `${done} / ${group.questions.length}`;
    wrap.querySelector('.tk-group-bar span').style.width =
      `${(done / group.questions.length) * 100}%`;
  });
}

// ── Interaction ──────────────────────────────────────────────

function selectSheet(id) {
  sheet = data.sheets.find((s) => s.id === id) || data.sheets[0];
  location.hash = sheet.id;
  if (HAS_CHROME) chrome.storage.sync.set({ activeSheet: sheet.id });
  renderSheetTabs();
  renderOverview();
  renderList();
}

$('tkSearch').addEventListener('input', (e) => {
  filters.search = e.target.value.trim().toLowerCase();
  renderList();
});

function wireChips(containerId, key) {
  $(containerId).addEventListener('click', (e) => {
    const btn = e.target.closest('.tk-chip');
    if (!btn) return;
    $(containerId).querySelectorAll('.tk-chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filters[key] = btn.dataset[key];
    renderList();
  });
}
wireChips('tkStatus', 'status');
wireChips('tkLevel', 'level');

$('tkExpand').addEventListener('click', (e) => {
  const groups = [...document.querySelectorAll('.tk-group')];
  const open = groups.every((g) => g.classList.contains('open'));
  groups.forEach((g) => g.classList.toggle('open', !open));
  e.target.textContent = open ? 'Expand all' : 'Collapse all';
});

// ── Boot ─────────────────────────────────────────────────────

(async function init() {
  const loaded = await SheetData.load();
  if (!loaded) {
    $('tkList').innerHTML = '<div class="tk-empty">Could not load the study sheets.</div>';
    return;
  }
  // The combined view leads, since it answers the broader question.
  data = { ...loaded, sheets: [buildAllSheets(loaded), ...loaded.sheets] };

  const [solved, ticks, sync] = await Promise.all([
    solvedFromExtension(),
    HAS_CHROME ? SheetProgress.load() : Promise.resolve(new Set()),
    readSync(['uiTheme', 'activeSheet']),
  ]);
  solvedIds = solved;
  manualDone = ticks;
  applyTheme(sync.uiTheme || 'dark');

  const wanted = decodeURIComponent(location.hash.slice(1)) || sync.activeSheet;
  sheet = data.sheets.find((s) => s.id === wanted) || data.sheets[0];

  renderSheetTabs();
  renderOverview();
  renderList();
}());
