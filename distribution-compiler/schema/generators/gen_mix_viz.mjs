import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bisectLeft, fx, HERE, N, round, sum } from "./_shared.mjs";

const OUT = join(HERE, "..", "field-crew-adoption-mixture.html");

const lo = 0.003, hi = 0.012;
const a = 2.0, b = 24.0;
const wA = 0.20, wB = 0.80;
const XMAX = 0.30;  // plot domain for adoption fraction

const betaPdf = (x) => (x <= 0 || x >= 1 ? 0.0 : 600.0 * Math.pow(x, a - 1) * Math.pow(1 - x, b - 1));   // 1/B(2,24)=600
const unifPdf = (x) => (lo <= x && x <= hi ? 1.0 / (hi - lo) : 0.0);
const mixPdf = (x) => wA * unifPdf(x) + wB * betaPdf(x);

// fine CDF grid
const NN = 300000;
const xs = Array.from({ length: NN + 1 }, (_, i) => i / NN);
const cdf = new Array(NN + 1).fill(0.0);
for (let i = 1; i <= NN; i++) cdf[i] = cdf[i - 1] + 0.5 * (mixPdf(xs[i]) + mixPdf(xs[i - 1])) * (1.0 / NN);
const tot = cdf[NN];
for (let i = 0; i <= NN; i++) cdf[i] = cdf[i] / tot;
function CDF(x) {
  if (x <= 0) return 0.0;
  if (x >= 1) return 1.0;
  const j = Math.trunc(x * NN), f = x * NN - j;
  return cdf[j] + f * (cdf[Math.min(j + 1, NN)] - cdf[j]);
}
function quant(p) {
  const j = bisectLeft(cdf, p);
  if (j <= 0) return 0.0;
  const x0 = xs[j - 1], x1 = xs[j], c0 = cdf[j - 1], c1 = cdf[j];
  return c1 === c0 ? x1 : x0 + (p - c0) / (c1 - c0) * (x1 - x0);
}
const mean = wA * (lo + hi) / 2 + wB * (a / (a + b));
const QS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95];
const PQ = new Map(QS.map((p) => [p, quant(p)]));

// ---------- SVG geometry ----------
// PDF panel
const PL = 66, PR = 862, PT = 54, PB = 250;     // plot box
const YCLIP = 10.0;
const px = (x) => (PL + (x / XMAX) * (PR - PL));
const pyd = (d) => (PB - (Math.min(d, YCLIP) / YCLIP) * (PB - PT));
// CDF panel
const CT = 336, CB = 560;
const pyc = (c) => (CB - c * (CB - CT));
const f1 = (x) => fx(x, 1);

// beta-body area (weighted) path
const pts = Array.from({ length: 601 }, (_, i) => i);
const X = (i) => i / 600 * XMAX;
let betaArea = `M ${f1(px(0))} ${f1(pyd(0))} `;
for (const i of pts) betaArea += `L ${f1(px(X(i)))} ${f1(pyd(wB * betaPdf(X(i))))} `;
betaArea += `L ${f1(px(XMAX))} ${f1(pyd(0))} Z`;
// beta-body outline (stroke)
const betaLine = "M " + pts.map((i) => `${f1(px(X(i)))} ${f1(pyd(wB * betaPdf(X(i))))}`).join(" L ");

// CDF curve
const cdfLine = "M " + pts.map((i) => `${f1(px(X(i)))} ${f1(pyc(CDF(X(i))))}`).join(" L ");

// x ticks
const xticks = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const pct = (x) => (x === 0 ? "0" : `${Math.round(x * 100)}%`);

const TEAL = "#0e6e78", TEALS = "#dcedee", AMBER = "#b06d12", AMBERS = "#f3e7d2";
const INK = "#151922", SLATE = "#59636f", RULE = "#e2e5ea", FAINT = "#9aa3ad";

function txt(x, y, s, size = 11, fill = SLATE, anchor = "start", weight = "400", mono = true) {
  const fam = mono ? "ui-monospace,Menlo,monospace" : "ui-sans-serif,system-ui,sans-serif";
  return `<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;
}

const svg = [];
svg.push('<svg viewBox="0 0 900 600" role="img" aria-label="The adoption_rate weighted_combination: a uniform near-zero band weighted 20 percent plus a Beta(2,24) body weighted 80 percent. Top panel shows the combined density with a tall amber spike for the non-adopter band and the teal beta body. Bottom panel shows the cumulative distribution rising 20 percent across the narrow band then following the beta S-curve to 100 percent, with p10 p50 p90 marked.">');

// ---- PDF panel ----
svg.push(txt(PL, 34, "DENSITY — the two components add up", 12, TEAL, "start", "700"));
// axes
svg.push(`<line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="${RULE}"/>`);
svg.push(`<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PB}" stroke="${RULE}"/>`);
for (const d of [0, 5, 10]) {
  const y = pyd(d); svg.push(`<line x1="${PL - 4}" y1="${f1(y)}" x2="${PL}" y2="${f1(y)}" stroke="${FAINT}"/>`);
  svg.push(txt(PL - 8, y + 3, String(d), 9, FAINT, "end"));
}
for (const xt of xticks) {
  const x = px(xt); svg.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PB + 4}" stroke="${FAINT}"/>`);
  svg.push(txt(x, PB + 16, pct(xt), 9, FAINT, "middle"));
}
svg.push(txt(((PL + PR) / 2), PB + 30, "adoption share at maturity", 9.5, SLATE, "middle"));
// beta body area + line
svg.push(`<path d="${betaArea}" fill="${TEALS}" stroke="none"/>`);
svg.push(`<path d="${betaLine}" fill="none" stroke="${TEAL}" stroke-width="2"/>`);
// band spike (clipped) amber
const bx0 = px(lo), bx1 = px(hi);
svg.push(`<rect x="${f1(bx0)}" y="${PT}" width="${f1(bx1 - bx0)}" height="${PB - PT}" fill="${AMBERS}" stroke="${AMBER}" stroke-width="1.5"/>`);
svg.push(`<path d="M ${f1((bx0 + bx1) / 2)} ${PT + 2} l -4 8 M ${f1((bx0 + bx1) / 2)} ${PT + 2} l 4 8" stroke="${AMBER}" stroke-width="1.5" fill="none"/>`);
svg.push(txt(bx1 + 8, PT + 16, "20% of the mass — a near-zero band,", 9.5, AMBER, "start", "700"));
svg.push(txt(bx1 + 8, PT + 29, "density ≈ 22 (off the top of this scale)", 9, AMBER));
svg.push(txt(px(0.075), pyd(wB * betaPdf(1 / 24)) - 8, "80% — the Beta(2,24) body", 9.5, TEAL, "middle", "700"));
// note the sum
svg.push(txt(PR, 34, "f(x) = 0.20·uniform(x) + 0.80·beta(x)", 10, SLATE, "end"));

// ---- CDF panel ----
svg.push(txt(PL, 316, "CUMULATIVE — how the mass accrues, left to right", 12, TEAL, "start", "700"));
svg.push(`<line x1="${PL}" y1="${CB}" x2="${PR}" y2="${CB}" stroke="${RULE}"/>`);
svg.push(`<line x1="${PL}" y1="${CT}" x2="${PL}" y2="${CB}" stroke="${RULE}"/>`);
for (const c of [0, 0.2, 0.5, 0.9, 1.0]) {
  const y = pyc(c);
  svg.push(`<line x1="${PL - 4}" y1="${f1(y)}" x2="${PR}" y2="${f1(y)}" stroke="${c !== 0.2 ? "#eef1f4" : "#f0e6d4"}"/>`);
  svg.push(txt(PL - 8, y + 3, `${Math.round(c * 100)}%`, 9, FAINT, "end"));
}
for (const xt of xticks) {
  const x = px(xt); svg.push(`<line x1="${f1(x)}" y1="${CB}" x2="${f1(x)}" y2="${CB + 4}" stroke="${FAINT}"/>`);
  svg.push(txt(x, CB + 16, pct(xt), 9, FAINT, "middle"));
}
// band region shade + label
svg.push(`<rect x="${f1(bx0)}" y="${CT}" width="${f1(bx1 - bx0)}" height="${CB - CT}" fill="${AMBERS}" opacity="0.7"/>`);
svg.push(txt(bx1 + 6, CT + 40, "the band lifts the curve", 9, AMBER));
svg.push(txt(bx1 + 6, CT + 52, "0 → 20% in 0.9% of width", 9, AMBER, "start", "700"));
// cdf curve
svg.push(`<path d="${cdfLine}" fill="none" stroke="${TEAL}" stroke-width="2.4"/>`);
svg.push(txt(px(0.16), pyc(CDF(0.16)) - 10, "then the Beta body carries it to 100%", 9, TEAL));
// percentile markers
for (const [p, lab] of [[0.10, "p10"], [0.50, "p50"], [0.90, "p90"]]) {
  const xq = PQ.get(p), x = px(xq), y = pyc(p);
  svg.push(`<line x1="${f1(x)}" y1="${CB}" x2="${f1(x)}" y2="${f1(y)}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3"/>`);
  svg.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="3" fill="${INK}"/>`);
  svg.push(txt(x, CB + 30, lab, 9, INK, "middle", "700"));
  svg.push(txt(x, CB + 42, `${fx(xq * 100, 1)}%`, 9, SLATE, "middle"));
}
// mean marker
const xm = px(mean); svg.push(`<line x1="${f1(xm)}" y1="${CT}" x2="${f1(xm)}" y2="${CB}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="1 3"/>`);
svg.push(txt(xm + 4, CT + 12, `mean ${fx(mean * 100, 1)}%`, 9, AMBER));
svg.push(txt(((PL + PR) / 2), CB + 30, "", 9));
svg.push("</svg>");
const SVG = svg.join("\n      ");

const rows = QS.map((p) => `<tr><td>${`p${String(Math.round(p * 100)).padStart(2, "0")}`}</td><td>${fx(PQ.get(p) * 100, 1)}%</td></tr>`).join("");

const html = `<title>field-crew::adoption_rate — how the weighted_combination combines</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--paper:#f5f6f8;--panel:#fff;--ink:#151922;--slate:#59636f;--rule:#e2e5ea;--teal:#0e6e78;--teal-soft:#e2f1f2;--amber:#b06d12;--amber-soft:#f6ecda;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  *{box-sizing:border-box} body{margin:0}
  .wrap{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.6;padding:0 0 5rem}
  .col{max-width:960px;margin:0 auto;padding:0 24px}
  header.hero{border-bottom:1px solid var(--rule);background:linear-gradient(180deg,#fbfcfd,#f5f6f8)}
  .hero-inner{padding:2.6rem 0 2rem}
  .eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;color:var(--teal);font-weight:600}
  h1{font-size:1.8rem;font-weight:800;letter-spacing:-.02em;margin:.4rem 0 0;text-wrap:balance}
  .lede{font-size:1.05rem;color:var(--slate);max-width:72ch;margin:1rem 0 0}
  h2{font-size:1.15rem;font-weight:750;margin:2.2rem 0 .3rem}
  p{margin:.6rem 0;max-width:78ch} .muted{color:var(--slate)}
  code{font-family:var(--mono);font-size:.88em;background:#eceef2;border:1px solid var(--rule);border-radius:4px;padding:.03em .34em}
  .chip{display:inline-flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.8rem;margin-right:1rem}
  .sw{width:.9em;height:.9em;border-radius:3px;display:inline-block}
  .figure{background:var(--panel);border:1px solid var(--rule);border-radius:14px;padding:14px 16px;overflow-x:auto;margin-top:1rem}
  .figure svg{display:block;min-width:840px;width:100%;height:auto}
  ol{max-width:78ch} li{margin:.35rem 0}
  table.q{border-collapse:collapse;font-family:var(--mono);font-size:.92rem;margin-top:.6rem}
  table.q td{padding:.28rem 1.2rem .28rem 0}
  table.q td:first-child{color:var(--slate)} table.q td:nth-child(2){font-weight:650;text-align:right}
  .note{background:var(--teal-soft);border:1px solid #8fc4c8;border-radius:10px;padding:.8rem 1rem;margin:1rem 0;font-size:.95rem}
  .codebox{background:#0f141b;border-radius:10px;overflow-x:auto;margin:.6rem 0}
  .codebox pre{margin:0;padding:.9rem 1.1rem;font-family:var(--mono);font-size:.78rem;line-height:1.6;color:#cdd6e0;white-space:pre-wrap;overflow-wrap:break-word}
  .codebox .cmt{color:#6b7787} .codebox .a{color:#e6b566} .codebox .b{color:#8fd0ad}
  footer{margin-top:2.5rem;border-top:1px solid var(--rule);padding-top:1.1rem;color:var(--slate);font-size:.88rem}
</style>

<div class="wrap">
<header class="hero"><div class="col hero-inner">
  <div class="eyebrow">field-crew::adoption_rate · distribution = weighted_combination</div>
  <h1>How the uniform band and the Beta body combine</h1>
  <p class="lede">A <code style="font-family:var(--mono)">weighted_combination</code> is a <b>weighted blend of two sub-distributions</b> (a mixture distribution, in the usual stats sense). Here: a near-zero <b>uniform</b> band for
  the 20% who structurally never adopt, and a <b>Beta(2,24)</b> body for the 80% who do. They combine by weight — both
  as a sampling recipe and as a sum of densities.</p>
  <div style="margin-top:1.2rem">
    <span class="chip"><span class="sw" style="background:${AMBERS};border:1.5px solid ${AMBER}"></span> uniform [0.003, 0.012] · weight 0.20</span>
    <span class="chip"><span class="sw" style="background:${TEALS};border:1.5px solid ${TEAL}"></span> Beta(2,24) · weight 0.80</span>
  </div>
</div></header>

<div class="col">

<h2>Two ways to read “combine”</h2>
<ol>
  <li><b>As a recipe (how you'd sample it).</b> Flip a weighted coin: with probability <b>0.20</b> the firm is a
  structural non-adopter — draw its share from <code>uniform(0.003, 0.012)</code> (essentially nil). With probability
  <b>0.80</b> it's an adopter — draw from <code>Beta(2, 24)</code>. One draw, one component.</li>
  <li><b>As a density (how the curves add).</b> The <code>weighted_combination</code>'s density is the <b>weighted sum</b> of the two component
  densities: <code>f(x) = 0.20·uniform(x) + 0.80·beta(x)</code>. At any x you add the two (weighted) heights — which is
  why the near-zero band shows up as a tall amber spike, and the rest is the teal Beta hump.</li>
</ol>
<div class="note">The <code>allocation</code>'s <code>constraint: "sum(components[].weight) == 1"</code> is exactly what makes
this a valid blend: 0.20 + 0.80 = 1, so no probability is created or lost — the two pieces partition all the mass.</div>

<h2>The picture</h2>
<div class="figure">
      ${SVG}
</div>
<p class="muted" style="font-size:.92rem">Top: the combined <b>density</b>. The amber band is drawn to the top of the frame
with an arrow because its true height (≈ 22) is far off this scale — that's 20% of the mass squeezed into a 0.9%-wide
sliver. Bottom: the combined <b>CDF</b>. Read it left to right: across the tiny amber band the curve jumps from 0 to 20%,
then the Beta body carries it the rest of the way to 100%. Percentiles are read straight off this curve.</p>

<h2>What falls out (the derived percentiles)</h2>
<p>Because 20% of the mass sits in the near-zero band, the bottom fifth of the distribution is essentially zero, and the
median lands inside the Beta body:</p>
<table class="q">
  <tr><td>mean</td><td>${fx(mean * 100, 1)}%</td></tr>
  ${rows}
</table>
<p class="muted" style="font-size:.92rem">These are the node's <code>debug_computed_percentiles</code> — read off this
exact distribution by Monte-Carlo/quadrature, never authored.</p>

<h2>The distribution that produced it</h2>
<div class="codebox"><pre>"distribution": {
  "kind": "weighted_combination",
  "components": [
    {
      <span class="a">"name": "structural non-adopters"</span>,
      "distribution": {
        "kind": "uniform",
        "low": 0.003,
        "high": 0.012
      },
      "weight": 0.20
    },
    {
      <span class="b">"name": "adopting body"</span>,
      "distribution": {
        "kind": "beta",
        "alpha": 2,
        "beta": 24
      },
      "weight": 0.80
    }
  ],
  "allocation": {
    "constraint": "sum(components[].weight) == 1",
    "confidence": 30
  }
}</pre></div>

<footer>
  Curves and percentiles computed directly from <code>0.20·uniform(0.003,0.012) + 0.80·Beta(2,24)</code> (numerical
  quadrature of the density, inverse-CDF for the quantiles). Mean = 0.20·${fx((lo + hi) / 2, 4)} + 0.80·${fx(a / (a + b), 4)} = ${fx(mean, 4)}.
</footer>
</div></div>
`;
writeFileSync(OUT, html);
const r4 = (x) => round(x, 4);
console.log("mean", r4(mean), "p10", r4(PQ.get(0.10)), "p50", r4(PQ.get(0.50)), "p90", r4(PQ.get(0.90)), "p95", r4(PQ.get(0.95)));
console.log("wrote", [...html].length, "bytes");
