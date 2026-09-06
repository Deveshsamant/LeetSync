#!/usr/bin/env python3
"""
Build video-ready frames of the real extension, for Google Flow (Veo).

Flow takes an image as the first frame of a generation, or as an "ingredient"
it composes a scene around. Neither preserves the picture: from frame two on,
Veo re-synthesises everything, and small UI text is the first thing to melt.
So these frames are built for the two jobs where that does not matter --

  * a pixel-accurate FIRST FRAME for a locked-off shot, where the drift only
    starts after the cut, and
  * a PALETTE ingredient, where nothing is being read at all and the point is
    to make Veo's output share the extension's colours instead of looking like
    stock footage.

Every frame is authored at the delivery aspect ratio. The site's screenshots
are whole screens -- popup-settings-light.png is 840x4386 -- and Flow would
crop a 1:5 sliver to ruins.

The popup here is captured at its real 420x600, not full height: a video frame
wants the screen as it looks, not the screen unrolled.

Usage:
    # serve the extension folder on :8123 first, then
    python store/make-ad-frames.py

Writes store/ad/ (gitignored, like store/dist -- these are large and
regenerated, not source).
"""

import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(os.path.dirname(__file__)))
OUT = os.path.join(ROOT, 'store', 'ad')
SRC = os.path.join(OUT, '.src')
BASE = 'http://localhost:8123'
CHROME = r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'

# Straight from theme.css, so a frame cannot be graded to a palette the
# extension no longer wears.
THEMES = {
    'signal': dict(
        bg='#08090A', band='#0B0E10', card='#0E1214', bd='#1F2529',
        tx='#E9EDF0', tx3='#99A3AA', ac='#3FE08B',
        radius=22, border=2, hard_shadow=False,
    ),
    'modernist': dict(
        bg='#f3f2f2', band='#eae9e9', card='#f3f2f2', bd='#201e1d',
        tx='#201e1d', tx3='#605d5d', ac='#ec3013',
        radius=0, border=4, hard_shadow=True,
    ),
}
# The preview takes the extension's own names for these.
PREVIEW_THEME = {'signal': 'dark', 'modernist': 'light'}


def rgb(hex_):
    h = hex_.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ── Capture ──────────────────────────────────────────────────

def shot(query, name, w, h):
    path = os.path.join(SRC, name)
    profile = tempfile.mkdtemp()
    try:
        subprocess.run([
            CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
            '--no-first-run', '--no-default-browser-check', '--disable-extensions',
            '--user-data-dir=' + profile, '--force-device-scale-factor=2',
            '--virtual-time-budget=6000', '--window-size=%d,%d' % (w, h),
            '--screenshot=' + path, BASE + '/' + query,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not os.path.exists(path):
        raise SystemExit('capture failed: %s\nIs the extension served on :8123?' % name)
    return Image.open(path).convert('RGB')


# ── Ground ───────────────────────────────────────────────────

def ground(w, h, t, glow_at=(0.68, 0.32)):
    """The themed backdrop: flat colour, one soft accent glow, a faint grid.

    The glow is what gives Veo something to hold on to -- a flat field grades
    to mud, a field with one light source in it keeps its shape as the model
    re-renders.
    """
    im = Image.new('RGB', (w, h), rgb(t['bg']))

    blob = Image.new('L', (w, h), 0)
    r = int(min(w, h) * 0.62)
    cx, cy = int(w * glow_at[0]), int(h * glow_at[1])
    ImageDraw.Draw(blob).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    blob = blob.filter(ImageFilter.GaussianBlur(min(w, h) // 7))
    # Light on dark can carry more; on the light ground the same strength
    # reads as a stain.
    blob = blob.point(lambda v: int(v * (0.11 if t['radius'] else 0.07)))
    im = Image.composite(Image.new('RGB', (w, h), rgb(t['ac'])), im, blob)

    grid = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    # Near-black hairlines on a light ground carry far further than the same
    # value does on a dark one, so the light theme takes a third of the ink.
    step, line = 120, rgb(t['bd']) + (70 if t['radius'] else 24,)
    for x in range(0, w, step):
        g.line([(x, 0), (x, h)], fill=line, width=1)
    for y in range(0, h, step):
        g.line([(0, y), (w, y)], fill=line, width=1)
    im = Image.alpha_composite(im.convert('RGBA'), grid).convert('RGB')
    return im


def mask_for(size, radius):
    """A rounded-corner mask, or a plain opaque one when the theme is square."""
    m = Image.new('L', size, 255)
    if radius:
        m = Image.new('L', size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1),
                                            radius=radius, fill=255)
    return m


def place(bg, shot_im, box_h, t, centre=None):
    """Drop a screenshot on the ground, wearing the theme's own shadow.

    Modernist throws a hard offset block, Signal a soft one -- the same
    distinction the extension and the site both make, so a frame reads as this
    product rather than as a generic app mock.
    """
    w, h = bg.size
    scale = box_h / shot_im.size[1]
    sw, sh = int(shot_im.size[0] * scale), box_h
    art = shot_im.resize((sw, sh), Image.LANCZOS)

    cx, cy = centre or (w // 2, h // 2)
    b, r = t['border'], t['radius']
    x, y = cx - sw // 2, cy - sh // 2

    if t['hard_shadow']:
        off = max(10, box_h // 46)
        bg.paste(Image.new('RGB', (sw + b * 2, sh + b * 2), rgb(t['bd'])),
                 (x - b + off, y - b + off))
    else:
        pad = box_h // 8
        soft = Image.new('L', (sw + pad * 2, sh + pad * 2), 0)
        ImageDraw.Draw(soft).rounded_rectangle(
            (pad, pad, pad + sw, pad + sh), radius=r, fill=150)
        soft = soft.filter(ImageFilter.GaussianBlur(max(1, pad // 2)))
        bg.paste(Image.new('RGB', soft.size, (0, 0, 0)),
                 (x - pad, y - pad + pad // 3), soft)

    # One plate of border colour with the art inset, so the corner radius cuts
    # frame and screenshot together instead of leaving a square edge behind a
    # rounded one.
    plate = Image.new('RGB', (sw + b * 2, sh + b * 2), rgb(t['bd']))
    plate.paste(art, (b, b))
    bg.paste(plate, (x - b, y - b), mask_for(plate.size, r + b if r else 0))
    return bg


# ── Palette ingredient ───────────────────────────────────────

def palette(t):
    """No screenshot, no text: colour in the proportions the product uses it.

    Fed to Flow as an ingredient this steers the grade of a whole shot. A
    swatch strip would not -- the model needs to see a composition, with the
    accent occupying about as much of the frame as it should in the output.
    """
    w, h = 1920, 1080
    im = ground(w, h, t, glow_at=(0.22, 0.7))
    d = ImageDraw.Draw(im)

    panel = (150, 150, 1120, 930)
    d.rectangle(panel, fill=rgb(t['card']), outline=rgb(t['bd']), width=t['border'])
    # Bars standing in for lines of type, so the model reads text weight
    # without any glyphs to mangle.
    for i, width in enumerate((640, 780, 520, 700, 430)):
        y = 250 + i * 92
        d.rectangle((214, y, 214 + width, y + 26),
                    fill=rgb(t['tx'] if i == 0 else t['tx3']))

    d.rectangle((1230, 150, 1770, 560), fill=rgb(t['ac']))
    d.rectangle((1230, 620, 1770, 930), fill=rgb(t['card']),
                outline=rgb(t['bd']), width=t['border'])
    d.rectangle((1300, 700, 1450, 850), fill=rgb(t['ac']))
    return im


# ── One frame per screen ─────────────────────────────────────

# Every screen the extension has, including the two the popup's own tab bar
# cannot reach. The label is what the frame is called; the query is how the
# preview is asked for it.
SCREENS = [
    ('setup',     'screen=setup&step=2'),
    ('consent',   'screen=setup&step=4'),
    ('dashboard', 'tab=dashboard'),
    ('solved',    'tab=problems'),
    ('sheets',    'tab=sheets'),
    ('battle',    'tab=battle'),
    ('settings',  'tab=settings'),
]

# The popup sits 616px wide in a 1920 frame, which is about 1.47x its real
# size -- comfortably readable at 1080p. That fixes how much of a screen a
# frame can hold, and Settings is 2,193 CSS px tall, so a screen that does not
# fit becomes several frames rather than one unreadable one. Shrinking to fit
# is the wrong trade for video: a frame nobody can read shows no features at
# all.
ART_W = 616
ART_H = 900
MAX_SLICES = 3
OVERLAP = 60        # source px repeated between slices, so nothing falls between


def slices(shot_im):
    """Cut a whole-screen capture into frame-height pieces, top first."""
    sw, sh = shot_im.size
    step = int(ART_H / (ART_W / sw))          # source px shown by one frame
    out, top = [], 0
    while top < sh and len(out) < MAX_SLICES:
        bottom = min(sh, top + step)
        # A last sliver is padded up rather than shown short, so every frame
        # in the set has the same composition.
        if bottom - top < step and len(out):
            top = max(0, bottom - step)
        out.append(shot_im.crop((0, top, sw, min(sh, top + step))))
        if bottom >= sh:
            break
        top = bottom - OVERLAP
    return out


def screen_frames(theme_name):
    """A readable frame for every screen, in one theme."""
    t = THEMES[theme_name]
    th = PREVIEW_THEME[theme_name]
    made = []

    for label, query in SCREENS:
        shot_im = shot('preview-popup.html?capture=1&full=1&theme=%s&%s' % (th, query),
                       'screen-%s.png' % label, 420, 3000)
        shot_im = trim_tail(shot_im)
        parts = slices(shot_im)
        for i, part in enumerate(parts, 1):
            suffix = '' if len(parts) == 1 else '-%d' % i
            frame = place(ground(1920, 1080, t, glow_at=(0.74, 0.3)),
                          part, ART_H, t, centre=(1180, 540))
            made.append(('screen-%s%s-16x9-%s.png' % (label, suffix, theme_name), frame))

    tracker = shot('preview-tracker.html?capture=1&theme=%s' % th,
                   'screen-tracker.png', 1280, 900)
    top = tracker.crop((0, 0, tracker.size[0], int(tracker.size[0] * 9 / 16)))
    made.append(('screen-tracker-16x9-%s.png' % theme_name,
                 place(ground(1920, 1080, t, glow_at=(0.5, 0.2)), top, 980, t)))
    return made


def trim_tail(im):
    """Drop the empty ground below a full-height capture.

    The capture window is deliberately over-tall because Chrome cannot report
    how tall the page turned out, so every screen ends in a band of nothing.
    """
    w, h = im.size
    px = im.load()
    bg = px[1, h - 2]
    last = h - 1
    while last > 400 and all(px[x, last] == bg for x in range(0, w, 7)):
        last -= 1
    return im.crop((0, 0, w, min(h, last + 24)))


# ── Build ────────────────────────────────────────────────────

def main():
    os.makedirs(SRC, exist_ok=True)
    written = []

    for name, t in THEMES.items():
        th = PREVIEW_THEME[name]
        print('%s --- capturing' % name)
        popup = shot('preview-popup.html?capture=1&theme=%s&tab=dashboard' % th,
                     'popup-%s.png' % name, 420, 600)
        tracker = shot('preview-tracker.html?capture=1&theme=%s' % th,
                       'tracker-%s.png' % name, 1280, 900)

        # 16:9 -- the popup with room around it, so a slow push-in has
        # somewhere to go.
        f = place(ground(1920, 1080, t), popup, 880, t, centre=(1180, 540))
        written.append(('frame-popup-16x9-%s.png' % name, f))

        # 9:16 -- Shorts and Reels, where a letterboxed 16:9 gets scrolled past.
        f = place(ground(1080, 1920, t, glow_at=(0.5, 0.26)), popup, 1420, t)
        written.append(('frame-popup-9x16-%s.png' % name, f))

        # The tracker is landscape already; crop to 16:9 from the top, which
        # is where the sheets and the progress bars are.
        tw, th_ = tracker.size
        top = tracker.crop((0, 0, tw, int(tw * 9 / 16)))
        f = place(ground(1920, 1080, t, glow_at=(0.5, 0.2)), top, 980, t)
        written.append(('frame-tracker-16x9-%s.png' % name, f))

        written.append(('frame-palette-%s.png' % name, palette(t)))

    # Modernist only: the per-screen set is a light-ground storyboard, and
    # doubling it in Signal would be sixteen more files nobody asked for.
    print('modernist --- one frame per screen')
    written.extend(screen_frames('modernist'))

    os.makedirs(OUT, exist_ok=True)
    for fname, im in written:
        path = os.path.join(OUT, fname)
        im.convert('RGB').save(path, optimize=True)
        print('  %-34s %sx%s  %d KB'
              % (fname, im.size[0], im.size[1], os.path.getsize(path) // 1024))

    # The prompts travel with the pictures: uploading eight frames to Flow and
    # then hunting for what to type at them is how a kit gets half used.
    prompts = os.path.join(ROOT, 'store', 'ad-prompts.md')
    if os.path.exists(prompts):
        shutil.copy(prompts, os.path.join(OUT, 'PROMPTS.md'))
        print('  %-34s (copied)' % 'PROMPTS.md')

    shutil.rmtree(SRC, ignore_errors=True)
    print('\n%d frames in store/ad/' % len(written))


if __name__ == '__main__':
    main()
