# Privacy Policy — LeetSync

**Last updated:** September 3, 2026

## Summary

LeetSync stores your data on your own device and pushes your solutions to your
own GitHub repository. It also has an **optional** usage-reporting feature that
is **switched off unless you turn it on**.

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

## Usage reporting — optional, off by default

Settings → **Usage reporting** enables anonymous usage statistics. While it is
off, nothing is collected, queued, or sent, and no identifier exists.

### If you switch it on, we collect

- A random install ID generated on your device. It is not derived from your
  name, email, GitHub account, or anything else about you.
- The extension version
- Which features you use — which tab you open, which study sheet you select,
  when you open the tracker, export or import data, or change theme
- **Problems you push**: the LeetCode problem title, slug, difficulty, and the
  programming language used
- Whether a push succeeded, and if it failed, a category only
  (`auth`, `network`, or `other`)

### We never collect

- Your GitHub personal access token
- Your repository name or GitHub username
- Your IP address — it is not stored, and there is no column for it
- Error messages, which can contain repository paths
- Browsing history, cookies, or any advertising identifier

### Where it goes

To a Cloudflare Worker operated by the developer, writing to a Cloudflare D1
database. **No third-party analytics provider is involved.** Data is not sold,
shared, or used for advertising.

### Turning it off

Switching it off immediately deletes any queued events and forgets the install
ID. If you switch it back on later, a new unrelated ID is generated, so past
and future data cannot be linked.

## Third-party services

- **GitHub API** — used solely to push your solutions to your own repository.
  Your token is stored locally and sent only to `api.github.com`.
- **LeetCode** — the extension reads submission data from `leetcode.com` pages
  you visit, to detect accepted solutions.
- **raw.githubusercontent.com** — the extension fetches a public configuration
  file and the study-sheet definitions. No user data is sent in these requests.

## Data retention and removal

Usage events are retained for as long as they are useful for product decisions.
To have data associated with your install ID deleted, open an issue with that
ID (Settings shows it only while reporting is enabled) and it will be removed.

Uninstalling the extension deletes all local data. Data already sent while
reporting was enabled is not deleted automatically — use the request above.

## Contact

Questions, or a deletion request:
[github.com/Deveshsamant/LeetSync/issues](https://github.com/Deveshsamant/LeetSync/issues)
