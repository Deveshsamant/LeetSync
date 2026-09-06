# LeetSync ad — Flow kit

Everything needed to shoot a 30-second spot in Google Flow: the standing rules
that go in **Agent instructions**, and a prompt per shot.

The frames referenced here are built by `store/make-ad-frames.py` and land in
`store/ad/`. Upload all eight to Flow's asset library first (**Upload media**),
so they are pickable as a first frame or an ingredient.

---

## Agent instructions

Flow's **Agent instructions** panel takes one rule per entry. These are
standing rules — they apply to every generation, so they do not have to be
repeated in a prompt. Add them one at a time with **+ Add instruction**.

Copy each line as its own instruction:

```
Never render text, letters, numbers, logos or interface labels anywhere in the frame. If a screen is visible, keep it out of focus or cropped by the frame edge.
```

```
Camera is locked off or moves very slowly. No whip pans, no orbits, no drone moves, no crash zooms, no handheld shake beyond a barely perceptible drift.
```

```
One continuous shot per clip. Never cut, dissolve or montage inside a single generation.
```

```
Real hands, real desks, ordinary rooms, practical light. No holograms, no floating interfaces, no particle effects, no science fiction.
```

```
Human performance stays small: a breath, a lean, a glance. Never a broad smile, a thumbs up, a fist pump or any celebration.
```

```
Audio is diegetic only — room tone, a keyboard, distant traffic, a chair. No music, no voiceover, no whooshes, no risers.
```

```
Never show LeetCode, GitHub, Chrome or any other real brand name, logo or product interface.
```

Then **one** of these two, depending on which theme you are cutting:

```
Colour grade: near-black background, a single vivid green accent, cool neutral shadows. No warm orange, no teal push, no golden hour.
```

```
Colour grade: bright off-white background, a single vivid red accent, hard black lines, flat even light. No warm tint, no bloom, no haze.
```

Keeping the grade as a standing instruction is what makes six separately
generated clips look like one film.

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
