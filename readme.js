/* ============================================================
   readme.js — README + stat-panel generation (pure, no chrome APIs)

   Split out of background.js so it can be unit tested in Node. Loaded into
   the service worker with importScripts(), which shares one global scope,
   so callers in background.js are unchanged.
   ============================================================ */
// ── Language Mapping — the service worker cannot see the content script ──

const LANGUAGE_MAP = {
  'python':      { ext: '.py',     name: 'Python'     },
  'python3':     { ext: '.py',     name: 'Python'     },
  'c':           { ext: '.c',      name: 'C'          },
  'cpp':         { ext: '.cpp',    name: 'C++'        },
  // Display-name aliases: content.js sends LeetCode's slug, but stored
  // records carry the display name, and a re-push would otherwise fall
  // through to the .txt default.
  'c++':         { ext: '.cpp',    name: 'C++'        },
  'c#':          { ext: '.cs',     name: 'C#'         },
  'java':        { ext: '.java',   name: 'Java'       },
  'javascript':  { ext: '.js',     name: 'JavaScript' },
  'typescript':  { ext: '.ts',     name: 'TypeScript' },
  'csharp':      { ext: '.cs',     name: 'C#'         },
  'go':          { ext: '.go',     name: 'Go'         },
  'golang':      { ext: '.go',     name: 'Go'         },
  'ruby':        { ext: '.rb',     name: 'Ruby'       },
  'swift':       { ext: '.swift',  name: 'Swift'      },
  'kotlin':      { ext: '.kt',     name: 'Kotlin'     },
  'scala':       { ext: '.scala',  name: 'Scala'      },
  'rust':        { ext: '.rs',     name: 'Rust'       },
  'php':         { ext: '.php',    name: 'PHP'        },
  'dart':        { ext: '.dart',   name: 'Dart'       },
  'racket':      { ext: '.rkt',    name: 'Racket'     },
  'erlang':      { ext: '.erl',    name: 'Erlang'     },
  'elixir':      { ext: '.ex',     name: 'Elixir'     },
  'mysql':       { ext: '.sql',    name: 'MySQL'      },
  'mssql':       { ext: '.sql',    name: 'MS SQL'     },
  'oraclesql':   { ext: '.sql',    name: 'Oracle SQL' },
  'postgresql':  { ext: '.sql',    name: 'PostgreSQL' },
  'pandas':      { ext: '.py',     name: 'Pandas'     },
};

function getLanguageInfo(lang) {
  const key = (lang || '').toLowerCase().replace(/\s+/g, '');
  return LANGUAGE_MAP[key] || { ext: '.txt', name: lang || 'Unknown' };
}

/**
 * Pull the problem slug out of a LeetCode URL, or null if it is not one.
 * Used for analytics, so it must never invent a value from an unexpected URL.
 */
function slugFromLeetCodeUrl(url) {
  const m = /^https?:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9-]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

function slugify(title) {
  return title.trim().replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
}

function padNumber(num) {
  return String(num).padStart(4, '0');
}

function buildFolderName(num, title) {
  return `${padNumber(num)}-${slugify(title)}`;
}

function difficultyBadge(difficulty) {
  const colors = { 'Easy': '🟢', 'Medium': '🟡', 'Hard': '🔴' };
  return `${colors[difficulty] || '⚪'} ${difficulty}`;
}

// ── README Generators ────────────────────────────────────────

/**
 * Difficulty badge using shields.io
 */
/**
 * shields.io splits a badge path on "-", so any literal hyphen or underscore
 * in a field has to be doubled first. Without this a date like 2026-09-02
 * renders as "404 badge not found".
 */
function shieldText(value) {
  return encodeURIComponent(
    String(value ?? '').replace(/_/g, '__').replace(/-/g, '--')
  );
}

function difficultyShieldBadge(difficulty) {
  const map = {
    'Easy':   { label: 'Easy',   color: '00b8a3' },
    'Medium': { label: 'Medium', color: 'ffa116' },
    'Hard':   { label: 'Hard',   color: 'ef4743' },
  };
  const d = map[difficulty] || { label: difficulty || 'Unknown', color: '888888' };
  return `![Difficulty](https://img.shields.io/badge/DIFFICULTY-${shieldText(d.label)}-${d.color}?style=for-the-badge&labelColor=1a1a2e)`;
}

/**
 * Language badge using shields.io
 */
function languageShieldBadge(language) {
  return `![Language](https://img.shields.io/badge/LANGUAGE-${shieldText(language || 'Unknown')}-6c5ce7?style=for-the-badge&labelColor=1a1a2e)`;
}

/**
 * Generate a text-based horizontal progress bar.
 * e.g. ▓▓▓▓▓▓▓░░░ 70%
 */
function progressBar(value, total, width = 20) {
  if (total === 0) return '░'.repeat(width) + ' 0%';
  const filled = Math.round((value / total) * width);
  const empty = width - filled;
  const pct = Math.round((value / total) * 100);
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
}

/**
 * Build per-problem README — clean, minimal, with badges + best stats.
 */
const VERDICT_MARK = {
  'Accepted': '✅',
  'Wrong Answer': '❌',
  'Time Limit Exceeded': '⏱',
  'Memory Limit Exceeded': '💾',
  'Output Limit Exceeded': '📤',
  'Runtime Error': '💥',
  'Compile Error': '🔧',
};

/** "1 h 12 m" from a span of milliseconds, or null if it is not a real span. */
function humanSpan(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mins = Math.round(n / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * How the solve actually went: how many attempts it took, in what order, and
 * how long from first opening the problem to getting it accepted.
 *
 * Omitted entirely when there is nothing to say — a first-try solve with no
 * recorded attempts should not get a section announcing "1 attempt".
 */
function buildAttemptsSection({ attempts, verdicts, firstSeenAt }) {
  const total = Number(attempts);
  const list = Array.isArray(verdicts) ? verdicts.filter(v => typeof v === 'string') : [];
  const span = humanSpan(firstSeenAt);
  if (!Number.isFinite(total) || total < 1) return '';
  if (total === 1 && !span) return '';

  let c = `### HOW IT WENT\n\n`;
  c += `| | |\n|:--|:--|\n`;
  c += `| **Attempts** | ${total === 1 ? 'first try' : `${total} before accepted`} |\n`;
  if (span) c += `| **Time to solve** | ${span} |\n`;
  if (list.length) {
    // Oldest first, so the row reads as the story of the session.
    const trail = list.slice(-12).map(v => `${VERDICT_MARK[v] || '•'} ${v}`).join(' → ');
    c += `| **Verdicts** | ${trail} |\n`;
  }
  return c + `\n`;
}

/**
 * The user's own note for a problem.
 *
 * Emitted with the heading even when empty, so the block always exists in the
 * file and a later edit is a section replacement rather than an insertion at
 * a guessed position — the same reason buildSolutionsSection is shared.
 *
 * The note is the user's prose and goes in verbatim, but the heading sentinel
 * must stay findable, so a note that forges one is defused.
 */
function buildNotesSection(note) {
  const text = String(note ?? '').trim();
  let c = `### NOTES\n\n`;
  c += text
    ? `${text.replace(/^###\s+NOTES\s*$/gim, '### NOTES​')}\n\n`
    : `_No notes yet._\n\n`;
  return c;
}

function generateProblemReadme(problem) {
  const {
    number, title, difficulty, tags, description, url, language,
    runtime, memory, solutionNumber, solutionLabel, bestRuntime,
    bestMemory, isNewBestTime, isNewBestMemory, isFirstSolution,
    attempts, verdicts, firstSeenAt,
  } = problem;

  const langInfo = getLanguageInfo(language || '');
  // Plain text: it becomes the <img> alt for the topics panel.
  const tagsList = (tags && tags.length) ? tags.join(', ') : 'None';
  const date = new Date().toISOString().split('T')[0];
  const solNum = solutionNumber || 1;

  let c = '';

  // ── Header ──
  c += `<div align="center">\n\n`;
  c += `# ${number}. ${title}\n\n`;
  c += `${difficultyShieldBadge(difficulty)}\xa0\xa0`;
  c += `${languageShieldBadge(langInfo.name)}\xa0\xa0`;
  c += `![Solutions](https://img.shields.io/badge/SOLUTIONS-${shieldText(solNum)}-6c5ce7?style=for-the-badge&labelColor=1a1a2e)\xa0\xa0`;
  c += `![Date](https://img.shields.io/badge/DATE-${shieldText(date)}-605d5d?style=for-the-badge&labelColor=1a1a2e)\n\n`;
  c += `[![View on LeetCode](https://img.shields.io/badge/View%20on-LeetCode-ffa116?style=flat-square&logo=leetcode&logoColor=ffa116)](${url})\n\n`;
  c += `</div>\n\n`;
  c += `---\n\n`;

  // ── Topics + Best Performance, as SVG panels ──
  // Neither section needs per-row links, so both get the same rendered
  // treatment as the root stat panels rather than GitHub's table styling.
  c += `<div align="center">\n\n`;
  c += `<picture>\n`;
  c += `  <source media="(prefers-color-scheme: dark)" srcset="${PROBLEM_SVG.dark}">\n`;
  c += `  <source media="(prefers-color-scheme: light)" srcset="${PROBLEM_SVG.light}">\n`;
  c += `  <img alt="Topics: ${svgEsc(tagsList)} — best runtime ${svgEsc(bestRuntime || runtime || 'N/A')}, best memory ${svgEsc(bestMemory || memory || 'N/A')}" src="${PROBLEM_SVG.dark}">\n`;
  c += `</picture>\n\n`;
  c += `</div>\n\n`;

  if (isNewBestTime || isNewBestMemory) {
    const improved = [isNewBestTime && 'Runtime', isNewBestMemory && 'Memory']
      .filter(Boolean).join(' and ');
    c += `> **New personal best** — ${improved} improved on this submission.\n\n`;
  }

  c += buildAttemptsSection({ attempts, verdicts, firstSeenAt });
  c += `---\n\n`;

  // ── Notes ──
  c += buildNotesSection(problem.note);
  c += `---\n\n`;

  // ── Solutions Index ──
  c += buildSolutionsSection(solNum, langInfo, date);
  c += `---\n\n`;

  // ── Problem Description ──
  c += `### PROBLEM DESCRIPTION\n\n`;
  c += `${description}\n\n`;
  c += `---\n\n`;

  c += `<div align="center">\n\n`;
  c += `<sub>Auto-synced by <strong>LeetSync</strong> · Built by `;
  c += `<a href="https://deveshsamant.in/">Devesh Samant</a></sub>\n\n`;
  c += `</div>\n`;

  return c;
}
// ── README themes — implements "README Header.dc.html" (Claude Design) ──
//
// The design splits the header into five panels. Panels 1–2 (title and the
// four shields.io badges) stay as Markdown, because GitHub renders those
// natively and the badges are theme-independent by design. Panels 3–5
// (progress, languages, quick stats) cannot be expressed in Markdown, so they
// ship as two SVGs with byte-identical geometry — only the theme hexes swap —
// served through <picture> + prefers-color-scheme.

const SVG_THEME = {
  light: {
    canvas: '#ffffff', rule2: '#201e1d', rule1: '#d7d3d3', heading: '#ec3013',
    label: '#201e1d', pct: '#605d5d', track: '#d7d3d3', langFill: '#ec3013',
    tableLabel: '#605d5d', tableValue: '#201e1d', row: '#ffffff', zebra: '#f3f2f2',
  },
  dark: {
    canvas: '#0d1117', rule2: '#605d5d', rule1: '#444141', heading: '#ff563c',
    label: '#f8f4f4', pct: '#bab6b6', track: '#444141', langFill: '#ff563c',
    tableLabel: '#bab6b6', tableValue: '#f8f4f4', row: '#0d1117', zebra: '#201e1d',
  },
};

// Difficulty fills are identical in both themes (per the design spec).
const DIFF_FILL = { Total: '#6c5ce7', Easy: '#00b8a3', Medium: '#ffa116', Hard: '#ef4743' };

// Geometry: 900px canvas with 40px padding -> 820px content. Row grid is
// 92 / 40 / 1fr / 44 with a 16px gutter; bars are 14px tall.
const SVG_W = 820;
const COL_LABEL = 92, COL_COUNT = 40, COL_PCT = 44, GUTTER = 16;
const COL_BAR = SVG_W - COL_LABEL - COL_COUNT - COL_PCT - GUTTER * 3;
const X_COUNT_END = COL_LABEL + GUTTER + COL_COUNT;
const X_BAR = X_COUNT_END + GUTTER;
const BAR_H = 14, ROW_GAP = 11, SEG_GAP = 2;
const SEGS_DIFF = 30, SEGS_LANG = 25;

const F_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const F_SANS = 'Archivo, system-ui, -apple-system, Segoe UI, sans-serif';

function svgEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Mirrors progressBar(): round the ratio onto `width` cells, filled first. */
function svgSegments(value, total, width, fill, track, y) {
  const filled = total ? Math.round((value / total) * width) : 0;
  const segW = (COL_BAR - SEG_GAP * (width - 1)) / width;
  let out = '';
  for (let i = 0; i < width; i++) {
    const x = (X_BAR + i * (segW + SEG_GAP)).toFixed(2);
    out += `<rect x="${x}" y="${y}" width="${segW.toFixed(2)}" height="${BAR_H}" fill="${i < filled ? fill : track}"/>`;
  }
  return out;
}

function svgBarRow(row, y, t, fill, segCount) {
  const base = y + BAR_H / 2 + 4.3;
  let s = '';
  s += `<text x="0" y="${base}" font-family="${F_MONO}" font-size="12.5" fill="${t.label}">${svgEsc(row.label)}</text>`;
  s += `<text x="${X_COUNT_END}" y="${base}" text-anchor="end" font-family="${F_MONO}" font-size="12.5" font-weight="700" fill="${t.label}">${row.count}</text>`;
  s += svgSegments(row.count, row.total, segCount, fill, t.track, y);
  s += `<text x="${SVG_W}" y="${base}" text-anchor="end" font-family="${F_MONO}" font-size="11" fill="${t.pct}">${row.pct}</text>`;
  return s;
}

function svgHeading(text, y, t) {
  return `<text x="${SVG_W / 2}" y="${y + 30}" text-anchor="middle" font-family="${F_SANS}" `
    + `font-size="12" font-weight="800" letter-spacing="1.68" fill="${t.heading}">${svgEsc(text)}</text>`;
}

function svgPct(value, total) {
  return (total ? Math.round((value / total) * 100) : 0) + '%';
}

/**
 * Build panels 3–5 as a single SVG. Geometry is identical between themes so
 * the light and dark files stay swappable.
 */
function buildStatsSvg(problems, themeName) {
  const t = SVG_THEME[themeName] || SVG_THEME.dark;
  const sorted = [...problems].sort((a, b) => a.number - b.number);
  const total = sorted.length;

  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  const langCount = {};
  sorted.forEach(p => {
    if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
    if (p.language) langCount[p.language] = (langCount[p.language] || 0) + 1;
  });
  const topLangs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const today = new Date().toISOString().split('T')[0];

  const HEAD_H = 50, RULE2 = 2, GAP_PANEL = 30;
  let y = 0;
  let body = '';

  // ── Panel 3 · Progress Dashboard ──
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="${RULE2}" fill="${t.rule2}"/>`;
  y += RULE2;
  body += svgHeading('PROGRESS DASHBOARD', y, t);
  y += HEAD_H;

  const progRows = [
    { label: 'Total', count: total, total, pct: '100%', fill: DIFF_FILL.Total },
    { label: 'Easy', count: counts.Easy, total, pct: svgPct(counts.Easy, total), fill: DIFF_FILL.Easy },
    { label: 'Medium', count: counts.Medium, total, pct: svgPct(counts.Medium, total), fill: DIFF_FILL.Medium },
    { label: 'Hard', count: counts.Hard, total, pct: svgPct(counts.Hard, total), fill: DIFF_FILL.Hard },
  ];
  progRows.forEach((r, i) => {
    body += svgBarRow(r, y, t, r.fill, SEGS_DIFF);
    y += BAR_H + (i < progRows.length - 1 ? ROW_GAP : 0);
  });

  // ── Panel 4 · Languages Used ──
  y += GAP_PANEL;
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="${RULE2}" fill="${t.rule2}"/>`;
  y += RULE2;
  body += svgHeading('LANGUAGES USED', y, t);
  y += HEAD_H;

  if (topLangs.length) {
    topLangs.forEach(([name, n], i) => {
      body += svgBarRow(
        { label: name, count: n, total, pct: svgPct(n, total) },
        y, t, t.langFill, SEGS_LANG
      );
      y += BAR_H + (i < topLangs.length - 1 ? ROW_GAP : 0);
    });
  } else {
    body += `<text x="0" y="${y + 11}" font-family="${F_MONO}" font-size="12.5" fill="${t.pct}">No solutions yet</text>`;
    y += BAR_H;
  }

  // ── Panel 5 · Quick Stats ──
  y += GAP_PANEL;
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="${RULE2}" fill="${t.rule2}"/>`;
  y += RULE2;
  body += svgHeading('QUICK STATS', y, t);
  y += HEAD_H;

  const ROW_H = 35;
  const rows = [
    ['Total Solved', String(total), null, true],
    ['Easy', String(counts.Easy), DIFF_FILL.Easy, true],
    ['Medium', String(counts.Medium), DIFF_FILL.Medium, true],
    ['Hard', String(counts.Hard), DIFF_FILL.Hard, true],
    ['Languages', topLangs.map(([l]) => l).join(', ') || 'N/A', null, false],
    ['Last Solved', sorted[sorted.length - 1]?.title || 'N/A', null, false],
    ['Last Push', today, null, false],
  ];

  rows.forEach((r, i) => {
    const [label, value, swatch, bold] = r;
    const bg = i % 2 === 0 ? t.zebra : t.row;
    const base = y + ROW_H / 2 + 4.6;
    body += `<rect x="0" y="${y}" width="${SVG_W}" height="${ROW_H}" fill="${bg}"/>`;
    body += `<text x="12" y="${base}" font-family="${F_MONO}" font-size="13" fill="${t.tableLabel}">${svgEsc(label)}</text>`;
    if (swatch) {
      body += `<rect x="${SVG_W - 12 - 9 - 7 - value.length * 7.8}" y="${y + ROW_H / 2 - 4.5}" width="9" height="9" fill="${swatch}"/>`;
    }
    body += `<text x="${SVG_W - 12}" y="${base}" text-anchor="end" font-family="${F_MONO}" font-size="13"`
      + `${bold ? ' font-weight="700"' : ''} fill="${t.tableValue}">${svgEsc(value)}</text>`;
    const last = i === rows.length - 1;
    body += `<rect x="0" y="${y + ROW_H}" width="${SVG_W}" height="${last ? 2 : 1}" fill="${last ? t.rule2 : t.rule1}"/>`;
    y += ROW_H + (last ? 2 : 1);
  });

  const H = Math.ceil(y);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${H}" viewBox="0 0 ${SVG_W} ${H}" role="img" aria-label="LeetCode progress, languages and quick stats">`
    + `<rect width="${SVG_W}" height="${H}" fill="${t.canvas}"/>${body}</svg>`;
}

// Where the generated panels live in the user's repository.
const SVG_PATH = {
  light: '.leetsync/stats-light.svg',
  dark: '.leetsync/stats-dark.svg',
};

const CAL_PATH = {
  light: '.leetsync/calendar-light.svg',
  dark: '.leetsync/calendar-dark.svg',
};

const CAL_WEEKS = 53;                 // a rolling year, like GitHub's own grid
const CAL_CELL = 13;
const CAL_GAP = 3;
const CAL_LEFT = 30;                  // room for the weekday initials
const CAL_TOP = 34;                   // room for the heading and month labels
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight UTC for a YYYY-MM-DD string, or null if it is not one. */
function utcDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * A rolling-year solve grid, one cell per day, shaded by how many problems
 * were solved that day.
 *
 * Dates are handled entirely in UTC. Building the grid off local time would
 * put a solve in a different column depending on where the README is
 * generated, and the stored dates are already UTC calendar days.
 */
function buildCalendarSvg(problems, themeName, endDate) {
  const t = SVG_THEME[themeName] || SVG_THEME.dark;

  const perDay = new Map();
  for (const p of problems) {
    const day = utcDay(p.date);
    if (day === null) continue;
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }

  // The grid ends on the Saturday of the current week, so the last column is
  // never a partial one that shifts every day.
  const end = utcDay(endDate) ?? Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const endDow = new Date(end).getUTCDay();
  const gridEnd = end + (6 - endDow) * 86400000;
  const gridStart = gridEnd - (CAL_WEEKS * 7 - 1) * 86400000;

  const step = CAL_CELL + CAL_GAP;
  const W = CAL_LEFT + CAL_WEEKS * step + 10;
  const H = CAL_TOP + 7 * step + 26;

  const busiest = Math.max(1, ...perDay.values());
  // Four shades, so a one-solve day and a five-solve day read differently.
  const shade = (n) => {
    if (!n) return t.track;
    const level = Math.min(4, Math.ceil((n / busiest) * 4));
    return { 1: 0.35, 2: 0.55, 3: 0.78, 4: 1 }[level] === 1
      ? t.langFill
      : `${t.langFill}${{ 1: '59', 2: '8c', 3: 'c7' }[level]}`;
  };

  let body = `<text x="0" y="14" font-family="system-ui,sans-serif" font-size="13"`
    + ` font-weight="700" fill="${t.heading}">SOLVE ACTIVITY</text>`;

  let solvedDays = 0;
  let cells = '';
  let monthLabels = '';
  let lastMonth = -1;

  for (let w = 0; w < CAL_WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const day = gridStart + (w * 7 + d) * 86400000;
      if (day > end) continue;                       // do not draw the future
      const n = perDay.get(day) || 0;
      if (n) solvedDays++;
      const x = CAL_LEFT + w * step;
      const y = CAL_TOP + d * step;
      const iso = new Date(day).toISOString().slice(0, 10);
      cells += `<rect x="${x}" y="${y}" width="${CAL_CELL}" height="${CAL_CELL}"`
        + ` fill="${shade(n)}" rx="2"><title>${iso}: ${n} solved</title></rect>`;
    }
    // One label per month, at the week its 1st falls in.
    const first = new Date(gridStart + w * 7 * 86400000);
    if (first.getUTCMonth() !== lastMonth) {
      lastMonth = first.getUTCMonth();
      monthLabels += `<text x="${CAL_LEFT + w * step}" y="${CAL_TOP - 8}"`
        + ` font-family="system-ui,sans-serif" font-size="9.5" fill="${t.pct}">`
        + `${MONTHS[lastMonth]}</text>`;
    }
  }

  let dowLabels = '';
  for (const [d, label] of [[1, 'M'], [3, 'W'], [5, 'F']]) {
    dowLabels += `<text x="0" y="${CAL_TOP + d * step + 10}"`
      + ` font-family="system-ui,sans-serif" font-size="9.5" fill="${t.pct}">${label}</text>`;
  }

  const footer = `<text x="0" y="${H - 8}" font-family="system-ui,sans-serif"`
    + ` font-size="10" fill="${t.pct}">${solvedDays} active day${solvedDays === 1 ? '' : 's'}`
    + ` · ${problems.length} solved · busiest ${busiest} in a day</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"`
    + ` viewBox="0 0 ${W} ${H}" role="img" aria-label="Solve activity over the last year">`
    + `<rect width="${W}" height="${H}" fill="${t.canvas}"/>`
    + `${body}${monthLabels}${dowLabels}${cells}${footer}</svg>`;
}

// Per-problem panels sit beside the problem's own README.
const PROBLEM_SVG = {
  light: 'panel-light.svg',
  dark: 'panel-dark.svg',
};

/**
 * Per-problem panel: Topics and Best Performance rendered as SVG so they get
 * the same treatment as the root stat panels. Only sections without per-row
 * links move here — GitHub cannot make regions of an <img> clickable, so the
 * solutions table stays Markdown.
 */
function buildProblemSvg(problem, themeName) {
  const t = SVG_THEME[themeName] || SVG_THEME.dark;
  const tags = (problem.tags && problem.tags.length) ? problem.tags : ['None'];

  const HEAD_H = 50, RULE2 = 2, GAP_PANEL = 30, CHIP_H = 26, CHIP_GAP = 8;
  let y = 0;
  let body = '';

  // ── Topics ──
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="${RULE2}" fill="${t.rule2}"/>`;
  y += RULE2;
  body += svgHeading('TOPICS', y, t);
  y += HEAD_H;

  // Chips wrap onto further rows; 7.1px per character approximates the mono
  // advance width closely enough at 12px.
  let cx = 0;
  const rowsStart = y;
  tags.forEach(tag => {
    const w = Math.round(String(tag).length * 7.1) + 22;
    if (cx + w > SVG_W) { cx = 0; y += CHIP_H + CHIP_GAP; }
    body += `<rect x="${cx}" y="${y}" width="${w}" height="${CHIP_H}" fill="${t.zebra}" stroke="${t.rule1}"/>`;
    body += `<text x="${cx + w / 2}" y="${y + CHIP_H / 2 + 4.4}" text-anchor="middle" `
      + `font-family="${F_MONO}" font-size="12" fill="${t.label}">${svgEsc(tag)}</text>`;
    cx += w + CHIP_GAP;
  });
  y += CHIP_H;
  if (y === rowsStart + CHIP_H) { /* single row */ }

  // ── Best Performance ──
  y += GAP_PANEL;
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="${RULE2}" fill="${t.rule2}"/>`;
  y += RULE2;
  body += svgHeading('BEST PERFORMANCE', y, t);
  y += HEAD_H;

  const C1 = 220, C2 = 300;               // Metric | This attempt | All-time best
  const ROW_H = 38;

  // Column header
  body += `<text x="12" y="${y + 12}" font-family="${F_MONO}" font-size="11" letter-spacing="1.1" fill="${t.pct}">METRIC</text>`;
  body += `<text x="${C1 + 12}" y="${y + 12}" font-family="${F_MONO}" font-size="11" letter-spacing="1.1" fill="${t.pct}">THIS ATTEMPT</text>`;
  body += `<text x="${C1 + C2 + 12}" y="${y + 12}" font-family="${F_MONO}" font-size="11" letter-spacing="1.1" fill="${t.pct}">ALL-TIME BEST</text>`;
  y += 22;
  body += `<rect x="0" y="${y}" width="${SVG_W}" height="1" fill="${t.rule1}"/>`;
  y += 1;

  const rows = [
    ['Runtime', problem.runtime, problem.bestRuntime || problem.runtime, problem.isNewBestTime],
    ['Memory', problem.memory, problem.bestMemory || problem.memory, problem.isNewBestMemory],
  ];

  rows.forEach(([label, now, best, isNew], i) => {
    const bg = i % 2 === 0 ? t.zebra : t.row;
    const base = y + ROW_H / 2 + 4.6;
    body += `<rect x="0" y="${y}" width="${SVG_W}" height="${ROW_H}" fill="${bg}"/>`;
    body += `<text x="12" y="${base}" font-family="${F_MONO}" font-size="13" fill="${t.tableLabel}">${svgEsc(label)}</text>`;
    body += `<text x="${C1 + 12}" y="${base}" font-family="${F_MONO}" font-size="13" fill="${t.tableLabel}">${svgEsc(now || 'N/A')}</text>`;
    body += `<text x="${C1 + C2 + 12}" y="${base}" font-family="${F_MONO}" font-size="13" font-weight="700" fill="${t.tableValue}">${svgEsc(best || 'N/A')}</text>`;
    if (isNew) {
      const bx = C1 + C2 + 12 + String(best || 'N/A').length * 7.8 + 10;
      body += `<rect x="${bx}" y="${y + ROW_H / 2 - 8}" width="42" height="16" fill="${DIFF_FILL.Total}"/>`;
      body += `<text x="${bx + 21}" y="${y + ROW_H / 2 + 4}" text-anchor="middle" font-family="${F_MONO}" font-size="9.5" font-weight="700" fill="#ffffff">BEST</text>`;
    }
    body += `<rect x="0" y="${y + ROW_H}" width="${SVG_W}" height="${i === rows.length - 1 ? 2 : 1}" fill="${i === rows.length - 1 ? t.rule2 : t.rule1}"/>`;
    y += ROW_H + (i === rows.length - 1 ? 2 : 1);
  });

  const H = Math.ceil(y);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${H}" viewBox="0 0 ${SVG_W} ${H}" role="img" aria-label="Topics and best performance">`
    + `<rect width="${SVG_W}" height="${H}" fill="${t.canvas}"/>${body}</svg>`;
}

/**
 * How many problems LeetCode publishes at each difficulty.
 *
 * A snapshot, not a live figure — it drifts upward as problems are added, and
 * fetching it would cost a network call on every push. "45 / 895" still reads
 * far better than a bare "45", and a stale denominator is off by a percent or
 * so. Update here when it matters.
 */
const LEETCODE_TOTALS = { Easy: 895, Medium: 1878, Hard: 843 };
const LEETCODE_TOTAL_ALL =
  LEETCODE_TOTALS.Easy + LEETCODE_TOTALS.Medium + LEETCODE_TOTALS.Hard;

/** Panels 1–2: title, subtitle and the four theme-independent badges. */
function buildReadmeHeader(problems, fallback, calFallback) {
  const total = problems.length;
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  problems.forEach(p => { if (counts[p.difficulty] !== undefined) counts[p.difficulty]++; });

  // shieldText doubles "-" and "_" then percent-encodes, which is what keeps
  // the "/" in "45/895" from splitting the badge path into a 404. Encoding it
  // again here would ship a literal "%2F" as the badge text.
  const badge = (label, value, fill) =>
    `![${label}](https://img.shields.io/badge/${encodeURIComponent(label.toUpperCase())}-${shieldText(String(value))}-${fill.slice(1)}?style=for-the-badge&labelColor=1a1a2e)`;
  const outOf = (n, of) => `${n}/${of}`;

  let c = '';
  c += `<div align="center">\n\n`;
  c += `<h1>LeetCode Solutions</h1>\n`;
  c += `<p><em>Automatically synced with every accepted submission</em></p>\n\n`;
  c += `${badge('Total Solved', outOf(total, LEETCODE_TOTAL_ALL), DIFF_FILL.Total)} `;
  c += `${badge('Easy', outOf(counts.Easy, LEETCODE_TOTALS.Easy), DIFF_FILL.Easy)} `;
  c += `${badge('Medium', outOf(counts.Medium, LEETCODE_TOTALS.Medium), DIFF_FILL.Medium)} `;
  c += `${badge('Hard', outOf(counts.Hard, LEETCODE_TOTALS.Hard), DIFF_FILL.Hard)}\n\n`;
  c += `<picture>\n`;
  c += `  <source media="(prefers-color-scheme: dark)" srcset="${SVG_PATH.dark}">\n`;
  c += `  <source media="(prefers-color-scheme: light)" srcset="${SVG_PATH.light}">\n`;
  c += `  <img alt="Progress, languages and quick stats" src="${fallback}">\n`;
  c += `</picture>\n\n`;
  c += `<picture>\n`;
  c += `  <source media="(prefers-color-scheme: dark)" srcset="${CAL_PATH.dark}">\n`;
  c += `  <source media="(prefers-color-scheme: light)" srcset="${CAL_PATH.light}">\n`;
  c += `  <img alt="Solve activity over the last year" src="${calFallback}">\n`;
  c += `</picture>\n\n`;
  c += `</div>\n\n`;
  return c;
}

function buildRoot(problems, themeName) {
  const sorted = [...problems].sort((a, b) => a.number - b.number);
  const today = new Date().toISOString().split('T')[0];
  let c = buildReadmeHeader(sorted,
    SVG_PATH[themeName] || SVG_PATH.dark,
    CAL_PATH[themeName] || CAL_PATH.dark);
  c += buildProblemsTable(sorted, today);
  c += buildFooter();
  return c;
}

/**
 * Two themes, matching the design's two artboards. Both emit identical
 * Markdown and both SVGs are always published, so GitHub switches on the
 * reader's system theme. The selection decides only which file the <picture>
 * falls back to where prefers-color-scheme is unsupported.
 */
const README_THEMES = {
  light: (problems) => buildRoot(problems, 'light'),
  dark: (problems) => buildRoot(problems, 'dark'),
};

// ── Shared helpers for themes ──
/**
 * The solutions index for one problem. Shared so that deleting a solution can
 * rewrite this block in place without regenerating the whole README — the
 * stored record has no description or tags to rebuild the rest from.
 */
function buildSolutionsSection(count, langInfo, date) {
  let c = `### SOLUTIONS (${count})\n\n`;
  c += `| # | File | Language | Date |\n`;
  c += `|:-:|------|:--------:|:----:|\n`;
  for (let i = 1; i <= count; i++) {
    const fname = `sol${i}${langInfo.ext}`;
    const tag = i === count ? ' ← **latest**' : '';
    c += `| ${i} | [${fname}](./${fname}) | \`${langInfo.name}\` | ${date}${tag} |\n`;
  }
  return c + `\n`;
}

/** One row of the solutions table. */
function problemRow(p, today) {
  const num = p.number || parseInt(p.folderName?.match(/^(\d+)/)?.[1], 10) || '?';
  const folder = p.folderName || buildFolderName(num, p.title);
  const link = `[${p.title}](problems/${folder})`;
  // Square swatches, matching the design's 9px difficulty chips — the
  // circles the old themes used are not part of this system.
  const swatch = { Easy: '🟩', Medium: '🟧', Hard: '🟥' }[p.difficulty] || '⬜';
  const diff = `${swatch} ${p.difficulty || '—'}`;
  return `| ${num} | ${link} | ${diff} | \`${p.language}\` | ${p.date || today} |\n`;
}

const TABLE_HEAD =
  `| # | Problem | Difficulty | Language | Date |\n`
  + `|:---:|:--------|:----------:|:--------:|:----:|\n`;

/** Past this many solutions a flat table stops being readable. */
const FLAT_TABLE_LIMIT = 40;
const RECENT_COUNT = 10;

/**
 * The solutions index.
 *
 * A flat table is fine while the repo is small, but it grows by one row per
 * push forever, and at a few hundred it is a wall nobody scrolls. Past
 * FLAT_TABLE_LIMIT this switches to the most recent solutions up front and
 * collapsed <details> per difficulty — which GitHub renders natively, so the
 * whole list is still one click away and still searchable in the raw file.
 */
function buildProblemsTable(sorted, today) {
  let c = `---\n\n`;
  c += `<div align="center">\n\n`;
  c += `### ALL SOLUTIONS\n\n`;
  c += `</div>\n\n`;

  if (sorted.length <= FLAT_TABLE_LIMIT) {
    c += TABLE_HEAD;
    sorted.forEach(p => { c += problemRow(p, today); });
    return c + `\n`;
  }

  // Newest first, by date then number — the rows a visitor actually wants.
  const recent = [...sorted]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.number - a.number)
    .slice(0, RECENT_COUNT);

  c += `**Latest ${recent.length}**\n\n`;
  c += TABLE_HEAD;
  recent.forEach(p => { c += problemRow(p, today); });
  c += `\n`;

  for (const level of ['Easy', 'Medium', 'Hard']) {
    const rows = sorted.filter(p => p.difficulty === level);
    if (!rows.length) continue;
    const swatch = { Easy: '🟩', Medium: '🟧', Hard: '🟥' }[level];
    c += `<details>\n<summary><strong>${swatch} ${level}</strong> — ${rows.length} solved</summary>\n\n`;
    c += TABLE_HEAD;
    rows.forEach(p => { c += problemRow(p, today); });
    c += `\n</details>\n\n`;
  }

  const rest = sorted.filter(p => !['Easy', 'Medium', 'Hard'].includes(p.difficulty));
  if (rest.length) {
    c += `<details>\n<summary><strong>⬜ Uncategorised</strong> — ${rest.length}</summary>\n\n`;
    c += TABLE_HEAD;
    rest.forEach(p => { c += problemRow(p, today); });
    c += `\n</details>\n\n`;
  }

  return c;
}

function buildFooter() {
  // Restrained single line — the design carries no decorative emoji.
  let c = `---\n\n`;
  c += `<div align="center">\n\n`;
  c += `<sub>Auto-synced by <strong>LeetSync</strong> · Built by `;
  c += `<a href="https://deveshsamant.in/">Devesh Samant</a></sub>\n\n`;
  c += `</div>\n`;
  return c;
}

// Exported only when required from Node (tests). In the service worker
// `module` is undefined, so this block is skipped.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    shieldText, difficultyShieldBadge, languageShieldBadge,
    progressBar, slugify, padNumber, buildFolderName, getLanguageInfo,
    generateProblemReadme, buildStatsSvg, buildProblemSvg,
    buildProblemsTable, buildFooter, buildSolutionsSection, slugFromLeetCodeUrl,
    README_THEMES, SVG_PATH, PROBLEM_SVG, SVG_THEME, DIFF_FILL,
    buildCalendarSvg, CAL_PATH, LEETCODE_TOTALS,
    buildProblemsTable, FLAT_TABLE_LIMIT, buildNotesSection, buildAttemptsSection,
  };
}
