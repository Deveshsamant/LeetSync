const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shieldText, difficultyShieldBadge, languageShieldBadge,
  progressBar, slugify, padNumber, buildFolderName, getLanguageInfo,
  generateProblemReadme, buildStatsSvg, buildProblemSvg, buildProblemsTable,
  buildSolutionsSection,
  README_THEMES, SVG_PATH, PROBLEM_SVG,
} = require('../readme.js');

const sample = [
  { number: 1, title: 'Two Sum', difficulty: 'Easy', language: 'Java', date: '2026-09-02' },
  { number: 15, title: '3Sum', difficulty: 'Medium', language: 'Python', date: '2026-09-01' },
  { number: 42, title: 'Trapping Rain Water', difficulty: 'Hard', language: 'C++', date: '2026-08-30' },
];

// ── shields.io escaping ──────────────────────────────────────
// Regression: a date badge shipped as "Date-2026-09-02-0984e3". shields.io
// splits the path on "-", so it read label="Date", message="2026" and
// rendered "404 badge not found" in every problem README.

test('shieldText doubles hyphens and underscores', () => {
  assert.equal(shieldText('2026-09-02'), '2026--09--02');
  assert.equal(shieldText('Objective-C'), 'Objective--C');
  assert.equal(shieldText('snake_case'), 'snake__case');
  assert.equal(shieldText('plain'), 'plain');
});

test('shieldText survives empty and nullish input', () => {
  assert.equal(shieldText(''), '');
  assert.equal(shieldText(null), '');
  assert.equal(shieldText(undefined), '');
});

/** A shields.io badge path must be exactly label-message-color. */
function badgeFieldCount(url) {
  const path = decodeURIComponent(url.split('/badge/')[1].split('?')[0]);
  // Collapse escaped pairs first so only real separators remain.
  // Collapse the escaped pairs to a placeholder that is not a hyphen, so
  // only genuine field separators are left to split on.
  return path.replace(/--/g, '~').replace(/__/g, '~').split('-').length;
}

test('every badge in a problem README has exactly 3 fields', () => {
  const md = generateProblemReadme({
    number: 1, title: 'Two Sum', difficulty: 'Easy', tags: ['Array'],
    description: 'desc', url: 'https://leetcode.com/problems/two-sum/',
    language: 'Java', runtime: '3 ms', memory: '47 MB', solutionNumber: 1,
  });
  const urls = [...md.matchAll(/https:\/\/img\.shields\.io\/badge\/[^)\s]+/g)].map(m => m[0]);
  assert.ok(urls.length >= 4, 'expected badges in the header');
  for (const u of urls) {
    assert.equal(badgeFieldCount(u), 3, `malformed badge: ${u}`);
  }
});

test('hyphenated language does not break its badge', () => {
  assert.equal(badgeFieldCount(languageShieldBadge('Objective-C')), 3);
});

test('difficulty badges use the design palette', () => {
  assert.match(difficultyShieldBadge('Easy'), /-00b8a3\?/);
  assert.match(difficultyShieldBadge('Medium'), /-ffa116\?/);
  assert.match(difficultyShieldBadge('Hard'), /-ef4743\?/);
});

// ── progressBar ──────────────────────────────────────────────

test('progressBar fills proportionally and always spans width', () => {
  const bar = progressBar(5, 10, 20);
  assert.equal((bar.match(/[▓░]/g) || []).length, 20);
  assert.match(bar, /50%$/);
});

test('progressBar handles a zero total without dividing by zero', () => {
  assert.match(progressBar(0, 0, 10), /^░{10} 0%$/);
});

// ── folder naming ────────────────────────────────────────────

test('padNumber pads to four digits', () => {
  assert.equal(padNumber(1), '0001');
  assert.equal(padNumber(1234), '1234');
});

test('slugify strips punctuation and collapses spaces', () => {
  assert.equal(slugify('Two Sum'), 'Two-Sum');
  assert.equal(slugify('Trapping Rain Water'), 'Trapping-Rain-Water');
});

test('buildFolderName combines number and slug', () => {
  assert.equal(buildFolderName(1, 'Two Sum'), '0001-Two-Sum');
});

// ── stat panel SVGs ──────────────────────────────────────────

test('light and dark panels share identical geometry', () => {
  const light = buildStatsSvg(sample, 'light');
  const dark = buildStatsSvg(sample, 'dark');
  const strip = s => s.replace(/#[0-9a-fA-F]{6}/g, '#');
  assert.equal(strip(light), strip(dark),
    'only theme hexes may differ between the two panels');
});

test('panels are well-formed SVG with a declared size', () => {
  const svg = buildStatsSvg(sample, 'dark');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /width="820"/);
  assert.match(svg, /height="\d+"/);
  assert.equal((svg.match(/<rect/g) || []).length > 100, true);
});

test('panels render with no problems at all', () => {
  const svg = buildStatsSvg([], 'light');
  assert.match(svg, /<\/svg>$/);
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('panels never emit NaN for real data', () => {
  assert.doesNotMatch(buildStatsSvg(sample, 'dark'), /NaN|undefined/);
});

// ── per-problem panel ────────────────────────────────────────

const problem = {
  number: 11, title: 'Container With Most Water', difficulty: 'Medium',
  tags: ['Array', 'Two Pointers', 'Greedy'],
  description: 'desc', url: 'https://leetcode.com/problems/container-with-most-water/',
  language: 'C++', runtime: '0 ms (Beats 100%)', memory: '62.9 MB (Beats 49%)',
  solutionNumber: 1, bestRuntime: '0 ms (Beats 100%)', bestMemory: '62.9 MB (Beats 49%)',
  isNewBestTime: true,
};

test('problem panel is well-formed SVG in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const svg = buildProblemSvg(problem, theme);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
});

test('problem panel geometry is identical across themes', () => {
  const strip = s => s.replace(/#[0-9a-fA-F]{6}/g, '#');
  assert.equal(strip(buildProblemSvg(problem, 'light')), strip(buildProblemSvg(problem, 'dark')));
});

test('problem panel shows every topic', () => {
  const svg = buildProblemSvg(problem, 'dark');
  for (const tag of problem.tags) assert.ok(svg.includes(tag), `${tag} missing`);
});

test('problem panel marks a new best only when there is one', () => {
  assert.match(buildProblemSvg(problem, 'dark'), />BEST</);
  const noBest = { ...problem, isNewBestTime: false, isNewBestMemory: false };
  assert.doesNotMatch(buildProblemSvg(noBest, 'dark'), />BEST</);
});

test('problem panel survives missing tags and stats', () => {
  const bare = { number: 1, title: 'Two Sum', difficulty: 'Easy' };
  const svg = buildProblemSvg(bare, 'light');
  assert.match(svg, /<\/svg>$/);
  assert.doesNotMatch(svg, /NaN|undefined/);
  assert.ok(svg.includes('None'), 'falls back to a None topic chip');
});

test('problem README references both panels through <picture>', () => {
  const md = generateProblemReadme(problem);
  assert.match(md, /<picture>/);
  assert.ok(md.includes(PROBLEM_SVG.light));
  assert.ok(md.includes(PROBLEM_SVG.dark));
  // The solutions table keeps its per-row links, so it must stay Markdown.
  assert.match(md, /\[sol1\.cpp\]\(\.\/sol1\.cpp\)/);
});

test('language resolves from slug and display name alike', () => {
  assert.equal(getLanguageInfo('cpp').ext, '.cpp');
  assert.equal(getLanguageInfo('C++').ext, '.cpp');
  assert.equal(getLanguageInfo('csharp').ext, '.cs');
  assert.equal(getLanguageInfo('C#').ext, '.cs');
  assert.equal(getLanguageInfo('python3').ext, '.py');
  // Unknown languages still degrade to a safe default.
  assert.equal(getLanguageInfo('brainfuck').ext, '.txt');
});

// ── solutions index ──────────────────────────────────────────
// Deleting a solution rewrites this block in place, so the section has to be
// replaceable without disturbing the description or the topics panel.

test('solutions section lists every file and marks the latest', () => {
  const s = buildSolutionsSection(3, getLanguageInfo('java'), '2026-09-03');
  assert.equal((s.match(/\[sol\d+\.java\]/g) || []).length, 3);
  assert.equal((s.match(/← \*\*latest\*\*/g) || []).length, 1);
  assert.match(s, /### SOLUTIONS \(3\)/);
  assert.match(s, /\| 3 \| \[sol3\.java\]\(\.\/sol3\.java\) \|.*← \*\*latest\*\*/);
});

test('patching the solutions index keeps the README valid', () => {
  const md = generateProblemReadme({
    number: 1, title: 'Two Sum', difficulty: 'Easy', tags: ['Array'],
    description: 'Given an array…', url: 'u', language: 'java', solutionNumber: 3,
  });
  const section = buildSolutionsSection(2, getLanguageInfo('java'), '2026-09-03').trimEnd();
  const patched = md
    .replace(/### SOLUTIONS \(\d+\)[\s\S]*?(?=\n---)/, `${section}\n`)
    .replace(/badge\/SOLUTIONS-\d+-/, 'badge/SOLUTIONS-2-');

  assert.equal((patched.match(/\[sol\d+\.java\]/g) || []).length, 2, 'row removed');
  assert.match(patched, /SOLUTIONS-2-/, 'header badge follows the count');
  // Without a blank line the rule reads as a setext heading and eats the table.
  assert.match(patched.slice(patched.indexOf('### SOLUTIONS')), /\|\n\n---/);
  assert.ok(patched.includes('PROBLEM DESCRIPTION'), 'description survives');
  assert.ok(patched.includes('<picture>'), 'topics panel survives');
});

// ── root README ──────────────────────────────────────────────

test('both themes exist and nothing else', () => {
  assert.deepEqual(Object.keys(README_THEMES).sort(), ['dark', 'light']);
});

test('root README serves both panels through <picture>', () => {
  const md = README_THEMES.dark(sample);
  assert.match(md, /<picture>/);
  assert.ok(md.includes(SVG_PATH.light), 'light panel referenced');
  assert.ok(md.includes(SVG_PATH.dark), 'dark panel referenced');
  assert.match(md, /prefers-color-scheme: dark/);
});

test('theme selection only changes the <picture> fallback', () => {
  const light = README_THEMES.light(sample);
  const dark = README_THEMES.dark(sample);
  assert.notEqual(light, dark);
  assert.match(light, new RegExp(`<img[^>]+src="${SVG_PATH.light}"`));
  assert.match(dark, new RegExp(`<img[^>]+src="${SVG_PATH.dark}"`));
});

test('problems table uses square difficulty swatches, not circles', () => {
  const table = buildProblemsTable(sample, '2026-09-02');
  assert.match(table, /🟩 Easy/);
  assert.match(table, /🟧 Medium/);
  assert.match(table, /🟥 Hard/);
  assert.doesNotMatch(table, /🟢|🟡|🔴/);
});

test('every solved problem appears in the table', () => {
  const table = buildProblemsTable(sample, '2026-09-02');
  for (const p of sample) assert.ok(table.includes(p.title), `${p.title} missing`);
});
