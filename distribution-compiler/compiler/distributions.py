# -*- coding: utf-8 -*-
"""Distribution construction: a grounded description (kind + params) -> a quantile function Q(p)
and the derived percentiles. Deterministic, node-local. scipy for the parametric families;
ported fits for metalog and the lognormal-body+GPD-tail splice.

Every constructor takes a `params` dict of already-resolved scalars (numbers) and returns an
object with `.ppf(p)` (accepts a float or a list) plus a `.support` (lo, hi).
"""
import math
import numpy as np
from scipy import stats, optimize

PS = (0.05, 0.10, 0.50, 0.90, 0.95)
_GRID = np.linspace(1e-4, 1 - 1e-4, 4000)   # shared probability grid for numeric cdf/monotonicity/mean

def _elementwise(arr, fn):
    """Apply a scalar quantile function fn(p) over a ppf input array -> float ndarray."""
    return np.array([fn(pp) for pp in arr], dtype=float)

class Dist:
    """Wraps a scipy frozen dist OR a (cdf, support) pair for numeric inversion."""
    def __init__(self, ppf=None, cdf=None, pdf=None, support=(-np.inf, np.inf)):
        self._ppf = ppf; self._cdf = cdf; self._pdf = pdf; self.support = support
    def pdf(self, x):
        if self._pdf is None: raise ValueError("no pdf for this construction (needed by slope_match)")
        return float(self._pdf(x))
    def cdf(self, x):
        if self._cdf is not None: return float(self._cdf(x))
        return float(np.interp(x, self.ppf(_GRID), _GRID))
    def ppf(self, p):
        arr = np.atleast_1d(np.asarray(p, dtype=float))
        if self._ppf is not None:
            out = self._ppf(arr)
        else:
            lo, hi = self.support
            lo = -1e12 if not np.isfinite(lo) else lo
            hi =  1e12 if not np.isfinite(hi) else hi
            clo, chi = self._cdf(lo), self._cdf(hi)   # clamp on boundary mass (point_mass / hurdle)
            out = []
            for pp in arr:
                if pp <= 0 or pp <= clo: out.append(lo)
                elif pp >= 1 or pp >= chi: out.append(hi)
                else: out.append(optimize.brentq(lambda x: self._cdf(x) - pp, lo, hi, xtol=1e-9))
            out = np.array(out)
        return out if np.ndim(p) else float(out[0])
    def percentiles(self, ps=PS):
        return {f"p{round(p*100):02d}": round(float(self.ppf(p)), 6) for p in ps}

# ---------- parametric families (scipy) ----------
def _frozen(d, support=(-np.inf, np.inf)):
    """Wrap a scipy frozen distribution as a Dist (ppf/cdf/pdf come from scipy)."""
    return Dist(ppf=d.ppf, cdf=d.cdf, pdf=d.pdf, support=support)
def _lognormal(p):   # median, sigma  (X = exp(mu+sigma Z), median = exp(mu))
    return _frozen(stats.lognorm(s=p["sigma"], scale=p["median"]), (0, np.inf))
def _beta(p):
    return _frozen(stats.beta(p["alpha"], p["beta"]), (0, 1))
def _normal(p):
    return _frozen(stats.norm(p["mean"], p["sd"]))
def _gamma(p):       # shape, rate
    return _frozen(stats.gamma(a=p["shape"], scale=1.0/p["rate"]), (0, np.inf))
def _uniform(p):
    lo, hi = p["low"], p["high"]; return _frozen(stats.uniform(lo, hi-lo), (lo, hi))
def _gpd(p):         # location, scale, shape
    d = stats.genpareto(c=p["shape"], loc=p["location"], scale=p["scale"])
    lo = p["location"]; hi = np.inf if p["shape"] >= 0 else p["location"] - p["scale"]/p["shape"]
    return _frozen(d, (lo, hi))

# ---------- point_mass: atoms with an allocation ----------
def _point_mass(p):
    atoms = p["_atoms"]                       # [(value, weight)]
    xs = sorted(atoms); tot = sum(w for _, w in xs)
    if tot <= 0:
        raise ValueError("point_mass total weight must be > 0")
    cum = []; c = 0.0
    for v, w in xs: c += w/tot; cum.append((c, v))
    def q(pp):
        for c_, val in cum:
            if pp <= c_ + 1e-12: return val
        return cum[-1][1]
    def ppf(arr): return _elementwise(arr, q)
    def cdf(x):                               # right-continuous step (exact, not grid-interp)
        return sum(w for v, w in xs if v <= x) / tot
    return Dist(ppf=ppf, cdf=cdf, support=(xs[0][0], xs[-1][0]))

# ---------- weighted_combination: mixture of components ----------
def _weighted_combination(p):
    comps = p["_components"]                   # [(Dist, weight)]
    tot = sum(w for _, w in comps); comps = [(d, w/tot) for d, w in comps]
    los = [d.support[0] for d, _ in comps]; his = [d.support[1] for d, _ in comps]
    # an infinite-support component keeps the mixture unbounded on that side — do NOT collapse it
    # to a finite neighbour's bound (that silently truncated the hurdle model to all-zeros).
    lo = -1e12 if any(not np.isfinite(l) for l in los) else min(los)
    hi =  1e12 if any(not np.isfinite(h) for h in his) else max(his)
    def cdf(x):
        return sum(w * (d._cdf(x) if d._cdf is not None else float(np.mean(d.ppf(np.linspace(.001,.999,999)) <= x)))
                   for d, w in comps)
    return Dist(cdf=cdf, support=(lo, hi))

# ---------- metalog (unbounded, lower-, upper-, or doubly-bounded), k terms ----------
def _metalog(p):
    anchors = p["_anchors"]                    # [(prob, x)]
    K = p.get("k", 5); mass0 = p.get("zero_mass", 0.0)
    bl = p.get("lower_bound", None); bu = p.get("upper_bound", None)
    def basis(y):
        z = math.log(y/(1-y)); c = y-0.5
        return [1.0, z, c*z, c, c*c, c*c*z][:K]
    # boundedness transform (Keelin 2016): fit in the unbounded z-space, invert back to x.
    #   none: z = x                              lower bl: x = bl + e^z
    #   upper bu: x = bu - e^-z                  both [bl,bu]: x = (bl + bu·e^z)/(1 + e^z)  (log-odds)
    def fwd(x):
        if bl is not None and bu is not None: return math.log((x - bl) / (bu - x))
        if bl is not None: return math.log(x - bl)
        if bu is not None: return -math.log(bu - x)
        return x
    def inv(M):
        if bl is not None and bu is not None: e = math.exp(M); return (bl + bu*e) / (1.0 + e)
        if bl is not None: return bl + math.exp(M)
        if bu is not None: return bu - math.exp(-M)
        return M
    tp = [(q, fwd(x)) for q, x in anchors]
    A = np.array([basis(q) for q, _ in tp]); b = np.array([t for _, t in tp])
    coef, *_ = np.linalg.lstsq(A, b, rcond=None)
    def Qy(y): return inv(float(np.dot(coef, basis(y))))
    # monotonicity guard
    if np.any(np.diff([Qy(y) for y in _GRID]) <= 0):
        raise ValueError("metalog non-monotonic — infeasible fit")
    lo0 = bl if bl is not None else Qy(1e-4)
    hi0 = bu if bu is not None else Qy(1 - 1e-4)
    def ppf(arr): return _elementwise(arr, lambda pp: lo0 if pp <= mass0 else Qy((pp-mass0)/(1-mass0)))
    return Dist(ppf=ppf, support=(lo0, hi0))

# ---------- splice: piecewise body + tail joined at a shared x-value ----------
def _splice(p):
    segs = p["_segments"]                      # [Dist body, Dist tail]
    at_x = p["_at"]                            # splice x-value (== tail location, e.g. 400)
    body, tail = segs[0], segs[1]
    pstar = body.cdf(at_x)                     # probability mass in the body up to the splice
    def ppf(arr):
        return _elementwise(arr, lambda pp: float(body.ppf(pp)) if pp <= pstar
                            else float(tail.ppf((pp-pstar)/(1-pstar))))
    return Dist(ppf=ppf, support=(body.support[0], tail.support[1]))

# ---------- piecewise: monotone interpolation of stated quantiles ----------
def _piecewise(p):
    """Quantile function through stated (prob, value) points: log-linear between two positive values,
    linear (floored at 0) when either is <= 0; the end segments extend past the outer points. The
    simulator's empirical fallback uses exactly this rule (montecarlo-engine quantile.ts interpLog)."""
    pts = sorted(p["_anchors"])
    if len(pts) < 2: raise ValueError("piecewise needs >= 2 anchors")
    if any(b[1] < a[1] for a, b in zip(pts, pts[1:])): raise ValueError("piecewise anchors must be non-decreasing")
    def seg(a, b, u):
        d = b[0] - a[0]; t = 0.0 if d == 0 else (u - a[0]) / d
        if a[1] > 0 and b[1] > 0: return math.exp(math.log(a[1]) + t * (math.log(b[1]) - math.log(a[1])))
        return max(0.0, a[1] + t * (b[1] - a[1]))
    def q(u):
        if u <= pts[0][0]: return seg(pts[0], pts[1], u)
        for i in range(1, len(pts)):
            if u <= pts[i][0]: return seg(pts[i - 1], pts[i], u)
        return seg(pts[-2], pts[-1], u)
    def ppf(arr): return _elementwise(arr, q)
    return Dist(ppf=ppf, support=(q(1e-9), q(1 - 1e-9)))

_KINDS = {
    "lognormal": _lognormal, "beta": _beta, "normal": _normal, "gamma": _gamma,
    "uniform": _uniform, "generalized_pareto": _gpd, "point_mass": _point_mass,
    "weighted_combination": _weighted_combination, "metalog": _metalog, "splice": _splice,
    "piecewise": _piecewise,
}

def construct(kind, params):
    if kind not in _KINDS: raise ValueError(f"unknown distribution kind: {kind}")
    return _KINDS[kind](params)

def truncate(dist, lower=None, upper=None):
    """Condition a distribution on [lower, upper] — the node's truncation (I16). Percentiles are
    then derived from the truncated distribution, so nothing falls outside the declared bounds."""
    lo = dist.support[0] if lower is None else lower
    hi = dist.support[1] if upper is None else upper
    ca = 0.0 if not np.isfinite(lo) else float(dist.cdf(lo))
    cb = 1.0 if not np.isfinite(hi) else float(dist.cdf(hi))
    if cb - ca <= 0:
        raise ValueError("truncation bounds enclose no probability mass")
    def ppf(arr): return _elementwise(arr, lambda pp: float(dist.ppf(ca + pp * (cb - ca))))
    def cdf(x):
        if x <= lo: return 0.0
        if x >= hi: return 1.0
        return (float(dist.cdf(x)) - ca) / (cb - ca)
    return Dist(ppf=ppf, cdf=cdf, support=(lo, hi))
