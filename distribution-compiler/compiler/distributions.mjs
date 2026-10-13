// Distribution construction: a grounded description (kind + params) -> a quantile function Q(p)
// and the derived percentiles. Deterministic, node-local. The parametric families are written in
// standard form, shifted and scaled (special functions in numerics.mjs); metalog and the
// lognormal-body+GPD-tail splice are fits.
//
// Every constructor takes a `params` object of already-resolved scalars (numbers) and returns a Dist
// with `.ppf(p)` (accepts a number or an array) plus a `.support` [lo, hi].
import * as N from "./numerics.mjs";
import { round } from "./format.mjs";

export const PS = [0.05, 0.10, 0.50, 0.90, 0.95];
export const GRID = N.linspace(1e-4, 1 - 1e-4, 4000);   // shared probability grid for numeric cdf/monotonicity/mean
const MIX_GRID = N.linspace(0.001, 0.999, 999);          // a component without a cdf: its ppf on this grid

const isArr = (p) => Array.isArray(p) || ArrayBuffer.isView(p);

/** Apply a scalar quantile function fn(p) over a ppf input array -> Float64Array. */
function elementwise(arr, fn) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = fn(arr[i]);
  return out;
}

/** A (cdf, support) pair for numeric inversion, or a closed-form ppf. */
export class Dist {
  constructor({ ppf = null, cdf = null, pdf = null, support = [-Infinity, Infinity] } = {}) {
    this._ppf = ppf; this._cdf = cdf; this._pdf = pdf; this.support = support;
    this._gridPpf = null;
  }
  pdf(x) {
    if (this._pdf === null) throw new DistError("no pdf for this construction (needed by slope_match)");
    return this._pdf(x);
  }
  cdf(x) {
    if (this._cdf !== null) return this._cdf(x);
    if (this._gridPpf === null) this._gridPpf = this.ppf(GRID);   // pure, so cached
    return N.interp(x, this._gridPpf, GRID);
  }
  /** Q(p) for a scalar (-> number) or an array (-> Float64Array). */
  ppf(p) {
    const arr = isArr(p) ? p : [p];
    let out;
    if (this._ppf !== null) {
      out = elementwise(arr, this._ppf);
    } else {
      let [lo, hi] = this.support;
      lo = Number.isFinite(lo) ? lo : -1e12;
      hi = Number.isFinite(hi) ? hi : 1e12;
      const clo = this._cdf(lo), chi = this._cdf(hi);   // clamp on boundary mass (point_mass / hurdle)
      out = elementwise(arr, (pp) => {
        if (pp <= 0 || pp <= clo) return lo;
        if (pp >= 1 || pp >= chi) return hi;
        return brentq((x) => this._cdf(x) - pp, lo, hi, 1e-9);
      });
    }
    return isArr(p) ? out : out[0];
  }
  percentiles(ps = PS) {
    const out = {};
    for (const p of ps) out[`p${String(Math.round(p * 100)).padStart(2, "0")}`] = round(this.ppf(p), 6);
    return out;
  }
}

/** A construction its params cannot support (bad anchors, no mass); the compiler reports it as a diagnostic. */
export class DistError extends Error { constructor(m) { super(m); this.name = "DistError"; } }

/** Brent's method on a cdf, refusing to iterate on NaN. */
function brentq(f, a, b, xtol) {
  return N.brentq((x) => {
    const v = f(x);
    if (Number.isNaN(v)) throw new DistError(`the cdf is NaN at x=${x}`);
    return v;
  }, a, b, { xtol });
}

// ---------- parametric families ----------
/** A family given in standard form (_pdf/_cdf/_ppf on support [a, b]), shifted by loc and scaled by scale.
 *  Outside the support the pdf is 0 and the cdf 0 or 1; invalid params give NaN. */
function frozen({ a, b, loc = 0, scale = 1, ok = true, _pdf, _cdf, _ppf }, support) {
  const good = ok && scale > 0 && loc === loc;
  const pdf = (x) => {
    const z = (x - loc) / scale;
    if (!(ok && scale > 0) || Number.isNaN(z)) return NaN;
    return a <= z && z <= b ? _pdf(z) / scale : 0;
  };
  const cdf = (x) => {
    const z = (x - loc) / scale;
    if (!(ok && scale > 0) || Number.isNaN(z)) return NaN;
    if (z >= b) return 1;
    return a < z && z < b ? _cdf(z) : 0;
  };
  const ppf = (q) => {
    if (!good) return NaN;
    if (q > 0 && q < 1) return _ppf(q) * scale + loc;
    if (q === 0) return a * scale + loc;
    if (q === 1) return b * scale + loc;
    return NaN;
  };
  return new Dist({ ppf, cdf, pdf, support });
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
function lognormal(p) {   // median, sigma  (X = exp(mu+sigma Z), median = exp(mu))
  const s = p.sigma;
  return frozen({
    a: 0, b: Infinity, scale: p.median, ok: s > 0,
    _pdf: (x) => Math.exp(x !== 0 ? -(Math.log(x) * Math.log(x)) / (2 * (s * s)) - Math.log(s * x * SQRT_2PI) : -Infinity),
    _cdf: (x) => N.ndtr(Math.log(x) / s),
    _ppf: (q) => Math.exp(s * N.ndtri(q)),
  }, [0, Infinity]);
}
function beta(p) {
  const a = p.alpha, b = p.beta;
  return frozen({
    a: 0, b: 1, ok: a > 0 && b > 0,
    _pdf: (x) => N.betapdf(x, a, b),
    _cdf: (x) => N.betainc(a, b, x),
    _ppf: (q) => N.betaincinv(a, b, q),
  }, [0, 1]);
}
function normal(p) {
  return frozen({
    a: -Infinity, b: Infinity, loc: p.mean, scale: p.sd,
    _pdf: (x) => Math.exp(-(x * x) / 2.0) / SQRT_2PI,
    _cdf: N.ndtr,
    _ppf: N.ndtri,
  });
}
function gamma(p) {       // shape, rate
  const k = p.shape;
  return frozen({
    a: 0, b: Infinity, scale: 1.0 / p.rate, ok: k > 0,
    _pdf: (x) => Math.exp((k - 1.0 === 0 ? 0 : (k - 1.0) * Math.log(x)) - x - N.lgamma(k)),
    _cdf: (x) => N.gammainc(k, x),
    _ppf: (q) => N.gammaincinv(k, q),
  }, [0, Infinity]);
}
function uniform(p) {
  const lo = p.low, hi = p.high;
  return frozen({ a: 0, b: 1, loc: lo, scale: hi - lo, _pdf: () => 1.0, _cdf: (x) => x, _ppf: (q) => q }, [lo, hi]);
}
function gpd(p) {         // location, scale, shape
  const c = p.shape;
  const lo = p.location, hi = c >= 0 ? Infinity : p.location - p.scale / c;
  return frozen({
    a: 0, b: c < 0 ? -1.0 / c : Infinity, loc: p.location, scale: p.scale, ok: Number.isFinite(c),
    _pdf: (x) => Math.exp(x === x && c !== 0 ? -((c + 1.0 === 0 ? 0 : (c + 1.0) * Math.log1p(c * x)) / c) : -x),
    _cdf: (x) => -N.invBoxcox1p(-x, -c),
    _ppf: (q) => -N.boxcox1p(-q, -c),
  }, [lo, hi]);
}

// ---------- point_mass: atoms with an allocation ----------
function pointMass(p) {
  const xs = [...p._atoms].sort((u, v) => u[0] - v[0] || u[1] - v[1]);   // [(value, weight)]
  let tot = 0;
  for (const [, w] of xs) tot += w;
  if (tot <= 0) throw new DistError("point_mass total weight must be > 0");
  const cum = [];
  let c = 0.0;
  for (const [v, w] of xs) { c += w / tot; cum.push([c, v]); }
  const q = (pp) => {
    for (const [c_, val] of cum) if (pp <= c_ + 1e-12) return val;
    return cum[cum.length - 1][1];
  };
  const cdf = (x) => {                       // right-continuous step (exact, not grid-interp)
    let s = 0;
    for (const [v, w] of xs) if (v <= x) s += w;
    return s / tot;
  };
  return new Dist({ ppf: q, cdf, support: [xs[0][0], xs[xs.length - 1][0]] });
}

// ---------- weighted_combination: mixture of components ----------
function weightedCombination(p) {
  let tot = 0;
  for (const [, w] of p._components) tot += w;
  if (tot === 0) throw new DistError("weighted_combination total weight must be > 0");
  const comps = p._components.map(([d, w]) => [d, w / tot]);   // [(Dist, weight)]
  const los = comps.map(([d]) => d.support[0]), his = comps.map(([d]) => d.support[1]);
  // an infinite-support component keeps the mixture unbounded on that side — do NOT collapse it
  // to a finite neighbour's bound (that silently truncated the hurdle model to all-zeros).
  const lo = los.some((l) => !Number.isFinite(l)) ? -1e12 : Math.min(...los);
  const hi = his.some((h) => !Number.isFinite(h)) ? 1e12 : Math.max(...his);
  const cdf = (x) => {
    let s = 0;
    for (const [d, w] of comps) {
      let c;
      if (d._cdf !== null) c = d._cdf(x);
      else {
        if (!d._mixGrid) d._mixGrid = d.ppf(MIX_GRID);
        let n = 0;
        for (const v of d._mixGrid) if (v <= x) n++;
        c = n / MIX_GRID.length;
      }
      s += w * c;
    }
    return s;
  };
  return new Dist({ cdf, support: [lo, hi] });
}

// ---------- metalog (unbounded, lower-, upper-, or doubly-bounded), k terms ----------
function metalog(p) {
  const anchors = p._anchors;                 // [(prob, x)]
  const K = p.k ?? 5, mass0 = p.zero_mass ?? 0.0;
  const bl = p.lower_bound ?? null, bu = p.upper_bound ?? null;
  const basis = (y) => {
    const z = Math.log(y / (1 - y)), c = y - 0.5;
    return [1.0, z, c * z, c, c * c, c * c * z].slice(0, K);
  };
  // boundedness transform (Keelin 2016): fit in the unbounded z-space, invert back to x.
  //   none: z = x                              lower bl: x = bl + e^z
  //   upper bu: x = bu - e^-z                  both [bl,bu]: x = (bl + bu·e^z)/(1 + e^z)  (log-odds)
  const fwd = (x) => {
    if (bl !== null && bu !== null) return logPos((x - bl) / (bu - x));
    if (bl !== null) return logPos(x - bl);
    if (bu !== null) return -logPos(bu - x);
    return x;
  };
  const inv = (M) => {
    if (bl !== null && bu !== null) { const e = Math.exp(M); return (bl + bu * e) / (1.0 + e); }
    if (bl !== null) return bl + Math.exp(M);
    if (bu !== null) return bu - Math.exp(-M);
    return M;
  };
  const tp = anchors.map(([q, x]) => [q, fwd(x)]);
  const coef = N.lstsq(tp.map(([q]) => basis(q)), tp.map(([, t]) => t));
  const Qy = (y) => inv(N.dot(coef, basis(y)));
  // monotonicity guard
  let prev = Qy(GRID[0]);
  for (let i = 1; i < GRID.length; i++) {
    const v = Qy(GRID[i]);
    if (v - prev <= 0) throw new DistError("metalog non-monotonic — infeasible fit");
    prev = v;
  }
  const lo0 = bl !== null ? bl : Qy(1e-4);
  const hi0 = bu !== null ? bu : Qy(1 - 1e-4);
  return new Dist({ ppf: (pp) => (pp <= mass0 ? lo0 : Qy((pp - mass0) / (1 - mass0))), support: [lo0, hi0] });
}
/** log of a bound-transform argument, which must be positive. */
function logPos(x) {
  if (x <= 0) throw new DistError("an anchor lies outside the metalog's bounds");
  return Math.log(x);
}

// ---------- splice: piecewise body + tail joined at a shared x-value ----------
function splice(p) {
  const [body, tail] = p._segments;           // [Dist body, Dist tail]
  const atX = p._at;                          // splice x-value (== tail location, e.g. 400)
  const pstar = body.cdf(atX);                // probability mass in the body up to the splice
  return new Dist({
    ppf: (pp) => (pp <= pstar ? body.ppf(pp) : tail.ppf((pp - pstar) / (1 - pstar))),
    support: [body.support[0], tail.support[1]],
  });
}

// ---------- piecewise: monotone interpolation of stated quantiles ----------
/** Quantile function through stated (prob, value) points: log-linear between two positive values,
 *  linear (floored at 0) when either is <= 0; the end segments extend past the outer points. The
 *  simulator's empirical fallback uses exactly this rule (montecarlo-engine quantile.ts interpLog). */
function piecewise(p) {
  const pts = [...p._anchors].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (pts.length < 2) throw new DistError("piecewise needs >= 2 anchors");
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] < pts[i - 1][1]) throw new DistError("piecewise anchors must be non-decreasing");
  }
  const seg = (a, b, u) => {
    const d = b[0] - a[0], t = d === 0 ? 0.0 : (u - a[0]) / d;
    if (a[1] > 0 && b[1] > 0) return Math.exp(Math.log(a[1]) + t * (Math.log(b[1]) - Math.log(a[1])));
    return Math.max(0.0, a[1] + t * (b[1] - a[1]));
  };
  const q = (u) => {
    if (u <= pts[0][0]) return seg(pts[0], pts[1], u);
    for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) return seg(pts[i - 1], pts[i], u);
    return seg(pts[pts.length - 2], pts[pts.length - 1], u);
  };
  return new Dist({ ppf: q, support: [q(1e-9), q(1 - 1e-9)] });
}

const KINDS = {
  lognormal, beta, normal, gamma, uniform, generalized_pareto: gpd, point_mass: pointMass,
  weighted_combination: weightedCombination, metalog, splice, piecewise,
};

export function construct(kind, params) {
  if (!Object.hasOwn(KINDS, kind)) throw new DistError(`unknown distribution kind: ${kind}`);
  return KINDS[kind](params);
}

/** Condition a distribution on [lower, upper] — the node's truncation (I16). Percentiles are
 *  then derived from the truncated distribution, so nothing falls outside the declared bounds. */
export function truncate(dist, lower = null, upper = null) {
  const lo = lower === null || lower === undefined ? dist.support[0] : lower;
  const hi = upper === null || upper === undefined ? dist.support[1] : upper;
  const ca = !Number.isFinite(lo) ? 0.0 : dist.cdf(lo);
  const cb = !Number.isFinite(hi) ? 1.0 : dist.cdf(hi);
  if (cb - ca <= 0) throw new DistError("truncation bounds enclose no probability mass");
  return new Dist({
    ppf: (pp) => dist.ppf(ca + pp * (cb - ca)),
    cdf: (x) => (x <= lo ? 0.0 : x >= hi ? 1.0 : (dist.cdf(x) - ca) / (cb - ca)),
    support: [lo, hi],
  });
}
