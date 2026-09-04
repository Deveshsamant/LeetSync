# Chrome Web Store

Everything needed to update the listing, in one place.

```
store/
  listing.md            copy to paste into each dashboard field
  assets/
    screenshots/        1280x800 — up to 5, at least 1 required
    promo/              small 440x280, marquee 1400x560
  dist/                 the upload zip (gitignored)
```

Listing: https://chromewebstore.google.com/detail/neghhaodkpiafoalaeldhbnboncnalec
Dashboard item ID: `neghhaodkpiafoalaeldhbnboncnalec`

## Build the upload zip

From the repo root:

```powershell
.\package.ps1
```

It writes `store/dist/leetsync-<version>.zip` from an explicit include list —
so a stray dev file cannot leak into a release — and refuses to build if
`background.js` imports something the list does not carry.

Bump `version` in `manifest.json` first. The store rejects a re-upload of a
version that already exists.

## Before you upload

- `manifest.json` version bumped
- `remote-config.json` has a `changelog` entry for the new version, which is
  what the What's New modal shows after the update
- `node --test test/*.test.js` passes
- Listing fields still match the package — see `listing.md`

## Assets

There is no API for store assets, so they are built here and uploaded by hand.

```bash
python store/make-assets.py
```

That writes all seven — five 1280x800 screenshots, the 440x280 small tile and
the 1400x560 marquee — from the marketing site's captures, which are the real
popup and tracker rather than mockups. Retake those first if the UI has
changed:

```bash
cd ../leetsync-site && bash scripts/capture-screens.sh
```

Two details the store is strict about, both handled by the script: the canvas
sizes are exact, and the PNGs must be 24-bit with **no alpha**. Chrome always
captures RGBA, so each image is composed in the browser at 2x, then
downsampled and flattened to RGB with Pillow — which also gives supersampled
text rather than the browser's antialiasing at final size. The script prints
the mode and dimensions of everything it writes and exits non-zero if any of
them come out wrong.

The compositions use the Modernist palette copied from the site's `THEMES`
table, so the tiles and the landing page cannot drift apart.
