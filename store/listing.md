# Chrome Web Store listing — copy to paste

Everything below is written to be pasted straight into the dashboard fields.
Keep this file in step with `manifest.json`; a listing that disagrees with the
package is the most common cause of a rejection.

## Current package

**2.2.1** — `store/dist/leetsync-2.2.1.zip`. A hotfix over 2.2.0, which went
live on 11 September and could not complete setup: the username is claimed at
step 2, the Worker's permission was asked for at step 4, and the claim was
refused in between. Nothing on the Listing or Privacy tabs changes from 2.2.0
— upload the package, leave the fields.

The 2.2.0 permission changes alter three fields on the Privacy tab, all marked
below. `remote-config.json` still
says `latestVersion: 2.1.0` on purpose: it drives the update prompt for existing
users, so move it only once this build is approved.

## Rejected once — do not undo this

Version 2.0.0 was rejected on 6 September 2026 for **keyword spam** (reference
*Yellow Argon*) and never reached a user. The fix ships as **2.0.1**: the
rejection was a listing field rather than a package fault, but a fresh version
makes a clean draft instead of resubmitting the one carrying the rejection.

The cited text was the study sheets, listed as seven bullets of brand name plus
problem count:

> Striver's A2Z DSA Sheet (474) • Love Babbar 450 DSA Sheet (448) • NeetCode
> 250 (250) • …

The feature is real, but that formatting is indistinguishable from a keyword
block: seven proper nouns and seven numbers, no sentence around them. It now
reads as prose that names three of the sheets in passing.

**Do not put the sheets back as a list, and do not add per-sheet counts.** The
same clause covers formatting, so the heavy rule characters that used to sit
around each heading are gone too.

---

## Title (from package — edit `manifest.json` `name`)

```
LeetSync - Auto Push LeetCode to GitHub
```

39 / 75 chars. The searchable words are already in it: *LeetCode*, *GitHub*,
*auto push*. Leave them in — the store matches queries against the title far
more strongly than the description.

## Summary (from package — `manifest.json` `description`, max 132)

```
Auto-push accepted LeetCode solutions to GitHub with study sheets, achievements and battle mode
```

95 / 132.

---

## Description

The first two lines are what shows in search results before "Read more".
Everything that matters is in them.

```
LeetSync automatically pushes every accepted LeetCode solution to your own GitHub repository — the code, a README per problem, and an index that keeps itself up to date. Solve, submit, and it is committed. No copy-pasting, ever.

─── WHAT IT DOES ───

• Detects accepted submissions on leetcode.com and pushes them in seconds
• Files each solution by problem number, with the right language extension
• Re-submitting adds sol2, sol3… instead of overwriting your first attempt
• Writes a README per problem: description, topics, your notes, your attempts
• Keeps a root index with difficulty badges, language mix and a solve calendar
• Queues and retries pushes that fail, so a dropped connection loses nothing

─── TWO COMPUTERS, ONE ACCOUNT ───

Sign in on a second machine with the same token and repo and it catches up by
itself — same solved problems, same streak, same achievements, same sheet
ticks. Solving on either keeps a single streak. Sign out publishes your
progress first, so signing back in restores it.

─── STUDY SHEETS ───

Seven of the DSA sheets people actually work through are built in, covering 895
unique problems between them. Solving a problem ticks it off in every sheet it
appears in, so one solve can advance four at once. Anything that is not a
LeetCode problem you can tick by hand, and a full-page tracker gives you search
and filters across all of them.

─── KEEPS YOU GOING ───

• Daily streak counter and a 90-day activity calendar
• Achievements that unlock as you go
• Battle mode — add a friend by GitHub username and compare progress
• A public leaderboard — all-time, this week and today, scored Hard 10 /
  Medium 5 / Easy 3, which you join by switching usage reporting on
• Every verdict recorded, so you can find the problems that took you 4 tries

─── TALK TO THE DEVELOPER ───

Settings has a box for feedback, an issue or a suggestion. It goes straight to
the developer, and a reply comes back in the extension itself, quoted next to
what you wrote — not into an inbox you have to go and check.

─── YOUR TOKEN, YOUR REPO ───

A classic personal access token with the repo scope lets setup finish in one
click, because GitHub allows that kind to create the repository for you. If your
solutions repo already exists, a fine-grained token limited to that one
repository works too and is the safer choice — setup reads which kind you pasted
and only asks the questions that kind can answer.

The token is held in Chrome storage and sent only to api.github.com. It is never
transmitted anywhere else, and you can revoke it on GitHub at any time.

Installing asks for two websites and nothing else: leetcode.com, to read your
accepted solution, and api.github.com, to commit it. Notifications and the
reporting server are requested later, only if you turn those on.

─── PRIVACY ───

Usage reporting is optional. It is on unless you turn it off, you are shown the
switch during setup, and Settings changes it at any time. It is also what puts
your username and score on the public leaderboard; switch it off and you are not
ranked. Sharing your solution code is a separate switch that stays off even
then. One activity ping — a random ID and
the version, twice a day at most — is on by default, disclosed at setup, and
has its own switch. It does not record which tab you opened or that you opened
the popup. Your GitHub token, repository name and GitHub username are never
collected.

Terms and conditions: https://leetsync-site.vercel.app/terms
Privacy policy: https://github.com/Deveshsamant/LeetSync/blob/main/PRIVACY_POLICY.md

Open source: https://github.com/Deveshsamant/LeetSync
Website: https://leetsync-site.vercel.app/
```

---

## Category

**Developer Tools**. Not Productivity — the store weights category relevance,
and every competing extension in this space sits in Developer Tools.

## Language

English (United States) — matches the 67% of installs already on en-US.

---

## Additional fields — currently EMPTY, fill these in

| Field | Value |
| --- | --- |
| Official URL | leave as None unless you verify the domain |
| Homepage URL | `https://leetsync-site.vercel.app/` |
| Support URL | `https://github.com/Deveshsamant/LeetSync/issues` |
| YouTube video | the landscape cut, once it is public — a listing with a video shows a play button in search results, which nothing else on the card does |

An empty Support URL is a visible gap on the listing page and gives a
frustrated user nowhere to go but a one-star review.

---

## Privacy tab — Single purpose

```
Automatically sync accepted LeetCode solutions to a user's GitHub repository.
```

## Privacy tab — Permission justifications

**storage**
```
Stores the user's GitHub token and repository name, theme choice, solved-problem records, streak and achievement progress, study-sheet ticks, and their rival list. All of it is held locally in Chrome storage.
```

**notifications** — declared in `optional_permissions`, so it does not appear
in the install prompt. Chrome still asks you to justify it.
```
Announces an unlocked achievement, and reminds the user in the evening when a streak they have been building is about to lapse. It is an optional permission requested during setup rather than at install; if the user declines, achievements still unlock and streaks are still counted, they are simply not announced.
```

**scripting**
```
Injects a content script into leetcode.com problem pages to detect the verdict of a submission and read the accepted solution, which is what gets pushed to GitHub.
```

**alarms**
```
Drains the retry queue for pushes that failed while offline, checks the remote configuration for maintenance notices, sends any queued usage events for users who switched usage reporting on, and sends the twice-daily activity ping for users who have not switched that off.
```

**Host permissions** — from 2.2.0 the manifest declares two as required and one
as optional. Justify all three; an undeclared host is a rejection risk.
```
leetcode.com — to detect accepted submissions and read the solution on the problem page. api.github.com — to commit the solution and README files to the user's own repository.
```

**Optional host permission** — `leetsync-analytics.devsamant1744.workers.dev`,
declared in `optional_host_permissions` and requested during setup rather than
at install:
```
leetsync-analytics.devsamant1744.workers.dev is the developer's own endpoint. It receives anonymous usage events for users who have switched usage reporting on, and an activity ping (a random install ID and the extension version, at most twice a day) which is on by default and has its own switch in Settings. It also serves two public reads that carry no identifier: the leaderboard shown in the Battle tab, and any message the developer broadcasts to users. It is an optional permission, requested at the point the user is shown the reporting switch during setup, so that installing the extension does not require granting it.
```

**Remote code**: No, I am not using Remote code.

---

## Privacy tab — Data usage

The extension collects data once the user opts in, so these boxes must be
ticked. Leaving them unticked contradicts the privacy policy and the in-app
consent screen.

| Category | Tick? | Why |
| --- | --- | --- |
| Personally identifiable information | **Yes** | The username chosen at setup is user-supplied, identifies them across sessions, and is shown publicly on the leaderboard. |
| Authentication information | **No** | The GitHub token never leaves the device. |
| Location | **No** | Never collected; there is no column for an IP address. |
| Web history | **No** | Only the LeetCode problem being solved, not browsing history. |
| User activity | **Yes** | Which features are used, and every submission verdict, language, runtime and memory. The activity ping also reports that an install was used, without the reporting opt-in. |
| Website content | **Yes** | Solution source code — but only under a second, separate opt-in that is off by default. |
| Health, Financial, Personal communications | **No** | Never collected. |

All three certifications can be signed truthfully: no data is sold or
transferred to third parties, none is used outside the single purpose, and
none is used for creditworthiness or lending.

**Privacy policy URL**
```
https://github.com/Deveshsamant/LeetSync/blob/main/PRIVACY_POLICY.md
```

---

## On ranking

Nobody can promise a top spot, and anything that claims to game it risks the
listing. What actually moves the needle, in order:

1. **Ratings and review count.** The single biggest factor, and the one you
   have least of. Ask satisfied users directly — in the What's New modal is a
   fair place.
2. **Install growth and retention.** Uninstalls count against you. Yours run
   at 17%, and they are 94% Windows against 65% ChromeOS installs — worth
   understanding before spending on acquisition.
3. **Keyword relevance.** Title carries the most weight, then the summary,
   then the first lines of the description. Covered above.
4. **A complete listing.** Five screenshots, both promo tiles, category,
   support URL. An incomplete listing is ranked below a complete one.
5. **Freshness.** Regular updates help; a listing untouched for a year decays.
