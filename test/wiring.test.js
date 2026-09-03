const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Structural checks over the popup and tracker pages.
 *
 * These exist because of two bugs that shipped: the Solved tab's search box
 * and difficulty chips were markup with no handlers, and the footer's
 * "Open dashboard" button had an id nothing ever read. Both are invisible to
 * a linter and to any test that only exercises pure functions, but both are
 * obvious when the markup and its script are compared.
 *
 * Deliberately dependency-free — no jsdom — so it stays fast and runs
 * anywhere `node --test` does.
 */

const read = (f) => readFileSync(join(__dirname, '..', f), 'utf8');

const PAGES = [
  { name: 'popup', html: read('popup.html'), js: read('popup.js') },
  { name: 'tracker', html: read('tracker.html'), js: read('tracker.js') },
];

/** ids that are styling or layout anchors only, never read from script. */
const MARKUP_ONLY = new Set(['uiThemeGrid']);

const idsIn = (html) => [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const referenced = (js, id) => js.includes(`'${id}'`) || js.includes(`"${id}"`) || js.includes(`#${id}`);

for (const page of PAGES) {
  test(`${page.name}: every getElementById target exists in the markup`, () => {
    const ids = new Set(idsIn(page.html));
    const wanted = [...new Set(
      [...page.js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1])
    )];
    const missing = wanted.filter(id => !ids.has(id));
    assert.deepEqual(missing, [], `script reads ids that no element has: ${missing}`);
  });

  test(`${page.name}: no duplicate ids`, () => {
    const ids = idsIn(page.html);
    const seen = new Set();
    const dupes = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(dupes, [], `duplicate ids: ${dupes}`);
  });

  test(`${page.name}: every interactive control with an id is wired`, () => {
    const controls = [...page.html.matchAll(
      /<(?:button|input|select|textarea)\b[^>]*\bid="([^"]+)"/g
    )].map(m => m[1]);
    const dead = controls.filter(id => !MARKUP_ONLY.has(id) && !referenced(page.js, id));
    assert.deepEqual(dead, [], `controls the script never touches: ${dead}`);
  });
}

test('popup: every data-* hook in the markup is read by the script', () => {
  const { html, js } = PAGES[0];
  const hooks = [...new Set(
    [...html.matchAll(/\bdata-([a-z-]+)=/g)].map(m => m[1])
  )];
  // dataset access camelCases the attribute name
  const camel = (h) => h.replace(/-(.)/g, (_, c) => c.toUpperCase());
  const unread = hooks.filter(h => !js.includes(`data-${h}`) && !js.includes(`.${camel(h)}`));
  assert.deepEqual(unread, [], `markup hooks nothing reads: ${unread}`);
});

test('popup: filter chips cover the difficulties the data can hold', () => {
  const { html } = PAGES[0];
  const filters = [...html.matchAll(/data-filter="([^"]+)"/g)].map(m => m[1]);
  for (const expected of ['all', 'easy', 'medium', 'hard']) {
    assert.ok(filters.includes(expected), `missing a "${expected}" filter chip`);
  }
});

test('both pages load the scripts they depend on', () => {
  for (const page of PAGES) {
    if (page.js.includes('SheetProgress') || page.js.includes('SheetData')) {
      assert.match(page.html, /<script src="sheet-progress\.js">/,
        `${page.name} uses SheetProgress/SheetData but never loads it`);
    }
    assert.match(page.html, /<link rel="stylesheet" href="theme\.css">/,
      `${page.name} must load the shared tokens`);
  }
});

test('no reserved underscore-prefixed files sit in the extension root', () => {
  // Chrome reserves the "_" prefix at the top level of an extension and
  // refuses to load the ENTIRE extension if it finds one, reporting only
  // "Could not load manifest" — which points nowhere near the real cause.
  // A generated dev preview once landed here and broke loading outright.
  const root = join(__dirname, '..');
  const offenders = readdirSync(root)
    .filter(name => name.startsWith('_') && name !== '__pycache__');
  assert.deepEqual(offenders, [],
    `these break "Load unpacked" entirely: ${offenders.join(', ')}`);
});

test('the preview generator writes names Chrome will accept', () => {
  const src = readFileSync(join(__dirname, '..', 'scripts', 'make-preview.mjs'), 'utf8');
  const outputs = [...src.matchAll(/build\([^,]+,[^,]+,\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(outputs.length, 'expected make-preview.mjs to declare its outputs');
  for (const name of outputs) {
    assert.ok(!name.startsWith('_'),
      `make-preview.mjs writes "${name}" into the extension root, and a leading underscore stops Chrome loading the extension`);
  }
});
