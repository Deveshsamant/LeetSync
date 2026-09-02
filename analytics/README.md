# LeetSync analytics

Opt-in usage reporting. Cloudflare Worker + D1, no third-party provider.

## Deploy

```bash
cd analytics
npx wrangler d1 create leetsync-analytics      # copy the database_id it prints
# paste it into wrangler.toml
npx wrangler d1 execute leetsync-analytics --remote --file=schema.sql
npx wrangler deploy                            # prints your worker URL
```

## Point the extension at it

1. Set `ENDPOINT` at the top of `../analytics.js` to the URL wrangler printed.
   **While it is empty, analytics is completely inert** — that is the default,
   so a build can never report by accident.
2. Narrow `host_permissions` in `manifest.json` from `https://*.workers.dev/*`
   to your exact subdomain. A narrower permission is easier to justify in
   review.
3. Reload the extension. Reporting still does nothing until a user switches it
   on in Settings.

## Reading the data

```bash
npx wrangler d1 execute leetsync-analytics --remote \
  --command "SELECT event, COUNT(*) FROM events GROUP BY event"
```

`queries.sql` has ready-made ones: daily actives, feature usage, most-pushed
problems, difficulty and language mix, failure reasons, version adoption.

## What is guaranteed

The Worker only writes columns that exist in `schema.sql`, and there is no
column for an IP address, GitHub username, repository or token — so none can
be stored even if a future client sends them. `test/analytics.test.js` asserts
both the client field allowlist and the Worker's, and fails if `ENDPOINT` is
committed non-empty.

## Free tier

100,000 requests/day and 5 GB of D1 storage. Events are batched up to 50 per
request and flushed every 30 minutes, so a few thousand users sit far inside it.
