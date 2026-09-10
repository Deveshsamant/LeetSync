const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Guards over the store listing.
 *
 * These exist because of a rejection. Version 2.0.0 was refused on 6 September
 * 2026 for keyword spam (reference "Yellow Argon") over a block that listed the
 * seven study sheets as brand name plus problem count:
 *
 *     Striver's A2Z DSA Sheet (474) - Love Babbar 450 DSA Sheet (448) - ...
 *
 * The feature is real and the fix was a rewrite into prose. But "remember not
 * to put it back" is not a guarantee, and the person who puts it back will be
 * doing something reasonable at the time -- adding a sheet, refreshing the
 * copy -- with no memory of a rejection from months earlier. So the rule is
 * enforced here instead, where it fails in a second rather than in a review
 * queue in a week.
 *
 * The second test guards the other half: a listing whose declared permissions
 * disagree with the manifest is its own rejection, and the two live in
 * different files that are edited at different times.
 */

const read = (f) => readFileSync(join(__dirname, '..', f), 'utf8');

/** The authors whose names were stripped from everything user-facing. */
const AUTHORS = /\b(striver|str[ií]ver's|love\s*babbar|babbar|neetcode)\b/i;

/** The fenced block under a `## heading`. */
function fenced(md, heading) {
  const m = new RegExp('## ' + heading + '[\\s\\S]*?```\\n([\\s\\S]*?)\\n```').exec(md);
  assert.ok(m, `listing.md has no fenced block under "${heading}"`);
  return m[1];
}

/** The fenced block under a **bold label** — how the per-field copy is written. */
function labelled(md, label) {
  const m = new RegExp('\\*\\*' + label + '\\*\\*[\\s\\S]*?```\\n([\\s\\S]*?)\\n```').exec(md);
  assert.ok(m, `listing.md has no fenced block under "**${label}**"`);
  return m[1];
}

test('the store description does not reintroduce the rejected pattern', () => {
  // Scoped to the description itself. The file also quotes the rejected text
  // as an example of what not to do, and that quote must stay.
  const description = fenced(read('store/listing.md'), 'Description');

  assert.ok(!AUTHORS.test(description),
    'the store description names a sheet author again — this is the exact '
    + 'wording that was rejected as keyword spam');

  // The shape mattered as much as the words: a run of short lines each ending
  // in a parenthesised count reads as a keyword block whatever it contains.
  const counted = description.split('\n')
    .filter(line => /^\s*[•\-*]/.test(line) && /\(\s*\d{2,4}\s*\)/.test(line));
  assert.ok(counted.length < 3,
    `${counted.length} bullet lines carry a parenthesised count; that is the `
    + 'formatting the rejection cited, not just the brand names');
});

test('no user-facing text carries a sheet author name', () => {
  // The display names are the ones that reach a user. The ids still carry the
  // authors (striver-a2z-sheet, love-babbar-450) and deliberately so: progress
  // is stored against them, so renaming an id would orphan somebody's ticks.
  const sheets = JSON.parse(read('sheets.json'));
  for (const sheet of sheets.sheets) {
    assert.ok(!AUTHORS.test(sheet.name),
      `sheet "${sheet.name}" (${sheet.id}) has an author's name in its display name`);
  }

  // The changelog is served live from this repo and rendered in the What's New
  // modal, which makes it user-facing text that no release process touches.
  const config = JSON.parse(read('remote-config.json'));
  for (const [version, notes] of Object.entries(config.changelog || {})) {
    for (const note of notes) {
      assert.ok(!AUTHORS.test(note),
        `remote-config changelog ${version} names an author: "${note.slice(0, 60)}..."`);
    }
  }
});

test('the tracker does not print a source URL as its own link text', () => {
  // The sheet sources are the authors' own pages, and their paths spell the
  // names out — strivers-a2z-sheet, neetcode250. Printing the URL as the link
  // label put back on screen exactly what was stripped from the sheet names,
  // so the label is fixed text and the address lives only in the href.
  const tracker = read('tracker.js');
  assert.ok(!/textContent\s*=\s*sheet\.source/.test(tracker),
    'tracker.js renders sheet.source as visible text; its path names the author');
});

test('the listing justifies exactly the permissions the manifest declares', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const listing = read('store/listing.md');

  // Chrome asks for a justification per permission, and refuses a submission
  // whose declared set does not match the package.
  const named = [
    ...(manifest.permissions || []),
    ...(manifest.optional_permissions || []),
  ];
  for (const permission of named) {
    assert.ok(new RegExp('\\*\\*' + permission + '\\*\\*').test(listing),
      `manifest declares "${permission}" but listing.md has no justification for it`);
  }

  // Hosts are justified in one field each, required and optional apart.
  const hostBlock = labelled(listing, 'Host permissions');
  for (const pattern of manifest.host_permissions || []) {
    const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
    assert.ok(hostBlock.includes(host),
      `host_permissions declares ${host}, which the listing does not justify`);
  }

  const optional = manifest.optional_host_permissions || [];
  if (optional.length) {
    const optionalBlock = labelled(listing, 'Optional host permission');
    for (const pattern of optional) {
      const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
      assert.ok(optionalBlock.includes(host),
        `optional_host_permissions declares ${host}, which the listing does not justify`);
    }
    // And the required field must not still be claiming it.
    assert.ok(!optional.some(p => hostBlock.includes(
      p.replace(/^https?:\/\//, '').replace(/\/\*$/, ''))),
      'an optional host is justified in the required host field; Chrome reads '
      + 'that as a permission the package does not ask for');
  }
});

test('the listing agrees with the packaged version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const listing = read('store/listing.md');
  assert.ok(listing.includes(manifest.version),
    `manifest is ${manifest.version} but listing.md never mentions that version; `
    + 'the two have drifted');

  // Title and summary are read-only in the dashboard because they come from
  // the package — so the listing must quote what the package actually says.
  assert.equal(fenced(listing, 'Title[^\\n]*'), manifest.name);
  assert.equal(fenced(listing, 'Summary[^\\n]*'), manifest.description);
});
