// Empirical quantile function: sample values by interpolating researched percentiles.
import type { Pctiles, ProjectNode, QuantPoint } from "./types.ts";

/** Percentile keys paired with their cumulative probability, in order. */
const PCT_POINTS: [keyof Pctiles, number][] = [
  ["p01", 0.01],
  ["p10", 0.1],
  ["p25", 0.25],
  ["p50", 0.5],
  ["p75", 0.75],
  ["p90", 0.9],
  ["p99", 0.99],
];

/** Percentile keys paired with their display label, in order. Shared by the renderers. */
export const PCT_LABELS: [keyof Pctiles, string][] = [
  ["p01", "P1"],
  ["p10", "P10"],
  ["p25", "P25"],
  ["p50", "P50"],
  ["p75", "P75"],
  ["p90", "P90"],
  ["p99", "P99"],
];

/** A node's percentile curve. */
export function defaultCurve(n: ProjectNode): Pctiles | undefined {
  return n.pctiles;
}

/**
 * Build the sorted [probability, value] points for a node's quantile function.
 * `override` supplies an explicit percentile set in place of the node's own.
 */
export function ptsOf(n: ProjectNode, override?: Pctiles): QuantPoint[] {
  const pc = override || defaultCurve(n) || {};
  const out: QuantPoint[] = [];
  for (const [key, prob] of PCT_POINTS) {
    const v = pc[key];
    if (v != null) out.push([prob, v]);
  }
  return out;
}

/**
 * Interpolate a value between two quantile points at cumulative probability `u`.
 * Interpolation is log-linear when both endpoints are positive (so heavy-tailed
 * magnitudes read correctly), and linear otherwise.
 */
export function interpLog(a: QuantPoint, b: QuantPoint, u: number): number {
  const d = b[0] - a[0];
  const t = d === 0 ? 0 : (u - a[0]) / d;
  const va = a[1];
  const vb = b[1];
  if (va > 0 && vb > 0) return Math.exp(Math.log(va) + t * (Math.log(vb) - Math.log(va)));
  return Math.max(0, va + t * (vb - va));
}

/** Evaluate the quantile function `P` at cumulative probability `u` in [0,1]. */
export function quant(P: QuantPoint[], u: number): number {
  const n = P.length;
  if (n === 0) return 0;
  if (n === 1) return P[0][1];
  if (u <= P[0][0]) return interpLog(P[0], P[1], u);
  for (let i = 1; i < n; i++) {
    if (u <= P[i][0]) return interpLog(P[i - 1], P[i], u);
  }
  return interpLog(P[n - 2], P[n - 1], u);
}

/** Clamp a sampled value: fractions to [1e-4, 0.995], everything else to ≥ 0. */
export function frac(n: ProjectNode, v: number): number {
  return n._frac ? Math.max(1e-4, Math.min(0.995, v)) : Math.max(0, v);
}

/** Std dev of a click-override distribution, in bar-position units (5% of the bar length). */
export const OVERRIDE_SD = 0.05;

export interface NodeAxis {
  /** value → position in [0,1] along the bar. */
  toT(v: number): number;
  /** position in [0,1] along the bar → value. */
  toValue(t: number): number;
}

/**
 * The value↔position mapping the percentile bar is drawn with: log-scaled for
 * magnitudes, linear for gate rates and fractions. Positions run 0..1 across the
 * bar. Shared by the renderer (drawing + click) and the override sampler so a
 * clicked point maps to the same value everywhere.
 */
export function nodeAxis(n: ProjectNode): NodeAxis {
  const gate = n.kind === "gate";
  const pc = defaultCurve(n) || {};
  const vals: number[] = [];
  for (const [key] of PCT_LABELS) {
    const raw = pc[key];
    if (raw != null) vals.push(gate ? Math.min(0.999, raw) : frac(n, raw));
  }
  const mn = vals.length ? Math.min(...vals) : 0;
  const mx = vals.length ? Math.max(...vals) : 1;
  const lin = gate || !!n._frac || mn <= 0;
  const lmin = lin ? 0 : Math.log(mn / 1.6);
  const lspan = lin ? 0 : Math.log(mx * 1.6) - lmin;
  // Gates always span the full 0%–100% probability range (so 0 and 1 are reachable),
  // even though that squashes their P10/P90 inward. Fraction value nodes keep a padded axis.
  const linMax = gate ? 1 : mx * 1.12 || 1;
  const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
  return {
    toT: (v) => clamp01(lin ? v / linMax : (Math.log(Math.max(v, 1e-9)) - lmin) / lspan),
    toValue: (t) => (lin ? clamp01(t) * linMax : Math.exp(lmin + clamp01(t) * lspan)),
  };
}
