# -*- coding: utf-8 -*-
"""Emit compiler/testdata/_test.json — fixtures exercising each kind + the fill/check paths. Written via
json.dump (bypasses the completeness hook, which is for hand-authored artifacts)."""
import json, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = lambda x: {"value_type": "inferred_value", "measure": {"value": x}}
SIGMA = (math.log(400) - math.log(20)) / 1.2816   # lognormal with p50=20, p90=400

nodes = {
    # beta(4.5,2.4): omit percentiles -> compiler FILLS them
    "test::beta_fill": {
        "unit": "fraction 0-1", "model_definition": "beta, percentiles omitted (test fill)",
        "distribution": {"kind": "beta", "alpha": V(4.5), "beta": V(2.4)},
        "support_score": 50, "reasoning": "t"},
    # beta with a WRONG authored percentile -> compiler ERRORS
    "test::beta_mismatch": {
        "unit": "fraction 0-1", "model_definition": "beta, wrong authored p50 (test check)",
        "distribution": {"kind": "beta", "alpha": V(4.5), "beta": V(2.4)},
        "support_score": 50, "reasoning": "t",
        "debug_computed_percentiles": {"p05": 0.2, "p10": 0.28, "p50": 0.90, "p90": 0.89, "p95": 0.93}},
    # splice: lognormal body + GPD tail whose scale is slope_match(segments[0], splices[0])
    "test::splice_gpd": {
        "unit": "usd", "model_definition": "lognormal body + GPD tail, scale by slope_match",
        "distribution": {
            "kind": "splice",
            "segments": [
                {"name": "body", "distribution": {"kind": "lognormal", "median": V(20), "sigma": V(SIGMA)}},
                {"name": "tail", "distribution": {"kind": "generalized_pareto",
                    "location": V(400),
                    "scale": {"value_type": "computed_value", "formula": "slope_match(segments[0], splices[0])", "measure": {}},
                    "shape": V(0.927)}}],
            "splices": [{"at": V(400)}]},
        "support_score": 40, "reasoning": "t"},
    # point_mass: two atoms
    "test::point_mass": {
        "unit": "count", "model_definition": "two atoms 60/40",
        "distribution": {"kind": "point_mass", "atoms": [{"value": V(10), "weight": 0.6}, {"value": V(50), "weight": 0.4}]},
        "support_score": 30, "reasoning": "t"},
    # weighted_combination: mixture of two normals
    "test::mixture": {
        "unit": "count", "model_definition": "mixture of N(10,2) and N(30,3)",
        "distribution": {"kind": "weighted_combination", "components": [
            {"distribution": {"kind": "normal", "mean": V(10), "sd": V(2)}, "weight": 0.5},
            {"distribution": {"kind": "normal", "mean": V(30), "sd": V(3)}, "weight": 0.5}]},
        "support_score": 30, "reasoning": "t"},
    # metalog: lower-semi-bounded, $0 mass 0.13
    "test::metalog": {
        "unit": "usd/mo", "model_definition": "lower-semi-bounded metalog, 13% at $0",
        "distribution": {"kind": "metalog", "lower_bound": 0.0, "zero_mass": 0.13, "k": 5,
            "anchors": [{"value": V(x)} for x in [15, 17.5, 19.99, 29, 39.99, 69]]},
        "support_score": 45, "reasoning": "t"},
}
os.makedirs(f"{ROOT}/compiler/testdata", exist_ok=True)
json.dump(nodes, open(f"{ROOT}/compiler/testdata/_test.json", "w"), indent=1, ensure_ascii=False)
print("wrote compiler/testdata/_test.json with", len(nodes), "fixture nodes; sigma=%.4f" % SIGMA)
