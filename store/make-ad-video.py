#!/usr/bin/env python3
"""
Build the LeetSync video ad out of the real extension.

Every frame is either the extension's own screenshots or type set in its own
typeface. Nothing is generated, because a generated frame cannot hold a
screenshot still: image-to-video models re-synthesise from frame two, and small
UI text is the first thing they melt. The whole point of this ad is that the
screens are real, so the motion is done here instead -- a slow push on each
scene and a crossfade between them, which is all a product ad of this kind
needs.

Scenes are composed in a browser so the type is Archivo and the screenshots are
the real PNGs, captured at 2x, then the motion is computed with Pillow and the
frames handed to ffmpeg.

    python store/make-ad-video.py [path/to/leetsync-site]

Writes store/ad/leetsync-ad-16x9.mp4 and -9x16.mp4 (gitignored).
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
OUT = os.path.join(ROOT, 'store', 'ad')
WORK = os.path.join(OUT, '.video')
CHROME = r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'

FPS = 24
HOLD = 3.4          # seconds a scene is on screen at full opacity
FADE = 0.55         # seconds of crossfade into the next one
ZOOM = 0.045        # how far each scene pushes in over its life

# Modernist, the same tokens the site and the store tiles use.
INK, BG, BAND, MUTED, AC = '#201e1d', '#f3f2f2', '#eae9e9', '#605d5d', '#ec3013'


def uri(path):
    with open(path, 'rb') as fh:
        return 'data:image/png;base64,' + base64.b64encode(fh.read()).decode()


def shell(body, w, h, ground=BG, ink=INK):
    return (
        '<!doctype html><html><head><meta charset="utf-8">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?'
        'family=Archivo:wght@400;600;700;800;900&display=block" rel="stylesheet">\n'
        '<style>\n'
        '  *{margin:0;padding:0;box-sizing:border-box}\n'
        '  html,body{width:%dpx;height:%dpx;overflow:hidden}\n'
        '  body{font-family:Archivo,system-ui,sans-serif;background:%s;color:%s;\n'
        '    background-image:linear-gradient(rgba(32,30,29,.05) 1px,transparent 1px),\n'
        '                     linear-gradient(90deg,rgba(32,30,29,.05) 1px,transparent 1px);\n'
        '    background-size:%dpx %dpx}\n'
        '  .kick{font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:%s}\n'
        '  h1{font-weight:900;letter-spacing:-.025em;text-transform:uppercase;line-height:.95}\n'
        '  .lede{color:%s;line-height:1.4;text-wrap:pretty}\n'
        '  .frame{border:3px solid %s;box-shadow:20px 20px 0 %s;background:%s;overflow:hidden}\n'
        '  .frame img{display:block;width:100%%;object-position:top}\n'
        '  em{font-style:normal;color:%s}\n'
        '</style></head><body>%s</body></html>'
    ) % (w, h, ground, ink, 96, 96, AC, MUTED, INK, INK, BG, AC, body)


# ── Scene kinds ──────────────────────────────────────────────

def statement(kick, head, lede, w, h, dark=False):
    """Type only. Carries the argument; the screens prove it afterwards."""
    scale = h / 1080.0
    body = (
        '<div style="display:flex;flex-direction:column;justify-content:center;'
        'height:100%%;padding:0 %dpx">\n'
        '  <div class="kick" style="font-size:%dpx;margin-bottom:%dpx">%s</div>\n'
        '  <h1 style="font-size:%dpx;margin-bottom:%dpx;max-width:20ch">%s</h1>\n'
        '  <p class="lede" style="font-size:%dpx;max-width:34ch">%s</p>\n'
        '</div>'
    ) % (int(110 * scale), int(17 * scale), int(26 * scale), kick,
         int(92 * scale), int(30 * scale), head, int(27 * scale), lede)
    return shell(body, w, h,
                 ground='#08090A' if dark else BG,
                 ink='#E9EDF0' if dark else INK)


def with_shot(kick, head, lede, shot, w, h, crop_h=None):
    """Type beside the screen it is talking about."""
    scale = h / 1080.0
    vertical = h > w
    art = ('<div class="frame" style="width:%dpx;height:%dpx">'
           '<img src="%s" alt=""></div>') % (
        int((360 if vertical else 430) * scale),
        int((crop_h or (515 if vertical else 615)) * scale),
        uri(os.path.join(IMG, shot)))

    if vertical:
        body = (
            '<div style="display:flex;flex-direction:column;justify-content:center;'
            'align-items:flex-start;height:100%%;padding:0 %dpx;gap:%dpx">\n'
            '  <div>\n'
            '    <div class="kick" style="font-size:%dpx;margin-bottom:%dpx">%s</div>\n'
            '    <h1 style="font-size:%dpx;margin-bottom:%dpx">%s</h1>\n'
            '    <p class="lede" style="font-size:%dpx;max-width:26ch">%s</p>\n'
            '  </div>\n  %s\n</div>'
        ) % (int(90 * scale), int(46 * scale), int(15 * scale), int(18 * scale),
             kick, int(58 * scale), int(20 * scale), head, int(23 * scale),
             lede, art)
    else:
        body = (
            '<div style="display:flex;align-items:center;height:100%%;'
            'padding:0 %dpx;gap:%dpx">\n'
            '  <div style="flex:1;min-width:0">\n'
            '    <div class="kick" style="font-size:%dpx;margin-bottom:%dpx">%s</div>\n'
            '    <h1 style="font-size:%dpx;margin-bottom:%dpx">%s</h1>\n'
            '    <p class="lede" style="font-size:%dpx;max-width:30ch">%s</p>\n'
            '  </div>\n  %s\n</div>'
        ) % (int(120 * scale), int(80 * scale), int(16 * scale), int(22 * scale),
             kick, int(64 * scale), int(24 * scale), head, int(25 * scale),
             lede, art)
    return shell(body, w, h)


def closer(w, h):
    scale = h / 1080.0
    body = (
        '<div style="display:flex;flex-direction:column;align-items:center;'
        'justify-content:center;height:100%%;text-align:center;gap:%dpx">\n'
        '  <img src="%s" style="width:%dpx;height:%dpx;border:3px solid %s;'
        'box-shadow:%dpx %dpx 0 %s">\n'
        '  <h1 style="font-size:%dpx">Solve.<br>Submit.<br><em>Synced.</em></h1>\n'
        '  <div style="background:%s;color:%s;font-weight:900;'
        'letter-spacing:.05em;text-transform:uppercase;font-size:%dpx;'
        'padding:%dpx %dpx;box-shadow:%dpx %dpx 0 %s">Add to Chrome &mdash; free</div>\n'
        '  <p class="lede" style="font-size:%dpx">leetsync-site.vercel.app</p>\n'
        '</div>'
    ) % (int(34 * scale), uri(os.path.join(ROOT, 'icons', 'icon128.png')),
         int(104 * scale), int(104 * scale), INK,
         int(8 * scale), int(8 * scale), AC,
         int(76 * scale), AC, BG, int(24 * scale),
         int(20 * scale), int(38 * scale), int(7 * scale), int(7 * scale), INK,
         int(20 * scale))
    return shell(body, w, h)


# ── The ad ───────────────────────────────────────────────────

def storyboard(w, h):
    """The argument, in order: the problem, the turn, the proof, the ask."""
    return [
        statement(
            'The daily commit',
            'Keeping your GitHub green is a second job',
            'Nobody has time to solve a problem and then go and commit it.',
            w, h, dark=True),
        statement(
            'Except',
            'You already code every day',
            'It just does not show up where anybody looks.',
            w, h),
        with_shot(
            'What LeetSync does',
            'Every accepted solution, committed',
            'Solve on LeetCode. It lands in your own repository seconds later '
            '\u2014 no copying, nothing to remember.',
            'popup-dashboard-light.png', w, h),
        with_shot(
            'One streak, two platforms',
            'The graph fills itself in',
            'Your LeetCode streak and your GitHub calendar stop being two '
            'separate habits.',
            'readme-light.png', w, h, crop_h=(430 if h > w else 500)),
        with_shot(
            'Your code, kept',
            'Everything you solved, worth looking at',
            'Filed by problem, with a README each, an index that maintains '
            'itself, and every attempt you made.',
            'popup-problems-light.png', w, h),
        with_shot(
            '895 problems',
            'Seven study sheets, ticking themselves',
            'Solve once and it ticks in every sheet that problem appears in. '
            'Nothing to keep in sync by hand.',
            'popup-sheets-light.png', w, h),
        closer(w, h),
    ]


# ── Capture, motion, encode ──────────────────────────────────

def capture(html, path, w, h):
    """Compose in a browser at 2x: real Archivo, real screenshots."""
    page = os.path.join(WORK, 'scene.html')
    with open(page, 'w', encoding='utf-8') as fh:
        fh.write(html)
    profile = tempfile.mkdtemp()
    try:
        subprocess.run([
            CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
            '--no-first-run', '--no-default-browser-check', '--disable-extensions',
            '--user-data-dir=' + profile, '--force-device-scale-factor=2',
            '--virtual-time-budget=9000', '--window-size=%d,%d' % (w, h),
            '--screenshot=' + path, 'file:///' + page.replace('\\', '/'),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not os.path.exists(path):
        raise SystemExit('scene capture failed: ' + path)


def push(scene, w, h, t):
    """One frame of a slow zoom, t running 0 -> 1 across the scene."""
    sw, sh = scene.size
    keep = 1.0 - ZOOM * t
    cw, ch = int(sw * keep), int(sh * keep)
    x, y = (sw - cw) // 2, (sh - ch) // 2
    return scene.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)


def render(scenes, w, h, out_name):
    hold_n, fade_n = int(HOLD * FPS), int(FADE * FPS)
    frames = os.path.join(WORK, 'f')
    shutil.rmtree(frames, ignore_errors=True)
    os.makedirs(frames)

    n = 0
    for i, scene in enumerate(scenes):
        last = i == len(scenes) - 1
        for f in range(hold_n):
            push(scene, w, h, f / float(hold_n + fade_n)).save(
                os.path.join(frames, '%05d.png' % n), compress_level=1)
            n += 1
        if last:
            break
        # Crossfade into the next scene, both still pushing in.
        nxt = scenes[i + 1]
        for f in range(fade_n):
            a = push(scene, w, h, (hold_n + f) / float(hold_n + fade_n))
            b = push(nxt, w, h, f / float(hold_n + fade_n) * 0.35)
            Image.blend(a, b, (f + 1) / float(fade_n + 1)).save(
                os.path.join(frames, '%05d.png' % n), compress_level=1)
            n += 1

    out = os.path.join(OUT, out_name)
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-framerate', str(FPS), '-i', os.path.join(frames, '%05d.png'),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ], check=True)
    shutil.rmtree(frames, ignore_errors=True)
    return out, n


def main():
    if not os.path.isdir(IMG):
        sys.exit('No screenshots at %s' % IMG)
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    for label, (w, h) in (('16x9', (1920, 1080)), ('9x16', (1080, 1920))):
        print('%s -- composing scenes' % label)
        scenes = []
        for i, html in enumerate(storyboard(w, h)):
            path = os.path.join(WORK, '%s-%02d.png' % (label, i))
            capture(html, path, w, h)
            scenes.append(Image.open(path).convert('RGB'))
        print('%s -- rendering' % label)
        out, n = render(scenes, w, h, 'leetsync-ad-%s.mp4' % label)
        print('  %-28s %d frames  %.1fs  %d KB'
              % (os.path.basename(out), n, n / float(FPS),
                 os.path.getsize(out) // 1024))

    shutil.rmtree(WORK, ignore_errors=True)
    print('\nDone. Silent by design -- social autoplays muted.')


if __name__ == '__main__':
    main()
