# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static site for GitHub Pages — no build step, no dependencies. Open `index.html` directly in a browser to develop.

## Architecture

Three files, no framework:

- **`index.html`** — single page with one view (`#learn-view`). No start screen; learning begins immediately on load.
- **`style.css`** — CSS custom properties in `:root`, dark terminal theme. Layout is flexbox column inside `#learn-view` at `100dvh`.
- **`script.js`** — all game logic. Key classes and globals:
  - `TimingDetector` — 2-means clustering on recent press durations to auto-detect the user's dit/dah threshold and unit time. `gapTimeout` (3× unit) determines end of a character.
  - `MORSE` / `REVERSE` — forward and reverse lookup tables (A-Z, 0-9).
  - `gameState` — `'idle' | 'waiting' | 'inputting' | 'evaluating'`
  - `audioReady` flag — AudioContext requires a user gesture; set to `true` on first press, at which point `ensureCtx()` unlocks audio.
  - `playbackAbort` counter — increment to cancel any in-flight `playMorseRef` async loop.

## Morse timing model

Standard PARIS ratios (all relative, never absolute):
- dit = 1 unit, dah = 3 units
- inter-element gap = 1 unit, inter-character gap = 3 units
- WPM formula: `unit_ms = 60000 / (50 × wpm)`

The reference playback speed is set by `refWpm` (5–30 WPM). User timing is detected adaptively — do not hardcode thresholds.

## Key behaviours to preserve

- `renderTimingEntry()` renders one row per press: a bar track with a ghost ref-bar, solid actual bar, and a white tick at the reference position, plus actual value (2 decimal seconds) and signed deviation.
- After `evaluate()` fires (gap timeout), the next letter auto-advances after 1200 ms (correct) or 2200 ms (wrong).
- Space bar is wired as an alias for mouse press/release on `#press-area`.
