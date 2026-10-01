"""Source acquisition: install_source (fetched file -> raw archive + cleaned core + MANIFEST + corpus
doc, deduped) and fetch_request (the file-locked human-fetch queue). Plus the chained loop:
install a source, then ground a node's reference against the freshly-extracted core.

Two-root model: the source cache (MANIFEST/cores/queue/tier files) lives under GROUNDING_SOURCES;
the corpus (documents.json) lives under FORECASTER_DATA."""
import os, sys, csv, json, hashlib, subprocess
import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALL = f"{REPO}/install_source.py"
FETCH = f"{REPO}/fetch_request.py"
ADD_OBS = f"{REPO}/add_observation.py"

HTML = ("<!doctype html><html><head><title>Acme Pricing</title><style>.x{color:red}</style></head>"
        "<body><h1>Acme Pricing</h1><p>The Pro plan is $49 per month.</p>"
        "<script>var a=1;</script><p>Gross margin was 82% in FY2025.</p></body></html>")

def _roots(tmp_path):
    """Create separate grounding (source cache + identity registry) and project (corpus) roots."""
    gs = tmp_path / "grounding"; pj = tmp_path / "project"
    for d in (gs, gs / "cores", pj, pj / "corpus"):
        d.mkdir(parents=True, exist_ok=True)
    (gs / "documents.json").write_text("{}")           # the shared source-identity registry
    env = dict(os.environ, FORECASTER_DATA=str(pj), GROUNDING_SOURCES=str(gs))
    return env, gs, pj

def _run(args, env, **kw):
    return subprocess.run([sys.executable] + args, env=env, capture_output=True, text=True, **kw)

def _doc_id(text): return "doc_" + hashlib.sha256(text.encode()).hexdigest()[:12]

def test_install_extracts_clean_core_and_registers(tmp_path):
    env, gs, pj = _roots(tmp_path)
    src = tmp_path / "page.html"; src.write_text(HTML)
    r = _run([INSTALL, str(src), "--url", "https://acme.com/pricing", "--title", "Acme Pricing"], env)
    assert r.returncode == 0, r.stderr
    doc_id = _doc_id(HTML)
    core = (gs / "cores" / f"{doc_id}.txt").read_text()
    assert "The Pro plan is $49 per month." in core
    assert "var a=1" not in core and "color:red" not in core          # script/style stripped
    docs = json.load(open(gs / "documents.json"))      # identity registered in the shared cache
    assert doc_id in docs and docs[doc_id]["publisher"] == "acme.com"
    rows = list(csv.DictReader(open(gs / "MANIFEST.csv")))
    assert [r for r in rows if r["sha256"].startswith(doc_id[4:])]

def test_install_dedupes_identical_bytes(tmp_path):
    env, gs, pj = _roots(tmp_path)
    src = tmp_path / "page.html"; src.write_text(HTML)
    _run([INSTALL, str(src), "--url", "https://acme.com/pricing", "--title", "Acme"], env)
    r2 = _run([INSTALL, str(src), "--url", "https://acme.com/pricing", "--title", "Acme"], env)
    assert "already archived" in r2.stdout
    rows = list(csv.DictReader(open(gs / "MANIFEST.csv")))
    assert len(rows) == 1, "duplicate manifest row written"

def test_install_plain_text_source(tmp_path):
    env, gs, pj = _roots(tmp_path)
    src = tmp_path / "note.txt"; src.write_text("Median seat price is $30 per month across the sample.\n")
    r = _run([INSTALL, str(src), "--url", "https://x.com/n", "--title", "Note"], env)
    assert r.returncode == 0, r.stderr
    core = (gs / "cores" / f"{_doc_id(open(src).read())}.txt").read_text()
    assert "Median seat price is $30" in core

def test_fetch_queue_add_list_resolve(tmp_path):
    env, gs, pj = _roots(tmp_path)
    _run([FETCH, "add", "--url", "https://ashbyhq.com/report", "--why", "JS-rendered",
          "--for", "habit-app::acceptance_rate", "--priority", "top"], env)
    out = _run([FETCH, "list"], env).stdout
    assert "1 pending" in out and "ashbyhq.com/report" in out
    _run([FETCH, "resolve", "--url", "https://ashbyhq.com/report"], env)
    assert "0 pending" in _run([FETCH, "list"], env).stdout

def test_fetch_queue_merges_same_url(tmp_path):
    env, gs, pj = _roots(tmp_path)
    _run([FETCH, "add", "--url", "https://x.com/r", "--for", "a::b", "--why", "reason one"], env)
    _run([FETCH, "add", "--url", "https://x.com/r/", "--for", "c::d", "--why", "reason two"], env)  # trailing slash
    q = [json.loads(l) for l in open(gs / "fetch-queue.jsonl") if l.strip()]
    assert len(q) == 1, "same URL should merge, not duplicate"
    assert set(q[0]["for"]) == {"a::b", "c::d"}

def test_install_autoresolves_matching_request(tmp_path):
    env, gs, pj = _roots(tmp_path)
    _run([FETCH, "add", "--url", "https://acme.com/pricing", "--for", "acme::price", "--priority", "top"], env)
    src = tmp_path / "page.html"; src.write_text(HTML)
    _run([INSTALL, str(src), "--url", "https://acme.com/pricing", "--title", "Acme"], env)
    q = [json.loads(l) for l in open(gs / "fetch-queue.jsonl") if l.strip()]
    assert q[0]["status"] == "resolved"

def test_installed_core_is_quote_verifiable(tmp_path):
    """The whole point: after install, add_observation can quote-verify against the new core."""
    env, gs, pj = _roots(tmp_path)
    src = tmp_path / "page.html"; src.write_text(HTML)
    _run([INSTALL, str(src), "--url", "https://acme.com/pricing", "--title", "Acme"], env)
    doc_id = _doc_id(HTML)
    r = _run([ADD_OBS, doc_id, "obs_price", "--value", "49", "--unit", "USD/mo",
              "--statement", "Pro plan $49/mo", "--quote", "The Pro plan is $49 per month."], env)
    assert r.returncode == 0, r.stderr
    assert "verification=verified" in r.stdout


def test_fetch_queue_check_flags_archived(tmp_path):
    """fetch_request check flags a pending request whose domain is already in the archive."""
    env, gs, pj = _roots(tmp_path)
    (gs / "MANIFEST.csv").write_text(
        "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\n"
        "x,manual,acme.com,Acme,https://acme.com/p,html,1,1,deadbeef,manual/acme.html,x,cited\n")
    _run([FETCH, "add", "--url", "https://acme.com/pricing", "--for", "a::b", "--force"], env)  # --force: it IS archived
    _run([FETCH, "add", "--url", "https://notarchived.example/x", "--for", "c::d"], env)
    out = _run([FETCH, "check"], env).stdout
    assert "POSSIBLE MATCH" in out and "acme.com/pricing" in out
    assert "not in archive" in out and "notarchived.example" in out

def test_fetch_add_refuses_already_archived(tmp_path):
    """add must refuse a domain already in the archive (no --force) — never queue a redundant fetch."""
    env, gs, pj = _roots(tmp_path)
    (gs / "MANIFEST.csv").write_text(
        "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\n"
        "x,manual,acme.com,Acme,https://acme.com/p,html,1,1,deadbeef,manual/acme.html,x,cited\n")
    r = _run([FETCH, "add", "--url", "https://acme.com/pricing", "--for", "a::b"], env)
    assert "NOT queued" in r.stdout
    assert not (gs / "fetch-queue.jsonl").exists() or \
        "acme.com" not in (gs / "fetch-queue.jsonl").read_text()
