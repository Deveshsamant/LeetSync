# -*- coding: utf-8 -*-
"""
The YouTube thumbnail.

A frame lifted from the film does not work here. In a feed the thumbnail is
about 210px wide, so the film's headline and its supporting paragraph both
fall below the point where anyone can read them, and the composition -- built
for 1920px -- leaves a third of the frame empty.

So this is drawn for the size it is actually seen at: four words, set as large
as the frame allows, with the claim in the accent so the eye lands on it. The
screenshot stays, because the proof is the point, but it is cropped to the part
that reads at thumbnail size -- the sync banner and the counters -- rather than
shrunk whole into illegibility.

Light ground is deliberate. Most of YouTube is viewed in dark mode, so an
off-white card is the one that separates from everything around it.

Writes store/ad/youtube-thumbnail.jpg at 1280x720 (gitignored, like the film).
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader

_video = SourceFileLoader(
    'make_ad_video',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make-ad-video.py'),
).load_module()

capture, uri, IMG, OUT, WORK = (
    _video.capture, _video.uri, _video.IMG, _video.OUT, _video.WORK)
INK, BG, AC, MUTED = _video.INK, _video.BG, _video.AC, _video.MUTED

W, H = 1280, 720


def markup():
    shot = uri(os.path.join(IMG, 'popup-dashboard-light.png'))
    return (
        '<!doctype html><html><head><meta charset="utf-8">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?'
        'family=Archivo:wght@600;800;900&display=block" rel="stylesheet">\n'
        '<style>\n'
        '  *{margin:0;padding:0;box-sizing:border-box}\n'
        '  html,body{width:%(w)dpx;height:%(h)dpx;overflow:hidden}\n'
        '  body{font-family:Archivo,system-ui,sans-serif;background:%(bg)s;color:%(ink)s;\n'
        '    background-image:linear-gradient(rgba(32,30,29,.055) 1px,transparent 1px),\n'
        '                     linear-gradient(90deg,rgba(32,30,29,.055) 1px,transparent 1px);\n'
        '    background-size:80px 80px;display:flex;align-items:center;gap:44px;\n'
        '    padding:0 54px}\n'
        # A vermilion edge down the left: the frame reads as LeetSync's even
        # at the size where the wordmark itself would not.
        '  .edge{position:absolute;left:0;top:0;bottom:0;width:16px;background:%(ac)s}\n'
        '  .type{flex:1;min-width:0}\n'
        '  h1{font-weight:900;text-transform:uppercase;letter-spacing:-.035em;\n'
        '     line-height:.86;font-size:112px}\n'
        # 13 characters is the longest line, and at the headline's own size it
        # runs under the screenshot. It gets its own size rather than forcing
        # the two short lines down to fit it.
        '  h1 em{font-style:normal;color:%(ac)s;display:block;font-size:84px;\n'
        '         letter-spacing:-.03em;white-space:nowrap}\n'
        '  .arrow{color:%(ac)s}\n'
        '  .foot{margin-top:26px;font-weight:800;text-transform:uppercase;\n'
        '        letter-spacing:.13em;font-size:21px;color:%(muted)s}\n'
        # The screenshot is cropped, not scaled: the top of the popup carries
        # the sync banner and the counters, which are the only parts still
        # legible once this is 210px wide.
        '  .frame{width:338px;height:452px;flex:none;border:4px solid %(ink)s;\n'
        '         box-shadow:16px 16px 0 %(ink)s;background:%(bg)s;overflow:hidden}\n'
        '  .frame img{display:block;width:100%%;object-fit:cover;object-position:top}\n'
        '</style></head><body>\n'
        '  <div class="edge"></div>\n'
        '  <div class="type">\n'
        '    <h1>LeetCode <span class="arrow">&rarr;</span> GitHub<em>Automatically</em></h1>\n'
        '    <div class="foot">Free Chrome extension</div>\n'
        '  </div>\n'
        '  <div class="frame"><img src="%(shot)s" alt=""></div>\n'
        '</body></html>'
    ) % {'w': W, 'h': H, 'bg': BG, 'ink': INK, 'ac': AC, 'muted': MUTED, 'shot': shot}


def main():
    os.makedirs(WORK, exist_ok=True)
    png = os.path.join(WORK, 'thumb.png')
    capture(markup(), png, W, H)

    # Chrome renders at 2x for crisp type; YouTube wants exactly 1280x720.
    jpg = os.path.join(OUT, 'youtube-thumbnail.jpg')
    subprocess.check_call([
        'ffmpeg', '-y', '-loglevel', 'error', '-i', png,
        '-vf', 'scale=%d:%d:flags=lanczos' % (W, H),
        '-q:v', '2', jpg,
    ])
    print('%s  %d KB' % (os.path.basename(jpg), os.path.getsize(jpg) // 1024))


if __name__ == '__main__':
    main()
