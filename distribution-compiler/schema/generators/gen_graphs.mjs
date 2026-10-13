import { writeFileSync } from "node:fs";
import { bisectLeft, commas, data, dumps, fx, N, round, sum } from "./_shared.mjs";

const TEAL = "#0e6e78", TEALS = "#e2f1f2", AMBER = "#b06d12";
const INK = "#151922", SLATE = "#59636f", RULE = "#e2e5ea", FAINT = "#9aa3ad", MONO = "ui-monospace,Menlo,monospace";

// geometry
const W = 860, H = 212;
const PL = 64, PR = 834, PT = 40, PB = 150;
const f1 = (x) => fx(x, 1);

const txt = (x, y, s, size = 10.5, fill = SLATE, anchor = "start", weight = "400") =>
  `<text x="${f1(x)}" y="${f1(y)}" font-family="${MONO}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;

function cdfPercentiles(pdf, lo, hi, ps, n = 200000) {
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
  const cdf = new Array(n + 1).fill(0.0), h = (hi - lo) / n;
  for (let i = 1; i <= n; i++) cdf[i] = cdf[i - 1] + 0.5 * (pdf(xs[i]) + pdf(xs[i - 1])) * h;
  const tot = cdf[n], cdfn = cdf.map((c) => c / tot);
  let mean = 0.0;
  for (let i = 1; i <= n; i++) mean += 0.5 * (xs[i] * pdf(xs[i]) + xs[i - 1] * pdf(xs[i - 1])) * h;
  mean /= tot;
  const out = new Map();
  for (const p of ps) {
    const j = bisectLeft(cdfn, p);
    out.set(p, j <= 0 ? lo : xs[j - 1] + (p - cdfn[j - 1]) / (cdfn[j] - cdfn[j - 1]) * (xs[j] - xs[j - 1]));
  }
  return [out, mean];
}

function densityChart(title, unitLabel, pdf, xlo, xhi, ticks, fmt, pmark, mean, ycap = null, trunc = null, aria = "") {
  const px = (x) => PL + (x - xlo) / (xhi - xlo) * (PR - PL);
  const S = Array.from({ length: 241 }, (_, i) => pdf(xlo + (xhi - xlo) * i / 240));
  const ymax = ycap ? ycap : Math.max(...S) * 1.10;
  const py = (d) => PB - Math.min(d, ymax) / ymax * (PB - PT);
  const pts = S.map((s, i) => [px(xlo + (xhi - xlo) * i / 240), py(s)]);
  const area = `M ${f1(px(xlo))} ${f1(PB)} ` + pts.map(([x, y]) => `L ${f1(x)} ${f1(y)}`).join(" ") + ` L ${f1(px(xhi))} ${f1(PB)} Z`;
  const line = "M " + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L ");
  const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`];
  o.push(txt(PL, 26, title, 11.5, TEAL, "start", "700"));
  o.push(`<line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="${RULE}"/>`);
  o.push(`<path d="${area}" fill="${TEALS}"/>`);
  o.push(`<path d="${line}" fill="none" stroke="${TEAL}" stroke-width="2"/>`);
  for (const t of ticks) {
    const x = px(t); o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PB + 4}" stroke="${FAINT}"/>`);
    o.push(txt(x, PB + 16, fmt(t), 9, FAINT, "middle"));
  }
  o.push(txt((PL + PR) / 2, PB + 34, unitLabel, 9.5, SLATE, "middle"));
  if (trunc !== null) {
    const xt = px(trunc[0]); o.push(`<line x1="${f1(xt)}" y1="${PT}" x2="${f1(xt)}" y2="${PB}" stroke="${AMBER}" stroke-width="1.4" stroke-dasharray="5 3"/>`);
    o.push(txt(xt - 6, PT + 12, trunc[1], 9, AMBER, "end"));
  }
  // mean (amber dotted)
  const xm = px(mean); o.push(`<line x1="${f1(xm)}" y1="${PT}" x2="${f1(xm)}" y2="${PB}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="1 3"/>`);
  o.push(txt(xm + 4, PT + 10, "mean " + fmt(mean), 8.5, AMBER));
  // percentile markers
  for (const [p, lab] of pmark) {
    const x = px(p);
    o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PT}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>`);
    o.push(`<circle cx="${f1(x)}" cy="${f1(py(pdf(p)))}" r="2.6" fill="${INK}"/>`);
    o.push(txt(x, PB + 30, lab, 8.5, INK, "middle", "700"));
    o.push(txt(x, PB + 41, fmt(p), 8.5, SLATE, "middle"));
  }
  o.push("</svg>");
  return o.join("\n      ");
}

const figure = (svg, cap) => `  <div class="figure">\n      ${svg}\n    <p class="figcap">${cap}</p>\n  </div>`;

// ---------- pdfs ----------
const lognormalPdf = (mu, sig) => (x) => (x <= 0 ? 0.0 : Math.exp(-((Math.log(x) - mu) * (Math.log(x) - mu)) / (2 * sig * sig)) / (x * sig * Math.sqrt(2 * Math.PI)));
function betaPdf(a, b) {
  const lnB = N.lgamma(a) + N.lgamma(b) - N.lgamma(a + b);
  return (x) => (x <= 0 || x >= 1 ? 0.0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB));
}
const normalPdf = (mu, sd) => (x) => Math.exp(-((x - mu) * (x - mu)) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));

const graphs = {};
const pct100 = (v) => (v === 0 ? "0" : `${Math.round(v * 100)}%`);

// ===== point_mass : field-crew::platform_bundling_severity =====
{
  const atoms = [[0.15, 0.15], [0.55, 0.25], [1.00, 0.45], [1.30, 0.15]], xlo = 0.0, xhi = 1.5;
  const pmMean = round(sum(atoms.map(([a, w]) => a * w)) + 1e-9, 2);   // 0.805 -> 0.81 (round half up)
  const px = (x) => PL + (x - xlo) / (xhi - xlo) * (PR - PL);
  const wmax = Math.max(...atoms.map(([, w]) => w)), py = (w) => PB - w / (wmax * 1.15) * (PB - PT);
  const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="point_mass: four weighted atoms at x=0.15,0.55,1.00,1.30 with weights 0.15,0.25,0.45,0.15; mean ${fx(pmMean, 2)}.">`];
  o.push(txt(PL, 26, "point_mass — four atoms, one allocation of mass", 11.5, TEAL, "start", "700"));
  o.push(`<line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="${RULE}"/>`);
  for (const [pos, w] of atoms) {
    const x = px(pos); o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${f1(py(w))}" stroke="${TEAL}" stroke-width="3"/>`);
    o.push(`<circle cx="${f1(x)}" cy="${f1(py(w))}" r="4.5" fill="${TEAL}"/>`);
    o.push(txt(x, py(w) - 8, `${fx(w * 100, 0)}%`, 9, TEAL, "middle", "700"));
    o.push(txt(x, PB + 16, `×${fx(pos, 2)}`, 9, FAINT, "middle"));
  }
  o.push(txt((PL + PR) / 2, PB + 34, "revenue multiplier ×", 9.5, SLATE, "middle"));
  const xm = px(pmMean); o.push(`<line x1="${f1(xm)}" y1="${PT}" x2="${f1(xm)}" y2="${PB}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="1 3"/>`);
  o.push(txt(xm + 4, PT + 10, `mean ×${fx(pmMean, 2)}`, 8.5, AMBER));
  o.push("</svg>");
  graphs["field-crew::platform_bundling_severity"] = figure(o.join("\n      "),
    `Four fixed positions, each a spike whose height is its <span class="mono">weight</span> (one <span class="mono">allocation</span>, summing to 1). The mean ×${fx(pmMean, 2)} is the derived readout — no smooth curve, the support <em>is</em> the four atoms.`);
}

// ===== lognormal : field-crew::n_crews_reachable =====
{
  const FIRMS = 14260;   // latest value of the (fictional) business-register series — see series_extrapolate.mjs
  const mu = Math.log(3400), pdf = lognormalPdf(mu, 0.5), xlo = 0.0, xhi = 15000.0;
  // truncated percentiles/mean below the firm count
  const [pmt, meant] = cdfPercentiles(pdf, 1e-6, FIRMS, [0.10, 0.50, 0.90]);
  const [q10, q50, q90] = [0.10, 0.50, 0.90].map((p) => Math.round(pmt.get(p)));
  graphs["field-crew::n_crews_reachable"] = figure(densityChart(
    "lognormal — median 3,400, σ 0.5, clipped at the firm count", "reachable field-service firms (count)",
    pdf, xlo, xhi, [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000], (v) => (v < 1000 ? fx(v, 0) : `${fx(v / 1000, 0)}k`),
    [[pmt.get(0.10), "p10"], [pmt.get(0.50), "p50"], [pmt.get(0.90), "p90"]], meant,
    null, [FIRMS, `truncation ${commas(FIRMS)}`],
    `lognormal density around a median of 3400 with a right tail, hard-clipped at the firm count ${FIRMS}; p10/p50/p90 at ${q10}/${q50}/${q90}.`),
  `A right-skewed body around the register-derived median; the <span class="mono">truncation</span> at the registered firm count (${commas(FIRMS)}) cuts the far tail. <span class="mono">p10/p50/p90 = ${commas(q10)} / ${commas(q50)} / ${commas(q90)}</span> are read straight off the curve.`);
}

// ===== weighted_combination : field-crew::adoption_rate =====
{
  const uni = (x) => (0.003 <= x && x <= 0.012 ? 1.0 / 0.009 : 0.0);
  const bpdf = betaPdf(2, 24), mix = (x) => 0.2 * uni(x) + 0.8 * bpdf(x), xlo = 0.0, xhi = 0.30;
  const [pm, mean] = cdfPercentiles(mix, 1e-6, 1.0, [0.10, 0.50, 0.90], 300000);
  const [a, b, c] = [0.10, 0.50, 0.90].map((p) => fx(pm.get(p) * 100, 1));
  graphs["field-crew::adoption_rate"] = figure(densityChart(
    "weighted_combination — 20% near-zero band + 80% Beta(2,24)", "adoption share at maturity",
    mix, xlo, xhi, [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30], pct100,
    [[pm.get(0.10), "p10"], [pm.get(0.50), "p50"], [pm.get(0.90), "p90"]], mean, 12.0, null,
    `a tall near-zero amber band holding 20 percent of the mass plus the 80 percent Beta(2,24) body; p10/p50/p90 at ${a},${b},${c} percent.`),
  `The amber near-zero band (20% of the mass, clipped here — its true density ≈ 22) plus the teal Beta body (80%). The full density + CDF is on its own page; <span class="mono">p10/p50/p90 = ${a}% / ${b}% / ${c}%</span>.`);
}

// ===== beta : field-crew::share_of_jobs_scheduled =====
{
  const pdf = betaPdf(4.5, 2.4), [pm, mean] = cdfPercentiles(pdf, 1e-6, 1 - 1e-6, [0.10, 0.50, 0.90]);
  const [a, b, c] = [0.10, 0.50, 0.90].map((p) => Math.round(pm.get(p) * 100));
  graphs["field-crew::share_of_jobs_scheduled"] = figure(densityChart(
    "beta — Beta(4.5, 2.4), left-skewed toward high capture", "share of jobs scheduled in the app",
    pdf, 0.0, 1.0, [0, 0.2, 0.4, 0.6, 0.8, 1.0], pct100,
    [[pm.get(0.10), "p10"], [pm.get(0.50), "p50"], [pm.get(0.90), "p90"]], mean, null, null,
    `Beta(4.5,2.4) density on 0 to 1, unimodal and left-skewed with the peak near 0.7; p10/p50/p90 at ${a},${b},${c} percent.`),
  `Bounded on <span class="mono">[0,1]</span> — no truncation needed. The mode sits high (α &gt; β); <span class="mono">p10/p50/p90 = ${a}% / ${b}% / ${c}%</span> are read off Beta(4.5, 2.4).`);
}

// ===== normal : habit-app::active_days_per_year =====
{
  const pdf = normalPdf(110, 41), [pm, mean] = cdfPercentiles(pdf, -50, 300, [0.10, 0.50, 0.90]);
  const [a, b, c] = [0.10, 0.50, 0.90].map((p) => Math.round(pm.get(p)));
  graphs["habit-app::active_days_per_year"] = figure(densityChart(
    "normal — Normal(110, 41), symmetric", "active days / year (retained user)",
    pdf, 0.0, 220.0, [0, 55, 110, 165, 220], (v) => String(Math.round(v)),
    [[pm.get(0.10), "p10"], [pm.get(0.50), "p50"], [pm.get(0.90), "p90"]], mean, null, null,
    `a symmetric bell centred at 110 with sd 41; p10/p50/p90 at ${a},${b},${c} days.`),
  `Symmetric, so <span class="mono">mean = p50 = 110</span>. The derived <span class="mono">p10/p90 = ${a} / ${c}</span> fall out of <span class="mono">(mean 110, sd 41)</span>; the tiny mass below zero is why a floor would go in <span class="mono">truncation</span>.`);
}

// ===== gamma : habit-app::referrals_per_user =====
{
  const k = 1.25, rate = 2.0, lg = N.lgamma(k);
  const pdf = (x) => (x <= 0 ? 0.0 : Math.exp(k * Math.log(rate) + (k - 1) * Math.log(x) - rate * x - lg));
  const [pm, mean] = cdfPercentiles(pdf, 1e-6, 8, [0.10, 0.50, 0.90]);
  const gq = [0.10, 0.50, 0.90].map((p) => fx(pm.get(p), 2));
  graphs["habit-app::referrals_per_user"] = figure(densityChart(
    "gamma — Gamma(1.25, 2.0), heavy near zero", "referred sign-ups per paying user",
    pdf, 0.0, 4.0, [0, 1, 2, 3, 4], (v) => ([0, 1, 2, 3, 4].includes(v) ? String(Math.trunc(v)) : fx(v, 1)),
    [[pm.get(0.10), "p10"], [pm.get(0.50), "p50"], [pm.get(0.90), "p90"]], mean, null, null,
    `Gamma(1.25,2.0) density on 0 to infinity, piled toward zero with a long right tail; p10/p50/p90 at ${gq.join(",")}.`),
  `Non-negative and right-skewed — most users refer no one, a minority bring several friends along the tail. <span class="mono">p10/p50/p90 = ${gq.join(" / ")}</span> come off Gamma(1.25, 2.0).`);
}

// ===== uniform : structural band =====
{
  const lo = 0.003, hi = 0.012, pdf = (x) => (lo <= x && x <= hi ? 1.0 / (hi - lo) : 0.0);
  const xlo = 0.0, xhi = 0.016;
  graphs["the structural non-adopter band"] = figure(densityChart(
    "uniform — flat over [0.003, 0.012]", "subscribe share (the near-zero band)",
    pdf, xlo, xhi, [0, 0.004, 0.008, 0.012, 0.016], (v) => (v === 0 ? "0" : `${fx(v * 100, 1)}%`),
    [[lo + 0.1 * (hi - lo), "p10"], [lo + 0.5 * (hi - lo), "p50"], [lo + 0.9 * (hi - lo), "p90"]], (lo + hi) / 2, null, null,
    "a flat rectangular density over 0.003 to 0.012; p10/p50/p90 at 0.39,0.75,1.11 percent, evenly spaced."),
  "Flat between the two grounded bounds, zero outside — the band <em>is</em> its own support. Percentiles are linear: <span class=\"mono\">p10/p50/p90 = 0.39% / 0.75% / 1.11%</span> are just positions along <span class=\"mono\">[0.003, 0.012]</span>.");
}

writeFileSync(data("graphs.json"), dumps(graphs, { ensureAscii: false }));
console.log("generated", Object.keys(graphs).length, "graphs:", Object.keys(graphs).join(", "));
