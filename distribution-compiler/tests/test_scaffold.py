"""scaffold.py lifts a simulator's hand-authored node into a project file + a speculation; compiling
the result must reproduce the authored percentiles exactly, with every anchor machine-checked."""
import json, os, subprocess, sys
import scaffold

COMPILER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "compiler", "compile.py")
SCAFFOLD = os.path.join(os.path.dirname(COMPILER), "scaffold.py")


def hand(key, pctiles, bound="semi-lo", label="Free signups (count)"):
    return {"key": key, "node": key.split("::")[-1], "label": label, "source": "hand", "kind": "value", "bound": bound,
            "pctiles": pctiles, "prov": {k: "inferred" for k in pctiles}, "conf": "low", "basis": "why", "urls": ["https://x.example"]}


def test_anchors_restate_the_specs_quantiles():
    key, node, sid, spec, note = scaffold.scaffold(hand("demo::signups", {"p10": 200, "p50": 1500, "p90": 42000}), "demo")
    d = node["distribution"]
    assert d["kind"] == "metalog" and d["k"] == 3 and d["lower_bound"] == 0.0 and "upper_bound" not in d
    assert [(a["prob"], a["value"]["quantile"], a["value"]["reference"]) for a in d["anchors"]] == [(0.1, "p10", sid), (0.5, "p50", sid), (0.9, "p90", sid)]
    assert spec["measure"]["quantiles"] == {"p10": 200, "p50": 1500, "p90": 42000}
    assert node["support_score"] < 40 and note == ""


def test_fractions_are_doubly_bounded():
    _, node, *_ = scaffold.scaffold(hand("demo::conv", {"p10": 0.01, "p50": 0.03, "p90": 0.08}, bound="bounded"), "demo")
    assert node["distribution"]["kind"] == "metalog" and node["distribution"]["upper_bound"] == 1.0


def test_a_point_on_a_bound_falls_back_to_piecewise_like_the_hand_path():
    for pct, bound in (({"p10": 0, "p50": 3000, "p90": 12000}, "semi-lo"), ({"p01": 0.4, "p50": 0.82, "p90": 0.98, "p99": 1}, "bounded")):
        _, node, _, _, note = scaffold.scaffold(hand("demo::x", pct, bound=bound), "demo")
        d = node["distribution"]
        assert d["kind"] == "piecewise" and "bound" in note
        assert [a["value"]["measure"]["value"] for a in d["anchors"]] == list(pct.values())


def test_a_constant_is_one_atom():
    _, node, *_ = scaffold.scaffold(hand("demo::units", {"p10": 1, "p50": 1, "p90": 1}, bound="bounded"), "demo")
    assert node["distribution"]["kind"] == "point_mass" and node["distribution"]["atoms"][0]["value"]["measure"]["value"] == 1


def test_scaffold_then_compile_round_trips(tmp_path):
    root = tmp_path
    (root / "projects").mkdir(); (root / "corpus").mkdir()
    for f in ("observations.json", "general-knowledge.json", "speculations.json"):
        (root / "corpus" / f).write_text("{}\n")
    cov = {"projects": [{"id": "demo", "nodes": [
        hand("demo::signups", {"p01": 40, "p10": 200, "p50": 1500, "p90": 42000, "p99": 400000}),
        hand("demo::conv", {"p10": 0.01, "p50": 0.03, "p90": 0.08}, bound="bounded", label="Conversion"),
        hand("demo::head", {"p01": 0.4, "p10": 0.55, "p50": 0.82, "p90": 0.98, "p99": 1}, bound="bounded", label="Headwind"),
        hand("demo::fee", {"p10": 0, "p50": 3000, "p90": 12000}, label="Setup fee (USD)"),
        hand("demo::units", {"p10": 1, "p50": 1, "p90": 1}, bound="bounded", label="Units"),
    ]}]}
    (root / "cov.json").write_text(json.dumps(cov))
    env = {**os.environ, "FORECASTER_DATA": str(root)}
    subprocess.run([sys.executable, SCAFFOLD, str(root / "cov.json"), "demo", "--write"], env=env, check=True, capture_output=True)
    r = subprocess.run([sys.executable, COMPILER, "projects/demo.json", "--write"], env=env, cwd=root, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "0 error(s), 0 warning(s)" in r.stdout
    built = json.loads((root / "build" / "demo.compiled.json").read_text())["nodes"]
    q = built["demo::signups"]["debug_computed_percentiles"]
    assert abs(q["p10"] - 200) < 1e-3 and abs(q["p50"] - 1500) < 1e-2 and abs(q["p90"] - 42000) < 1
    q = built["demo::conv"]["debug_computed_percentiles"]
    assert abs(q["p50"] - 0.03) < 1e-6 and q["p95"] < 1
    q = built["demo::fee"]["debug_computed_percentiles"]
    assert q["p10"] == 0 and abs(q["p50"] - 3000) < 1e-6 and abs(q["p95"] - 12000 * 4 ** (0.05 / 0.4)) < 1e-3


def test_compile_rejects_an_anchor_outside_the_bounds(tmp_path):
    root = tmp_path
    (root / "projects").mkdir(); (root / "corpus").mkdir()
    for f in ("observations.json", "general-knowledge.json", "speculations.json"):
        (root / "corpus" / f).write_text("{}\n")
    node = {"unit": "fraction 0-1", "model_definition": "x", "support_score": 10, "reasoning": "x",
            "distribution": {"kind": "metalog", "k": 3, "lower_bound": 0, "upper_bound": 1,
                             "anchors": [{"prob": p, "value": {"value_type": "inferred_value", "measure": {"value": v}, "reasoning": "x", "confidence": 10}}
                                         for p, v in ((0.1, 0.5), (0.5, 0.9), (0.9, 1.0))]}}
    (root / "projects" / "demo.json").write_text(json.dumps({"demo::x": node}))
    r = subprocess.run([sys.executable, COMPILER, "projects/demo.json"], env={**os.environ, "FORECASTER_DATA": str(root)}, cwd=root, capture_output=True, text=True)
    assert r.returncode == 1 and "outside the bounds" in r.stdout and "Traceback" not in r.stderr
