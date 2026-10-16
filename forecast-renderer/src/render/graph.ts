// SVG charts: the portfolio "spread" strips, the per-project histogram, and the
// dependency-graph diagram.
import type { Project, ProjectNode, RunResult, HistProfile } from "../../../montecarlo-engine/src/types.ts";
import { fmt, esc, curSym, inReporting } from "../../../montecarlo-engine/src/format.ts";
import { reportingCurrency, toReporting } from "../../../montecarlo-engine/src/portfolio-context.ts";

/** A shared √-scaled horizontal axis so every project's spread strip is comparable. It is in the REPORTING
 *  currency: a strip converts its venture's values (format.ts inReporting) before placing them. */
export interface Scale {
  SW: number;
  MAXV: number;
  TICKS: number[];
  SX: (v: number) => number;
}

/** Round a positive value to a "nice" axis number: 1, 2, 2.5 or 5 × a power of ten. */
function niceRound(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * e;
}

/** Axis ticks for a √ scale up to `maxv`: about four, evenly spaced on screen (k/4)² · maxv, each rounded to a
 *  nice number. */
export function sqrtTicks(maxv: number): number[] {
  if (!(maxv > 0)) return [];
  const out: number[] = [];
  for (const k of [1, 2, 3, 4]) {
    const t = niceRound(maxv * (k / 4) ** 2);
    if (t <= maxv * 1.05 && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Build the shared spread-strip scale from all projects' results, in the reporting currency. */
export function makeScale(results: Record<string, RunResult>): Scale {
  let MAXV = 0;
  for (const id in results) {
    const r = results[id];
    const rate = toReporting(r.currency);
    for (const x of [r.p80, r.mean, r.afterTax80, r.afterTaxMean]) if (Number.isFinite(x)) MAXV = Math.max(MAXV, x * rate);
  }
  const SW = 320;
  const SP = 8;
  const PLOT = SW - 2 * SP;
  const SQ = Math.sqrt(MAXV || 1);
  const SX = (v: number): number => {
    v = Math.max(v, 0);
    return SP + (Math.sqrt(v) / SQ) * PLOT;
  };
  return { SW, MAXV, TICKS: sqrtTicks(MAXV), SX };
}

/** The tick-labelled header for the overview spread column (reporting currency). */
export function axhdr(scale: Scale): string {
  const sym = reportingCurrency().symbol;
  let s = `<svg class="strip" width="${scale.SW}" height="16" viewBox="0 0 ${scale.SW} 16"><text class="axl" x="${scale.SX(0)}" y="11" text-anchor="middle">0</text>`;
  for (const t of scale.TICKS) {
    if (t <= scale.MAXV * 1.05) s += `<text class="axl" x="${scale.SX(t).toFixed(1)}" y="11" text-anchor="middle">${fmt(t, sym)}</text>`;
  }
  return s + "</svg>";
}

/** One project's P20–P80 spread strip with P20/P50/P80 dots + a mean diamond. Takes explicit values so
 *  it can plot either the revenue or the net-income view (a RunResult satisfies the shape structurally).
 *  The values are in the ambient (the venture's) currency, converted into the scale's reporting currency. */
export function stripSVG(raw: { p20: number; p50: number; p80: number; mean: number }, scale: Scale): string {
  const v = { p20: inReporting(raw.p20), p50: inReporting(raw.p50), p80: inReporting(raw.p80), mean: inReporting(raw.mean) };
  const H = 28;
  const y = 15;
  let s = `<svg class="strip" width="${scale.SW}" height="${H}" viewBox="0 0 ${scale.SW} ${H}">`;
  for (const t of scale.TICKS) {
    if (t <= scale.MAXV * 1.05) {
      const x = scale.SX(t).toFixed(1);
      s += `<line x1="${x}" y1="3" x2="${x}" y2="${H - 3}" stroke="#EBEFF3"/>`;
    }
  }
  s += `<line x1="${scale.SX(v.p20).toFixed(1)}" y1="${y}" x2="${scale.SX(v.p80).toFixed(1)}" y2="${y}" stroke="#CBD5DD" stroke-width="2"/>`;
  const dot = (val: number, c: string): string =>
    `<circle cx="${scale.SX(val).toFixed(1)}" cy="${y}" r="3.3" fill="${c}" stroke="#fff" stroke-width="1.3"/>`;
  // Mean as a diamond (rotated square) so it reads as distinct from the round percentile dots.
  const cx = scale.SX(v.mean);
  const meanMark = `<rect x="${(cx - 3.2).toFixed(1)}" y="${y - 3.2}" width="6.4" height="6.4" fill="#7a5aa8" stroke="#fff" stroke-width="1.2" transform="rotate(45 ${cx.toFixed(1)} ${y})"/>`;
  return s + dot(v.p20, "#A8483A") + dot(v.p80, "#2F7D57") + dot(v.p50, "#1E5F84") + meanMark + "</svg>";
}

/**
 * The average-yearly-revenue histogram, with a separate "~0" bar and P20/P50/P80
 * lines. `cap` is the (fixed) value at the right edge of the axis — passing the
 * project's baseline P95 keeps the axis stable across override re-runs so the
 * bars and markers track actual values instead of rescaling every time.
 */
const HIST_NB = 48;
/** Bin a sample array into the histogram profile histSVG renders, at a fixed cap. Cheap (one pass);
 *  lets the startup cache store ~51 counts instead of the raw samples. */
export function histProfile(samples: Float64Array, cap: number, thr: number): HistProfile {
  // Log-x binning: revenue is heavy-tailed (mean ≫ median), so a linear axis crushes almost
  // every run into the first bin. The ≈0 spike (< lo) stays a separate bar; everything in
  // [lo, cap] is binned in log-space so the distribution's shape is legible.
  const lo = thr * 0.15;
  const logLo = Math.log(lo);
  const span = Math.log(Math.max(cap, lo * 1.0001)) - logLo;
  const bins = new Array(HIST_NB).fill(0);
  let zero = 0, loss = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v < 0) { loss++; continue; }
    if (v < lo) { zero++; continue; }
    let bi = Math.floor(((Math.log(v) - logLo) / span) * HIST_NB);
    if (bi >= HIST_NB) bi = HIST_NB - 1;
    if (bi < 0) bi = 0;
    bins[bi]++;
  }
  return { loss, zero, bins, total: samples.length || 1 };
}

/** A histogram profile with no draws (every bin empty). */
export const emptyHist = (): HistProfile => ({ loss: 0, zero: 0, bins: new Array(HIST_NB).fill(0), total: 1 });

/** The net-income histogram's x-axis cap from a result's after-tax draws (`r.sAfter`, non-empty): their p95
 *  when positive, else `fallback` (default: a mean-based cap). */
export function netCap(r: RunResult, fallback = Math.max(1, r.afterTaxMean * 3, 1)): number {
  const s = Float64Array.prototype.slice.call(r.sAfter as Float64Array).sort((a: number, b: number) => a - b);
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  return p95 > 0 ? p95 : fallback;
}

export function histSVG(r: RunResult, cap: number, net = false): string {
  // Wide, short aspect (viewBox ~6:1) so the chart fills the full page width freed up by
  // moving the dependency graph to the bottom, without getting tall.
  const W = 900;
  const H = 150;
  const L = 8;
  const Rr = 8;
  const T = 10;
  const B = 126;
  // NET mode plots the after-tax (net income) distribution + its own cap/percentiles; else gross revenue.
  const samples = net ? r.sAfter : r.samples;
  const cached = net ? r.histAfter : r.hist;
  if (net) {
    if (r.histAfterCap != null && r.histAfterCap > 0) cap = r.histAfterCap;
    else if (samples && samples.length) cap = netCap(r, cap); // live re-run without a precomputed net cap → p95 of net
  }
  if (cap <= 0) cap = Math.max(1, (net ? r.afterTaxMean : r.mean) * 3, 1);
  const P20 = net ? r.afterTax20 : r.p20, P50 = net ? r.afterTax50 : r.p50, P80 = net ? r.afterTax80 : r.p80, MEAN = net ? r.afterTaxMean : r.mean;
  // Prefer live samples (a re-run after an edit); otherwise the precomputed profile from the cache.
  const prof = samples && samples.length ? histProfile(samples, cap, r.thr) : (cached || emptyHist());
  const { loss, zero, bins, total } = prof;
  const nb = bins.length;
  const off = loss > 0 ? 1 : 0; // a leading red "loss" bar, only when some runs lose money
  // Scale the bars to the tallest DATA bin, not the ≈0/loss spikes — the ≈0 pile is often >50% of
  // runs and would otherwise crush the visible distribution flat. The ≈0/loss bars are clipped to the
  // plot top (truncated) with their true share labelled above.
  let maxb = 1;
  for (let b = 0; b < nb; b++) maxb = Math.max(maxb, bins[b]);
  const bw = (W - L - Rr) / (nb + 1 + off);
  const x0 = L;

  let s = `<svg class="hist" viewBox="0 0 ${W} ${H}">`;
  // Log-y: bar height ∝ log(count), referenced to the tallest data bin, so low-density tail bins stay
  // visible. Empty bins draw nothing; the ≈0/loss spikes exceed the data max and clip to the plot top.
  const hpx = (c: number): number => (c <= 0 ? 0 : Math.min((Math.log1p(c) / Math.log1p(maxb)) * (B - T), B - T));
  // When a spike is clipped (count > the data max), print its true share inside the top of the bar
  // (dark, so it reads on the muted fill) — below the P20/P50 labels above the plot.
  const pctLbl = (count: number, cx: number): string =>
    count > maxb ? `<text class="ax" x="${cx.toFixed(1)}" y="${T + 10}" text-anchor="middle" fill="#6E2A22" font-weight="700">${((count / total) * 100).toFixed(0)}%</text>` : "";
  // faint log-count gridlines (10, 100, 1k…) so the y-axis reads as log; labelled at the right edge.
  const cfmt = (c: number): string => (c >= 1000 ? `${c / 1000}k` : `${c}`);
  for (let c = 10; c < maxb; c *= 10) {
    const gy = B - hpx(c);
    s += `<line x1="${x0}" y1="${gy.toFixed(1)}" x2="${(W - Rr).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#EEF1F5"/><text class="ax" x="${(W - Rr).toFixed(1)}" y="${(gy - 2).toFixed(1)}" text-anchor="end">${cfmt(c)}</text>`;
  }
  if (off) {
    const lh = hpx(loss);
    s += `<rect class="barloss" x="${x0}" y="${(B - lh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${lh.toFixed(1)}"/>`;
    s += pctLbl(loss, x0 + bw / 2);
    s += `<text class="ax" x="${(x0 + bw / 2).toFixed(1)}" y="${B + 11}" text-anchor="middle">loss</text>`;
  }
  const zx = x0 + off * bw;
  const zh = hpx(zero);
  s += `<rect class="bar0" x="${zx.toFixed(1)}" y="${(B - zh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${zh.toFixed(1)}"/>`;
  s += pctLbl(zero, zx + bw / 2);
  s += `<text class="ax" x="${(zx + bw / 2).toFixed(1)}" y="${B + 11}" text-anchor="middle">~0</text>`;
  for (let j = 0; j < nb; j++) {
    const h = hpx(bins[j]);
    const xx = x0 + bw * (off + 1 + j);
    if (h > 0) s += `<rect class="bar" x="${xx.toFixed(1)}" y="${(B - h).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }
  // Log-x axis mapping (matches histProfile): the ≈0 spike sits left of `lo`; [lo, cap] is log-spaced.
  const lo = r.thr * 0.15;
  const logLo = Math.log(lo);
  const lspan = Math.log(Math.max(cap, lo * 1.0001)) - logLo;
  const px = (v: number): number => {
    if (v < 0) return x0 + bw / 2;
    if (v < lo) return zx + bw / 2;
    const bi = Math.min(nb - 0.001, ((Math.log(v) - logLo) / lspan) * nb);
    return x0 + bw * (off + 1 + bi);
  };
  // Axis: left edge = lo (the ≈0 cutoff), power-of-10 gridlines across [lo, cap], right edge = cap+.
  const firstBinX = x0 + bw * (off + 1);
  s += `<text class="ax" x="${firstBinX.toFixed(1)}" y="${B + 11}" text-anchor="start">${fmt(lo)}</text>`;
  for (let p = Math.ceil(Math.log10(lo) + 1e-3); Math.pow(10, p) < cap; p++) {
    const tv = Math.pow(10, p);
    const tx = px(tv);
    if (tx < firstBinX + 10 || tx > W - Rr - 22) continue; // don't crowd the end labels
    s += `<line x1="${tx.toFixed(1)}" y1="${T}" x2="${tx.toFixed(1)}" y2="${B}" stroke="#EDF1F6"/><text class="ax" x="${tx.toFixed(1)}" y="${B + 11}" text-anchor="middle">${fmt(tv)}</text>`;
  }
  s += `<text class="ax" x="${(W - Rr).toFixed(1)}" y="${B + 11}" text-anchor="end">${fmt(cap)}+</text>`;
  // p20/p50/p80 are solid percentile lines; mean is dashed (it's an expected value, not a quantile).
  const lines: [string, number, string, boolean][] = [
    ["p20", P20, "#A8483A", false],
    ["p50", P50, "#1E5F84", false],
    ["mean", MEAN, "#7a5aa8", true],
    ["p80", P80, "#2F7D57", false],
  ];
  for (const [name, val, color, dash] of lines) {
    const x = px(val);
    s +=
      `<line class="pl" x1="${x.toFixed(1)}" y1="${T}" x2="${x.toFixed(1)}" y2="${B}" stroke="${color}"${dash ? ' stroke-dasharray="3 3"' : ""}/>` +
      `<text class="plt" x="${x.toFixed(1)}" y="${T - 1}" text-anchor="middle" fill="${color}">${name.toUpperCase()}</text>`;
  }

  // Full-height transparent hit areas carrying each column's label in data-tip; a mousemove handler
  // reads it into the reactive label under the chart. Each tip reports the bar's own share AND the
  // cumulative share BELOW and ABOVE it, so hovering reads like a CDF. `cumBelow` accumulates as the
  // bars are emitted strictly left→right (loss → ~0 → ascending bins), which is also value order.
  const pct = (count: number): string => `${Math.round((count / total) * 100)}`;
  const share = (count: number): string => `${((count / total) * 100).toFixed(1)}`;
  const hit = (x: number, w: number, tip: string): string =>
    `<rect class="histhit" x="${x.toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${(B - T).toFixed(1)}" fill="transparent" pointer-events="all" data-tip="${esc(tip)}"/>`;
  let cumBelow = 0;
  // Two-line readout above the hovered bar: ‹ share below | value range | share above ›, then the bar's
  // own height (its share of runs) centred on the line below the range.
  const tip = (label: string, count: number): string => {
    const above = total - cumBelow - count;
    const t = `< ${pct(cumBelow)}%  |  ${label}  |  ${pct(above)}% >\n↕ ${share(count)}% of runs`;
    cumBelow += count;
    return t;
  };
  if (off) s += hit(x0 - 1, bw, tip(`a loss (< ${curSym()}0)`, loss));
  s += hit(zx - 1, bw, tip(`≈ ${curSym()}0 (under ${fmt(r.thr * 0.15)})`, zero));
  for (let j = 0; j < nb; j++) {
    const blo = Math.exp(logLo + (j / nb) * lspan);
    const bhi = Math.exp(logLo + ((j + 1) / nb) * lspan);
    const range = j === nb - 1 ? `${fmt(blo)}+` : `${fmt(blo)}–${fmt(bhi)}`;
    s += hit(x0 + bw * (off + 1 + j) - 0.75, bw, tip(range, bins[j]));
  }
  return s + "</svg>";
}

/** The gate/value → revenue dependency-graph diagram (any node list). */
export function graphSVG(p: { nodes: ProjectNode[] }): string {
  const gates = p.nodes.filter((n) => n.kind === "gate");
  const vals = p.nodes.filter((n) => n.kind === "value");
  const rows = Math.max(gates.length, vals.length);
  const W = 380;
  const rowH = 26;
  const H = Math.max(90, rows * rowH + 24);
  const colG = 14;
  const colV = 150;
  const colR = 300;
  const boxW = 118;
  const boxH = 20;
  const ry = H / 2 - 16;

  let s =
    `<svg class="graph" viewBox="0 0 ${W} ${H}"><rect class="rev" x="${colR}" y="${ry}" width="72" height="34" rx="7"/>` +
    `<text x="${colR + 36}" y="${ry + 14}" text-anchor="middle" font-weight="700">${curSym()}/yr</text>` +
    `<text x="${colR + 36}" y="${ry + 26}" text-anchor="middle">avg</text>`;
  const box = (x: number, y: number, label: string, cls: string): string => {
    const t = label.length > 22 ? label.slice(0, 21) + "…" : label;
    return `<rect class="gnode ${cls}" x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="5"/><text x="${x + 6}" y="${y + 13}">${esc(t)}</text>`;
  };
  const edge = (x1: number, y1: number): string =>
    `<path class="edge" d="M ${x1} ${y1} C ${x1 + 18} ${y1}, ${colR - 18} ${ry + 17}, ${colR} ${ry + 17}"/>`;
  gates.forEach((n: ProjectNode, i: number) => {
    const y = 12 + i * rowH;
    s += edge(colG + boxW, y + boxH / 2) + box(colG, y, n.label, "gate");
  });
  vals.forEach((n: ProjectNode, i: number) => {
    const y = 12 + i * rowH;
    s += edge(colV + boxW, y + boxH / 2) + box(colV, y, n.label, "val");
  });
  return s + "</svg>";
}
