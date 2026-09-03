# LeetSync analytics dashboard

Static page. No build step, no dependencies, no server of its own — it reads
one `/api/summary` response from the Worker and draws it.

## What keeps it private

**The dashboard key, not the hosting.** The Worker rejects every read without
`Authorization: Bearer <DASHBOARD_KEY>`, so even if someone finds the URL they
see the unlock screen and nothing else.

The key is held in `localStorage` and sent only to your Worker. Vercel serves
static files and never sees it.

For a second layer, Vercel's Deployment Protection (Project → Settings →
Deployment Protection) puts SSO in front of the whole site. Useful, but the
key is what actually guards the data.

## Deploy to Vercel

The repo root is the extension, so point Vercel at this subdirectory:

1. Import the GitHub repo at vercel.com/new
2. Set **Root Directory** to `dashboard`
3. Framework preset: **Other**. Leave build and output commands empty.
4. Deploy

Or from the CLI:

```bash
cd dashboard
npx vercel --prod
```

## Rotating the key

```bash
cd ../analytics
node ../node_modules/wrangler/bin/wrangler.js secret put DASHBOARD_KEY
```

Enter the new value. Old keys stop working immediately; press **Lock** in the
dashboard and enter the new one.

## Running it locally

Any static server works, for example:

```bash
python -m http.server 8080
```

The Worker returns permissive CORS on the API, so localhost works without
extra configuration.

## Changing what it shows

Aggregation happens in SQL inside `../analytics/worker.js` (`summary()`), not
in the browser — the dashboard only ever receives totals. Add a query there,
redeploy the Worker, then draw it here.
