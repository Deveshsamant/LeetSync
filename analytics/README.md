# LeetSync analytics

Opt-in usage reporting. Cloudflare Worker + D1, no third-party provider.

**Deployed:** `https://leetsync-analytics.devsamant1744.workers.dev`
D1 database `leetsync-analytics` (`4d2953f7-13e6-45a9-8924-6bbd3a3d8532`).
Redeploy after changing `worker.js` with `deploy.cmd`.

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

## The dashboard

It lives in its own repository, `../leetsync-dashboard`, so it can be deployed
privately without publishing it alongside the extension. See the README there.

## Read API

Every `/api/*` route needs `Authorization: Bearer $DASHBOARD_KEY`, set with
`wrangler secret put DASHBOARD_KEY`. Without the secret the read API stays
closed rather than open.

| Route | Returns |
| --- | --- |
| `/api/summary?days=30` | Totals, daily series, verdicts, themes, languages, versions, failures, sheets, per-difficulty averages, top 50 problems |
| `/api/users?days=30` | One row per install: submissions, acceptance, pushes, distinct problems, theme, version |
| `/api/user?id=<install>&limit=300` | One install's profile, language mix, and event timeline |
| `/api/activity?days=30&limit=200` | The raw event feed, newest first |
| `/api/code?id=<event id>` | The stored solution for one event, 404 when none was shared |
| `/api/retention?days=365` | Weekly cohorts and how many of each were still active at 1, 2 and 4 weeks |
| `/api/problem?slug=<slug>` | One problem: verdicts, languages, who attempted it, attempts per day |
| `/api/check-failures` | Runs the hourly failure check now and reports what it decided |

## Migrations

`schema.sql` is the current shape, for a fresh database. `migrations/` holds
the steps to bring an existing one forward; run one with:

```bash
npx wrangler d1 execute leetsync-analytics --remote --file=migrations/001_richer_events.sql
```

## Two allowlists, on purpose

`pick()` in `../analytics.js` decides what may leave the device; `clean()` in
`worker.js` decides what may be stored. Both must be widened for a new field to
reach the database, and `schema.sql` has no column for anything identifying.
Solution code is gated a third time, behind its own consent, and is the only
user-authored content the table can hold.

## Failure alerting

An hourly cron checks the push-failure rate and posts to a webhook when it
spikes, so a bad release does not wait for someone to open the dashboard.

It is off until a webhook is configured:

```bash
npx wrangler secret put ALERT_WEBHOOK
```

The body carries the message under both `text` and `content`, so one URL works
for Slack or Discord unchanged.

It stays quiet on purpose: fewer than 5 pushes in the hour is treated as no
signal, the rate has to cross 35%, and it will not fire again for 6 hours, or
a sustained outage would alert every hour. `/api/check-failures` runs the same
check on demand so it can be verified without waiting.
