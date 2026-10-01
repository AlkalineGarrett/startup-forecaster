"""Distribution construction + percentile derivation. Parametric families are checked against
scipy directly (the compiler must match); structural kinds by their defining properties."""
import math, numpy as np, pytest
from scipy import stats
import distributions as D

PARAMETRIC = [
    ("lognormal", {"median": 20, "sigma": 0.5}, stats.lognorm(s=0.5, scale=20)),
    ("beta", {"alpha": 4.5, "beta": 2.4}, stats.beta(4.5, 2.4)),
    ("normal", {"mean": 110, "sd": 41}, stats.norm(110, 41)),
    ("gamma", {"shape": 1.3, "rate": 2.1}, stats.gamma(a=1.3, scale=1 / 2.1)),
    ("uniform", {"low": 0.003, "high": 0.012}, stats.uniform(0.003, 0.009)),
    ("generalized_pareto", {"location": 400, "scale": 530, "shape": 0.4}, stats.genpareto(c=0.4, loc=400, scale=530)),
]

@pytest.mark.parametrize("kind,params,sp", PARAMETRIC)
def test_parametric_matches_scipy(kind, params, sp):
    d = D.construct(kind, params)
    for p in (0.05, 0.10, 0.50, 0.90, 0.95):
        assert d.ppf(p) == pytest.approx(float(sp.ppf(p)), rel=1e-6), (kind, p)

@pytest.mark.parametrize("kind,params,_sp", PARAMETRIC)
def test_percentiles_monotonic_finite(kind, params, _sp):
    v = list(D.construct(kind, params).percentiles().values())
    assert all(v[i] <= v[i + 1] + 1e-9 for i in range(len(v) - 1))
    assert all(np.isfinite(x) for x in v)

def test_point_mass_step_cdf():
    d = D.construct("point_mass", {"_atoms": [(10, 0.6), (50, 0.4)]})
    assert d.ppf(0.5) == 10 and d.ppf(0.9) == 50
    assert d.cdf(10) == pytest.approx(0.6)
    assert d.cdf(50) == pytest.approx(1.0)

def test_hurdle_mixture_no_crash_and_clamps():
    # a point_mass at 0 mixed with a continuous beta — the schema's two-part/hurdle model.
    pm = D.construct("point_mass", {"_atoms": [(0.0, 1.0)]})
    be = D.construct("beta", {"alpha": 2, "beta": 3})
    mix = D.construct("weighted_combination", {"_components": [(pm, 0.30), (be, 0.70)]})
    pct = mix.percentiles()
    assert pct["p05"] == 0.0 and pct["p10"] == 0.0          # below the 30% boundary mass
    vals = list(pct.values())
    assert all(vals[i] <= vals[i + 1] + 1e-9 for i in range(len(vals) - 1))

def test_splice_p50_is_body_median():
    sigma = (math.log(400) - math.log(20)) / 1.2816       # lognormal p50=20, p90=400
    body = D.construct("lognormal", {"median": 20, "sigma": sigma})
    scale = 532.755006                                     # slope_match at x=400 (see test_formula)
    tail = D.construct("generalized_pareto", {"location": 400, "scale": scale, "shape": 0.927})
    sp = D.construct("splice", {"_segments": [body, tail], "_at": 400})
    assert sp.ppf(0.50) == pytest.approx(20, rel=1e-3)     # p50 < splice → body
    assert sp.ppf(0.90) == pytest.approx(400, rel=1e-2)    # p90 at the splice
    assert sp.ppf(0.95) > 400                              # tail

def test_metalog_lower_bound_and_zero_mass():
    anchors = [((i + 1) / 7.0, v) for i, v in enumerate([15, 17.5, 19.99, 29, 39.99, 69])]
    d = D.construct("metalog", {"_anchors": anchors, "k": 5, "lower_bound": 0.0, "zero_mass": 0.13})
    pct = d.percentiles()
    assert pct["p05"] == 0.0 and pct["p10"] == 0.0         # below the 13% mass → the lower bound
    assert pct["p50"] > 0
    v = list(pct.values())
    assert all(v[i] <= v[i + 1] + 1e-9 for i in range(len(v) - 1))

def test_metalog_doubly_bounded():
    # a fraction/rate ladder (e.g. annual retention) on [0,1]: the log-odds transform must honor
    # every anchor AND keep the whole distribution inside the bounds (no tail crossing the ceiling).
    anchors = [(0.25, 0.445), (0.5, 0.60), (0.9, 0.83)]
    d = D.construct("metalog", {"_anchors": anchors, "k": 3, "lower_bound": 0.0, "upper_bound": 1.0})
    q = d.ppf(np.array([0.25, 0.50, 0.90]))
    assert abs(q[0] - 0.445) < 1e-6 and abs(q[1] - 0.60) < 1e-6 and abs(q[2] - 0.83) < 1e-6
    grid = d.ppf(np.linspace(1e-4, 1 - 1e-4, 500))
    assert grid.min() >= 0.0 and grid.max() <= 1.0        # no mass outside [0, 1]
    assert d.support == (0.0, 1.0)

def test_metalog_upper_bounded():
    # upper-semi-bounded: x = bu - e^-z, a right-limited quantity with no lower bound
    anchors = [(0.1, 0.60), (0.5, 0.85), (0.9, 0.95)]
    d = D.construct("metalog", {"_anchors": anchors, "k": 3, "upper_bound": 1.0})
    q = d.ppf(np.array([0.1, 0.5, 0.9]))
    assert abs(q[1] - 0.85) < 1e-6
    assert d.ppf(np.array([0.999]))[0] <= 1.0

def test_metalog_infeasible_raises():
    # anchors whose values are non-monotonic in probability cannot fit a monotone quantile curve
    bad = [(0.1, 100), (0.5, 1), (0.9, 50)]
    with pytest.raises(ValueError):
        D.construct("metalog", {"_anchors": bad, "k": 5, "lower_bound": None, "zero_mass": 0.0})

def test_unknown_kind_raises():
    with pytest.raises(ValueError):
        D.construct("nonesuch", {})

# ---- fuzz regressions ----
def test_hurdle_mixture_with_infinite_support_component():
    # point_mass@0 + lognormal (infinite support) once returned ALL ZEROS because the mixture
    # support collapsed to the point-mass bound. The tail must survive.
    pm = D.construct("point_mass", {"_atoms": [(0.0, 1.0)]})
    ln = D.construct("lognormal", {"median": 30, "sigma": 0.7})
    mix = D.construct("weighted_combination", {"_components": [(pm, 0.4), (ln, 0.6)]})
    pct = mix.percentiles()
    assert pct["p05"] == 0.0 and pct["p10"] == 0.0     # below the 40% mass at 0
    assert pct["p50"] > 0 and pct["p90"] > 20          # the lognormal tail is preserved

def test_point_mass_zero_total_weight_raises():
    with pytest.raises(ValueError):
        D.construct("point_mass", {"_atoms": [(0.0, 0.0), (5.0, 0.0)]})

def test_truncate_clips():
    d = D.truncate(D.construct("normal", {"mean": 10, "sd": 50}), lower=0, upper=None)
    pct = d.percentiles()
    assert pct["p05"] >= 0 and pct["p50"] > 10         # nothing below the lower bound; median shifts up
