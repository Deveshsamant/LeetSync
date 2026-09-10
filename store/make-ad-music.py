# -*- coding: utf-8 -*-
"""
Score the ad.

The music is written rather than licensed, for two reasons. A track lifted from
anywhere else gets the post muted on YouTube and struck on Instagram, and no
stock loop knows where the cuts are. This one does: make-ad-video.py holds each
scene for 81 frames and crossfades for 13, so a scene is 94 frames at 24fps --
3.9167 seconds. Eight beats fit that exactly at 122.55 BPM, which puts a bar
line on every cut and a section change on every scene.

    scene 1  dark, the problem          sub and a low pad, nothing else
    scene 2  the turn                   pad opens, first arpeggio note
    scene 3  the dashboard              kick enters, quiet
    scene 4  the graph                  hats, the bass starts moving
    scene 5  everything solved          full, still restrained
    scene 6  the sheets                 peak, a counter-line on top
    scene 7  the closer                 drums drop out, one chord rings

Harmony walks A minor to C major over those fourteen bars, which is the same
journey the copy makes.

Writes the score to store/ad/leetsync-ad-music.wav, then lays it under both
cuts of the picture as -sound.mp4. All of it is gitignored, like the video.
"""

import os
import subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store', 'ad')

SR = 48000
BPM = 122.55            # eight beats per scene, so bar lines land on cuts
BEAT = 60.0 / BPM
BAR = BEAT * 4
BARS = 14

# The score is cut to the film, not the other way round: 645 frames at 24fps.
# Bar 12's chord is held long enough to still be ringing when the picture ends,
# so the fade lands on a sustain rather than on silence.
VIDEO_FRAMES, VIDEO_FPS = 645, 24
DUR = VIDEO_FRAMES / float(VIDEO_FPS)

N = int(DUR * SR)
T = np.arange(N) / float(SR)


def at(bar, beat=0.0):
    """Sample index of a position in the score."""
    return int((bar * BAR + beat * BEAT) * SR)


def add(buf, sig, start):
    """Mix `sig` into `buf` at `start`, clipped to the buffer."""
    end = min(start + len(sig), len(buf))
    if end <= start:
        return
    buf[start:end] += sig[:end - start]


# ── Note names to frequencies ────────────────────────────────

STEPS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def hz(name):
    """'A3' -> 220.0. Sharps as 'F#4'."""
    letter, rest = name[0], name[1:]
    semis = STEPS[letter]
    if rest.startswith('#'):
        semis, rest = semis + 1, rest[1:]
    octave = int(rest)
    return 440.0 * (2.0 ** ((semis - 9) / 12.0 + (octave - 4)))


# One chord per bar: A minor resolving to C major.
CHORDS = [
    ('A2', ['A3', 'C4', 'E4']),          # 0  Am
    ('A2', ['A3', 'C4', 'E4']),          # 1
    ('F2', ['F3', 'A3', 'C4', 'E4']),    # 2  Fmaj7
    ('F2', ['F3', 'A3', 'C4', 'E4']),    # 3
    ('C2', ['C3', 'E3', 'G3', 'B3']),    # 4  Cmaj7
    ('C2', ['C3', 'E3', 'G3', 'B3']),    # 5
    ('A2', ['A3', 'C4', 'E4', 'G4']),    # 6  Am7
    ('G2', ['G3', 'B3', 'D4', 'E4']),    # 7  G6
    ('F2', ['F3', 'A3', 'C4', 'E4']),    # 8  Fmaj7
    ('C2', ['C3', 'E3', 'G3', 'B3']),    # 9  Cmaj7
    ('A2', ['A3', 'C4', 'E4', 'G4']),    # 10 Am7
    ('G2', ['G3', 'B3', 'D4', 'E4']),    # 11 G6
    ('C2', ['C3', 'E3', 'G3', 'B3']),    # 12 Cmaj7 -- the resolve
    ('C2', ['C3', 'E3', 'G3', 'B3']),    # 13 ring out
]


# ── Voices ───────────────────────────────────────────────────

def env_ad(n, attack, decay, curve=3.0):
    """Attack then exponential decay, both in seconds."""
    a = max(1, int(attack * SR))
    e = np.empty(n, dtype=np.float64)
    a = min(a, n)
    e[:a] = np.linspace(0.0, 1.0, a) ** 1.5
    if n > a:
        d = np.arange(n - a) / float(SR)
        e[a:] = np.exp(-d * curve / max(decay, 1e-4))
    return e


def pad(freqs, dur, level):
    """Detuned saw stack under a slow filter -- the bed everything sits on.

    Takes frequencies, not names: every other voice does too."""
    n = int(dur * SR)
    t = np.arange(n) / float(SR)
    out = np.zeros(n)
    for f in freqs:
        for cents in (-7.0, 0.0, 7.0):
            fd = f * (2.0 ** (cents / 1200.0))
            # Bandlimited-ish saw: partials thinned so nothing aliases.
            for k in range(1, 13):
                if fd * k > SR * 0.42:
                    break
                out += np.sin(2 * np.pi * fd * k * t + k * 0.7) / k
    out /= max(len(freqs), 1) * 3.0

    # The filter opens across the note, which is what makes a pad breathe.
    cutoff = np.linspace(520.0, 2600.0, n)
    out = _sweep_lowpass(out, cutoff)

    # And it gives the bottom back to the sub: three detuned saws per chord
    # tone pile up fast down there, and the root is already being played.
    b, a = signal.butter(2, 150.0 / (SR / 2.0), btype='high')
    out = signal.lfilter(b, a, out)

    e = np.ones(n)
    a = int(0.35 * SR)
    r = int(0.6 * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return out * e * level


def _sweep_lowpass(x, cutoff):
    """A one-pole lowpass whose cutoff moves sample by sample."""
    # Cheap, but a moving cutoff is the whole point and biquads would need
    # re-designing every block.
    a = np.exp(-2.0 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1.0 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def sub(freq, dur, level):
    """Sine bass with a little second harmonic so small speakers hear it."""
    n = int(dur * SR)
    t = np.arange(n) / float(SR)
    s = np.sin(2 * np.pi * freq * t) + 0.28 * np.sin(4 * np.pi * freq * t)
    e = np.ones(n)
    a, r = int(0.02 * SR), int(0.25 * SR)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return s * e * level


def pluck(freq, dur, level):
    """Short triangle-ish tone -- the arpeggio."""
    n = int(dur * SR)
    t = np.arange(n) / float(SR)
    s = (np.sin(2 * np.pi * freq * t)
         + 0.32 * np.sin(4 * np.pi * freq * t + 1.1)
         + 0.14 * np.sin(6 * np.pi * freq * t + 2.3)
         + 0.07 * np.sin(10 * np.pi * freq * t + 0.4)
         + 0.03 * np.sin(16 * np.pi * freq * t + 1.9))
    return s * env_ad(n, 0.004, 0.18, 4.5) * level


def bell(freq, dur, level):
    """Longer, purer, sits on top of the peak."""
    n = int(dur * SR)
    t = np.arange(n) / float(SR)
    s = (np.sin(2 * np.pi * freq * t)
         + 0.22 * np.sin(2 * np.pi * freq * 2.01 * t)
         + 0.09 * np.sin(2 * np.pi * freq * 3.02 * t))
    return s * env_ad(n, 0.02, 0.9, 2.6) * level


def kick(level):
    """Sine with a pitch envelope: 120Hz down to 45Hz in 40ms."""
    n = int(0.34 * SR)
    t = np.arange(n) / float(SR)
    f = 45.0 + 75.0 * np.exp(-t * 26.0)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t * 9.0)
    click = np.random.RandomState(7).randn(n) * np.exp(-t * 320.0) * 0.10
    return (body + click) * level


def hat(level, closed=True):
    """Filtered noise. Not a real hat, but it keeps time."""
    n = int((0.055 if closed else 0.16) * SR)
    rs = np.random.RandomState(19 if closed else 23)
    x = rs.randn(n)
    b, a = signal.butter(4, 7000.0 / (SR / 2.0), btype='high')
    x = signal.lfilter(b, a, x)
    t = np.arange(n) / float(SR)
    return x * np.exp(-t * (70.0 if closed else 22.0)) * level


# ── Space ────────────────────────────────────────────────────

def reverb(x, seconds=1.9, mix=0.26):
    """Convolution with decaying noise. Cheap plate, does the job."""
    n = int(seconds * SR)
    rs = np.random.RandomState(1234)
    ir = rs.randn(n) * np.exp(-np.arange(n) / float(SR) * (5.0 / seconds))
    b, a = signal.butter(4, 5200.0 / (SR / 2.0), btype='low')
    ir = signal.lfilter(b, a, ir)
    ir[:int(0.012 * SR)] = 0.0          # pre-delay, keeps the front clear
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    wet = signal.fftconvolve(x, ir)[:len(x)]
    return x * (1.0 - mix) + wet * mix


# ── The arrangement ──────────────────────────────────────────

def build():
    beds = np.zeros(N)      # pad + sub, heavily reverberant
    tops = np.zeros(N)      # arp + bell, lightly reverberant
    hits = np.zeros(N)      # drums, dry

    for bar in range(BARS):
        root, voicing = CHORDS[bar]
        start = at(bar)

        # -- Pad. Quiet and dark for the first two bars, then it opens.
        level = 0.16 if bar < 2 else (0.24 if bar < 6 else 0.30)
        if bar >= 12:
            level = 0.34
        held = BAR * (2.6 if bar == 12 else 1.02)
        add(beds, pad([hz(n) for n in voicing], held, level), start)

        # -- Sub. Roots throughout; from bar 6 it answers on the offbeat.
        add(beds, sub(hz(root), BAR * 0.92, 0.30), start)
        if 6 <= bar < 12:
            add(beds, sub(hz(root) * 1.5, BEAT * 1.4, 0.13), at(bar, 2.5))

        # -- Arpeggio. One note at the turn, then eighths.
        if bar == 2:
            add(tops, pluck(hz(voicing[-1]), 1.2, 0.20), at(bar, 2))
        elif bar >= 3:
            notes = voicing + voicing[-2::-1]
            for i in range(8):
                if bar >= 12 and i >= 4:
                    break                      # thin out over the closer
                f = hz(notes[i % len(notes)])
                if i % 4 == 3:
                    f *= 2.0                   # a lift every fourth note
                vel = 0.15 if i % 2 == 0 else 0.10
                add(tops, pluck(f, 0.5, vel), at(bar, i * 0.5))

        # -- Counter-line across the peak, and the final resolve.
        if bar in (10, 11):
            add(tops, bell(hz(voicing[1]) * 2.0, 1.6, 0.13), at(bar, 1))
        if bar == 12:
            add(tops, bell(hz('E5'), 2.6, 0.17), start)
            add(tops, bell(hz('G5'), 2.4, 0.10), at(bar, 1.5))

        # -- Kick from bar 4, gone by the closer.
        if 4 <= bar < 12:
            for beat in (0, 2):
                add(hits, kick(0.62), at(bar, beat))
            if bar >= 8:
                add(hits, kick(0.34), at(bar, 3.5))

        # -- Hats from bar 6.
        if 6 <= bar < 12:
            for i in range(8):
                if i % 2 == 1:
                    add(hits, hat(0.16), at(bar, i * 0.5))
                elif i in (2, 6):
                    add(hits, hat(0.07, closed=False), at(bar, i * 0.5))

    mix = reverb(beds, 2.4, 0.30) + reverb(tops, 1.5, 0.20) + reverb(hits, 0.9, 0.08)

    # Nothing below the sub's fundamental is doing any work.
    b, a = signal.butter(2, 55.0 / (SR / 2.0), btype='high')
    mix = signal.lfilter(b, a, mix)

    # A shelf of air on top. Every voice here is built from a handful of
    # harmonics, so without it the whole thing sounds like it is under a
    # blanket -- which the first render was.
    b, a = signal.butter(2, 4200.0 / (SR / 2.0), btype='high')
    mix = mix + 0.42 * signal.lfilter(b, a, mix)

    # Fade in from silence, and out under the closer.
    fi = int(0.9 * SR)
    mix[:fi] *= np.linspace(0, 1, fi) ** 1.6
    fo = int(2.4 * SR)
    mix[-fo:] *= np.linspace(1, 0, fo) ** 1.4

    # Soft clip, then leave a decibel of headroom.
    mix = np.tanh(mix * 1.25) / 1.25
    mix *= 0.891 / (np.max(np.abs(mix)) + 1e-12)     # -1 dBFS
    return mix


# ── Under the picture ────────────────────────────────────────

# Every platform normalises what you upload -- YouTube, Instagram and X all
# aim at roughly -14 LUFS -- so the track is delivered there rather than left
# for their encoder to pull around.
LUFS = 'loudnorm=I=-14:TP=-1.5:LRA=11'


def mux(track):
    """Marry the score to each cut. The picture is not re-encoded."""
    made = []
    for label in ('16x9', '9x16'):
        src = os.path.join(OUT, 'leetsync-ad-%s.mp4' % label)
        if not os.path.exists(src):
            print('  skipped %s -- run make-ad-video.py first' % label)
            continue
        dst = os.path.join(OUT, 'leetsync-ad-%s-sound.mp4' % label)
        subprocess.check_call([
            'ffmpeg', '-y', '-loglevel', 'error',
            '-i', src, '-i', track,
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy',                  # the frames are already right
            '-af', LUFS,
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-movflags', '+faststart', '-shortest', dst,
        ])
        made.append(dst)
        print('  %s  %.1f MB' % (os.path.basename(dst),
                                 os.path.getsize(dst) / 1e6))
    return made


def main():
    os.makedirs(OUT, exist_ok=True)
    mono = build()
    # Slight stereo width: the tops arrive a hair later on one side.
    delay = int(0.011 * SR)
    left = mono.copy()
    right = np.concatenate([np.zeros(delay), mono[:-delay]])
    stereo = np.stack([left, right * 0.97 + left * 0.03], axis=1)

    path = os.path.join(OUT, 'leetsync-ad-music.wav')
    wavfile.write(path, SR, (stereo * 32767.0).astype(np.int16))
    print('%s  %.3fs  %d bars @ %.2f BPM'
          % (os.path.basename(path), len(mono) / float(SR), BARS, BPM))
    mux(path)


if __name__ == '__main__':
    main()
