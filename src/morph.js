/* Voice Morph: formant (vocal-tract length) and pitch (glottal-pulse rate) changed independently. Pure JS, Node and browser. */
(function (g) {
  "use strict";
  const PV = g.PhaseVocoder || (typeof require !== "undefined" ? require("./pvoc.js") : null);
  const fft = PV.fft;
  const hann = (N) => { const w = new Float64Array(N); for (let n = 0; n < N; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N); return w; };

  /**
   * True spectral envelope of one frame (Roebel and Rodet 2005 idea): cepstral smoothing of the log magnitude,
   * iterated with A = max(log magnitude, envelope) so the envelope rides the harmonic peaks instead of sagging between them.
   * logmag: natural log magnitude, bins 0..N/2. Returns the envelope in the same units.
   */
  function trueEnvelope(logmag, N, q0, iters, work) {
    const K = N / 2 + 1, re = work.re, im = work.im, A = Float64Array.from(logmag), env = new Float64Array(K);
    const lift = work.lift;
    for (let it = 0; it <= iters; it++) {
      for (let k = 0; k < K; k++) re[k] = A[k];
      for (let k = 1; k < N / 2; k++) re[N - k] = A[k];
      im.fill(0);
      fft(re, im, true);
      for (let n = 0; n < N; n++) { const m = n <= N / 2 ? n : N - n; re[n] *= m < lift.length ? lift[m] : 0; im[n] = 0; }
      fft(re, im, false);
      for (let k = 0; k < K; k++) env[k] = re[k];
      if (it < iters) for (let k = 0; k < K; k++) A[k] = Math.max(logmag[k], env[k]);
    }
    return env;
  }
  function makeWork(N, q0) {
    const lift = new Float64Array(q0 + 1), t0 = Math.floor(q0 * 0.75);
    for (let n = 0; n <= q0; n++) lift[n] = n <= t0 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (n - t0)) / (q0 - t0));
    return { re: new Float64Array(N), im: new Float64Array(N), lift };
  }

  /**
   * Move the spectral envelope along frequency by ratioAt(t), keeping the fine (harmonic) structure and the phases.
   * ratio > 1 moves formants up (shorter vocal tract). opt: {sr, N, q0, iters, ratioAt(t seconds)}
   */
  function warpFormants(x, opt) {
    const sr = opt.sr, N = opt.N || 2048, hop = N / 4, q0 = opt.q0 || Math.round((g.__Q0 || 110) * sr / 44100), iters = opt.iters == null ? 6 : opt.iters, L = x.length, K = N / 2 + 1;
    const w = hann(N), work = makeWork(N, q0), re = new Float64Array(N), im = new Float64Array(N);
    const xp = new Float64Array(L + 2 * N); for (let i = 0; i < L; i++) xp[N + i] = x[i];
    const out = new Float64Array(L + 2 * N), den = new Float64Array(L + 2 * N), mag = new Float64Array(K), ph = new Float64Array(K), lm = new Float64Array(K);
    for (let s = 0; s < L + N; s += hop) {
      let e = 0; for (let n = 0; n < N; n++) { const v = xp[s + n] * w[n]; re[n] = v; im[n] = 0; e += v * v; }
      fft(re, im, false);
      for (let k = 0; k < K; k++) { mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); }
      if (e > 1e-10) {
        for (let k = 0; k < K; k++) lm[k] = Math.log(mag[k] + 1e-7);
        const env = trueEnvelope(lm, N, q0, iters, work), R = opt.ratioAt((s - N + N / 2) / sr);
        for (let k = 0; k < K; k++) {
          const src = k / R, i0 = Math.floor(src);
          let eo; if (i0 >= K - 1) eo = env[K - 1]; else { const fr = src - i0; eo = env[i0] * (1 - fr) + env[i0 + 1] * fr; }
          const gl = Math.max(-6.9, Math.min(3.5, eo - env[k])); mag[k] *= Math.exp(gl);
        }
      }
      for (let k = 0; k < K; k++) { re[k] = mag[k] * Math.cos(ph[k]); im[k] = mag[k] * Math.sin(ph[k]); }
      im[0] = 0; im[N / 2] = 0; for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      fft(re, im, true);
      for (let n = 0; n < N; n++) { out[s + n] += re[n] * w[n]; den[s + n] += w[n] * w[n]; }
    }
    const y = new Float32Array(L); for (let i = 0; i < L; i++) y[i] = out[N + i] / Math.max(den[N + i], 1e-3);
    return y;
  }

  /** Mean spectral envelope in dB over the louder frames, for display and tests. Returns {freqs, db}. */
  function avgEnvelope(x, sr, N) {
    N = N || 2048; const K = N / 2 + 1, w = hann(N), q0 = Math.round((g.__Q0 || 110) * sr / 44100), work = makeWork(N, q0), re = new Float64Array(N), im = new Float64Array(N), lm = new Float64Array(K);
    const hop = N / 2, frames = []; let mx = 0;
    for (let s = 0; s + N <= x.length; s += hop) { let e = 0; for (let n = 0; n < N; n++) { const v = x[s + n]; e += v * v; } frames.push([s, e]); mx = Math.max(mx, e); }
    const acc = new Float64Array(K); let cnt = 0;
    for (const [s, e] of frames) {
      if (e < 0.2 * mx) continue;
      for (let n = 0; n < N; n++) { re[n] = x[s + n] * w[n]; im[n] = 0; }
      fft(re, im, false); for (let k = 0; k < K; k++) lm[k] = Math.log(Math.hypot(re[k], im[k]) + 1e-7);
      const env = trueEnvelope(lm, N, q0, 6, work); for (let k = 0; k < K; k++) acc[k] += env[k]; cnt++;
    }
    const freqs = new Float64Array(K), db = new Float64Array(K); for (let k = 0; k < K; k++) { freqs[k] = (k * sr) / N; db[k] = (cnt ? acc[k] / cnt : 0) * 8.685889638; }
    return { freqs, db };
  }
  /** Top n local maxima of an envelope between lo and hi Hz, returned in frequency order. */
  function envPeaks(env, lo, hi, n) {
    const p = []; const { freqs, db } = env;
    for (let k = 2; k < db.length - 2; k++) if (freqs[k] >= lo && freqs[k] <= hi && db[k] > db[k - 1] && db[k] >= db[k + 1] && db[k] > db[k - 2] && db[k] >= db[k + 2]) p.push([k, db[k]]);
    p.sort((a, b) => b[1] - a[1]); return p.slice(0, n).map((q) => freqs[q[0]]).sort((a, b) => a - b);
  }

  const lfo = (t) => (Math.sin(2 * Math.PI * 0.7 * t + 1.3) + 0.6 * Math.sin(2 * Math.PI * 1.9 * t + 0.4) + 0.4 * Math.sin(2 * Math.PI * 3.1 * t + 2.2)) / 2;

  /**
   * cfg: { semis: pitch change in semitones (glottal-pulse rate), formant: ratio of formant frequencies to the original,
   *        linked: bool (formants ride with the pitch change, like playing tape faster), wander: 0..1, breath: 0..1 }
   */
  function morph(x, sr, cfg) {
    const g2 = Math.pow(2, (cfg.semis || 0) / 12), F = cfg.linked ? g2 : (cfg.formant || 1), wander = cfg.wander || 0, breath = cfg.breath || 0;
    let y = Math.abs(g2 - 1) > 1e-4 ? PV.process(x, { semis: cfg.semis, N: 2048, lock: "identity" }) : Float32Array.from(x);
    const R = F / g2; // the pitch shifter already moved the formants by g2; warp the rest of the way
    if (Math.abs(R - 1) > 1e-3 || wander > 0) y = warpFormants(y, { sr, ratioAt: (t) => R * Math.pow(2, wander * 0.12 * lfo(t)) });
    if (breath > 0) {
      let env = 0, prev = 0, s = 7777; const a = Math.exp(-1 / (0.02 * sr));
      for (let i = 0; i < y.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; const nz = s / 2147483648 - 1, hp = nz - prev; prev = nz; env = Math.max(Math.abs(y[i]), env * a); y[i] += breath * 0.3 * env * hp; }
    }
    // match level to the input, then keep clear of clipping
    let ri = 0, ro = 0, pk = 0; const n = Math.min(x.length, y.length); for (let i = 0; i < n; i++) { ri += x[i] * x[i]; ro += y[i] * y[i]; pk = Math.max(pk, Math.abs(y[i])); }
    let k = ro > 1e-12 ? Math.sqrt(ri / ro) : 1; if (pk * k > 0.95) k = 0.95 / pk; for (let i = 0; i < y.length; i++) y[i] *= k;
    return y;
  }

  g.VoiceMorph = { trueEnvelope, warpFormants, avgEnvelope, envPeaks, morph };
  if (typeof module !== "undefined") module.exports = g.VoiceMorph;
})(typeof globalThis !== "undefined" ? globalThis : this);
