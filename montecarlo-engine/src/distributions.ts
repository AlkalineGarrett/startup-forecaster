// Distribution construction: a grounded description (kind + resolved scalar params) → a quantile
// function Q(u) driven by one copula uniform. Counterpart of distribution-compiler's
// `compiler/distributions.mjs` (its DATA-CONTRACT.md, §4): `construct(dist)` returns a `Dist` with `.ppf(u)`/`.cdf(x)`/`.support`;
// `realize(node)` applies the node's optional truncation. The parametric families use closed forms
// here (normal via rng's erf/probit; beta via a ported incomplete-beta inverse).
//
// `distribution.kind` IS the family and its params are grounded — percentiles are a derived readout,
// never the input.
import { phi, probit } from "./rng.ts";
import { quant } from "./quantile.ts";
import type { QuantPoint } from "./types.ts";

/** A ready-to-sample marginal: an inverse-CDF Q(u), a CDF, and the value support. */
export interface Dist {
  ppf(u: number): number;
  cdf(x: number): number;
  support: [number, number];
}

/** A normalized distribution description (kind + resolved scalar params; structural kinds nest). */
export interface DistSpec {
  kind: string;
  // parametric
  median?: number; sigma?: number;      // lognormal
  alpha?: number; beta?: number;        // beta
  mean?: number; sd?: number;           // normal
  shape?: number; rate?: number;        // gamma
  low?: number; high?: number;          // uniform
  location?: number; scale?: number;    // generalized_pareto (+ shape)
  // structural
  atoms?: { value: number; weight: number }[];              // point_mass
  components?: { d: DistSpec; weight: number }[];            // weighted_combination
  body?: DistSpec; tail?: DistSpec; at?: number;            // splice
  anchors?: { prob: number; value: number }[]; k?: number;  // metalog
  lower_bound?: number | null; upper_bound?: number | null; zero_mass?: number;  // metalog
}

const INF = Infinity;
const BIG = 1e12;

// ---------- special functions (Numerical Recipes) — for the beta family ----------
function gammln(xx: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = xx, y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the incomplete beta (Lentz). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-30, EPS = 1e-12;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b) — the beta CDF. */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Inverse regularized incomplete beta — the beta quantile (NR invbetai). */
function invbetai(p: number, a: number, b: number): number {
  const EPS = 1e-9, a1 = a - 1, b1 = b - 1;
  let x = 0, t, u, err, al, h, w;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (a >= 1 && b >= 1) {
    const pp = p < 0.5 ? p : 1 - p;
    t = Math.sqrt(-2 * Math.log(pp));
    x = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) x = -x;
    al = (x * x - 3) / 6;
    h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    w = (x * Math.sqrt(al + h)) / h - (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const lna = Math.log(a / (a + b)), lnb = Math.log(b / (a + b));
    t = Math.exp(a * lna) / a;
    u = Math.exp(b * lnb) / b;
    w = t + u;
    if (p < t / w) x = Math.pow(a * w * p, 1 / a);
    else x = 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  const afac = -gammln(a) - gammln(b) + gammln(a + b);
  for (let j = 0; j < 10; j++) {
    if (x === 0 || x === 1) return x;
    err = betai(a, b, x) - p;
    t = Math.exp(a1 * Math.log(x) + b1 * Math.log(1 - x) + afac);
    u = err / t;
    x -= (t = u / (1 - 0.5 * Math.min(1, u * (a1 / x - b1 / (1 - x)))));
    if (x <= 0) x = 0.5 * (x + t);
    if (x >= 1) x = 0.5 * (x + t + 1);
    if (Math.abs(t) < EPS * x && j > 0) break;
  }
  return x;
}

// ---------- generic numeric inversion (for mixtures) ----------
function numericPPF(cdf: (x: number) => number, support: [number, number]): (u: number) => number {
  const lo = isFinite(support[0]) ? support[0] : -BIG;
  const hi = isFinite(support[1]) ? support[1] : BIG;
  const clo = cdf(lo), chi = cdf(hi);
  return (u: number): number => {
    if (u <= 0 || u <= clo) return lo;
    if (u >= 1 || u >= chi) return hi;
    let a = lo, b = hi;
    for (let i = 0; i < 200; i++) {
      const m = 0.5 * (a + b);
      if (cdf(m) < u) a = m; else b = m;
      if (b - a < 1e-9 * Math.max(1, Math.abs(m))) break;
    }
    return 0.5 * (a + b);
  };
}

// ---------- parametric families ----------
function lognormal(median: number, sigma: number): Dist {
  const mu = Math.log(median);
  return {
    ppf: (u) => Math.exp(mu + sigma * probit(u)),
    cdf: (x) => (x <= 0 ? 0 : phi((Math.log(x) - mu) / sigma)),
    support: [0, INF],
  };
}
function betaDist(alpha: number, beta: number): Dist {
  return { ppf: (u) => invbetai(u, alpha, beta), cdf: (x) => betai(alpha, beta, x), support: [0, 1] };
}
function normal(mean: number, sd: number): Dist {
  return { ppf: (u) => mean + sd * probit(u), cdf: (x) => phi((x - mean) / sd), support: [-INF, INF] };
}
function uniform(low: number, high: number): Dist {
  const span = high - low;
  return {
    ppf: (u) => low + u * span,
    cdf: (x) => (x <= low ? 0 : x >= high ? 1 : (x - low) / span),
    support: [low, high],
  };
}
/** Generalized Pareto (location, scale, shape). */
function gpd(loc: number, scale: number, shape: number): Dist {
  const hi = shape < 0 ? loc - scale / shape : INF;
  return {
    ppf: (u) => (Math.abs(shape) < 1e-9 ? loc - scale * Math.log(1 - u) : loc + (scale / shape) * (Math.pow(1 - u, -shape) - 1)),
    cdf: (x) => {
      if (x <= loc) return 0;
      const z = (x - loc) / scale;
      if (Math.abs(shape) < 1e-9) return 1 - Math.exp(-z);
      const base = 1 + shape * z;
      return base <= 0 ? (shape < 0 ? 1 : 0) : 1 - Math.pow(base, -1 / shape);
    },
    support: [loc, hi],
  };
}

// ---------- structural kinds ----------
function pointMass(atoms: { value: number; weight: number }[]): Dist {
  const xs = atoms.slice().sort((p, q) => p.value - q.value);
  const tot = xs.reduce((s, a) => s + a.weight, 0);
  if (tot <= 0) throw new Error("point_mass total weight must be > 0");
  const cum: [number, number][] = [];
  let c = 0;
  for (const a of xs) { c += a.weight / tot; cum.push([c, a.value]); }
  return {
    ppf: (u) => { for (const [cc, v] of cum) if (u <= cc + 1e-12) return v; return cum[cum.length - 1][1]; },
    cdf: (x) => xs.filter((a) => a.value <= x).reduce((s, a) => s + a.weight, 0) / tot,
    support: [xs[0].value, xs[xs.length - 1].value],
  };
}
function weightedCombination(components: { d: DistSpec; weight: number }[]): Dist {
  const comps = components.map((c) => ({ d: construct(c.d), w: c.weight }));
  const tot = comps.reduce((s, c) => s + c.w, 0);
  for (const c of comps) c.w /= tot;
  // an infinite-support component keeps the mixture unbounded on that side — do NOT collapse it
  // to a finite neighbour (that silently truncates a hurdle model to all-zeros).
  const lo = comps.some((c) => !isFinite(c.d.support[0])) ? -BIG : Math.min(...comps.map((c) => c.d.support[0]));
  const hi = comps.some((c) => !isFinite(c.d.support[1])) ? BIG : Math.max(...comps.map((c) => c.d.support[1]));
  const cdf = (x: number): number => comps.reduce((s, c) => s + c.w * c.d.cdf(x), 0);
  return { cdf, ppf: numericPPF(cdf, [lo, hi]), support: [lo, hi] };
}
/** Piecewise body + tail joined at a shared x-value `at` (= p* body-mass). */
function splice(body: Dist, tail: Dist, at: number): Dist {
  const pstar = body.cdf(at);
  return {
    ppf: (u) => (u <= pstar ? body.ppf(u) : tail.ppf((u - pstar) / (1 - pstar))),
    cdf: (x) => (x <= at ? body.cdf(x) : pstar + (1 - pstar) * tail.cdf(x)),
    support: [body.support[0], tail.support[1]],
  };
}

// ---------- metalog (k terms; unbounded, lower-, upper- or doubly-bounded) ----------
function solveLstsq(A: number[][], b: number[]): number[] {
  // normal equations (AᵀA)c = Aᵀb via Gaussian elimination with partial pivoting.
  const n = A[0].length;
  const AtA: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb: number[] = new Array(n).fill(0);
  for (let i = 0; i < A.length; i++)
    for (let r = 0; r < n; r++) {
      Atb[r] += A[i][r] * b[i];
      for (let cc = 0; cc < n; cc++) AtA[r][cc] += A[i][r] * A[i][cc];
    }
  const M = AtA.map((row, i) => [...row, Atb[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let cc = col; cc <= n; cc++) M[r][cc] -= f * M[col][cc];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function metalog(anchors: { prob: number; value: number }[], K: number, lowerBound: number | null, zeroMass: number, upperBound: number | null = null): Dist {
  const basis = (y: number): number[] => {
    const z = Math.log(y / (1 - y)), c = y - 0.5;
    return [1, z, c * z, c, c * c, c * c * z].slice(0, K);
  };
  // Boundedness transform (Keelin 2016), mirroring the compiler: fit in the unbounded space, invert back.
  const bl = lowerBound, bu = upperBound;
  const fwd = (x: number): number =>
    bl != null && bu != null ? Math.log((x - bl) / (bu - x)) : bl != null ? Math.log(x - bl) : bu != null ? -Math.log(bu - x) : x;
  const inv = (m: number): number => {
    if (bl != null && bu != null) { const e = Math.exp(m); return (bl + bu * e) / (1 + e); }
    if (bl != null) return bl + Math.exp(m);
    if (bu != null) return bu - Math.exp(-m);
    return m;
  };
  const tp = anchors.map((a) => ({ q: a.prob, t: fwd(a.value) }));
  const coef = solveLstsq(tp.map((p) => basis(p.q)), tp.map((p) => p.t));
  const Qy = (y: number): number => inv(basis(y).reduce((s, g, i) => s + coef[i] * g, 0));
  const loV = lowerBound != null ? lowerBound : Qy(1e-9);
  const hiV = upperBound != null ? upperBound : Qy(1 - 1e-9);
  const ppf = (u: number): number => (u <= zeroMass ? loV : Qy((u - zeroMass) / (1 - zeroMass)));
  // CDF = the monotone inverse of ppf (needed when the node is truncated, e.g. a retention metalog
  // capped at 1.0 whose lower-bounded right tail would otherwise extrapolate past the ceiling).
  const cdf = (x: number): number => {
    if (x <= loV) return zeroMass;
    if (x >= hiV) return 1;
    let a = 0, b = 1;
    for (let i = 0; i < 200; i++) { const m = 0.5 * (a + b); if (ppf(m) < x) a = m; else b = m; if (b - a < 1e-12) break; }
    return 0.5 * (a + b);
  };
  return { ppf, cdf, support: [loV, hiV] };
}

// ---------- piecewise: monotone interpolation of stated quantiles (the hand path's empirical rule) ----------
function piecewise(anchors: { prob: number; value: number }[]): Dist {
  const pts: QuantPoint[] = anchors.map((a) => [a.prob, a.value] as QuantPoint).sort((a, b) => a[0] - b[0]);
  const ppf = (u: number): number => quant(pts, u);
  const loV = ppf(1e-9), hiV = ppf(1 - 1e-9);
  const cdf = (x: number): number => {
    if (x <= loV) return 0;
    if (x >= hiV) return 1;
    let a = 0, b = 1;
    for (let i = 0; i < 200; i++) { const m = 0.5 * (a + b); if (ppf(m) < x) a = m; else b = m; if (b - a < 1e-12) break; }
    return 0.5 * (a + b);
  };
  return { ppf, cdf, support: [loV, hiV] };
}

// ---------- construct / realize ----------
export function construct(d: DistSpec): Dist {
  switch (d.kind) {
    case "lognormal": return lognormal(d.median as number, d.sigma as number);
    case "beta": return betaDist(d.alpha as number, d.beta as number);
    case "normal": return normal(d.mean as number, d.sd as number);
    case "gamma": { const shape = d.shape as number, rate = d.rate as number; return gammaDist(shape, rate); }
    case "uniform": return uniform(d.low as number, d.high as number);
    case "generalized_pareto": return gpd(d.location as number, d.scale as number, d.shape as number);
    case "point_mass": return pointMass(d.atoms as { value: number; weight: number }[]);
    case "weighted_combination": return weightedCombination(d.components as { d: DistSpec; weight: number }[]);
    case "splice": return splice(construct(d.body as DistSpec), construct(d.tail as DistSpec), d.at as number);
    case "piecewise": return piecewise(d.anchors as { prob: number; value: number }[]);
    case "metalog": return metalog(d.anchors as { prob: number; value: number }[], d.k || 5, d.lower_bound ?? null, d.zero_mass || 0, d.upper_bound ?? null);
    default: throw new Error(`unknown distribution kind: ${d.kind}`);
  }
}

/** Gamma(shape, rate) — Wilson–Hilferty seed refined by Newton on the CDF. Present for completeness
 *  (the current corpus has no gamma nodes); uses a lower regularized-gamma via series/continued fraction. */
function gammaDist(shape: number, rate: number): Dist {
  const scale = 1 / rate;
  const P = (x: number): number => regGammaP(shape, x / scale);
  return { ppf: numericPPF(P, [0, INF]), cdf: P, support: [0, INF] };
}
function regGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 200; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
  }
  const FPMIN = 1e-30;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
}

/** Condition a distribution on [lower, upper] (a node's truncation): with ca=F(lo), cb=F(hi),
 *  return Q(ca + u·(cb−ca)). Only bounds that clip are passed. */
export function truncate(dist: Dist, lower: number | null, upper: number | null): Dist {
  const lo = lower == null ? dist.support[0] : lower;
  const hi = upper == null ? dist.support[1] : upper;
  const ca = isFinite(lo) ? dist.cdf(lo) : 0;
  const cb = isFinite(hi) ? dist.cdf(hi) : 1;
  if (cb - ca <= 0) throw new Error("truncation bounds enclose no probability mass");
  return {
    ppf: (u) => dist.ppf(ca + u * (cb - ca)),
    cdf: (x) => (x <= lo ? 0 : x >= hi ? 1 : (dist.cdf(x) - ca) / (cb - ca)),
    support: [lo, hi],
  };
}
