#!/usr/bin/env python3
"""Preview a distribution's percentiles without authoring a node or running the full compiler —
and fit params to target quantiles (the actual authoring task). No corpus, no file write, no hook.

  # percentiles + support + mean for an inline construction (params: plain numbers or value objects)
  python3 compiler/preview.py '{"kind":"lognormal","median":9,"sigma":0.64}'
  python3 compiler/preview.py '{"kind":"splice","segments":[...],"splices":[...]}'

  # fit params to hit target quantiles, then show the resulting percentiles
  python3 compiler/preview.py fit beta p10=0.25 p90=0.70
  python3 compiler/preview.py fit lognormal p50=9 p90=20
  python3 compiler/preview.py fit normal p10=100 p90=140
  python3 compiler/preview.py fit gamma p10=0.1 p50=0.47 p90=1.5
  python3 compiler/preview.py fit metalog p10=50 p50=120 p90=400 [--lower=0]   # a source-stated LADDER

Reach for `metalog` when a source states a quantile LADDER (>=3 points) whose shape isn't a clean
parametric family — asymmetric, or lower-bounded (a $0 floor). A lognormal fit to just p10/p90
throws away a stated p50 that disagrees; a metalog honors every anchor.

CHOOSING THE ANCHOR PROBABILITIES (this is where ladders go wrong):
  - Source STATES the percentiles ("25th pct = X, median = Y, 90th = Z", levels.fyi p25/50/75/90,
    a ChartMogul retention decile table) -> anchor at the source's OWN stated percentiles.
  - Values are DATA POINTS / observed items (list-price tiers, an enumeration, measured samples) ->
    they are NOT p10/p90. Use plotting positions p_i = i/(n+1) (Weibull): for n=3 that is
    0.25/0.50/0.75, for n=4 0.20/0.40/0.60/0.80. Anchoring 3 data points at 0.10/0.50/0.90 pretends
    the outer two span an 80% interval they don't — it makes the fit far too narrow.
  - Values are a SUBJECTIVE low/median/high elicitation ("my plausible low/typical/high") -> that IS
    an 80% credible interval, so 0.10/0.50/0.90 is the correct convention; keep it.
"""
import sys, os, json, math
import numpy as np
from scipy import stats, optimize
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import distributions as D
import compile as C

Z = lambda p: float(stats.norm.ppf(p))

def show(dist):
    pct = dist.percentiles()
    grid = dist.ppf(D._GRID); mean = float(np.mean(grid))
    lo, hi = dist.support
    print("  percentiles:", {k: round(v, 6) for k, v in pct.items()})
    print(f"  mean≈{mean:.6g}   support=({lo:.6g}, {hi:.6g})")

def fit(kind, targets):
    """targets: {prob: value}. Returns a params dict for `kind`."""
    ps = sorted(targets); (p1, p2) = ps[0], ps[-1]; v1, v2 = targets[p1], targets[p2]
    if kind == "normal":
        sd = (v2 - v1) / (Z(p2) - Z(p1)); return {"mean": round(v1 - Z(p1) * sd, 6), "sd": round(sd, 6)}
    if kind == "lognormal":
        sig = (np.log(v2) - np.log(v1)) / (Z(p2) - Z(p1))
        med = np.exp(np.log(v1) - Z(p1) * sig); return {"median": round(float(med), 6), "sigma": round(float(sig), 6)}
    if kind == "beta":
        def resid(ab): a, b = ab; return [stats.beta.ppf(p1, a, b) - v1, stats.beta.ppf(p2, a, b) - v2]
        a, b = optimize.fsolve(resid, [2.0, 2.0], full_output=False); return {"alpha": round(float(a), 6), "beta": round(float(b), 6)}
    if kind == "gamma":
        pm = ps[len(ps) // 2]; vm = targets[pm]
        def resid(kr):
            k, r = abs(kr[0]), abs(kr[1])
            return [stats.gamma.ppf(p1, k, scale=1/r) - v1, stats.gamma.ppf(pm, k, scale=1/r) - vm]
        k, r = optimize.fsolve(resid, [1.5, 1.0]); return {"shape": round(abs(float(k)), 6), "rate": round(abs(float(r)), 6)}
    sys.exit(f"fit not supported for kind '{kind}' (have: normal, lognormal, beta, gamma)")

def _grounded_form(kind, targets):
    """For lognormal/normal, the params are a closed form of two quantiles — so author them as
    GROUNDED computed_value formulas over your two source observations, not inferred numbers."""
    ps = sorted(targets)
    if kind not in ("lognormal", "normal") or len(ps) < 2: return
    lo, hi = ps[0], ps[-1]; zlo, zhi = Z(lo), Z(hi); zspread = round(zhi - zlo, 4)
    print(f"  ↳ prefer computed_value (grounded, not inferred) — replace <lo>/<hi> with your "
          f"p{round(lo*100):02d}/p{round(hi*100):02d} source obs:")
    if kind == "lognormal":
        med = "exp((log(<lo>.value) + log(<hi>.value)) / 2)" if abs(zlo + zhi) < 1e-9 else \
              f"exp(log(<lo>.value) - ({round(zlo,4)}) * (log(<hi>.value) - log(<lo>.value)) / {zspread})"
        print(f"      median: {med}")
        print(f"      sigma:  (log(<hi>.value) - log(<lo>.value)) / {zspread}")
    else:
        mean = "(<lo>.value + <hi>.value) / 2" if abs(zlo + zhi) < 1e-9 else \
               f"<lo>.value - ({round(zlo,4)}) * (<hi>.value - <lo>.value) / {zspread}"
        print(f"      mean: {mean}")
        print(f"      sd:   (<hi>.value - <lo>.value) / {zspread}")

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    if sys.argv[1] == "fit":
        kind = sys.argv[2]; targets = {}; lower = None; upper = None
        for tok in sys.argv[3:]:
            if tok.startswith("--lower="): lower = float(tok.split("=", 1)[1]); continue
            if tok.startswith("--upper="): upper = float(tok.split("=", 1)[1]); continue
            k, v = tok.split("="); targets[int(k.lstrip("p")) / 100.0] = float(v)
        if kind == "metalog":                           # a source-stated quantile LADDER (3+ points),
            anchors = sorted(targets.items())           # asymmetric / bounded — not a parametric shape
            if len(anchors) < 2: sys.exit("metalog needs >= 2 quantiles (a ladder), e.g. fit metalog p10=50 p50=120 p90=400 [--lower=0] [--upper=1]")
            params = {"_anchors": [(p, v) for p, v in anchors], "k": len(anchors),
                      "lower_bound": lower, "upper_bound": upper, "zero_mass": 0.0}
            try:
                d = D.construct("metalog", params)
            except Exception as e:
                sys.exit(f"metalog infeasible: {e} — reduce k, widen the spacing, or set --lower=<bound>")
            authored = {"kind": "metalog", "k": len(anchors),
                        **({"lower_bound": lower} if lower is not None else {}),
                        **({"upper_bound": upper} if upper is not None else {}),
                        "anchors": [{"prob": p, "value": v} for p, v in anchors]}
            print("author this distribution (each anchor is a source quantile — reference the obs on `value`):")
            print("  " + json.dumps(authored))
            show(d)
            return
        params = fit(kind, targets)
        try:                                            # reject inverted targets (→ negative scale → NaN)
            d = D.construct(kind, params)
            bad = any(not math.isfinite(d.ppf(p)) for p in targets)
        except Exception:
            bad = True
        if bad:
            sys.exit(f"fit produced an infeasible distribution {params} — the higher-probability value must be larger")
        print(f"fit {kind}: {json.dumps(params)}")
        show(d)
        _grounded_form(kind, targets)
    else:
        dist_json = json.loads(sys.argv[1])
        diag = C.Diag("preview")
        ctx = {"ids": {}, "_corpus": ({}, {}, {}), "segments": [], "splices": []}
        dist = C.build_dist(dist_json, ctx, diag, "preview")
        for lvl, _n, p, m in diag: print(f"  {'✗' if lvl=='error' else '⚠'} {p}: {m}")
        if dist is None: sys.exit("could not construct")
        show(dist)

if __name__ == "__main__":
    main()
