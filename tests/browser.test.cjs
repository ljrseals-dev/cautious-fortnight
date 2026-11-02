const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const file = process.argv[2] || path.join(__dirname, "../index.html"), shots = path.join(__dirname, "..");
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(fs.readFileSync(file)); });
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, colorScheme: "dark" })).newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_|fonts\./.test(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__vm && window.__vm.ready() >= 1, null, { timeout: 120000 });

  const R = await page.evaluate(async () => {
    const { S, C, E, morphNow, buildCfg } = window.__vm, SR = 44100, out = {};
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
    const med = (a) => { const s = Array.from(a).sort((x, y) => x - y); return s[s.length >> 1]; };
    const fftI = (re, im) => { const N = re.length; for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } } for (let len = 2; len <= N; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = i + k, b = a + len / 2, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } } };
    // spectral envelope centroid from a 14th-order linear-prediction fit, 150-5000 Hz, 46 ms frames
    const lpcCentroid = (x, t0, t1) => { const N = 2048, P = 14, cs = []; for (let s = Math.floor(t0 * SR); s + N < Math.floor(t1 * SR); s += 882) {
        const w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = (x[s + i] - 0.97 * (x[s + i - 1] || 0)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1)));
        const r = new Float64Array(P + 1); for (let k = 0; k <= P; k++) { let a = 0; for (let i = k; i < N; i++) a += w[i] * w[i - k]; r[k] = a; } r[0] *= 1.0001; if (r[0] < 1e-9) continue;
        const A = new Float64Array(P + 1); A[0] = 1; let e = r[0]; for (let i = 1; i <= P; i++) { let acc = r[i]; for (let j = 1; j < i; j++) acc += A[j] * r[i - j]; const k = -acc / e, T = A.slice(); for (let j = 1; j < i; j++) A[j] = T[j] + k * T[i - j]; A[i] = k; e *= 1 - k * k; }
        let num = 0, den = 0; for (let f = 150; f <= 5000; f += 25) { let re = 0, im = 0; for (let k = 0; k <= P; k++) { re += A[k] * Math.cos(2 * Math.PI * f * k / SR); im -= A[k] * Math.sin(2 * Math.PI * f * k / SR); } const p = 1 / (re * re + im * im); num += f * p; den += p; }
        cs.push(num / den); } return cs; };
    // LPC envelope in dB on a log-frequency grid (150-6000 Hz, 160 points), then the octave shift that best aligns one envelope with another
    const GRID = 160, lpcEnv = (x, tc) => { const N = 2048, P = 14, s = Math.floor(tc * SR) - N / 2, w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = (x[s + i] - 0.97 * (x[s + i - 1] || 0)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1)));
      const r = new Float64Array(P + 1); for (let k = 0; k <= P; k++) { let a = 0; for (let i = k; i < N; i++) a += w[i] * w[i - k]; r[k] = a; } r[0] *= 1.0001;
      const A = new Float64Array(P + 1); A[0] = 1; let e = r[0]; for (let i = 1; i <= P; i++) { let acc = r[i]; for (let j = 1; j < i; j++) acc += A[j] * r[i - j]; const k = -acc / e, T = A.slice(); for (let j = 1; j < i; j++) A[j] = T[j] + k * T[i - j]; A[i] = k; e *= 1 - k * k; }
      const env = new Float64Array(GRID); for (let g = 0; g < GRID; g++) { const f = 150 * Math.pow(40, g / (GRID - 1)); let re = 0, im = 0; for (let k = 0; k <= P; k++) { re += A[k] * Math.cos(2 * Math.PI * f * k / SR); im -= A[k] * Math.sin(2 * Math.PI * f * k / SR); } env[g] = -10 * Math.log10(re * re + im * im); }
      // remove the overall spectral slope (the carrier's tilt) so only the formant structure is compared
      let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let g = 0; g < GRID; g++) { sx += g; sy += env[g]; sxx += g * g; sxy += g * env[g]; } const sl = (GRID * sxy - sx * sy) / (GRID * sxx - sx * sx), ic = (sy - sl * sx) / GRID;
      for (let g = 0; g < GRID; g++) env[g] -= sl * g + ic; return env; };
    const OCT_PER_PT = Math.log2(40) / (GRID - 1);
    const envShift = (ref, x, wins) => { const sc = new Float64Array(121); wins.forEach(([t0, t1]) => { for (const tc of [t0, (t0 + t1) / 2, t1]) { const a = lpcEnv(ref, tc), b = lpcEnv(x, tc); for (let k = -60; k <= 60; k++) { let c = 0, n = 0; for (let g = 0; g < GRID; g++) { const h = g - k; if (h < 0 || h >= GRID) continue; c += b[g] * a[h]; n++; } sc[k + 60] += c / Math.max(n, 40); } } });
      let bk = 0, bv = -1e30; for (let k = -60; k <= 60; k++) if (sc[k + 60] > bv) { bv = sc[k + 60]; bk = k; } return bk * OCT_PER_PT; };
    // periodicity at an expected f0: best normalized-autocorrelation lag within +-6 percent, with parabolic refinement. Returns {f0, r}.
    const f0At = (x, tc, f0exp) => { const N = 1764, s0 = Math.floor(tc * SR) - (N >> 1), lo = Math.floor(SR / (f0exp * 1.06)), hi = Math.ceil(SR / (f0exp * 0.94)), r = {}; let best = -2, bl = lo;
      let e0 = 0; for (let i = 0; i < N; i++) e0 += (x[s0 + i] || 0) ** 2;
      for (let l = lo - 1; l <= hi + 1; l++) { let c = 0, el = 0; for (let i = 0; i < N; i++) { c += (x[s0 + i] || 0) * (x[s0 + i + l] || 0); el += (x[s0 + i + l] || 0) ** 2; } r[l] = c / Math.sqrt(e0 * el + 1e-20); if (l >= lo && l <= hi && r[l] > best) { best = r[l]; bl = l; } }
      const a = r[bl - 1], b = r[bl], c2 = r[bl + 1], den = a - 2 * b + c2, off = den ? 0.5 * (a - c2) / den : 0; return { f0: SR / (bl + off), r: best }; };
    let again0; const base = Object.assign({}, morphNow(), { formSt: 0, semis: 0, mono: false, drift: false, vib: false, wander: false, breath: false, carrier: "buzz" });
    const make = (over, pitch) => buildCfg(Object.assign({}, base, over), pitch || S.pitch);
    const render = async (over, buf, pitch) => { const b = make(over, pitch); return E.render(buf || S.buf, b.pitch, b.cfg); };
    // stable vowel windows of the demo phrase: i, a, u, e, o
    const VOW = [[0.3, 0.58], [0.85, 1.2], [1.48, 1.78], [2.05, 2.28], [2.42, 2.82]];
    const vowelCent = (b) => mean(VOW.map(([a, c]) => mean(lpcCentroid(b.getChannelData(0), a, c))));
    const n0 = await render({}), up = await render({ formSt: 6 }), dn = await render({ formSt: -6 });
    const cN = vowelCent(n0), cU = vowelCent(up), cD = vowelCent(dn);
    // pitch preserved: periodicity at the commanded f0 in vowel frames
    const frames = []; VOW.forEach(([a, c]) => { for (let t = a + 0.03; t < c - 0.03; t += 0.04) frames.push(t); });
    const offCents = (b, over, expectMul) => { const x = b.getChannelData(0), m = make(over).pitch, d = [], rr = []; frames.forEach((t) => { const fi = Math.round(t / S.pitch.hop), exp = m.f0[fi] * expectMul; if (!S.pitch.voiced[fi]) return; const p = f0At(x, t, exp); d.push(1200 * Math.log2(p.f0 / exp)); rr.push(p.r); }); return { med: med(d), sd: sd(d), r: med(rr), n: d.length }; };
    const W = [[0.34, 0.54], [0.9, 1.15], [1.5, 1.75], [2.1, 2.25], [2.45, 2.8]], xN = n0.getChannelData(0);
    out.formant = { shiftUp: envShift(xN, up.getChannelData(0), W), shiftDn: envShift(xN, dn.getChannelData(0), W), shiftNone: envShift(xN, again0 = (await render({})).getChannelData(0), W), cN, cU, cD, ratioUp: cU / cN, ratioDn: cD / cN, upPitch: offCents(up, { formSt: 6 }, 1), dnPitch: offCents(dn, { formSt: -6 }, 1) };
    const p12 = await render({ semis: 12 }), pm7 = await render({ semis: -7 });
    out.pitch = { up12: offCents(p12, { semis: 12 }, 2), dn7: offCents(pm7, { semis: -7 }, Math.pow(2, -7 / 12)), cRatio12: vowelCent(p12) / cN, cRatioDn: vowelCent(pm7) / cN };
    const again = await render({ formSt: 6 }); let md = 0; { const a = up.getChannelData(0), b = again.getChannelData(0); for (let i = 0; i < a.length; i++) md = Math.max(md, Math.abs(a[i] - b[i])); } out.det = md;
    // output follows the commanded pitch including the drift cue; and the clean render does not wobble
    const dr = await render({ drift: true });
    const dev = (b, over) => { const x = b.getChannelData(0), clean = make({}).pitch, d = []; frames.forEach((t) => { const fi = Math.round(t / S.pitch.hop); if (!S.pitch.voiced[fi]) return; d.push(1200 * Math.log2(f0At(x, t, clean.f0[fi]).f0 / clean.f0[fi])); }); return sd(d); };
    out.drift = { sdOn: dev(dr), sdOff: dev(n0) };
    // held vowel for vibrato, wander, breath
    const hb = await (() => { const len = SR * 4, oc = new OfflineAudioContext(1, len, SR); const o = oc.createOscillator(); o.type = "sawtooth"; o.frequency.value = 120; o.start(0); [730, 1090, 2440].forEach((f, k) => { const b = oc.createBiquadFilter(); b.type = "bandpass"; b.frequency.value = f; b.Q.value = [8, 10, 12][k]; const g = oc.createGain(); g.gain.value = [1, 0.6, 0.3][k]; o.connect(b); b.connect(g); g.connect(oc.destination); }); return oc.startRendering(); })();
    { const d = hb.getChannelData(0); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); for (let i = 0; i < d.length; i++) d[i] *= 0.7 / m; }
    const hp = C.trackPitch(hb.getChannelData(0), SR), hold = (over) => render(over, hb, hp);
    const h0 = await hold({}), hv = await hold({ vib: true }), hw = await hold({ wander: true }), hbr = await hold({ breath: true });
    const vibAmp = (b) => { const x = b.getChannelData(0), c = []; for (let t = 0.6; t < 3.6; t += 0.01) c.push(1200 * Math.log2(f0At(x, t, 120).f0 / 120)); const m = mean(c); let re = 0, im = 0; c.forEach((v, i) => { re += (v - m) * Math.cos(2 * Math.PI * 5.4 * i * 0.01); im += (v - m) * Math.sin(2 * Math.PI * 5.4 * i * 0.01); }); return (2 * Math.hypot(re, im)) / c.length; };
    out.vib = { on: vibAmp(hv), off: vibAmp(h0) };
    const slow = (a) => a.map((_, i) => mean(a.slice(Math.max(0, i - 2), i + 3)));
    const cs0 = slow(lpcCentroid(h0.getChannelData(0), 0.6, 3.6)), csw = slow(lpcCentroid(hw.getChannelData(0), 0.6, 3.6)); out.wander = { sdOn: sd(csw) / mean(csw), sdOff: sd(cs0) / mean(cs0) };
    // breath: power midway between harmonics relative to power on the harmonics
    const valley = (b) => { const x = b.getChannelData(0), N = 8192, f0 = 120; let pk = 0, va = 0, n = 0; for (let s = SR; s + N < SR * 3; s += N) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); fftI(re, im); const pw = (f) => { const k = Math.round(f * N / SR); return re[k] ** 2 + im[k] ** 2; }; for (let h = 2; h <= 20; h++) { pk += pw(h * f0); va += pw((h + 0.5) * f0); n++; } } return va / pk; };
    out.breath = { on: valley(hbr), off: valley(h0) };
    // end-to-end warp: a single resonance (noise through a band-pass at 1000 Hz) through the whisper carrier. The output peak should sit at 1000 x warp.
    const oc1 = new OfflineAudioContext(1, SR * 3, SR), nb1 = oc1.createBuffer(1, SR * 3, SR), nd = nb1.getChannelData(0); let q = 4242; for (let i = 0; i < nd.length; i++) { q = (q * 1664525 + 1013904223) >>> 0; nd[i] = q / 2147483648 - 1; }
    const ns = oc1.createBufferSource(); ns.buffer = nb1; const bp1 = oc1.createBiquadFilter(); bp1.type = "bandpass"; bp1.frequency.value = 1000; bp1.Q.value = 6; ns.connect(bp1); bp1.connect(oc1.destination); ns.start();
    const res = await oc1.startRendering(), resD = new Float32Array(res.getChannelData(0)); let mxr = 0; for (const v of resD) mxr = Math.max(mxr, Math.abs(v)); for (let i = 0; i < resD.length; i++) resD[i] *= 0.5 / mxr; const resB = new AudioBuffer({ length: resD.length, numberOfChannels: 1, sampleRate: SR }); resB.copyToChannel(resD, 0);
    const rp = C.trackPitch(resD, SR);
    const peakHz = (b) => { const x = b.getChannelData(0), N = 4096, P = new Float64Array(N / 2); for (let s = SR / 2; s + N < SR * 2.5; s += N / 2) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); fftI(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; }
      const sm = new Float64Array(N / 2); for (let k = 3; k < N / 2 - 3; k++) { let a = 0; for (let j = -3; j <= 3; j++) a += P[k + j]; sm[k] = a; } let bk = 0; for (let k = 20; k < N / 2 - 3; k++) if (sm[k] > sm[bk]) bk = k; return (bk * SR) / N; };
    out.tone = {};
    for (const st of [-6, -3, 0, 3, 6]) { const b = make({ formSt: st, carrier: "noise" }, rp); b.cfg.sibilance = 0; const o = await E.render(resB, b.pitch, b.cfg); out.tone[st] = peakHz(o); }
    // balance: fricative-to-vowel level in the output against the input (sibilance on, as shipped)
    const rms = (x, t0, t1) => { let e = 0, n = 0; for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR) && i < x.length; i++) { e += x[i] * x[i]; n++; } return Math.sqrt(e / n); };
    const FR = [[0.03, 0.17], [0.66, 0.75], [1.27, 1.37]], bal = (x) => 20 * Math.log10(mean(FR.map(([a, c]) => rms(x, a, c))) / mean(VOW.slice(0, 3).map(([a, c]) => rms(x, a, c))));
    out.balance = { inDb: bal(S.buf.getChannelData(0)), outDb: bal(n0.getChannelData(0)), voicedShare: C.trackPitch(n0.getChannelData(0), SR).voicedShare };
    return out;
  });
  console.log(JSON.stringify(R, (k, v) => typeof v === "number" ? +v.toPrecision(4) : v));
  const f = R.formant;
  assert(f.shiftUp > 0.1 && f.shiftDn < -0.1 && Math.abs(f.shiftNone) < 0.03, "vowel envelopes move the right way (this correlation metric reads about half the commanded shift): " + JSON.stringify([f.shiftUp, f.shiftNone, f.shiftDn]));
  for (const st of [-6, -3, 0, 3, 6]) { const want = 1000 * Math.pow(2, st / 12); assert(Math.abs(R.tone[st] / want - 1) < 0.06, `single resonance at 1000 Hz warped by ${st} st lands at ${want.toFixed(0)} Hz, got ${R.tone[st]}`); }
  assert(f.ratioUp > 1.1 && f.ratioDn < 1.0, "centroid agrees in direction: " + [f.ratioUp, f.ratioDn]);
  for (const k of ["upPitch", "dnPitch"]) assert(Math.abs(f[k].med) < 25 && f[k].r > 0.6, `formant shift leaves the pitch alone (${k}): ` + JSON.stringify(f[k]));
  assert(Math.abs(R.pitch.up12.med) < 25 && Math.abs(R.pitch.dn7.med) < 25 && R.pitch.up12.r > 0.6, "pitch shift lands on the commanded pitch: " + JSON.stringify(R.pitch));
  assert(Math.abs(R.pitch.cRatio12 - 1) < 0.1 && Math.abs(R.pitch.cRatioDn - 1) < 0.1, "pitch shift leaves the envelope alone: " + JSON.stringify(R.pitch));
  assert(R.det < 1e-6, "renders repeat exactly: " + R.det);
  assert(R.drift.sdOn > R.drift.sdOff * 2 && R.drift.sdOn > 6, "drift adds pitch variation: " + JSON.stringify(R.drift));
  assert(R.vib.on > 15 && R.vib.on > R.vib.off * 4, "vibrato appears at 5.4 Hz on a held vowel: " + JSON.stringify(R.vib));
  assert(R.wander.sdOn > R.wander.sdOff * 1.8 && R.wander.sdOn > 0.01, "formant wander moves the envelope over time: " + JSON.stringify(R.wander));
  assert(R.breath.on > R.breath.off * 2, "breath fills the gaps between harmonics: " + JSON.stringify(R.breath));
  assert(Math.abs(R.balance.outDb - R.balance.inDb) < 4, "fricative-to-vowel balance stays within 4 dB of the speech: " + JSON.stringify(R.balance));
  assert(R.balance.voicedShare > 0.5, "vowels stay audible against sibilance (pitch tracker still finds them): " + JSON.stringify(R.balance));

  // UI: size macro, presets, playback, screenshots
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.fill("#size", "1"); await page.dispatchEvent("#size", "input");
  const s1 = await page.evaluate(() => [document.getElementById("form").value, document.getElementById("pitch").value]); assert(+s1[0] < -5 && +s1[1] < -8, "size giant sets both: " + s1);
  await page.click("#pKid"); const s2 = await page.evaluate(() => [document.getElementById("form").value, document.getElementById("pitch").value]); assert(+s2[0] > 5 && +s2[1] > 8, "child preset: " + s2);
  const r0 = await page.evaluate(() => window.__vm.ready()); await page.waitForFunction((b) => window.__vm.ready() > b, r0, { timeout: 120000 });
  assert((await page.textContent("#hdMorph")).includes("×1.41"), "header reads the warp: " + (await page.textContent("#hdMorph")));
  await page.click("#playM"); await page.waitForTimeout(600); assert.equal(await page.getAttribute("#playM", "aria-pressed"), "true"); await page.click("#stop");
  await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, "shot-dark.png"), fullPage: true });
  const ph = await (await browser.newContext({ viewport: { width: 400, height: 900 }, colorScheme: "light" })).newPage();
  await ph.goto(`http://127.0.0.1:${server.address().port}/`); await ph.waitForFunction(() => window.__vm && window.__vm.ready() >= 1, null, { timeout: 120000 }); await ph.waitForTimeout(600);
  await ph.screenshot({ path: path.join(shots, "shot-phone.png"), fullPage: true });
  assert((await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "no horizontal overflow");
  assert.equal(errs.length, 0, errs.join("\n"));
  console.log("voice morph browser tests ok; save button:", !!(await page.$("#dl")));
  await browser.close(); server.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
