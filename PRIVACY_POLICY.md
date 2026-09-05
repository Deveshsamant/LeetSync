# Privacy Policy — LeetSync

**Last updated:** September 5, 2026

## Summary

LeetSync stores your data on your own device and pushes your solutions to your
own GitHub repository. It also has an **optional** usage-reporting feature that
is **switched off unless you turn it on**.

One thing is sent without that switch: an **activity ping** — a random ID and
the extension version, at most twice a day, and nothing else. It is on by
default, it is disclosed when you set the extension up, and it has its own
switch in Settings. Turn it off and nothing leaves your browser at all.

## Data stored in your repository

Alongside your solutions, LeetSync keeps a `.leetsync/state.json` file in the
repository you connected. It holds the progress that is shared between your own
computers: which problems you have solved, the days you solved on, unlocked
achievements and study-sheet ticks.

It is written with your own token to your own repository. It contains no token,
no email, and no GitHub username, and it is never sent anywhere else — the
extension reads and writes it directly against `api.github.com`. If the
repository is private, so is the file.

## Data stored on your device

Held locally using Chrome's storage API and never transmitted anywhere except
where stated below:

- GitHub personal access token (entered by you)
- Repository name
- Solved problem metadata (number, title, difficulty, language, date)
- Theme and settings preferences
- Achievement and streak progress
- Study-sheet progress, including problems you tick by hand
- Friend/rival GitHub usernames (for the Battle feature)

Study-sheet ticks and your settings use Chrome's **sync** storage, so they
follow your Chrome profile to your other signed-in devices. That transfer is
performed by Chrome, not by us, and we cannot read it.

## Your username — required at setup

Connecting GitHub asks you to choose a username. It has to be unique across
LeetSync users, and that cannot be decided on your own device, so when you
pick one the extension sends **that name and your random install ID** to
LeetSync's server to reserve it.

This is the one thing sent before you have turned usage reporting on. Nothing
else goes with it: not your token, not your repository, not your GitHub
account, and no activity of any kind.

Clearing the username in Settings releases the reservation. Turning usage
reporting off stops your activity being sent but keeps the name reserved, so
nobody else can take it while you are not using it.

## Usage reporting — optional, off by default

Settings → **Usage reporting** enables anonymous usage statistics. While it is
off, none of the data listed below is collected, queued, or sent — only the
activity ping described in the next section, which has its own switch.

### If you switch it on, we collect

- A random install ID generated on your device. It is not derived from your
  name, email, GitHub account, or anything else about you.
- **Your username** — the one you chose when connecting GitHub. It labels your
  usage data in place of the random ID, and is shown publicly on the
  leaderboard described below.
- The extension version, and which of the two themes you are using
- Which features you use — which tab you open, which study sheet you select,
  when you open the tracker, export or import data, or change theme
- **Every submission you make on LeetCode**, not only the accepted ones: the
  problem slug, the verdict (`Accepted`, `Wrong Answer`, `Time Limit
  Exceeded`, and so on), the language, the runtime and memory LeetCode
  reports, and how many test cases passed
- **Problems you push**: the LeetCode problem title, slug, difficulty, the
  language used, and the length of the solution in characters
- Whether a push succeeded, and if it failed, a category only
  (`auth`, `network`, or `other`)

### The leaderboard is public

While usage reporting is on, you are ranked on a leaderboard that every
LeetSync user can see in the Battle tab. It shows your **username** and your
score — points, problems solved, and the split between Hard, Medium and Easy.

It never shows your install ID, your repository, your GitHub account, or which
problems you solved. Clear your username in Settings and you appear as
"Anonymous"; switch usage reporting off and you are not ranked at all.

Scores are Hard 10, Medium 5, Easy 3, counted once per problem.

### The activity ping — a separate switch, on by default

Settings → **Count me as an active user** is the only thing that sends anything
while usage reporting is off. It reports:

- The same random install ID
- The extension version
- The time it was sent

That is the whole payload. No problem, no verdict, no language, no theme, no
feature, no username. It is sent at most twice a day, and only while usage
reporting is off — once reporting is on, its own events already carry a
timestamp and the ping stops.

It exists to answer one question that reporting cannot: whether an install is
still in use, or has been sitting unused. Without it, someone who declines
reporting is indistinguishable from someone who has stopped using LeetSync.

Switch it off and nothing is sent under any circumstance while usage reporting
is also off.

### Solution code — a separate switch, also off by default

Settings → **Also share solution code** is an independent opt-in. Turning on
usage reporting does **not** turn this on, and switching usage reporting off
switches this off too.

While it is off, the source of your solutions never leaves your device — only
its length is reported. While it is on, the source of each accepted solution is
sent along with it, comments included. Leave it off if your code contains
anything you would not want to share.

### We never collect

- Your GitHub personal access token
- Your repository name or GitHub username
- Your IP address — it is not stored, and there is no column for it
- Error messages, which can contain repository paths
- Your solution code, unless you separately switch on code sharing
- Browsing history, cookies, or any advertising identifier

### Where it goes

To a Cloudflare Worker operated by the developer, writing to a Cloudflare D1
database. **No third-party analytics provider is involved.** Data is not sold,
shared, or used for advertising.

### Turning it off

Switching it off immediately deletes any queued events and stops anything
further being sent, apart from the activity ping above, which has its own
switch. It also switches code sharing off, so turning reporting back on cannot
silently resume it.

Your install ID and username are kept, because the username is reserved
against other users and that reservation is held by the ID — discarding it
would leave the name stranded with no way to release it. Clear the username in
Settings to release it and go back to being identified only by a random ID.

## Third-party services

- **GitHub API** — used solely to push your solutions to your own repository.
  Your token is stored locally and sent only to `api.github.com`.
- **LeetCode** — the extension reads submission data from `leetcode.com` pages
  you visit, to detect accepted solutions.
- **raw.githubusercontent.com** — the extension fetches a public configuration
  file and the study-sheet definitions. No user data is sent in these requests.
- **leetsync-analytics.devsamant1744.workers.dev** — besides usage reporting,
  the extension reads two public things from this endpoint: the current
  broadcast message, and the leaderboard. Both are plain reads that send no
  identifier and happen whatever your reporting setting is; as with any web
  request, the server sees that a request arrived. Your own leaderboard
  position is the one exception, and asking for it sends your install ID —
  which only happens while usage reporting is on.

## Data retention and removal

Usage events are retained for as long as they are useful for product decisions.
To have data associated with your install ID deleted, open an issue with that
ID (Settings shows it only while reporting is enabled) and it will be removed.

Uninstalling the extension deletes all local data. Data already sent while
reporting was enabled is not deleted automatically — use the request above.

## Contact

Questions, or a deletion request:
[github.com/Deveshsamant/LeetSync/issues](https://github.com/Deveshsamant/LeetSync/issues)
