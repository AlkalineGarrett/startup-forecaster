"""The evidence-authoring tools (add_observation, add_knowledge), hermetic via monkeypatched roots.
The corpus is written under PROJECT; the core quote-matched against lives under GROUNDING."""
import json, pytest
from types import SimpleNamespace
import add_observation as AO
import add_knowledge as AK

def test_norm_whitespace_and_unicode():
    assert AO._norm("a\n  b\tc") == "a b c"
    assert AO._norm("$10–25") == "$10-25"        # en-dash → hyphen
    assert AO._norm("“q”") == '"q"'          # curly quotes

def _corpus(tmp_path, core_text):
    # GROUNDING and PROJECT are both monkeypatched to tmp_path here, so: the identity registry is
    # tmp_path/documents.json, the core is tmp_path/cores/…, observations go to tmp_path/corpus/…
    (tmp_path / "cores").mkdir()
    (tmp_path / "cores" / "doc_abc.txt").write_text(core_text, encoding="utf-8")
    (tmp_path / "corpus").mkdir()
    (tmp_path / "documents.json").write_text(
        json.dumps({"doc_abc": {"sha256": "a" * 64, "core": "cores/doc_abc.txt"}}))

def _at(monkeypatch, mod, tmp_path):
    """Point a tool module's roots at one tmp dir (it holds both cores/ and corpus/)."""
    if hasattr(mod, "PROJECT"): monkeypatch.setattr(mod, "PROJECT", str(tmp_path))
    if hasattr(mod, "GROUNDING"): monkeypatch.setattr(mod, "GROUNDING", str(tmp_path))

def test_verify_quote_normalized(tmp_path, monkeypatch):
    _at(monkeypatch, AO, tmp_path)
    _corpus(tmp_path, "line one\n76.4%\nline three")
    doc = {"core": "cores/doc_abc.txt"}
    assert AO.verify_quote(doc, "76.4%") == "verified"
    assert AO.verify_quote(doc, "line one 76.4%") == "verified"    # matches across the newline
    assert AO.verify_quote(doc, "not present") == "not_in_doc"
    assert AO.verify_quote({"core": None}, "a real quote") == "unverifiable"
    # a trivial quote can't prove grounding → unchecked (not verified), even if it "appears"
    assert AO.verify_quote(doc, " ") == "unchecked"
    assert AO.verify_quote(doc, "ID") == "unchecked"

def _ns(**kw):
    d = dict(unit="c", value=None, mean=None, mode=None, interval=None, quantiles=None, points=None, series=None, population=None, period=None)
    d.update(kw); return SimpleNamespace(**d)

def test_build_measure_rejects_bad_flags():
    with pytest.raises(SystemExit):
        AO.build_measure(_ns(interval="10,1"))      # low >= high
    with pytest.raises(SystemExit):
        AO.build_measure(_ns(series="FY21:x"))      # non-numeric value

def test_build_measure_all_forms():
    a = SimpleNamespace(unit="c", value=None, mean=None, mode=None, interval="1,9",
                        quantiles="p10:2,p90:8", points=None, series="2021:100,2024:144", population=None, period=None)
    m = AO.build_measure(a)
    assert m["interval"] == {"low": 1.0, "high": 9.0}
    assert m["quantiles"] == {"p10": 2.0, "p90": 8.0}
    assert m["series"] == [{"period": "2021", "value": 100.0}, {"period": "2024", "value": 144.0}]  # schema: string period

def test_build_measure_rejects_named_quantile_keys():
    with pytest.raises(SystemExit):
        AO.build_measure(_ns(quantiles="gaap:72,nongaap:77"))   # named keys must use --points

def test_build_measure_accepts_points():
    m = AO.build_measure(_ns(points="gaap:72,nongaap:77"))
    assert m["points"] == {"gaap": 72.0, "nongaap": 77.0}

def test_add_observation_writes_verified(tmp_path, monkeypatch):
    _at(monkeypatch, AO, tmp_path)
    _corpus(tmp_path, "gross margin 76.4% reported")
    AO.add("doc_abc", "obs_gm", "stmt", "76.4%", "loc", {"unit": "%", "value": 76.4})
    o = json.loads((tmp_path / "corpus" / "observations.json").read_text())["obs_gm"]
    assert o["verification"] == "verified" and o["measure"]["value"] == 76.4
    assert "cited_by" not in o                              # node usage is derived, not stored (citations.py)
    assert o["doc"] == "doc_abc"                           # observation carries its source backref

def test_add_observation_check_does_not_write(tmp_path, monkeypatch):
    _at(monkeypatch, AO, tmp_path)
    _corpus(tmp_path, "value 5 here")
    AO.add("doc_abc", "obs_x", "s", "value 5", "", {"unit": "u", "value": 5}, check=True)
    assert not (tmp_path / "corpus" / "observations.json").exists()   # --check writes nothing

def test_add_knowledge_writes(tmp_path, monkeypatch):
    _at(monkeypatch, AK, tmp_path)
    (tmp_path / "corpus").mkdir()
    (tmp_path / "corpus" / "general-knowledge.json").write_text("{}")
    AK.add("gk", "gk_x", "stmt", "because it is a heuristic", 40, "%", None, None, None)
    d = json.loads((tmp_path / "corpus" / "general-knowledge.json").read_text())
    assert d["gk_x"]["measure"]["value"] == 40 and d["gk_x"]["reasoning"].startswith("because")

def test_add_knowledge_bad_id_prefix(tmp_path, monkeypatch):
    _at(monkeypatch, AK, tmp_path)
    (tmp_path / "corpus").mkdir(); (tmp_path / "corpus" / "speculations.json").write_text("{}")
    with pytest.raises(SystemExit):
        AK.add("spec", "gk_wrongprefix", "s", "r", None, None, None, None, None)
