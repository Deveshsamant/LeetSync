"""
Builds sheets.json from the PDFs in sheets/.

    python scripts/parse-sheets.py

Each PDF has the same shape: a header block with declared totals, then
sections ("<name>" followed by "<n> problems"), then four-line rows of
index / title / level / link.

Two things are recovered per row:
  * the real URL, taken from the PDF's embedded hyperlink on the title, so
    rows without a LeetCode problem still link somewhere useful;
  * the LeetCode frontend id, joined from LeetCode's public catalogue, which
    is what the popup ticks against.

Every sheet's parsed count is checked against the total the PDF declares, so
a parsing slip fails loudly instead of silently dropping problems.
"""

import glob
import json
import os
import re
import sys
import urllib.request

import pymupdf

SHEET_DIR = os.path.join('docs', 'sheets')
OUT = 'sheets.json'
LEVELS = {'Easy', 'Medium', 'Hard', '-'}
SKIP = {'#', 'PROBLEM', 'LEVEL', 'LEETCODE LINK'}


def leetcode_catalogue():
    """slug -> {id, paid} for every LeetCode problem."""
    req = urllib.request.Request(
        'https://leetcode.com/api/problems/all/',
        headers={'User-Agent': 'Mozilla/5.0 (LeetSync build)'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    out = {}
    for pair in data['stat_status_pairs']:
        out[pair['stat']['question__title_slug']] = {
            'id': pair['stat']['frontend_question_id'],
            'paid': bool(pair['paid_only']),
        }
    return out


def link_map(doc):
    """Anchor text -> URI, using the hyperlinks embedded in the PDF."""
    out = {}
    for page in doc:
        words = page.get_text('words')
        for link in page.get_links():
            uri = link.get('uri')
            if not uri:
                continue
            rect = pymupdf.Rect(link['from'])
            text = ' '.join(
                w[4] for w in words if pymupdf.Rect(w[:4]).intersects(rect)
            ).strip()
            # The title anchor is the useful one; the link-column anchor is a
            # bare domain and would overwrite it, so keep the first seen.
            if text and text not in out:
                out[text] = uri
    return out


def parse(path, catalogue):
    doc = pymupdf.open(path)
    text = '\n'.join(p.get_text() for p in doc)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    links = link_map(doc)

    title = lines[0]
    declared = re.search(r'(\d+)\s*\nTOTAL PROBLEMS', text)
    declared = int(declared.group(1)) if declared else None
    subtitle_m = re.search(r'TOTAL PROBLEMS', text)
    source = re.search(r'Source:\s*(\S+)', text)

    # Skip the header block, whose "<n>" / "TOTAL PROBLEMS" pairs would
    # otherwise look like rows.
    start = 0
    for k in range(len(lines) - 1):
        if re.fullmatch(r'\d+ problems?', lines[k + 1]):
            start = k
            break

    groups, current, i = [], None, start
    while i < len(lines):
        line = lines[i]

        if line in SKIP or re.fullmatch(r'Page \d+', line):
            i += 1
            continue

        # Section header: a name followed by "<n> problems"
        if i + 1 < len(lines) and re.fullmatch(r'\d+ problems?', lines[i + 1]):
            current = {'name': line, 'questions': []}
            groups.append(current)
            i += 2
            continue

        # Row: index, then a title that may wrap over several lines, then the
        # level, then a link that may also wrap.
        if re.fullmatch(r'\d+', line):
            # The first line after the index is always part of the title, even
            # when it reads like a level — A2Z has a problem titled "Hard".
            if i + 1 >= len(lines) or lines[i + 1] in SKIP:
                i += 1
                continue
            parts = [lines[i + 1]]
            j = i + 2
            while j < len(lines) and lines[j] not in LEVELS and len(parts) < 5:
                if lines[j] in SKIP or re.fullmatch(r'Page \d+', lines[j]):
                    break
                parts.append(lines[j])
                j += 1

            if not parts or j >= len(lines) or lines[j] not in LEVELS:
                i += 1
                continue

            name = ' '.join(parts)
            level = lines[j]
            j += 1

            # Link column: one line, plus any URL-shaped continuation lines.
            link_parts = []
            if j < len(lines):
                link_parts.append(lines[j])
                j += 1
                # A continuation is a bare URL fragment. It must contain a
                # letter, or the next row's index digits get swallowed.
                while j < len(lines) and re.fullmatch(r'(?=.*[a-z])[a-z0-9\-/._]+', lines[j]):
                    link_parts.append(lines[j])
                    j += 1
            link_text = ''.join(link_parts)

            uri = links.get(name, '')
            slug = None
            m = re.search(r'leetcode\.com/problems/([a-z0-9\-]+)', uri or link_text)
            if m:
                slug = m.group(1)

            # A wrapped URL in the PDF can leave the slug cut short. Repair it
            # when exactly one catalogue entry extends it.
            if slug and slug not in catalogue:
                hits = [c for c in catalogue if c.startswith(slug)]
                if len(hits) == 1:
                    slug = hits[0]

            meta = catalogue.get(slug) if slug else None
            q = {
                'id': int(meta['id']) if meta else None,
                'title': name,
                'difficulty': level if level != '-' else 'Unknown',
            }
            if meta:
                q['slug'] = slug                    # on LeetCode, so trackable
                if meta['paid']:
                    q['paid'] = True
            elif slug:
                # A LeetCode link the catalogue does not know (renamed or
                # retired). Still worth opening, but not trackable.
                q['url'] = f'https://leetcode.com/problems/{slug}/'
            elif uri:
                q['url'] = uri          # takeUforward / GeeksforGeeks fallback

            if current is None:
                current = {'name': 'Problems', 'questions': []}
                groups.append(current)
            current['questions'].append(q)
            i = j
            continue

        i += 1

    groups = [g for g in groups if g['questions']]
    count = sum(len(g['questions']) for g in groups)
    linked = sum(1 for g in groups for q in g['questions'] if q.get('id'))

    return {
        'id': os.path.splitext(os.path.basename(path))[0],
        'name': title,
        'source': source.group(1).rstrip('�').rstrip() if source else '',
        'count': count,
        'trackable': linked,
        'groups': groups,
    }, declared


def main():
    catalogue = leetcode_catalogue()
    print(f'LeetCode catalogue: {len(catalogue)} problems\n')

    sheets, failed = [], False
    for path in sorted(glob.glob(os.path.join(SHEET_DIR, '*.pdf'))):
        sheet, declared = parse(path, catalogue)
        ok = declared is None or sheet['count'] == declared
        if not ok:
            failed = True
        print('  %-26s %4d parsed / %-4s declared  %4d trackable  %2d groups %s'
              % (os.path.basename(path), sheet['count'],
                 declared if declared is not None else '?',
                 sheet['trackable'], len(sheet['groups']),
                 '' if ok else '  <-- MISMATCH'))
        sheets.append(sheet)

    if failed:
        print('\nParsed counts do not match the PDFs. Refusing to write sheets.json.')
        sys.exit(1)

    sheets.sort(key=lambda s: -s['count'])
    payload = {'generatedAt': __import__('datetime').date.today().isoformat(),
               'sheets': sheets}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    total = sum(s['count'] for s in sheets)
    track = sum(s['trackable'] for s in sheets)
    size = os.path.getsize(OUT) / 1024
    print(f'\nWrote {OUT} — {len(sheets)} sheets, {total} problems '
          f'({track} auto-trackable), {size:.1f} KB')


main()
