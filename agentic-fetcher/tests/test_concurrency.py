"""H. Concurrency — the file-locked corpus writers. Spawn many parallel add_observation processes
writing distinct ids to the same documents.json and assert EVERY write survives and the file stays
valid JSON. A lock regression shows up as a lost update or a corrupt file.

Two-root model: the core (for quote-verification) lives under GROUNDING_SOURCES; the corpus written
to lives under FORECASTER_DATA."""
import os, sys, json, subprocess, concurrent.futures
import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADD_OBS = f"{REPO}/add_observation.py"
ADD_KN = f"{REPO}/add_knowledge.py"

def _seed_roots(tmp_path):
    gs = tmp_path / "grounding"; pj = tmp_path / "project"
    for d in (gs, gs / "cores", pj, pj / "corpus"):
        d.mkdir(parents=True, exist_ok=True)
    (gs / "cores" / "doc_test.txt").write_text("the reported metric is 42 percent in the study\n")
    # doc identity → shared registry (GROUNDING); observations get written to PROJECT during the test
    json.dump({"doc_test": {"sha256": "test", "title": "T", "core": "cores/doc_test.txt"}},
              open(gs / "documents.json", "w"))
    json.dump({}, open(pj / "corpus" / "general-knowledge.json", "w"))
    json.dump({}, open(pj / "corpus" / "speculations.json", "w"))
    return gs, pj

def _run(args, gs, pj):
    env = dict(os.environ, FORECASTER_DATA=str(pj), GROUNDING_SOURCES=str(gs))
    return subprocess.run([sys.executable] + args, env=env, capture_output=True, text=True)

def test_parallel_add_observation_no_lost_writes(tmp_path):
    gs, pj = _seed_roots(tmp_path)
    N = 16
    def one(i):
        return _run([ADD_OBS, "doc_test", f"obs_p{i}", "--value", str(i), "--unit", "%",
                     "--statement", f"metric {i}", "--quote", "42 percent"], gs, pj)
    with concurrent.futures.ThreadPoolExecutor(max_workers=N) as ex:
        results = list(ex.map(one, range(N)))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results if r.returncode]
    obs = json.load(open(pj / "corpus" / "observations.json"))             # must still be valid JSON
    missing = [f"obs_p{i}" for i in range(N) if f"obs_p{i}" not in obs]
    assert not missing, f"lost writes under concurrency: {missing}"
    assert all(o["verification"] == "verified" for o in obs.values())

def test_parallel_add_knowledge_no_lost_writes(tmp_path):
    gs, pj = _seed_roots(tmp_path)
    N = 12
    def one(i):
        return _run([ADD_KN, "gk", f"gk_p{i}", "--statement", f"fact {i}", "--reasoning", "r"], gs, pj)
    with concurrent.futures.ThreadPoolExecutor(max_workers=N) as ex:
        results = list(ex.map(one, range(N)))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results if r.returncode]
    gk = json.load(open(pj / "corpus" / "general-knowledge.json"))
    missing = [f"gk_p{i}" for i in range(N) if f"gk_p{i}" not in gk]
    assert not missing, f"lost knowledge writes under concurrency: {missing}"
