/* Phase Vocoder Studio: STFT phase vocoder DSP, pure JS (Node and browser). */
(function (g) {
  "use strict";
  const plans = {};
  function plan(N) {
    if (plans[N]) return plans[N];
    const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), rev = new Uint32Array(N);
    for (let k = 0; k < N / 2; k++) { cos[k] = Math.cos((2 * Math.PI * k) / N); sin[k] = -Math.sin((2 * Math.PI * k) / N); }
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    return (plans[N] = { cos, sin, rev });
  }
  function fft(re, im, inverse) {
    const N = re.length, p = plan(N), rev = p.rev;
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1, step = N / len;
      for (let i = 0; i < N; i += len) for (let k = 0; k < half; k++) {
        const wr = p.cos[k * step], wi = inverse ? -p.sin[k * step] : p.sin[k * step], a = i + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    if (inverse) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
  }
  const hann = (N) => { const w = new Float64Array(N); for (let n = 0; n < N; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N); return w; };
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

  /**
   * Time-scale modification. alpha > 1 lengthens. opt: {N, alpha, lock:'none'|'identity', Hs}
   * Analysis hop Ha = Hs/alpha (rounded per frame). Synthesis hop Hs = N/4 by default.
   * lock 'identity': Laroche and Dolson (1999) identity phase locking: peaks propagate by instantaneous frequency,
   * every other bin in a peak's region of influence is rotated by the same angle as its peak.
   */
  function stretch(x, opt) {
    const N = opt.N || 2048, alpha = opt.alpha, lock = opt.lock === "identity", Hs = opt.Hs || N / 4, Ha = Hs / alpha, L = x.length;
    const xp = new Float64Array(L + 2 * N); for (let i = 0; i < L; i++) xp[N + i] = x[i];
    const starts = []; for (let m = 0; ; m++) { const s = Math.round(m * Ha); if (s >= L + N) break; starts.push(s); }
    const M = starts.length, outLen = (M - 1) * Hs + N, out = new Float64Array(outLen), den = new Float64Array(outLen);
    const w = hann(N), K = N / 2 + 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    const wk = new Float64Array(K); for (let k = 0; k < K; k++) wk[k] = (2 * Math.PI * k) / N;
    // m0: first frame that lies fully inside the signal. Phases are seeded there so neighbouring bins start coherent,
    // then propagated backwards over the earlier frames (which overlap the zero padding) and forwards from m0.
    let m0 = 0; while (m0 < M - 1 && starts[m0] < N) m0++;
    const analyze = (m, mag, ph) => {
      const s = starts[m];
      for (let n = 0; n < N; n++) { re[n] = xp[s + n] * w[n]; im[n] = 0; }
      fft(re, im, false);
      for (let k = 0; k < K; k++) { mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); }
    };
    const emit = (m, mag, syn) => {
      for (let k = 0; k < K; k++) { re[k] = mag[k] * Math.cos(syn[k]); im[k] = mag[k] * Math.sin(syn[k]); }
      im[0] = 0; im[N / 2] = 0;
      for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      fft(re, im, true);
      const o = m * Hs;
      for (let n = 0; n < N; n++) { out[o + n] += re[n] * w[n]; den[o + n] += w[n] * w[n]; }
    };
    const newA = () => new Float64Array(K);
    const pre = []; for (let m = 0; m <= m0; m++) { const mag = newA(), ph = newA(); analyze(m, mag, ph); pre.push({ mag, ph, syn: newA() }); }
    pre[m0].syn.set(pre[m0].ph);
    for (let m = m0 - 1; m >= 0; m--) {
      const ha = starts[m + 1] - starts[m], A = pre[m], B = pre[m + 1];
      for (let k = 0; k < K; k++) { const d = wrap(B.ph[k] - A.ph[k] - wk[k] * ha); A.syn[k] = B.syn[k] - Hs * (wk[k] + d / ha); }
    }
    for (let m = 0; m < m0; m++) emit(m, pre[m].mag, pre[m].syn);
    const prevMag = Float64Array.from(pre[m0].mag), prevAna = Float64Array.from(pre[m0].ph), prevSyn = Float64Array.from(pre[m0].syn);
    emit(m0, pre[m0].mag, pre[m0].syn);
    const mag = newA(), ph = newA(), syn = newA(), winst = newA();
    let prevPeaks = [];
    for (let m = m0 + 1; m < M; m++) {
      analyze(m, mag, ph);
      const ha = starts[m] - starts[m - 1];
      for (let k = 0; k < K; k++) { const d = wrap(ph[k] - prevAna[k] - wk[k] * ha); winst[k] = wk[k] + d / ha; }
      let peaks = [];
      if (lock) for (let k = 2; k < K - 2; k++) { const v = mag[k]; if (v > mag[k - 1] && v > mag[k - 2] && v > mag[k + 1] && v > mag[k + 2]) peaks.push(k); }
      if (!lock || peaks.length === 0) { for (let k = 0; k < K; k++) syn[k] = prevMag[k] < 0.01 * mag[k] ? ph[k] : prevSyn[k] + Hs * winst[k]; prevPeaks = []; }
      else {
        let qi = 0, pi = 0;
        const bounds = []; for (let i = 0; i < peaks.length - 1; i++) bounds.push((peaks[i] + peaks[i + 1]) >> 1);
        const theta = new Float64Array(peaks.length);
        for (let i = 0; i < peaks.length; i++) {
          const p = peaks[i]; let q = p;
          if (prevPeaks.length) { while (qi + 1 < prevPeaks.length && Math.abs(prevPeaks[qi + 1] - p) <= Math.abs(prevPeaks[qi] - p)) qi++; q = prevPeaks[qi]; }
          theta[i] = (!prevPeaks.length || prevMag[p] < 0.01 * mag[p]) ? 0 : prevSyn[q] + Hs * winst[p] - ph[p]; // a peak that was silent before starts from its own analysis phase
        }
        for (let k = 0; k < K; k++) { while (pi < bounds.length && k > bounds[pi]) pi++; syn[k] = ph[k] + theta[pi]; }
        prevPeaks = peaks;
      }
      for (let k = 0; k < K; k++) { prevAna[k] = ph[k]; prevSyn[k] = syn[k]; prevMag[k] = mag[k]; }
      emit(m, mag, syn);
    }
    const n = Math.round(L * alpha), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { const j = N + i; y[i] = j < outLen ? out[j] / Math.max(den[j], 1e-3) : 0; }
    return y;
  }

  /** Windowed-sinc resampler. ratio > 1 reads faster (raises pitch, shortens), band-limited to avoid aliasing. */
  function resample(x, ratio) {
    const L = x.length, n = Math.floor((L - 1) / ratio) + 1, out = new Float32Array(n), c = Math.min(1, 1 / ratio), hw = Math.ceil(12 / c);
    for (let i = 0; i < n; i++) {
      const t = i * ratio, i0 = Math.floor(t); let acc = 0;
      for (let k = i0 - hw + 1; k <= i0 + hw; k++) {
        if (k < 0 || k >= L) continue;
        const d = t - k, u = Math.PI * d * c, s = u === 0 ? 1 : Math.sin(u) / u;
        const wv = 0.42 + 0.5 * Math.cos((Math.PI * d) / hw) + 0.08 * Math.cos((2 * Math.PI * d) / hw);
        acc += x[k] * s * c * wv;
      }
      out[i] = acc;
    }
    return out;
  }

  /** stretchFactor: duration multiplier. semis: pitch shift in semitones. Duration = stretchFactor * input. */
  function process(x, opt) {
    const r = Math.pow(2, (opt.semis || 0) / 12), s = opt.stretch || 1;
    const bypass = Math.abs(r - 1) < 1e-9 && Math.abs(s - 1) < 1e-9;
    if (bypass && opt.skipIdentity) return Float32Array.from(x);
    let y = stretch(x, { N: opt.N, alpha: s * r, lock: opt.lock });
    if (Math.abs(r - 1) > 1e-9) y = resample(y, r);
    return y;
  }

  /** Magnitude spectrogram in dB for display. Returns {frames, bins, db}. */
  function spectrogram(x, N, maxFrames) {
    const K = N / 2, L = x.length, w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
    const frames = Math.max(1, Math.min(maxFrames, Math.floor(Math.max(0, L - N) / (N / 8)) + 1)), hop = frames > 1 ? (L - N) / (frames - 1) : 0;
    const db = new Float32Array(frames * K);
    for (let f = 0; f < frames; f++) {
      const s = Math.floor(f * hop);
      for (let n = 0; n < N; n++) { re[n] = (x[s + n] || 0) * w[n]; im[n] = 0; }
      fft(re, im, false);
      for (let k = 0; k < K; k++) db[f * K + k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / (N / 4) + 1e-9);
    }
    return { frames, bins: K, db };
  }

  function wavEncode(samples, sr) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return buf;
  }

  g.PhaseVocoder = { fft, stretch, resample, process, spectrogram, wavEncode };
  if (typeof module !== "undefined") module.exports = g.PhaseVocoder;
})(typeof globalThis !== "undefined" ? globalThis : this);
