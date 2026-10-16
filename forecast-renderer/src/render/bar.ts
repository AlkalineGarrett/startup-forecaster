// The per-node distribution graphic shown under each node: a probability-mass (density) curve of the
// node's grounded distribution, with the P10/P50/P90 reference lines coloured by provenance. Clicking
// it sets an override (a narrow test distribution) — see app.ts and simulate.ts. The click handler
// maps a pixel x to a bar position via BAR_GEO, so the geometry (W, X0, X1) must stay stable.
import type { Project, ProjectNode, Prov } from "../../../montecarlo-engine/src/types.ts";
import { frac, defaultCurve, nodeAxis, ptsOf, OVERRIDE_SD, PCT_LABELS, type NodeAxis } from "../../../montecarlo-engine/src/quantile.ts";
import { fmtShort, esc } from "../../../montecarlo-engine/src/format.ts";
import { construct, truncate, type Dist } from "../../../montecarlo-engine/src/distributions.ts";
import { buildMarginal, qAt } from "../../../montecarlo-engine/src/metalog.ts";
import { DISTRIBUTIONS } from "../../../montecarlo-engine/src/portfolio-context.ts";

interface Mark {
  name: string;
  val: number;
  prov?: Prov;
}

/** Per-percentile provenance colours (sourced / inferred / guess). Distinct from the
 * teal accent so a percentile's grounding reads at a glance. */
export const PROV_COLORS: Record<Prov, string> = { sourced: "#1C7A46", inferred: "#B26E00", guess: "#B0362B" };
const provColor = (pv?: Prov): string => (pv ? PROV_COLORS[pv] : "#17202B");

/** Inline legend for the provenance colours — appended to the node-section header. */
export const PROV_LEGEND =
  `<span class="provleg" style="font-family:var(--font-mono);font-weight:600;font-size:.62rem;letter-spacing:.02em;margin-left:8px;white-space:nowrap">` +
  `<span style="color:var(--ink-faint);font-weight:500">percentile provenance:</span> ` +
  `<span style="color:${PROV_COLORS.sourced}">■ sourced</span> ` +
  `<span style="color:${PROV_COLORS.inferred}">■ inferred</span> ` +
  `<span style="color:${PROV_COLORS.guess}">■ guess</span></span>`;

// SVG geometry (viewBox units). W/X0/X1 are consumed by the click handler (BAR_GEO) — keep stable.
const W = 700;
const H = 96;
const X0 = 46;
const X1 = 674;
const BASE = 64; // density baseline; the curve rises above it
const PEAK = 46; // max curve height in px above the baseline

/** Exported so the click handler can map a pixel x to a bar position (0..1). */
export const BAR_GEO = { W, X0, X1 };

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const uClamp = (u: number): number => Math.max(1e-6, Math.min(1 - 1e-6, u));

/** The percentile marks for a node, converted to display values. */
function marksOf(n: ProjectNode, gate: boolean): Mark[] {
  const pc = defaultCurve(n);
  if (!pc) return [];
  const marks: Mark[] = [];
  for (const [key, name] of PCT_LABELS) {
    const raw = pc[key];
    if (raw != null) marks.push({ name, val: gate ? Math.min(0.999, raw) : frac(n, raw), prov: n.prov?.[key] });
  }
  return marks;
}

/** A Dist built from a node's authored percentiles via the SAME metalog fit the sampler uses when a
 * node has no compiled distribution (simulate.ts nodeSampler fallback). Mirrors that path — buildMarginal
 * over ptsOf(n) with the node's bound, then frac() — so the drawn curve matches what is actually sampled.
 * cdf is a numeric inverse of the monotone ppf (densityPath only needs it to clip to the visible range). */
function inlineDist(n: ProjectNode, gate: boolean): Dist | undefined {
  const pts = ptsOf(n);
  if (pts.length < 2) return undefined;
  const bound = n.bound ?? (gate || n._frac ? "bounded" : "semi-lo");
  const m = buildMarginal(pts.map(([y, x]) => ({ y, x })), bound, 0, 1);
  const ppf = (u: number): number => { const v = qAt(m, uClamp(u)); return gate ? v : frac(n, v); };
  const lo = ppf(1e-6), hi = ppf(1 - 1e-6);
  const cdf = (x: number): number => {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    let a = 1e-6, b = 1 - 1e-6;
    for (let i = 0; i < 42; i++) { const mid = (a + b) / 2; if (ppf(mid) < x) a = mid; else b = mid; }
    return (a + b) / 2;
  };
  return { ppf, cdf, support: [lo, hi] };
}

/** The distribution backing a node: the compiled grounded distribution when present (unit-scoped key;
 * the generic base shares the base keys), else a metalog fit through the node's authored percentiles —
 * the same fallback the sampler uses — so inline-only nodes (e.g. a sequential-buildup project or
 * a placeholder node) still draw a density curve instead of an empty axis. */
function distOf(p: Project, n: ProjectNode, unitId?: string): Dist | undefined {
  const nd = DISTRIBUTIONS[unitId && unitId !== "generic" ? `${p.id}::${unitId}::${n.id}` : `${p.id}::${n.id}`];
  if (!nd) return inlineDist(n, n.kind === "gate");
  const d = construct(nd.d);
  return nd.trunc ? truncate(d, nd.trunc.lower ?? null, nd.trunc.upper ?? null) : d;
}

function quantileOf(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/**
 * Build the density-curve path for a distribution over the node's plotting axis. Uses equal-probability
 * cells: a uniform grid in U over the visible value range, so each cell carries mass Δu and its height
 * is Δu / Δt (mass per unit plot-width) — the true density in plot coordinates, valid for every kind
 * (mixtures, splices, metalogs) since it only needs the inverse-CDF. Returns an SVG path `d` string.
 */
function densityPath(dist: Dist, axis: NodeAxis): string {
  const N = 120;
  const vLo = axis.toValue(0);
  const vHi = axis.toValue(1);
  let uLo = uClamp(dist.cdf(vLo));
  let uHi = uClamp(dist.cdf(vHi));
  if (uHi - uLo < 1e-4) { uLo = 1e-3; uHi = 1 - 1e-3; } // degenerate visible range → show the full body
  const du = (uHi - uLo) / N;
  const t: number[] = new Array(N + 1);
  for (let k = 0; k <= N; k++) t[k] = clamp01(axis.toT(dist.ppf(uClamp(uLo + k * du))));
  const h: number[] = new Array(N);
  for (let k = 0; k < N; k++) h[k] = du / Math.max(t[k + 1] - t[k], 1e-4);
  // robust normalisation: scale to the 97th-percentile cell so a near-atomic spike doesn't flatten the body.
  const hNorm = Math.max(1e-9, quantileOf(h.slice().sort((a, b) => a - b), 0.97));
  const xAt = (tt: number): number => X0 + clamp01(tt) * (X1 - X0);
  const yAt = (hh: number): number => BASE - Math.min(1, hh / hNorm) * PEAK;
  let d = `M ${xAt(t[0]).toFixed(1)} ${BASE}`;
  for (let k = 0; k < N; k++) d += ` L ${xAt((t[k] + t[k + 1]) / 2).toFixed(1)} ${yAt(h[k]).toFixed(1)}`;
  d += ` L ${xAt(t[N]).toFixed(1)} ${BASE} Z`;
  return d;
}

/** Render one node's distribution graph (SVG string): a probability-mass curve with percentile
 * reference lines, or an override pin/band when one is set. */
export function renderBar(p: Project, n: ProjectNode, unitId?: string): string {
  const gate = n.kind === "gate";
  const marks = marksOf(n, gate);
  if (!marks.length) return "";
  const axis = nodeAxis(n);
  const xOf = (v: number): number => X0 + axis.toT(v) * (X1 - X0);
  const xAt = (t: number): number => X0 + clamp01(t) * (X1 - X0);
  const label = (v: number): string => (gate ? Math.round(v * 100) + "%" : fmtShort(v));
  const dist = gate ? undefined : distOf(p, n, unitId);
  const overridden = n._override != null;

  let s =
    `<svg class="pbar" viewBox="0 0 ${W} ${H}" data-pid="${p.id}"${unitId ? ` data-unit="${unitId}"` : ""} data-nid="${n.id}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(n.label)} probability distribution — click to test a value">` +
    `<line x1="${X0}" y1="${BASE}" x2="${X1}" y2="${BASE}" stroke="#D3DAE1" stroke-width="1.5"/>`;

  // The distribution body + its percentile reference lines. Dimmed (kept for reference) under an override.
  let std = "";
  if (dist) {
    std += `<path d="${densityPath(dist, axis)}" fill="#D7E6EF" stroke="#1E5F84" stroke-width="1.4" stroke-linejoin="round"/>`;
  }
  const m10 = marks.find((m) => m.name === "P10");
  const m50 = marks.find((m) => m.name === "P50");
  const m90 = marks.find((m) => m.name === "P90");
  // A light P10–P90 interquantile band along the baseline for orientation.
  if (m10 && m90) {
    const xa = xOf(m10.val), xb = xOf(m90.val);
    std += `<rect x="${xa.toFixed(1)}" y="${BASE + 2}" width="${(xb - xa).toFixed(1)}" height="4" rx="2" fill="#C4D3DD"/>`;
  }
  if (gate) {
    std +=
      `<text x="${X0}" y="${BASE + 22}" text-anchor="start" font-size="8" fill="#AEB6C0">0%</text>` +
      `<text x="${X1}" y="${BASE + 22}" text-anchor="end" font-size="8" fill="#AEB6C0">100%</text>`;
  }
  // P10/P50/P90 reference lines through the curve, coloured by provenance, labelled with value.
  for (const m of [m10, m50, m90]) {
    if (!m) continue;
    const x = xOf(m.val);
    const isP = m.name === "P50";
    const col = provColor(m.prov);
    std +=
      `<line x1="${x.toFixed(1)}" y1="${BASE - PEAK - 2}" x2="${x.toFixed(1)}" y2="${BASE}" stroke="${col}" stroke-width="${isP ? 2 : 1}" ${isP ? "" : 'stroke-dasharray="2 2" '}opacity="${isP ? 0.9 : 0.6}"/>` +
      `<text x="${x.toFixed(1)}" y="12" text-anchor="middle" font-size="9" fill="${col}"${isP ? ' font-weight="700"' : ""}>${m.name}</text>` +
      `<text x="${x.toFixed(1)}" y="${BASE + 20}" text-anchor="middle" font-size="10.5" fill="${col}" font-weight="600">${label(m.val)}</text>`;
  }
  // Mean (expected value) of the node's OWN distribution — a dashed violet mark, distinct from the
  // provenance-coloured percentile lines. For the right-skewed grounded distributions the mean sits
  // well to the right of the median (often near/past P90), so it is worth showing alongside P10/P50/P90.
  // "›"/"‹" flags a mean that falls off the visible axis (a heavy tail); the value label still reads true.
  if (dist) {
    let sum = 0;
    const MM = 256;
    for (let k = 0; k < MM; k++) sum += dist.ppf(uClamp((k + 0.5) / MM));
    const meanVal = sum / MM;
    const tm = axis.toT(meanVal);
    const xm = xAt(clamp01(tm));
    const off = tm > 1.003 ? "›" : tm < -0.003 ? "‹" : "";
    std +=
      `<line x1="${xm.toFixed(1)}" y1="${BASE - PEAK - 2}" x2="${xm.toFixed(1)}" y2="${BASE}" stroke="#7a5aa8" stroke-width="1.4" stroke-dasharray="3 2" opacity="0.85"/>` +
      `<text x="${xm.toFixed(1)}" y="12" text-anchor="middle" font-size="9" fill="#7a5aa8" font-weight="700">μ${off}</text>` +
      `<text x="${xm.toFixed(1)}" y="${BASE + 20}" text-anchor="middle" font-size="10.5" fill="#7a5aa8" font-weight="600">${label(meanVal)}</text>`;
  }
  s += overridden ? `<g opacity="0.3">${std}</g>` : std;

  // The override pin. Value nodes get a narrow test band; a gate is a single deterministic rate.
  if (overridden) {
    const t = clamp01(n._override as number);
    const xC = xAt(t);
    if (!gate) {
      const xL = xAt(t - OVERRIDE_SD), xR = xAt(t + OVERRIDE_SD);
      s += `<rect x="${xL.toFixed(1)}" y="${BASE - PEAK}" width="${(xR - xL).toFixed(1)}" height="${PEAK + 11}" rx="4" fill="#1E5F84" opacity="0.15"/>`;
    }
    s +=
      `<line x1="${xC.toFixed(1)}" y1="${BASE - PEAK - 2}" x2="${xC.toFixed(1)}" y2="${BASE + 11}" stroke="#1E5F84" stroke-width="2.5"/>` +
      `<text x="${xC.toFixed(1)}" y="12" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1E5F84">${label(axis.toValue(t))}</text>`;
  }
  return s + "</svg>";
}
