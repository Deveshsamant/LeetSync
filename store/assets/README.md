# Store assets

Uploaded by hand in the dashboard — there is no API for these.

| Asset | Size | Format | Notes |
| --- | --- | --- | --- |
| Screenshot | 1280x800 or 640x400 | JPEG or 24-bit PNG, **no alpha** | Up to 5, at least 1. You currently have 3 — fill all 5. |
| Small promo tile | 440x280 | JPEG or 24-bit PNG, no alpha | Shown in search results and category pages. |
| Marquee promo tile | 1400x560 | JPEG or 24-bit PNG, no alpha | Only used if the store features you, but required to be eligible. |

**No alpha channel.** A PNG saved with transparency is rejected, and the error
message does not say why. Flatten onto a solid background before exporting.

## What to show

The five screenshot slots are the most valuable space on the listing. One idea
each, largest text you can manage — they are shown small and most people never
click to enlarge:

1. The dashboard — sync status, streak, activity
2. A generated GitHub repo — the README with its stat panels
3. The study-sheet tracker with progress
4. Solved list with the difficulty filters
5. Battle mode, or Settings showing the privacy switches

`../../../leetsync-site/img/` holds current captures of the popup (840x1200)
and tracker (2560x1800) in both themes. They are the real UI, so they are the
right source — but compose them onto a 1280x800 canvas rather than uploading
as-is.
