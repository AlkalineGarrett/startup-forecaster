import { readFileSync, writeFileSync } from "node:fs";
import { data as dataPath, fx, loads } from "./_shared.mjs";

const data = loads(readFileSync(dataPath("metalog_curve.json"), "utf8"), { floats: true });
const num = (v) => +v;
const curve = data.curve.map(([x, f]) => [num(x), num(f)]), anchors = data.anchors.map(([x, f]) => [num(x), num(f)]);

const TEAL = "#0e6e78", TEALS = "#e2f1f2", STOP = "#a63a2b";
const INK = "#151922", SLATE = "#59636f", RULE = "#e2e5ea", FAINT = "#9aa3ad", MONO = "ui-monospace,Menlo,monospace";
const W = 860, H = 212, PL = 64, PR = 834, PT = 40, PB = 150;
const XMAX = 140.0;
const px = (x) => PL + (x / XMAX) * (PR - PL);
// restrict curve to plot range and get ymax
const cv = curve.filter(([x]) => x <= XMAX);
const ymax = Math.max(...cv.map(([, f]) => f)) * 1.18;
const py = (f) => PB - Math.min(f, ymax) / ymax * (PB - PT);
const f1 = (x) => fx(x, 1);
const txt = (x, y, s, size = 10.5, fill = SLATE, anchor = "start", weight = "400") =>
  `<text x="${f1(x)}" y="${f1(y)}" font-family="${MONO}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;
const area = `M ${f1(px(cv[0][0]))} ${f1(PB)} ` + cv.map(([x, f]) => `L ${f1(px(x))} ${f1(py(f))}`).join(" ") + ` L ${f1(px(cv[cv.length - 1][0]))} ${f1(PB)} Z`;
const line = "M " + cv.map(([x, f]) => `${f1(px(x))} ${f1(py(f))}`).join(" L ");
const P50 = Math.round(data.overall.p50), P90 = Math.round(data.overall.p90);
const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="A lower-semi-bounded metalog density fit to six observed paid prices (dots) up to about 140 dollars, plus a red stem at 0 dollars for the 13 percent free-tier mass; overall p05 and p10 are 0, p50 is ${P50}, p90 is ${P90}.">`];
o.push(txt(PL, 26, "metalog — six observed prices, fit to a lower-semi-bounded quantile curve (+ $0 mass)", 11.5, TEAL, "start", "700"));
o.push(`<line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="${RULE}"/>`);
for (const t of [0, 30, 60, 90, 120]) {
  const x = px(t); o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PB + 4}" stroke="${FAINT}"/>`);
  o.push(txt(x, PB + 16, `$${t}`, 9, FAINT, "middle"));
}
o.push(txt((PL + PR) / 2, PB + 34, "monthly list price ($)", 9.5, SLATE, "middle"));
o.push(`<path d="${area}" fill="${TEALS}"/>`);
o.push(`<path d="${line}" fill="none" stroke="${TEAL}" stroke-width="2"/>`);
// $0 mass stem (red)
const x0 = px(0); o.push(`<line x1="${f1(x0)}" y1="${PB}" x2="${f1(x0)}" y2="${PT + 14}" stroke="${STOP}" stroke-width="6" stroke-linecap="round"/>`);
o.push(`<circle cx="${f1(x0)}" cy="${PT + 14}" r="4.5" fill="${STOP}"/>`);
o.push(txt(x0 + 9, PT + 14, "$0 · mass 13% (free tier)", 9.5, STOP, "start", "700"));
// anchor dots on the curve
for (const [xp, f] of anchors) o.push(`<circle cx="${f1(px(xp))}" cy="${f1(py(f))}" r="3.4" fill="${INK}" stroke="#fff" stroke-width="1.5"/>`);
const last = anchors[anchors.length - 1];
o.push(txt(px(last[0]) + 2, py(last[1]) - 8, "the 6 observed prices", 9, INK));
// percentile markers p50, p90 (overall)
for (const [lab, val] of [["p50", num(data.overall.p50)], ["p90", num(data.overall.p90)]]) {
  const x = px(val); o.push(`<line x1="${f1(x)}" y1="${PB}" x2="${f1(x)}" y2="${PT}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>`);
  o.push(txt(x, PB + 30, lab, 8.5, INK, "middle", "700"));
  o.push(txt(x, PB + 41, `$${Math.round(val)}`, 8.5, SLATE, "middle"));
}
o.push("</svg>");
const svg = o.join("\n      ");
const FIG = '  <div class="figure">\n      ' + svg + `\n    <p class="figcap">The six paid prices (ink dots) sit at their rank-percentiles on a lower-semi-bounded metalog (teal); the red stem is the 13% free-tier <b>mass</b> at $0. Because that mass fills the bottom 13%, the overall <span class="mono">p05 = p10 = $0</span>, then <span class="mono">p50/p90 = $${P50} / $${P90}</span> — all read off the two-part fit.</p>\n  </div>`;

writeFileSync(dataPath("metalog_figure.html"), FIG);
console.log("figure built; overall:", JSON.stringify(data.overall), "mean", JSON.stringify(data.mean));
