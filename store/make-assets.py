#!/usr/bin/env python3
"""
Build the Chrome Web Store graphics from the real extension screenshots.

The store is strict about these: exact canvas sizes, and 24-bit PNG with no
alpha channel. Chrome's headless capture always writes RGBA, so every image is
composed in the browser, captured at 2x, then downsampled and flattened to RGB
here -- which also gives supersampled text rather than the browser's own
antialiasing at final size.

Sources are the captures in the marketing site's img/ folder, which are the
real popup and tracker rather than mockups. Regenerate those first if the UI
has changed:

    cd ../leetsync-site && bash scripts/capture-screens.sh

Usage:
    python store/make-assets.py [path/to/leetsync-site]
"""

import base64
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(os.path.dirname(__file__)))
SITE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1
                       else os.path.join(ROOT, '..', 'leetsync-site'))
IMG = os.path.join(SITE, 'img')

CHROME = r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'

# Modernist, copied from the site's THEMES table so the tiles and the landing
# page cannot drift apart.
INK, BG, BAND, MUTED, AC = '#201e1d', '#f3f2f2', '#eae9e9', '#605d5d', '#ec3013'


def uri(path):
    with open(path, 'rb') as fh:
        return 'data:image/png;base64,' + base64.b64encode(fh.read()).decode()


def shell(body, w, h):
    """Wrap composed markup in a fixed canvas."""
    return (
        '<!doctype html><html><head><meta charset="utf-8">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?'
        'family=Archivo:wght@400;600;700;800;900&display=block" rel="stylesheet">\n'
        '<style>\n'
        '  *{margin:0;padding:0;box-sizing:border-box}\n'
        '  html,body{width:%dpx;height:%dpx;overflow:hidden}\n'
        '  body{\n'
        '    font-family:Archivo,system-ui,-apple-system,sans-serif;\n'
        '    background:%s;color:%s;\n'
        '    background-image:linear-gradient(rgba(32,30,29,.05) 1px,transparent 1px),\n'
        '                     linear-gradient(90deg,rgba(32,30,29,.05) 1px,transparent 1px);\n'
        '    background-size:64px 64px;\n'
        '  }\n'
        '  .kick{font-size:13px;font-weight:700;letter-spacing:.18em;'
        'text-transform:uppercase;color:%s}\n'
        '  h1{font-weight:900;letter-spacing:-.02em;text-transform:uppercase;line-height:.98}\n'
        '  .lede{color:%s;line-height:1.45;text-wrap:pretty}\n'
        '  .ticks{list-style:none;display:flex;flex-direction:column;gap:10px}\n'
        '  .ticks li{display:grid;grid-template-columns:auto 1fr;gap:11px;'
        'align-items:start;font-size:17px;font-weight:600}\n'
        '  .ticks i{display:block;width:11px;height:11px;background:%s;margin-top:6px}\n'
        '  .frame{border:2px solid %s;box-shadow:14px 14px 0 %s;background:%s;'
        'overflow:hidden;flex:none}\n'
        '  .frame img{display:block;width:100%%;height:100%%;object-fit:cover;'
        'object-position:top}\n'
        '  .bar{height:8px;background:%s}\n'
        '</style></head><body>%s</body></html>'
    ) % (w, h, BG, INK, AC, MUTED, AC, INK, INK, BG, AC, body)


def portrait(kick, head, lede, ticks, shot, dark=False):
    """Text left, popup right. The popup is 420x600, shown at 0.885."""
    items = ''.join('<li><i></i><span>%s</span></li>' % t for t in ticks)
    ground = 'background:#08090A' if dark else ''
    body = (
        '<div style="display:flex;align-items:center;height:100%%;padding:0 74px;gap:64px">\n'
        '  <div style="flex:1;min-width:0">\n'
        '    <div class="kick" style="margin-bottom:20px">%s</div>\n'
        '    <h1 style="font-size:56px;margin-bottom:22px">%s</h1>\n'
        '    <p class="lede" style="font-size:19.5px;margin-bottom:32px;max-width:33ch">%s</p>\n'
        '    <ul class="ticks">%s</ul>\n'
        '  </div>\n'
        '  <div class="frame" style="width:372px;height:531px;%s">\n'
        '    <img src="%s" alt="">\n'
        '  </div>\n'
        '</div>'
    ) % (kick, head, lede, items, ground, uri(os.path.join(IMG, shot)))
    return shell(body, 1280, 800)


def landscape(kick, head, lede, shot):
    """Headline across the top, the wide capture cropped beneath it."""
    body = (
        '<div style="display:flex;flex-direction:column;height:100%%;padding:56px 74px 0">\n'
        '  <div class="kick" style="margin-bottom:16px">%s</div>\n'
        '  <h1 style="font-size:50px;margin-bottom:16px">%s</h1>\n'
        '  <p class="lede" style="font-size:19px;max-width:78ch;margin-bottom:34px">%s</p>\n'
        '  <div class="frame" style="flex:1;width:100%%;box-shadow:14px -14px 0 %s">\n'
        '    <img src="%s" alt="">\n'
        '  </div>\n'
        '</div>'
    ) % (kick, head, lede, INK, uri(os.path.join(IMG, shot)))
    return shell(body, 1280, 800)


def build():
    assets = []

    assets.append(('screenshots/01-pushes.png', 1280, 800, portrait(
        'Chrome extension',
        'Solve.<br>Submit.<br><span style="color:%s">Synced.</span>' % AC,
        'Every accepted LeetCode solution is pushed to your own GitHub repository '
        '&mdash; the code, a README per problem, and an index that keeps itself '
        'up to date.',
        ['No copy-pasting, ever',
         'Your token, your repo, your commits',
         'Free and open source'],
        'popup-dashboard-light.png')))

    assets.append(('screenshots/02-verdicts.png', 1280, 800, portrait(
        'Every verdict',
        'Knows what you struggled with',
        'Wrong answers are recorded too. Filter by what took you several tries, '
        'or what you have not revisited in a month.',
        ['Runtime and memory on every solve',
         'Write notes on any problem',
         'Two themes &mdash; Signal and Modernist'],
        'popup-problems-dark.png', dark=True)))

    assets.append(('screenshots/03-sheets.png', 1280, 800, portrait(
        '895 problems',
        'Seven study sheets, built in',
        "Striver's A2Z, Love Babbar 450, NeetCode 250 and 150, the SDE Sheet, "
        "Striver's 79 and Blind 75. Solve once and it ticks everywhere it appears.",
        ['1,667 rows, 895 unique problems',
         'No download, no account',
         'Tick non-LeetCode rows by hand'],
        'popup-sheets-light.png')))

    assets.append(('screenshots/04-tracker.png', 1280, 800, landscape(
        'Full-page tracker',
        'All 895 problems, one page',
        'Search and filter across every sheet at once, with your progress on each '
        'kept in step with what you have actually pushed.',
        'tracker-light.png')))

    assets.append(('screenshots/05-readme.png', 1280, 800, landscape(
        'Your repository',
        'A repo worth linking to',
        'A README per problem with the description, topics and your notes &mdash; and '
        'a root index with difficulty badges, language mix and a rolling-year '
        'solve calendar.',
        'readme-light.png')))

    logo = uri(os.path.join(ROOT, 'icons', 'icon128.png'))

    small = (
        '<div style="display:flex;flex-direction:column;justify-content:center;'
        'height:100%%;padding:0 34px">\n'
        '  <img src="%s" width="52" height="52" style="display:block;margin-bottom:20px" alt="">\n'
        '  <div style="font-size:37px;font-weight:900;letter-spacing:-.01em;'
        'text-transform:uppercase;line-height:1">LeetSync</div>\n'
        '  <div class="bar" style="width:62px;margin:15px 0 14px"></div>\n'
        '  <div style="font-size:16px;font-weight:600;color:%s;line-height:1.35">\n'
        '    LeetCode&nbsp;&rarr;&nbsp;GitHub,<br>automatically\n'
        '  </div>\n'
        '</div>'
    ) % (logo, MUTED)
    assets.append(('promo/small-tile-440x280.png', 440, 280, shell(small, 440, 280)))

    marquee = (
        '<div style="display:flex;align-items:center;height:100%%;padding:0 80px;gap:70px">\n'
        '  <div style="flex:1;min-width:0">\n'
        '    <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px">\n'
        '      <img src="%s" width="46" height="46" style="display:block" alt="">\n'
        '      <span style="font-size:31px;font-weight:900;letter-spacing:-.01em;'
        'text-transform:uppercase">LeetSync</span>\n'
        '    </div>\n'
        '    <h1 style="font-size:60px;margin-bottom:20px">Your solutions,<br>on GitHub,'
        '<br><span style="color:%s">automatically</span></h1>\n'
        '    <p class="lede" style="font-size:20px;max-width:46ch">\n'
        '      Every accepted LeetCode submission pushed to your own repository, with a\n'
        '      README per problem and seven study sheets built in.\n'
        '    </p>\n'
        '  </div>\n'
        '  <div class="frame" style="width:330px;height:471px">\n'
        '    <img src="%s" alt="">\n'
        '  </div>\n'
        '</div>'
    ) % (logo, AC, uri(os.path.join(IMG, 'popup-dashboard-light.png')))
    assets.append(('promo/marquee-tile-1400x560.png', 1400, 560, shell(marquee, 1400, 560)))

    return assets


def main():
    if not os.path.isdir(IMG):
        sys.exit('No screenshots at %s\nPass the site folder as the first argument.' % IMG)

    base = os.path.join(ROOT, 'store', 'assets')
    for sub in ('screenshots', 'promo'):
        os.makedirs(os.path.join(base, sub), exist_ok=True)

    work = tempfile.mkdtemp(prefix='leetsync-store-')
    profile = os.path.join(work, 'profile')
    ok = True
    try:
        for name, w, h, html in build():
            stem = os.path.basename(name)
            page = os.path.join(work, stem + '.html')
            with open(page, 'w', encoding='utf-8') as fh:
                fh.write(html)
            raw = os.path.join(work, stem)

            subprocess.run([
                CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--no-first-run', '--no-default-browser-check', '--disable-extensions',
                '--user-data-dir=' + profile,
                '--force-device-scale-factor=2',
                '--virtual-time-budget=9000',
                '--window-size=%d,%d' % (w, h),
                '--screenshot=' + raw,
                'file:///' + page.replace('\\', '/'),
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

            if not os.path.exists(raw):
                print('  %-44s FAILED -- Chrome wrote nothing' % name)
                ok = False
                continue

            # Downsample from 2x, then drop the alpha the store rejects.
            out = os.path.join(base, name)
            with Image.open(raw) as im:
                im = im.convert('RGBA')
                flat = Image.new('RGB', im.size, BG)
                flat.paste(im, mask=im.split()[3])
                if flat.size != (w, h):
                    flat = flat.resize((w, h), Image.LANCZOS)
                flat.save(out, 'PNG', optimize=True)

            with Image.open(out) as chk:
                kb = os.path.getsize(out) // 1024
                print('  %-44s %dx%d %s %d KB' % (name, chk.width, chk.height, chk.mode, kb))
                if chk.mode != 'RGB' or (chk.width, chk.height) != (w, h):
                    ok = False
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if not ok:
        sys.exit('Some assets are wrong -- see above.')
    print('\nAll assets are 24-bit RGB PNG at the required canvas sizes.')


if __name__ == '__main__':
    main()
