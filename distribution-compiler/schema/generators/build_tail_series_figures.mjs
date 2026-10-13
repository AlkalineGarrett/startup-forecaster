import { readFileSync, writeFileSync } from "node:fs";
import { commas, data, fx, loads, N } from "./_shared.mjs";

const gpd = loads(readFileSync(data("gpd_curve.json"), "utf8")), ts = loads(readFileSync(data("ts_curve.json"), "utf8"));
const TEAL = "#0e6e78", TEALS = "#e2f1f2", AMBER = "#b06d12", INK = "#151922", SLATE = "#59636f", RULE = "#e2e5ea", FAINT = "#9aa3ad", MONO = "ui-monospace,Menlo,monospace";
const f1 = (x) => fx(x, 1);
const txt = (x, y, s, size = 10.5, fill = SLATE, anchor = "start", weight = "400") =>
  `<text x="${f1(x)}" y="${f1(y)}" font-family="${MONO}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;

// ---------------- GPD graph (log-x density) ----------------
const W = 860, H = 224, PL = 64, PR = 834, PT = 42, PB = 158;
const lx = (x) => PL + Math.log10(x) / 6.0 * (PR - PL);   // x in [1,1e6]
const body = gpd.body.filter(([x]) => x >= 1);
const spl = gpd.splice.filter(([x]) => x >= 1);
const ymax = Math.max(Math.max(...body.map(([, v]) => v)), Math.max(...spl.map(([, v]) => v))) * 1.12;
const py = (v) => PB - Math.min(v, ymax) / ymax * (PB - PT);
const path = (pts) => "M " + pts.map(([x, v]) => `${f1(lx(x))} ${f1(py(v))}`).join(" L ");
const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="A log-x density of daily new installs. A lognormal body peaks near 20 per day; a dashed line shows the body tail dying by ~2000, while the solid spliced Generalized Pareto tail carries much heavier to ~347000 per day at p99.99. Threshold at the body p90 (400). Mean 815 per day, 41 times the median.">`];
o.push(txt(PL, 26, "lognormal body + Generalized Pareto tail — the mean demands the heavy tail", 11.5, TEAL, "start", "700"));
o.push(`<line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="${RULE}"/>`);
for (let e = 0; e < 7; e++) {
  const x = PL + e / 6.0 * (PR - PL), lab = ["1", "10", "100", "1k", "10k", "100k", "1M"][e];
  o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PB + 4}" stroke="${FAINT}"/>`);
  o.push(txt(x, PB + 16, lab, 9, FAINT, "middle"));
}
o.push(txt((PL + PR) / 2, PB + 34, "new installs per day (log scale)", 9.5, SLATE, "middle"));
o.push(`<path d="${path(spl)} L ${f1(lx(spl[spl.length - 1][0]))} ${f1(PB)} L ${f1(lx(spl[0][0]))} ${f1(PB)} Z" fill="${TEALS}"/>`);
o.push(`<path d="${path(spl)}" fill="none" stroke="${TEAL}" stroke-width="2.2"/>`);
o.push(`<path d="${path(body)}" fill="none" stroke="${SLATE}" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.85"/>`);
// threshold
const xt = lx(gpd.xstar); o.push(`<line x1="${f1(xt)}" y1="${PT}" x2="${f1(xt)}" y2="${PB}" stroke="${AMBER}" stroke-width="1.3" stroke-dasharray="5 3"/>`);
o.push(txt(xt + 5, PT + 11, "splice at p90 (~400/day)", 9, AMBER));
// percentile marks
for (const [lab, val] of [["p50", 20], ["p99", gpd.q.p99], ["p99.9", gpd.q["p99.9"]], ["p99.99", gpd.q["p99.99"]]]) {
  const x = lx(val); o.push(`<line x1="${f1(x)}" y1="${PT}" x2="${f1(x)}" y2="${PB}" stroke="${INK}" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>`);
  o.push(txt(x, PB + 30, lab, 8.5, INK, "middle", "700"));
  o.push(txt(x, PB + 41, val < 1000 ? fx(val, 0) : `${fx(val / 1000, 0)}k`, 8.5, SLATE, "middle"));
}
o.push(txt(PR, 26, "the body alone (dashed) dies; ξ=0.927, mean 815/day = 41× median", 9, SLATE, "end"));
o.push("</svg>");
const GPD_FIG = '  <div class="figure">\n      ' + o.join("\n      ") + '\n    <p class="figcap">The lognormal body (peak ~20/day) fits the quiet-app regime; the <b>dashed</b> line is the body\'s own tail — it dies by ~2,000/day. The archived <b>mean</b> (41× the median) demands the <b>solid</b> Generalized Pareto tail, which carries the rare viral launches: <span class="mono">p99.9 ≈ 41k</span>, <span class="mono">p99.99 ≈ 347k/day</span>. Shape ξ solved from the mean, scale slope-matched at the splice — no hard cap.</p>\n  </div>';

// ---------------- Time-series graph ----------------
const W2 = 860, H2 = 196, QL = 66, QR = 834, QT = 40, QB = 146;
const yrs = [2019, 2026], ylo = 12800, yhi = 15600;
const qx = (y) => QL + (y - yrs[0]) / (yrs[1] - yrs[0]) * (QR - QL);
const qy = (v) => QB - (v - ylo) / (yhi - ylo) * (QB - QT);
const o2 = [`<svg viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Registered small field-service firms 2019 to 2023 as four rising points from ${Math.trunc(ts.points[0][1])} to ${Math.trunc(ts.points[ts.points.length - 1][1])}, then a dashed CAGR extrapolation to ${Math.trunc(ts.extrapolated)} in ${Math.trunc(ts.target)}.">`];
o2.push(txt(QL, 26, "measure.series → extrapolate_cagr — a dated source, carried forward", 11.5, TEAL, "start", "700"));
o2.push(`<line x1="${QL}" y1="${QB}" x2="${QR}" y2="${QB}" stroke="${RULE}"/>`);
for (const yv of [13000, 13500, 14000, 14500, 15000, 15500]) {
  const y = qy(yv); o2.push(`<line x1="${QL}" y1="${f1(y)}" x2="${QR}" y2="${f1(y)}" stroke="#eef1f4"/>`);
  o2.push(txt(QL - 8, y + 3, commas(yv), 8.5, FAINT, "end"));
}
for (let yr = 2019; yr < 2027; yr++) { const x = qx(yr); o2.push(txt(x, QB + 15, String(yr), 8.5, FAINT, "middle")); }
// observed line + points
const pts = ts.points;
o2.push('<path d="M ' + pts.map(([y, v]) => `${f1(qx(y))} ${f1(qy(v))}`).join(" L ") + `" fill="none" stroke="${TEAL}" stroke-width="2.2"/>`);
for (const [y, v] of pts) {
  o2.push(`<circle cx="${f1(qx(y))}" cy="${f1(qy(v))}" r="3.6" fill="${INK}" stroke="#fff" stroke-width="1.5"/>`);
  o2.push(txt(qx(y), qy(v) - 9, commas(v), 8.5, INK, "middle", "700"));
}
// extrapolation dashed
const [ly, lv] = pts[pts.length - 1], ty = ts.target, tv = ts.extrapolated;
o2.push(`<line x1="${f1(qx(ly))}" y1="${f1(qy(lv))}" x2="${f1(qx(ty))}" y2="${f1(qy(tv))}" stroke="${AMBER}" stroke-width="2" stroke-dasharray="5 3"/>`);
o2.push(`<circle cx="${f1(qx(ty))}" cy="${f1(qy(tv))}" r="4" fill="none" stroke="${AMBER}" stroke-width="2"/>`);
o2.push(txt(qx(ty), qy(tv) - 10, commas(tv), 9, AMBER, "middle", "700"));
o2.push(txt(qx(ty), qy(tv) + 16, "extrapolate_cagr", 8.5, AMBER, "middle"));
o2.push(txt(QL + 6, QT + 12, `CAGR ${fx(ts.cagr * 100, 1)}%/yr (2019→2023)`, 9, SLATE));
o2.push("</svg>");
const TS_FIG = '  <div class="figure">\n      ' + o2.join("\n      ") + `\n    <p class="figcap">The four observed counts are a <span class="mono">measure.series</span>; <span class="mono">extrapolate_cagr(series, 2026)</span> reads their ${fx(ts.cagr * 100, 1)}%/yr trend and carries it three years past the 2023 latest to <b>~${commas(ts.extrapolated)}</b> — a <span class="mono">computed_value</span> whose formula is auditable, not a hand-typed projection.</p>\n  </div>`;

writeFileSync(data("gpd_fig.html"), GPD_FIG);
writeFileSync(data("ts_fig.html"), TS_FIG);
console.log("figures built. gpd text elems ok, ts ok.");
