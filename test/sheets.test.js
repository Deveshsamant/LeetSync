const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// sheets.json is generated from the PDFs by scripts/parse-sheets.py. These
// guard the shape the popup and tracker rely on, so a bad regeneration is
// caught here rather than by an empty Sheets tab.
const data = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'sheets.json'), 'utf8')
);

const everyQuestion = () =>
  data.sheets.flatMap(s => s.groups.flatMap(g => g.questions.map(q => [s, q])));

test('sheets.json has the expected sheets', () => {
  assert.ok(Array.isArray(data.sheets));
  assert.equal(data.sheets.length, 7);
  const ids = data.sheets.map(s => s.id).sort();
  assert.deepEqual(ids, [
    'love-babbar-450', 'neetcode-150', 'neetcode-250',
    'striver-79-sheet', 'striver-a2z-sheet', 'striver-blind-75',
    'striver-sde-sheet',
  ]);
});

test('every sheet declares a count matching its questions', () => {
  for (const s of data.sheets) {
    const actual = s.groups.reduce((n, g) => n + g.questions.length, 0);
    assert.equal(actual, s.count, `${s.id}: count ${s.count} but ${actual} questions`);
    assert.ok(s.groups.length > 0, `${s.id} has no groups`);
    assert.ok(s.name, `${s.id} has no name`);
  }
});

test('trackable equals the number of questions with a LeetCode id', () => {
  for (const s of data.sheets) {
    const withId = s.groups.reduce(
      (n, g) => n + g.questions.filter(q => q.id != null).length, 0);
    assert.equal(withId, s.trackable, `${s.id}: trackable mismatch`);
  }
});

test('every question has a title and a known difficulty', () => {
  const allowed = new Set(['Easy', 'Medium', 'Hard', 'Unknown']);
  for (const [s, q] of everyQuestion()) {
    assert.ok(q.title && q.title.trim(), `${s.id}: empty title`);
    assert.ok(allowed.has(q.difficulty), `${s.id}: bad difficulty ${q.difficulty}`);
  }
});

test('a slug always comes with a resolved LeetCode id', () => {
  for (const [s, q] of everyQuestion()) {
    if (q.slug) {
      assert.ok(Number.isInteger(q.id) && q.id > 0,
        `${s.id}: ${q.title} has slug ${q.slug} but id ${q.id}`);
      assert.match(q.slug, /^[a-z0-9-]+$/);
    }
  }
});

test('a question is either on LeetCode or has a fallback url, never both', () => {
  for (const [s, q] of everyQuestion()) {
    assert.ok(!(q.slug && q.url), `${s.id}: ${q.title} has both slug and url`);
    if (!q.slug && q.url) assert.match(q.url, /^https?:\/\//);
  }
});

// Some rows genuinely have no destination: the A2Z PDF prints "no LeetCode"
// with no hyperlink for theory items like "Check if the Number is Armstrong".
// Those are shown without a link rather than dropped, so this asserts the
// shortfall stays small instead of demanding zero.
test('almost every question is reachable', () => {
  const all = everyQuestion();
  const stranded = all.filter(([, q]) => !q.slug && !q.url);
  const ratio = stranded.length / all.length;
  assert.ok(ratio < 0.06,
    `${stranded.length}/${all.length} questions have no link (${(ratio * 100).toFixed(1)}%)`);
});

// Sheets legitimately list one problem several times under different wordings
// — Love Babbar 450 has "Kth Largest Element" three ways, all resolving to
// id 215. Deduplicating would misrepresent the sheet, so only the shape is
// checked here.
test('resolved ids are plausible LeetCode numbers', () => {
  for (const [s, q] of everyQuestion()) {
    if (q.id == null) continue;
    assert.ok(Number.isInteger(q.id) && q.id > 0 && q.id < 5000,
      `${s.id}: ${q.title} has implausible id ${q.id}`);
  }
});
