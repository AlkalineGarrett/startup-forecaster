"""Derivative documents (make_derivative.py) and the audit tooling (audit_prepare / mark_audited).
A derivative doc is computed from originals, reproducible by construction, and self-verifying.

Two-root split: a derivative's IDENTITY (+derivation) and its core land under GROUNDING (the shared
registry + cache); the derived OBSERVATION lands under PROJECT (corpus/observations.json, flat, with
a `doc` backref)."""
import os, sys, json, subprocess, math
import pytest
import make_derivative as MD

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MK = f"{REPO}/make_derivative.py"
PREP = f"{REPO}/audit_prepare.py"
MARK = f"{REPO}/mark_audited.py"

# ---- the compute kernel (pure) ----
def test_compute_methods():
    xs = [12, 29, 22.99, 8.99, 5.49]
    assert MD.compute("median", xs) == pytest.approx(12.0)
    assert MD.compute("mean", xs) == pytest.approx(sum(xs) / 5)
    assert MD.compute("min", xs) == pytest.approx(5.49)
    assert MD.compute("max", xs) == pytest.approx(29.0)
    assert MD.compute("count", xs) == 5
    assert MD.compute("p90", [1, 2, 3, 4, 5]) == pytest.approx(4.6)
    assert MD.compute("cagr", [100, 130, 160, 210]) == pytest.approx((210 / 100) ** (1 / 3) - 1)

def test_compute_cagr_needs_positive_start():
    with pytest.raises(ValueError):
        MD.compute("cagr", [0, 10])

def _roots(tmp_path):
    gs = tmp_path / "grounding"; pj = tmp_path / "project"
    for d in (gs, gs / "cores", pj, pj / "corpus"):
        d.mkdir(parents=True, exist_ok=True)
    # source identity → shared registry (GROUNDING)
    json.dump({"doc_src": {"sha256": "s", "title": "Src", "core": ""}},
              open(gs / "documents.json", "w"))
    # its observation → project's flat observation map, carrying a doc backref
    json.dump({"obs_series": {"statement": "", "measure": {"series": [{"period": "2021", "value": 100},
               {"period": "2024", "value": 210}]}, "quote": "x", "verification": "verified",
               "doc": "doc_src"}}, open(pj / "corpus" / "observations.json", "w"))
    env = dict(os.environ, FORECASTER_DATA=str(pj), GROUNDING_SOURCES=str(gs))
    return env, gs, pj

def _run(args, env): return subprocess.run([sys.executable] + args, env=env, capture_output=True, text=True)
def _reg(gs): return json.load(open(gs / "documents.json"))
def _obs(pj): return json.load(open(pj / "corpus" / "observations.json"))

def test_make_derivative_writes_doc_and_selfverifying_obs(tmp_path):
    env, gs, pj = _roots(tmp_path)
    r = _run([MK, "--title", "Median price (derived)", "--from", "doc_src/obs_series",
              "--records", "12,29,22.99,8.99,5.49", "--compute", "median", "--unit", "USD/mo",
              "--obs", "obs_med", "--statement", "median seat price (derived)"], env)
    assert r.returncode == 0, r.stderr
    der = [d for d in _reg(gs).values() if d.get("origin") == "derivative"]
    assert len(der) == 1
    d = der[0]
    assert d["derivation"]["result"] == 12.0 and d["derived_from"] == ["doc_src/obs_series"]
    o = _obs(pj)["obs_med"]
    assert o["measure"]["value"] == 12.0 and o["derived"] is True
    assert o["doc"] in _reg(gs)                              # backref resolves to a registry entry
    core = (gs / d["core"]).read_text()                      # quote self-verifies against the core
    assert o["quote"] in core

def test_make_derivative_is_deterministic_dedupes(tmp_path):
    env, gs, pj = _roots(tmp_path)
    args = [MK, "--title", "M", "--from", "doc_src", "--records", "1,2,3", "--compute", "mean", "--obs", "obs_m", "--statement", "s"]
    _run(args, env); _run(args, env)
    assert sum(1 for d in _reg(gs).values() if d.get("origin") == "derivative") == 1  # same inputs → one doc

def test_make_derivative_records_from_series(tmp_path):
    env, gs, pj = _roots(tmp_path)
    r = _run([MK, "--title", "CAGR (derived)", "--records-from", "doc_src/obs_series",
              "--compute", "cagr", "--unit", "fraction/yr", "--obs", "obs_cagr", "--statement", "cagr"], env)
    assert r.returncode == 0, r.stderr
    d = [x for x in _reg(gs).values() if x.get("origin") == "derivative"][0]
    assert d["derivation"]["result"] == pytest.approx((210 / 100) ** (1 / 1) - 1)  # 2 points, 1 step

def test_reasoning_derivative(tmp_path):
    env, gs, pj = _roots(tmp_path)
    r = _run([MK, "--title", "PT senior SWE ~EUR90k (synthesis)", "--from", "doc_src",
              "--reasoning", "Levels.fyi and Landing.Jobs bands overlap around 85-95k for senior; take 90k as the central estimate.",
              "--value", "90000", "--unit", "EUR/yr", "--obs", "obs_pt_senior_synth",
              "--statement", "PT senior SWE central estimate EUR90k (reasoning derivative)"], env)
    assert r.returncode == 0, r.stderr
    d = [x for x in _reg(gs).values() if x.get("derivation_kind") == "reasoning"][0]
    assert d["derivation"]["kind"] == "reasoning" and d["derivation"]["result"] == 90000.0
    o = _obs(pj)["obs_pt_senior_synth"]
    assert o["measure"]["value"] == 90000.0 and o["derivation_kind"] == "reasoning"
    assert o["quote"] in (gs / d["core"]).read_text()        # self-verifies

def test_compute_and_reasoning_are_mutually_exclusive(tmp_path):
    env, gs, pj = _roots(tmp_path)
    r = _run([MK, "--title", "bad", "--from", "doc_src", "--records", "1,2", "--compute", "mean",
              "--reasoning", "also reasoning"], env)
    assert r.returncode != 0 and "exactly one" in (r.stderr + r.stdout)

def test_audit_prepare_and_mark(tmp_path):
    env, gs, pj = _roots(tmp_path)
    (pj / "build").mkdir()
    r = _run([PREP, "obs", "2"], env); assert r.returncode == 0, r.stderr
    batches = list((pj / "build" / "audit").glob("batch_*.json"))
    assert batches, "no audit batches written"
    # write a verdict file and mark the obs verified
    vf = pj / "build" / "audit" / "verdicts_A.json"
    json.dump([{"doc": "doc_src", "obs": "obs_series", "verdict": "legit"}], open(vf, "w"))
    r = _run([MARK, "--pass-list", str(vf)], env); assert r.returncode == 0, r.stderr
    assert _obs(pj)["obs_series"]["audit"] == "verified"
    # now that it's verified, audit_prepare should exclude it
    r = _run([PREP, "obs", "2"], env)
    assert "0 across" in r.stdout or "total obs: 0" in r.stdout
