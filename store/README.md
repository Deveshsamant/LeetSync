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

Drop images into `assets/` and upload them by hand; there is no API for store
assets. Sizes and formats are in `assets/README.md`.

The marketing site's captures are a good starting point for screenshots, but
they are 840x1200 popup shots — the store wants 1280x800 landscape, so they
need composing onto a background rather than uploading directly.
