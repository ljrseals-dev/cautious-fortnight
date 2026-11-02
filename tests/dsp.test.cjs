const assert = require("assert");
globalThis.PhaseVocoder = require("../src/pvoc.js");
const C = require("../src/core.js"), M = require("../src/morph.js");
const sr = 44100;
// source-filter vowel: sawtooth at f0 through three resonators, steady for 2 s
function vowel(f0, forms, secs) {
  const n = Math.round(sr * secs), x = new Float32Array(n);
  const src = new Float64Array(n); let ph = 0; for (let i = 0; i < n; i++) { ph += f0 / sr; ph -= Math.floor(ph); src[i] = (2 * ph - 1) * 0.5; }
  forms.forEach(([f, bw, gain]) => { const r = Math.exp(-Math.PI * bw / sr), c1 = 2 * r * Math.cos(2 * Math.PI * f / sr), c2 = -r * r, b0 = 1 - r; let y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const y = b0 * src[i] + c1 * y1 + c2 * y2; y2 = y1; y1 = y; x[i] += gain * y; } });
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); for (let i = 0; i < n; i++) x[i] *= 0.6 / m; return x;
}
const A = [[730, 90, 1], [1090, 110, 0.9], [2440, 160, 0.6]];
const x = vowel(120, A, 2.0);
const f0of = (y) => C.trackPitch(Float32Array.from(y), sr).medianF0;
const peaks = (y) => M.envPeaks(M.avgEnvelope(y, sr), 300, 3600, 3);
const near = (a, b, tol) => Math.abs(a / b - 1) < tol;

// 1. unit warp is transparent
const id = M.warpFormants(x, { sr, ratioAt: () => 1 });
let e = 0, d = 0; for (let i = 4096; i < x.length - 4096; i++) { e += x[i] ** 2; d += (id[i] - x[i]) ** 2; }
const snr = 10 * Math.log10(e / d); console.log("identity warp SNR dB", snr.toFixed(1)); assert(snr > 40, "identity warp transparent");

// 2. baseline peaks of the synthetic vowel
const p0 = peaks(x); console.log("source formant peaks", p0.map(Math.round)); assert(near(p0[0], 730, 0.12) && near(p0[1], 1090, 0.12), "analysis finds F1 and F2");

// 3. formants x1.25 (shorter tract), pitch unchanged
const y1 = M.morph(x, sr, { semis: 0, formant: 1.25 }), p1 = peaks(y1);
console.log("formant x1.25 peaks", p1.map(Math.round), "f0", f0of(y1).toFixed(1));
assert(near(p1[0], 730 * 1.25, 0.08), "F1 moves up by 1.25: " + p1[0]); assert(near(p1[1], 1090 * 1.25, 0.08), "F2 moves up by 1.25: " + p1[1]);
assert(near(f0of(y1), 120, 0.01), "pitch unchanged by a formant move: " + f0of(y1)); assert.equal(y1.length, x.length);

// 4. formants x0.75 (longer tract)
const y2 = M.morph(x, sr, { semis: 0, formant: 0.75 }), p2 = peaks(y2); console.log("formant x0.75 peaks", p2.map(Math.round), "f0", f0of(y2).toFixed(1));
assert(near(p2[0], 730 * 0.75, 0.10), "F1 moves down by 0.75: " + p2[0]); assert(near(f0of(y2), 120, 0.01));

// 5. pitch +12 st with formants held: f0 doubles, F1 stays near 730
const y3 = M.morph(x, sr, { semis: 12, formant: 1 }), p3 = peaks(y3); console.log("pitch +12, formants held", p3.map(Math.round), "f0", f0of(y3).toFixed(1));
assert(near(f0of(y3), 240, 0.02), "f0 doubles: " + f0of(y3)); assert(near(p3[0], 730, 0.12), "F1 stays put: " + p3[0]); assert(Math.abs(y3.length / x.length - 1) < 0.01, "duration kept: " + y3.length);

// 6. linked (tape-speed) mode drags the formants with the pitch
const y4 = M.morph(x, sr, { semis: 12, linked: true }), p4 = peaks(y4); console.log("linked +12", p4.map(Math.round), "f0", f0of(y4).toFixed(1));
assert(near(f0of(y4), 240, 0.02) && near(p4[0], 1460, 0.12), "linked mode moves formants with pitch: " + p4[0]);

// 7. level kept, no clipping, finite
for (const y of [y1, y2, y3, y4]) { let pk = 0, r = 0; for (const v of y) { assert(isFinite(v)); pk = Math.max(pk, Math.abs(v)); r += v * v; } assert(pk <= 0.951); const ri = x.reduce((s, v) => s + v * v, 0); assert(Math.abs(10 * Math.log10(r / ri)) < 1.5, "level matched"); }

// 8. cues: wander modulates the formants over time, breath adds high-frequency noise, both leave pitch alone
const y5 = M.morph(x, sr, { wander: 1 }); const q = [y5.subarray(0, 44100), y5.subarray(44100)].map((s) => peaks(Float32Array.from(s))[0]); console.log("wander F1 first/second second", q.map(Math.round));
const y6 = M.morph(x, sr, { breath: 1 });
const hf = (s) => { let a = 0, b = 0; for (let i = 1; i < s.length; i++) { const dd = s[i] - s[i - 1]; a += dd * dd; b += s[i] * s[i]; } return a / b; };
assert(hf(y6) > hf(x) * 1.3, "breath adds high-frequency content: " + hf(y6) / hf(x)); assert(near(f0of(y6), 120, 0.01));
// wander: F1 track varies across short windows by several percent
const win = []; for (let s0 = 0; s0 + 8192 <= y5.length; s0 += 8192) win.push(peaks(Float32Array.from(y5.subarray(s0, s0 + 8192)))[0]);
const sp = (Math.max(...win) - Math.min(...win)) / 730; console.log("wander F1 spread across windows", (sp * 100).toFixed(1) + "%"); assert(sp > 0.03, "wander moves the formant over time");
console.log("morph dsp tests ok");
