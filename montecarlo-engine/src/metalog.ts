// Metalog marginal sampling (Keelin 2016). Each node's researched quantiles are fit to a
// flexible metalog quantile function Q(u); we sample by evaluating Q at a copula-supplied
// uniform u, so the marginal is honoured exactly while the factor model imposes dependence.
// A metalog fit to awkward quantiles can be non-monotonic (an invalid quantile function); we
// check feasibility and fall back to monotone piecewise interpolation of the same quantiles.
import type { QuantPoint } from "./types.ts";
import { quant } from "./quantile.ts";

/** How the value is bounded, which sets the metalog transform. */
export type MetaBound = "unbounded" | "semi-lo" | "bounded";

/** A ready-to-sample marginal: either a feasible metalog fit or a monotone empirical fallback. */
export interface Marginal {
  kind: "metalog" | "empirical";
  // metalog:
  a?: number[]; // coefficients on the transformed (unbounded) scale
  bound?: MetaBound;
  bl?: number; // lower bound (semi-lo / bounded)
  bu?: number; // upper bound (bounded)
  // empirical fallback (monotone piecewise interpolation, log-linear per positive segment):
  pts?: QuantPoint[];
}

const EPS = 1e-9;

/** The k-th metalog basis function g_k(y) in Keelin's standard term order (k is 1-based). */
function basis(y: number, k: number): number {
  const L = Math.log(y / (1 - y));
  const c = y - 0.5;
  if (k === 1) return 1;
  if (k === 2) return L;
  if (k === 3) return c * L;
  if (k === 4) return c;
  // k >= 5: odd → pure power c^((k-1)/2); even → c^(k/2 - 1) * L
  return k % 2 === 1 ? Math.pow(c, (k - 1) / 2) : Math.pow(c, k / 2 - 1) * L;
}

/** Solve a square linear system A·x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < EPS) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let cc = col; cc <= n; cc++) M[r][cc] -= f * M[col][cc];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Evaluate the metalog on the transformed (unbounded) scale at cumulative probability y. */
function metaZ(a: number[], y: number): number {
  let z = 0;
  for (let k = 1; k <= a.length; k++) z += a[k - 1] * basis(y, k);
  return z;
}

/** Untransform a value on the metalog's internal scale back to the node's units. */
function untransform(m: Marginal, z: number): number {
  if (m.bound === "semi-lo") return (m.bl as number) + Math.exp(z);
  if (m.bound === "bounded") {
    const e = Math.exp(z);
    return ((m.bl as number) + (m.bu as number) * e) / (1 + e);
  }
  return z;
}

/** Transform a raw value into the metalog's internal (unbounded) scale, or null if out of bounds. */
function transform(bound: MetaBound, bl: number, bu: number, x: number): number | null {
  if (bound === "semi-lo") return x > bl + EPS ? Math.log(x - bl) : null;
  if (bound === "bounded") return x > bl + EPS && x < bu - EPS ? Math.log((x - bl) / (bu - x)) : null;
  return x;
}

/** Check that the metalog quantile function is monotone increasing across (0,1). */
function feasible(m: Marginal): boolean {
  let prev = -Infinity;
  for (let i = 1; i < 200; i++) {
    const y = i / 200;
    const v = untransform(m, metaZ(m.a as number[], y));
    if (!isFinite(v) || v < prev - 1e-6) return false;
    prev = v;
  }
  return true;
}

/**
 * Build a sampler from a node's quantiles: `qs` = [{y: cumulative prob, x: value}, …], sorted.
 * Tries an exact metalog fit (one term per quantile); if it is infeasible, falls back to
 * monotone piecewise interpolation of the same points (log-linear when all values are positive).
 */
export function buildMarginal(qs: { y: number; x: number }[], bound: MetaBound, bl = 0, bu = 1): Marginal {
  const pts: QuantPoint[] = qs.map((q) => [q.y, q.x]);
  const empirical: Marginal = { kind: "empirical", pts };
  if (qs.length < 2) return empirical;
  // Transform the data onto the metalog's internal scale; bail to empirical if any point is out of bounds.
  const z: number[] = [];
  for (const q of qs) {
    const t = transform(bound, bl, bu, q.x);
    if (t == null) return empirical;
    z.push(t);
  }
  const n = qs.length;
  const A = qs.map((q) => Array.from({ length: n }, (_, i) => basis(q.y, i + 1)));
  const a = solve(A, z);
  if (!a) return empirical;
  const m: Marginal = { kind: "metalog", a, bound, bl, bu };
  return feasible(m) ? m : empirical;
}

/** Sample the marginal at copula-supplied uniform u ∈ (0,1). */
export function qAt(m: Marginal, u: number): number {
  const uu = Math.max(EPS, Math.min(1 - EPS, u));
  if (m.kind === "metalog") return untransform(m, metaZ(m.a as number[], uu));
  return quant(m.pts as QuantPoint[], uu);
}
