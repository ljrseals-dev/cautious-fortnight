import assert from "node:assert";
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../src/core.js");
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const n1 = C.smoothNoise(3000, 0.01, 0.8, 3), n2 = C.smoothNoise(3000, 0.01, 0.8, 3), n3 = C.smoothNoise(3000, 0.01, 0.8, 4);
assert(Math.abs(sd(n1) - 1) < 1e-3, "unit sd"); assert.deepEqual(Array.from(n1), Array.from(n2), "deterministic"); assert(n1.some((v, i) => v !== n3[i]), "seed matters");
// slow noise is slow: lag-1 correlation high at tau 0.8 s, low at 0.03 s
const ac = (a) => { let c = 0, e = 0; for (let i = 1; i < a.length; i++) { c += a[i] * a[i - 1]; e += a[i] * a[i]; } return c / e; };
assert(ac(n1) > 0.98); assert(ac(C.smoothNoise(3000, 0.01, 0.03, 3)) < 0.8);
// pitch cues: drift sd about 12.6 cents, vibrato only after sustained voicing
const voiced = new Float32Array(1000).fill(1); for (let i = 400; i < 420; i++) voiced[i] = 0;
const cents = (m) => Array.from(m, (v) => 1200 * Math.log2(v));
const d = cents(C.pitchCues(voiced, 0.01, { drift: true, strength: 1, seed: 7 })); assert(sd(d) > 8 && sd(d) < 18, "drift sd " + sd(d));
const off = C.pitchCues(voiced, 0.01, {}); assert(off.every((v) => v === 1), "no cues, no change");
const v = cents(C.pitchCues(voiced, 0.01, { vibrato: true, strength: 1 }));
assert(Math.max(...v.slice(0, 20).map(Math.abs)) < 3, "vibrato silent at the start of a voiced run");
assert(Math.max(...v.slice(150, 350).map(Math.abs)) > 25, "vibrato reaches depth on a held vowel");
assert(Math.max(...v.slice(420, 430).map(Math.abs)) < 3, "vibrato restarts after a break");
const w = C.warpWander(1000, 0.01, 1, 11); const wo = Array.from(w, (x) => Math.log2(x)); assert(sd(wo) > 0.03 && sd(wo) < 0.06, "wander sd octaves " + sd(wo));
assert(C.warpWander(100, 0.01, 0, 11).every((x) => x === 1), "zero strength is flat");
// size axis
const g = C.sizeToMorph(1), k = C.sizeToMorph(-1), a = C.sizeToMorph(0);
assert(Math.abs(g.warp * k.warp - 1) < 1e-9 && g.warp < 1 && k.warp > 1 && g.semis < 0 && k.semis > 0 && a.warp === 1 && a.semis === 0 || a.semis === -0, "size axis symmetric");
console.log("voice morph core tests ok");
