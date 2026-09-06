# LeetSync ad — Flow kit

Everything needed to shoot a 30-second spot in Google Flow: the standing rules
that go in **Agent instructions**, and a prompt per shot.

The frames referenced here are built by `store/make-ad-frames.py` and land in
`store/ad/`. Upload all eight to Flow's asset library first (**Upload media**),
so they are pickable as a first frame or an ingredient.

---

## Agent instructions

Flow's **Agent instructions** panel takes a single entry, so all of it goes in
one block. These are standing rules — they apply to every generation and do
not have to be repeated in a prompt. Keeping the grade standing rather than
inline is what makes six separately generated clips look like one film.

```
Every shot is one continuous take — no cuts, dissolves or montage inside a clip. Camera locked off or moving very slowly: no whip pans, orbits, drone moves or crash zooms, and no handheld shake beyond a barely perceptible drift. Real rooms, real hands, practical light; no holograms, floating interfaces, particle effects or science fiction. Never render text, letters, numbers, logos or interface labels anywhere in the frame — if a screen is visible keep it out of focus or cropped by the frame edge — and never show LeetCode, GitHub, Chrome or any other real brand. Human performance stays small: a breath, a lean, a glance; never a broad smile, a thumbs up or any celebration. Audio is diegetic only — room tone, a keyboard, distant traffic — with no music, voiceover, whooshes or risers. Colour grade: near-black background, a single vivid green accent, cool neutral shadows; no warm orange, no teal push, no golden hour.
```

For a **Modernist** cut, swap the final sentence for:

```
Colour grade: bright off-white background, a single vivid red accent, hard black lines, flat even light; no warm tint, no bloom, no haze.
```

If the field will not take that much, this keeps the load-bearing half. The
grade is the one rule that also works pasted into each prompt, so it is the
first thing to drop from here.

```
One continuous locked-off take, no cuts. Never render text, numbers, logos or brand names anywhere in frame; keep any screen out of focus. Real rooms, practical light, no sci-fi. Human performance small, no celebration. Diegetic audio only, no music. Grade near-black with a single vivid green accent and cool shadows.
```

---

## The shots

Thirty seconds, six shots. Four are generated, two are first-framed from the
real extension.

| # | Beat | Mode | Frame |
| --- | --- | --- | --- |
| 1 | The accept | Text to video | — |
| 2 | The old way | Text to video | — |
| 3 | The turn | Text to video | — |
| 4 | It just goes | Frames to video | `frame-popup-16x9-signal.png` |
| 5 | The repo fills | Frames to video | `frame-tracker-16x9-signal.png` |
| 6 | Someone notices | Text to video | — |

---

### 1 — The accept · 0–4s

> Close-up, 50mm, shallow depth of field. A young developer's face lit only by
> a monitor in a dark room at two in the morning. Their eyes flick down, then a
> soft green glow washes across their glasses and one cheek. They exhale and
> lean back an inch. Quiet, private satisfaction — no smile. Almost
> imperceptible handheld drift. Cool blue ambient fill, green key from the
> screen. Audio: the low hum of a room at night, one soft mechanical
> keyswitch.

### 2 — The old way · 4–9s

> Overhead top-down shot of a cluttered desk under a warm lamp. A hand
> repeatedly performs the same small motion — reaching for the mouse, dragging,
> releasing, returning. The motion repeats faster and faster. The hand slows,
> stops, and the fingers press against the forehead. 35mm, slight vignette,
> fine film grain. Audio: repetitive mouse clicks accelerating, then abrupt
> silence.

### 3 — The turn · 9–13s

> Medium shot from just behind the shoulder of a developer at a desk in a dark
> room. The monitor is in the background and completely out of focus. They
> press one key, then immediately push back from the desk, hands off the
> keyboard, and simply watch. Calm, still. Very slow push in on the back of
> their head. Audio: one keystroke, then room tone. Nothing else.

*The defocused monitor is deliberate — that is where you composite the real
screen recording in the edit.*

### 4 — It just goes · 13–19s

**Frames to video**, first frame `frame-popup-16x9-signal.png`.

> Locked-off static camera. No zoom, no pan, no push whatsoever. The interface
> stays completely still and unchanged. Only a faint green light drifts slowly
> across the dark background behind it, and a barely visible reflection moves
> across the panel's surface. Audio: quiet room tone.

**Cut before second four.** The numbers begin to rot after that.

### 5 — The repo fills · 19–25s

**Frames to video**, first frame `frame-tracker-16x9-signal.png`.

> Locked-off static camera, absolutely no movement. The layout holds
> completely still. A slow, soft sweep of light passes left to right across the
> surface, as if a window were behind the viewer. Nothing on the panel changes
> position. Audio: near silence, a distant room.

Same rule: **cut at three or four seconds.**

### 6 — Someone notices · 25–30s

> Close-up of two hands holding a phone in a bright modern office,
> over-the-shoulder, the phone screen deliberately out of focus. A second
> person leans into frame to look at it and their eyebrows lift very slightly.
> Natural window light from the left, 85mm, shallow depth of field. Audio:
> quiet office ambience, a soft "hm" of approval.

---

## One prompt per screen

Every one of these is **Frames to video**, with the matching PNG from
`store/ad/` as the first frame. They are all the same shot — a locked-off
panel — so the motion is in the light and the ground, never in the
interface. Asking Veo to animate the UI is asking it to invent one.

Fourteen frames is far more than a thirty-second cut needs. Generate the
five or six the script calls for; the rest are there so the script can
change without another capture run.

**Cut every one of these at three or four seconds.** Past that the numbers
start to rot, whatever the prompt says.

### `screen-setup.png` — Connect once

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A slow warm light rises from the lower left across the background, as if a lamp had just been switched on off-camera.
> Audio: a room at night, one distant keyboard press, nothing else.

### `screen-consent.png` — The data question

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. The background brightens very slightly and evenly across the whole frame, like daylight returning behind a blind.
> Audio: near silence, a chair shifting once in another room.

### `screen-dashboard-1.png` — Did it land

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A soft red highlight drifts slowly from left to right across the surface of the panel, as if a car had passed a window.
> Audio: low room tone, a fan somewhere behind the camera.

### `screen-dashboard-2.png` — Ninety days

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. Fine dust motes drift slowly through the air in front of the panel, catching the light. The panel itself does not move.
> Audio: near silence, the faint hum of a monitor.

### `screen-solved-1.png` — Everything you solved

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A soft vertical shadow passes slowly down the background, as if someone had walked past a window behind the camera.
> Audio: a distant door, then room tone.

### `screen-solved-2.png` — The list continues

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. The faint grid in the background brightens very slightly and then settles, a single slow breath of light.
> Audio: room tone, a page turning somewhere off-camera.

### `screen-sheets-1.png` — Seven sheets

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A soft light blooms slowly from behind the top edge of the panel and fades back down.
> Audio: quiet room tone, a pen set down on a desk.

### `screen-sheets-2.png` — Ticking themselves

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A very slow diagonal sheen crosses the surface of the panel from the top left to the bottom right, like light off glass.
> Audio: near silence, distant traffic through a closed window.

### `screen-battle-1.png` — The leaderboard

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A slow pulse of light swells from the lower right of the background and settles again — one breath, no repeat.
> Audio: low room tone rising very slightly, no music.

### `screen-battle-2.png` — Rivals

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. The faint reflection of a window drifts slowly across the panel from right to left.
> Audio: a room with a window open, distant street noise.

### `screen-settings-1.png` — Every switch

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. The background light shifts very slowly from cool to slightly warm across the whole frame.
> Audio: room tone, the click of a lamp switch off-camera.

### `screen-settings-2.png` — What is sent

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A soft shadow creeps in slowly from the left edge of the frame and stops partway across the background.
> Audio: near silence, a clock somewhere in the building.

### `screen-settings-3.png` — Say something

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A warm light rises slowly from below the frame and settles evenly across the background.
> Audio: quiet room tone, one soft keyboard press near the end.

### `screen-tracker.png` — All 895

> Locked-off static camera. No zoom, no pan, no push, no handheld drift.
> The panel and everything on it stays completely still and unchanged: no
> text moves, no numbers change, nothing appears or disappears. A broad soft sweep of light crosses the panel from left to right, as if a window were behind the viewer and a cloud had moved.
> Audio: a large quiet room, distant footsteps.

---

## B-roll worth having

Cheap to generate, and it saves a cut when a shot lands two seconds short.

> Extreme macro on a droplet of condensation running down a glass beside a
> keyboard, a single green highlight caught in it. Rack focus from the droplet
> to the keys behind. Very slow. Audio: near silence.

> Top-down close-up of a mechanical keyboard in a dark room, one key pressed
> and released by a single finger, then the hand withdrawing entirely out of
> frame. The keyboard sits still and lit. Audio: one keypress, then nothing.

> Slow tilt down a dark window at night with a city out of focus beyond it, the
> reflection of a green-lit screen visible in the glass. Audio: distant
> traffic, muffled.

---

## Vertical

For Shorts and Reels, generate natively at 9:16 rather than cropping — a
cropped 16:9 loses the composition and the faces drift out of frame. The
prompts above work unchanged; swap the first-frame images for
`frame-popup-9x16-*.png` and add to the prompt:

> Vertical composition. Keep the subject centred with clear headroom at the top
> and space at the bottom of the frame.

That empty top and bottom is where the caption goes in the edit.

---

## Credits

Every generation is eight seconds, and Flow shows the exact cost on the
generate button before you commit — check it there.

The order that matters more than the rate:

1. Draft all six shots on the **fast** model, two or three attempts each. Most
   will be discarded. That is normal.
2. Choose the three or four that actually work.
3. Re-roll **only those**, on the **quality** model, with the exact prompt that
   worked.

Spending quality credits on a first attempt is how a thousand credits become
nothing usable.

---

## In the edit

- Composite the real screen recording into the defocused monitor in shot 3.
  Record it from the preview harness: `node scripts/make-preview.mjs`, serve
  the folder, and capture `preview-popup.html` — the real popup, no browser
  chrome around it.
- Add the wordmark and the closing card as **real text layers**. Never let Veo
  generate them.
- Closing card: the mark, *Solve. Submit. Synced.*, and **Add to Chrome — free**.
- Keep LeetCode's name and logo out of it entirely. The site already carries
  "Not affiliated with LeetCode", and an ad leaning on their branding invites a
  takedown. *Your solutions, on GitHub, automatically* carries the idea without
  naming them.
