const test = require('node:test');
const assert = require('node:assert/strict');

const { SheetProgress, SheetData } = require('../sheet-progress.js');

// Manual ticks move to chrome.storage.sync so they survive a reinstall, but
// sync caps a single item at 8192 bytes. These guard the chunking that keeps
// each written item under that.
const PER_ITEM_CAP = 8192;

const makeEntries = (n, prefix = 'striver-a2z-sheet') =>
  Array.from({ length: n }, (_, i) => `${prefix}|Problem number ${i} with a fairly long title`);

test('a small set fits in one chunk', () => {
  const chunks = SheetProgress.chunk(makeEntries(5));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 5);
});

test('every chunk stays under the sync per-item cap', () => {
  for (const count of [100, 515, 1667]) {
    for (const c of SheetProgress.chunk(makeEntries(count))) {
      const bytes = Buffer.byteLength(JSON.stringify(c), 'utf8');
      assert.ok(bytes < PER_ITEM_CAP,
        `${count} entries produced a ${bytes}-byte chunk`);
    }
  }
});

test('chunking loses nothing and preserves order', () => {
  const entries = makeEntries(515);
  const flat = SheetProgress.chunk(entries).flat();
  assert.deepEqual(flat, entries);
});

test('the realistic worst case fits the chunk budget', () => {
  // 515 problems across the sheets cannot be auto-ticked.
  const chunks = SheetProgress.chunk(makeEntries(515));
  assert.ok(chunks.length <= SheetProgress.MAX_CHUNKS,
    `needs ${chunks.length} chunks, budget is ${SheetProgress.MAX_CHUNKS}`);
});

test('an entry longer than a chunk still gets its own chunk', () => {
  const huge = 'sheet|' + 'x'.repeat(SheetProgress.CHUNK_BYTES + 500);
  const chunks = SheetProgress.chunk(['a|b', huge, 'c|d']);
  assert.equal(chunks.flat().length, 3, 'nothing dropped');
});

test('an empty set produces one empty chunk, not a crash', () => {
  const chunks = SheetProgress.chunk([]);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], []);
});

// ── Remote sheet payloads ────────────────────────────────────
// Sheets can be published outside a store release, so a malformed or
// truncated download must be rejected rather than emptying the Sheets tab.

const validPayload = {
  generatedAt: '2026-09-03',
  sheets: [{
    id: 'striver-blind-75', name: "Striver's Blind 75", count: 1, trackable: 1,
    groups: [{ name: 'Array', questions: [{ id: 1, title: 'Two Sum', difficulty: 'Easy' }] }],
  }],
};

test('a well-formed payload is accepted', () => {
  assert.equal(SheetData.isValid(validPayload), true);
});

test('malformed payloads are rejected', () => {
  const bad = [
    null,
    undefined,
    {},
    { sheets: [] },
    { sheets: 'nope' },
    { sheets: [{ id: 'x', name: 'X' }] },                       // no groups
    { sheets: [{ id: 'x', name: 'X', groups: [] }] },           // empty groups
    { sheets: [{ id: 'x', name: 'X', groups: [{ name: 'g' }] }] }, // no questions
    { sheets: [{ name: 'no id', groups: [{ questions: [] }] }] },
  ];
  for (const payload of bad) {
    assert.equal(SheetData.isValid(payload), false,
      `should have rejected ${JSON.stringify(payload)}`);
  }
});

test('the bundled sheets.json passes its own validation', () => {
  const bundled = JSON.parse(
    require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sheets.json'), 'utf8')
  );
  assert.equal(SheetData.isValid(bundled), true);
});
