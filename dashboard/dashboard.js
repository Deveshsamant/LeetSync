/* ============================================================
   dashboard.js — LeetSync analytics.

   Static page, no build step and no dependencies. It reads a single
   /api/summary response from the Worker; all aggregation happens in SQL on
   Cloudflare's side, so this only draws.

   The key lives in localStorage and is sent as a bearer token. It never
   reaches the host serving this page — Vercel only serves static files.
   ============================================================ */

const ENDPOINT = 'https://leetsync-analytics.devsamant1744.workers.dev';
const KEY_STORE = 'leetsync.dashboardKey';
const THEME_STORE = 'leetsync.dashboardTheme';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString();

let days = 30;
let key = null;

// ── Theme ────────────────────────────────────────────────────

function applyTheme(name) {
  document.body.classList.toggle('light', name === 'light');
  try { localStorage.setItem(THEME_STORE, name); } catch { /* private mode */ }
}
try { applyTheme(localStorage.getItem(THEME_STORE) || 'dark'); } catch { /* ignore */ }

$('themeBtn').addEventListener('click', () =>
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light'));

// ── Fetching ─────────────────────────────────────────────────

async function fetchSummary(withKey, range) {
  const res = await fetch(`${ENDPOINT}/api/summary?days=${range}`, {
    headers: { authorization: `Bearer ${withKey}` },
  });
  if (res.status === 401) throw new Error('unauthorised');
  if (!res.ok) throw new Error(`worker returned ${res.status}`);
  return res.json();
}

// ── Gate ─────────────────────────────────────────────────────

$('gateForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = $('keyInput').value.trim();
  if (!candidate) return;

  $('gateBtn').disabled = true;
  $('gateBtn').textContent = 'Checking…';
  $('gateError').textContent = '';

  try {
    const data = await fetchSummary(candidate, days);
    key = candidate;
    try { localStorage.setItem(KEY_STORE, key); } catch { /* private mode */ }
    $('gate').hidden = true;
    $('app').hidden = false;
    render(data);
  } catch (error) {
    $('gateError').textContent = error.message === 'unauthorised'
      ? 'That key was rejected.'
      : `Could not reach the Worker (${error.message}).`;
  } finally {
    $('gateBtn').disabled = false;
    $('gateBtn').textContent = 'Unlock';
  }
});

$('lockBtn').addEventListener('click', () => {
  try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
  location.reload();
});

// ── Controls ─────────────────────────────────────────────────

$('ranges').addEventListener('click', async (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  $('ranges').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
  days = Number(chip.dataset.days);
  await reload();
});

$('refreshBtn').addEventListener('click', reload);

async function reload() {
  $('refreshBtn').textContent = 'Loading…';
  try {
    render(await fetchSummary(key, days));
  } catch (error) {
    $('footNote').textContent = `Refresh failed: ${error.message}`;
  } finally {
    $('refreshBtn').textContent = 'Refresh';
  }
}

// ── Drawing ──────────────────────────────────────────────────

/** Horizontal bars, used by most panels. */
function bars(host, rows, { label, value, colour } = {}) {
  const el = $(host);
  el.innerHTML = '';
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="empty">Nothing recorded yet.</div>';
    return;
  }
  const max = Math.max(...rows.map(r => Number(value(r)) || 0), 1);
  for (const row of rows) {
    const n = Number(value(row)) || 0;
    const div = document.createElement('div');
    div.className = 'bar-row';

    const name = document.createElement('span');
    name.className = 'bar-name';
    name.textContent = label(row);
    name.title = label(row);

    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = `${(n / max) * 100}%`;
    if (colour) fill.style.background = colour(row);
    track.appendChild(fill);

    const val = document.createElement('span');
    val.className = 'bar-value';
    val.textContent = fmt(n);

    div.append(name, track, val);
    el.appendChild(div);
  }
}

/** Activity over time, drawn as SVG so there is no chart dependency. */
function activityChart(daily) {
  const host = $('activityChart');
  host.innerHTML = '';
  if (!daily || !daily.length) {
    host.innerHTML = '<div class="empty">No activity in this range.</div>';
    return;
  }

  const W = 1000, H = 220, padL = 40, padR = 12, padT = 12, padB = 26;
  const max = Math.max(...daily.map(d => d.events), 1);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = daily.length > 1 ? innerW / (daily.length - 1) : 0;
  const x = (i) => padL + (daily.length > 1 ? i * step : innerW / 2);
  const y = (v) => padT + innerH - (v / max) * innerH;

  const css = getComputedStyle(document.body);
  const accent = css.getPropertyValue('--ac').trim() || '#3FE08B';
  const grid = css.getPropertyValue('--hair').trim() || '#161B1F';
  const text = css.getPropertyValue('--tx5').trim() || '#525C63';

  const line = daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.events).toFixed(1)}`).join(' ');
  const area = `${line} L${x(daily.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;

  // Four gridlines with value labels
  let gridlines = '';
  for (let g = 0; g <= 3; g++) {
    const v = Math.round((max / 3) * g);
    const gy = y(v);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${grid}" stroke-width="1"/>`
      + `<text x="${padL - 8}" y="${gy + 3.5}" text-anchor="end" font-family="ui-monospace,monospace" font-size="9" fill="${text}">${v}</text>`;
  }

  // Date labels at both ends, plus the middle when there is room
  const marks = daily.length > 6 ? [0, Math.floor(daily.length / 2), daily.length - 1] : daily.map((_, i) => i);
  const labels = [...new Set(marks)].map(i =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}"
       font-family="ui-monospace,monospace" font-size="9" fill="${text}">${daily[i].day.slice(5)}</text>`).join('');

  const dots = daily.map((d, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(d.events).toFixed(1)}" r="2.5" fill="${accent}"><title>${d.day}: ${d.events} events, ${d.installs} installs</title></circle>`).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Events per day">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridlines}
    <path d="${area}" fill="url(#fade)"/>
    <path d="${line}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}
  </svg>`;
}

function problemsTable(rows) {
  const body = $('problemsBody');
  body.innerHTML = '';
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No solutions pushed yet.</td></tr>';
    return;
  }
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');

    const rank = document.createElement('td');
    rank.className = 'rank';
    rank.textContent = i + 1;

    const title = document.createElement('td');
    const a = document.createElement('a');
    a.href = `https://leetcode.com/problems/${r.slug}/`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = r.title || r.slug;
    title.appendChild(a);

    const level = document.createElement('td');
    const span = document.createElement('span');
    const lvl = (r.difficulty || 'Unknown');
    span.className = `level ${lvl.toLowerCase()}`;
    span.textContent = lvl;
    level.appendChild(span);

    const pushes = document.createElement('td');
    pushes.className = 'num';
    pushes.textContent = fmt(r.pushes);

    const installs = document.createElement('td');
    installs.className = 'num';
    installs.textContent = fmt(r.installs);

    const open = document.createElement('td');
    open.className = 'open';
    open.textContent = '↗';

    tr.append(rank, title, level, pushes, installs, open);
    body.appendChild(tr);
  });
}

function render(data) {
  const pushes = (data.events.find(e => e.event === 'push_ok') || {}).n || 0;
  const fails = (data.events.find(e => e.event === 'push_fail') || {}).n || 0;

  $('tInstalls').textContent = fmt(data.totals.installs);
  $('tEvents').textContent = fmt(data.totals.events);
  $('tPushes').textContent = fmt(pushes);
  $('tFailures').textContent = fmt(fails);
  $('tProblems').textContent = fmt(data.problems.length);

  $('activityNote').textContent = `${data.daily.length} day${data.daily.length === 1 ? '' : 's'} with activity`;
  activityChart(data.daily);

  const level = (d) => ({ Easy: 'var(--easy)', Medium: 'var(--med)', Hard: 'var(--hard)' }[d.difficulty]);
  bars('eventsChart', data.events, { label: r => r.event, value: r => r.n });
  bars('difficultyChart', data.difficulty, { label: r => r.difficulty, value: r => r.n, colour: level });
  bars('languagesChart', data.languages, { label: r => r.language, value: r => r.n });
  bars('versionsChart', data.versions, { label: r => r.version, value: r => r.installs });
  bars('failuresChart', data.failures, { label: r => r.reason, value: r => r.n });
  bars('sheetsChart', data.sheets, { label: r => r.sheet, value: r => r.installs });

  problemsTable(data.problems);

  $('footNote').textContent = `Updated ${new Date(data.generatedAt).toLocaleString()} · last ${data.days} days`;
}

// ── Boot ─────────────────────────────────────────────────────

(async function init() {
  let stored = null;
  try { stored = localStorage.getItem(KEY_STORE); } catch { /* private mode */ }
  if (!stored) return;                       // show the gate

  try {
    const data = await fetchSummary(stored, days);
    key = stored;
    $('gate').hidden = true;
    $('app').hidden = false;
    render(data);
  } catch {
    // Stale or rejected key: fall back to the gate rather than a blank page.
    try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
  }
}());
