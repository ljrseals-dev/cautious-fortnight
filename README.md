# Voice Morph

A browser voice changer where **formants and pitch are separate**. One "size" slider runs from child to giant by moving the vocal-tract resonances (formants) and the pitch together, and each can be moved on its own. It uses a channel vocoder: the speech is split into bands, the band envelopes are read, and the synthesis filters are shifted up or down in frequency while the carrier pitch is set separately. Optional cues (pitch drift and jitter, vibrato on held vowels, formant wander, breath) are in the spirit of the Uncanny Voice build.

Open `index.html` (standalone, has Save WAV). `artifact.html` is the same page without the download button.

## Controls
Size slider (-1 child ... +1 giant) with Child / Neutral / Giant presets; formant shift and pitch shift in semitones; monotone (robot) with its own pitch; carrier (pitch-tracked buzz or noise); bands (up to 32, ERB spaced); envelope smoothing; cue strength. Demo phrase, file upload, or microphone record. Original and morphed spectrograms are shown one above the other.

## Build and test
`python3 build.py` assembles `index.html` and `artifact.html` from `demo/template.html`, `src/core.js`, `src/engine.js`.
`node tests/core.test.mjs` and `NODE_PATH=$(npm root -g) node tests/browser.test.cjs` (headless Chromium through Playwright).

## What is verified (measured, headless Chromium, synthetic demo phrase)
- **Formant warp, end to end:** a single 1000 Hz resonance passed through the warp lands at 721 / 861 / 1012 / 1206 / 1421 Hz for -6 / -3 / 0 / +3 / +6 semitones (targets 707 / 841 / 1000 / 1189 / 1414; the test allows 6%).
- **Pitch is independent of the formant shift:** with the formants moved, the output periodicity at the commanded f0 stays within a few cents (median error 0.2 to 1.8 cents in the runs above; tracker scatter is larger, 4 to 6 cents).
- **Vowel envelopes move the right way**, but the envelope-correlation metric reads only about half the commanded shift, so it is asserted for direction only.
- **Balance:** fricative-to-vowel level is 11.6 dB in the input and 13.8 dB in the output.
- **Cues:** vibrato on held vowels measures about 25 cents deviation (0 when off); drift raises pitch scatter from 4.8 to 14.4 cents; formant wander and breath are nonzero when on and zero when off.
- **Repeatability:** two renders with the same settings differ by about 1e-7, so the "random" cues are seeded and repeatable.

## Bug found while building
The shared sibilance path (also used in Dudley Vocoder, Vocoder in a Room, Robot Choir) buried the vowels by roughly 18 to 28 dB in an early version. It is fixed by leveling the band output to the input before adding sibilance at natural level, and a balance test now guards it.

## Not verified
**Nobody has listened to this.** Intelligibility, naturalness and whether the child and giant settings sound like a child or a giant are all untested; the demo is synthetic. The size-to-ratio mapping and the cue amounts are my own choices, not taken from a study. Real speech through the microphone has not been tested.

## Citations
See CREDITS.md.
