"""The closed formula grammar: arithmetic + min/max/extrapolate_cagr/extrapolate_linear/slope_match
over ids and structure. Also that it refuses anything outside the grammar."""
import math, pytest
import formula as F
import distributions as D

def test_arithmetic_and_ids():
    assert F.evaluate("2 + 3 * 4", {}) == 14
    assert F.evaluate("(2 + 3) * 4", {}) == 20
    assert F.evaluate("2 ** 3 - 1", {}) == 7
    ctx = {"ids": {"in_a": {"value": 10}, "in_b": {"value": 3}}}
    assert F.evaluate("in_a.value * in_b.value", ctx) == 30
    assert F.evaluate("in_a.value / in_b.value", ctx) == pytest.approx(10 / 3)

def test_min_max():
    ctx = {"ids": {"in_a": {"value": 5}, "in_b": {"value": 2}}}
    assert F.evaluate("min(in_a.value, in_b.value)", ctx) == 2
    assert F.evaluate("max(in_a.value, in_b.value, 9)", ctx) == 9

def test_extrapolate_cagr_dict_series():
    ctx = {"ids": {"obs_s": {"series": [{"period": 2021, "value": 78841}, {"period": 2024, "value": 236888}]}}}
    r = F.evaluate("extrapolate_cagr(obs_s.series, 2026)", ctx)
    cagr = (236888 / 78841) ** (1 / 3) - 1
    assert r == pytest.approx(236888 * (1 + cagr) ** 2, rel=1e-9)

def test_extrapolate_cagr_pair_series():
    ctx = {"ids": {"obs_s": {"series": [[2020, 100], [2022, 144]]}}}   # 20%/yr
    assert F.evaluate("extrapolate_cagr(obs_s.series, 2023)", ctx) == pytest.approx(172.8, rel=1e-6)

def test_extrapolate_linear():
    ctx = {"ids": {"obs_s": {"series": [{"period": 2020, "value": 10}, {"period": 2022, "value": 20}]}}}
    assert F.evaluate("extrapolate_linear(obs_s.series, 2024)", ctx) == pytest.approx(30, rel=1e-9)

def test_slope_match():
    sigma = (math.log(400) - math.log(20)) / 1.2816
    body = D.construct("lognormal", {"median": 20, "sigma": sigma})
    r = F.evaluate("slope_match(segments[0], splices[0])", {"segments": [body], "splices": [400], "ids": {}})
    # continuity: sigma_gpd = (1 - F(x)) / f(x) at x=400
    assert r == pytest.approx((1 - body.cdf(400)) / body.pdf(400), rel=1e-9)
    assert r == pytest.approx(532.755, rel=1e-3)

def test_nested_functions():
    ctx = {"ids": {"in_a": {"value": 4}}}
    assert F.evaluate("max(min(in_a.value, 10), sqrt(in_a.value))", ctx) == 4
    assert F.evaluate("log(exp(2))", {}) == pytest.approx(2)

def test_grammar_rejects_arbitrary_code():
    with pytest.raises(Exception):
        F.evaluate("__import__('os').system('echo hi')", {})
    with pytest.raises(Exception):
        F.evaluate("open('x')", {})
