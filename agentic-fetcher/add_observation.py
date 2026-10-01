#!/usr/bin/env python3
"""Add an observation to the shared corpus so a node's `reference: "doc_<sha>/obs_<id>"` resolves
to a real, quote-verified fact — turning grounding from prose into a machine-checked link.

  python3 add_observation.py doc_5697a4de16e7 obs_nrr_arpa_lt50 \
      --value 94 --unit "%" --statement "Net revenue retention ~94% for <$50 ARPA SaaS" \
      --quote "Net Revenue Retention (NRR)" --locator "retention table"

Which nodes cite an observation is NOT stored on it (that list drifts into stale/phantom entries).
It is derived on demand from projects/*.json by `citations.py`.

Measure forms (§7): --value / --mean / --mode scalars; --interval "lo,hi"; --quantiles
"p10:v,p50:v,p90:v"; --series "2021:78841,2024:236888" (feeds extrapolate_cagr/linear).
--check verifies the quote against the core and prints the result WITHOUT writing.

The quote is matched against the document's lean core (cores/doc_<sha12>.txt) after normalizing
whitespace and common unicode (dashes/quotes/NBSP), so a figure split across lines or an en-dash
still matches. verified = found; not_in_doc = core exists but quote absent; unverifiable = no core.
Reads the doc's identity/core from the shared registry (GROUNDING/documents.json); writes the
observation into the project's flat evidence map (PROJECT/corpus/observations.json, keyed obs_<id>
with a `doc` backref) under an exclusive file lock (safe for parallel agents).
"""
import sys, os, json, argparse, fcntl, re, unicodedata
# Observations are written to the flat map under PROJECT (corpus/observations.json); the source
# IDENTITY (+ the core it quote-matches against) is read from GROUNDING. Both overridable for tests.
from paths import PROJECT, GROUNDING
from paths import schema_defs
try:                                                    # the schema lives in distribution-compiler (its single
    import jsonschema                                    # source); a missing schema is an error, not a skip
except ImportError:
    jsonschema = None
if jsonschema:
    _DEFS = schema_defs()
    _MEASURE_V = jsonschema.Draft202012Validator({**_DEFS["measure"], "$defs": _DEFS})
else:
    _MEASURE_V = None

def _norm(s):
    """Collapse whitespace and fold unicode dashes/quotes/NBSP so quote-matching isn't defeated by
    line wraps or en-dash vs hyphen."""
    s = unicodedata.normalize("NFKC", s)
    s = s.translate({0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2013: "-", 0x2014: "-", 0x2015: "-",
                     0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"', 0x00a0: " "})
    return re.sub(r"\s+", " ", s).strip()

def verify_quote(doc, quote):
    core = doc.get("core")
    if not quote: return "unchecked"
    q = _norm(quote)
    if len(q) < 3 or not any(c.isalnum() for c in q):   # too trivial to prove grounding
        return "unchecked"
    if not core or not os.path.exists(f"{GROUNDING}/{core}"): return "unverifiable"
    text = open(f"{GROUNDING}/{core}", encoding="utf-8", errors="replace").read()
    return "verified" if q in _norm(text) else "not_in_doc"

def build_measure(a):
    m = {"unit": a.unit} if a.unit else {}
    if a.value is not None: m["value"] = a.value
    if a.mean is not None: m["mean"] = a.mean
    if a.mode is not None: m["mode"] = a.mode
    try:
        if a.interval:
            lo, hi = (float(x) for x in a.interval.split(","))
            if lo >= hi: sys.exit(f"--interval low must be < high (got {lo},{hi})")
            m["interval"] = {"low": lo, "high": hi}       # schema §7: interval is {low, high}
        if a.quantiles:
            m["quantiles"] = {k.strip(): float(v) for k, v in (kv.split(":") for kv in a.quantiles.split(","))}
        if a.points:                                    # named point-measures (not probability quantiles)
            m["points"] = {k.strip(): float(v) for k, v in (kv.split(":") for kv in a.points.split(","))}
        if a.series:                                    # period is a string per schema §7
            m["series"] = [{"period": p.strip(), "value": float(v)} for p, v in (it.split(":") for it in a.series.split(","))]
    except (ValueError, TypeError):
        sys.exit("malformed measure flag. Formats: --interval 'lo,hi'  --quantiles 'p10:v,p50:v'  --series 'YYYY:v,YYYY:v'")
    if a.population: m["population"] = a.population
    if a.period: m["period"] = a.period
    if _MEASURE_V is not None:                           # reject a schema-invalid measure at write time
        errs = sorted(_MEASURE_V.iter_errors(m), key=lambda e: list(e.path))
        if errs:
            sys.exit("measure is schema-invalid: " + "; ".join(e.message[:100] for e in errs[:3])
                     + "  (quantiles keys must be p10/p50/…; use --points 'label:v,…' for named breakdowns)")
    return m

def _registry():
    p = f"{GROUNDING}/documents.json"                  # source-identity registry (shared cache)
    return json.load(open(p)) if os.path.exists(p) else {}, p

def add(doc_id, obs_id, statement, quote, locator, measure, check=False):
    reg, reg_path = _registry()
    if doc_id not in reg: sys.exit(f"unknown document {doc_id} (not in {reg_path})")
    doc = reg[doc_id]; v = verify_quote(doc, quote); cap = doc.get("capture")
    if check:                                          # verify only, no lock, no write
        print(f"[check] {doc_id}/{obs_id}: verification={v}")
        if v == "not_in_doc": print("  ⚠ quote not found in the core (after whitespace/unicode normalization)")
        if cap == "transcribed":
            print("  ⚠ capture:transcribed — quote verifies against an agent transcription, not the live page")
        return v
    # Note: which nodes cite an observation is NOT stored — it drifts (stale/phantom entries). It is
    # derived on demand from projects/*.json by agentic-fetcher/citations.py (always fresh).
    # `audit: unaudited` marks it as owing the legitimacy pass (audit_prepare.py → mark_audited.py); check_sources.py S8 counts
    # it as debt until an audit marks it `verified`/`flagged`. Never born pre-audited.
    obs = {"statement": statement, "measure": measure, "quote": quote or None,
           "locator": locator, "verification": v, "audit": "unaudited", "doc": doc_id}
    if cap == "transcribed": obs["source_capture"] = "transcribed"   # weaker evidence: self-verifies
    if quote is None: obs["capture_note"] = "value read without a verbatim quote"
    path = f"{PROJECT}/corpus/observations.json"       # the project's flat observation map (keyed obs_<id>)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fh = open(path, "a+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)  # lock the read-modify-write
    try:
        fh.seek(0); body = fh.read().strip(); obsmap = json.loads(body) if body else {}
        obsmap[obs_id] = obs
        fh.seek(0); fh.truncate(); json.dump(obsmap, fh, indent=1, ensure_ascii=False); fh.write("\n"); fh.flush()
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()
    print(f"{doc_id}/{obs_id}: verification={v}  measure={measure}")
    if v == "not_in_doc":
        print("  ⚠ quote NOT found in the core (after normalization) — fix the quote/locator or value")
    if cap == "transcribed":
        print("  ⚠ source is capture:transcribed — the quote verifies against an AGENT TRANSCRIPTION, not "
              "the live page. Corroborate with a second source or a human audit before treating as firm.")
    return v

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("doc_id"); ap.add_argument("obs_id")
    ap.add_argument("--statement", required=True); ap.add_argument("--quote", default=None)
    ap.add_argument("--unit", default=None); ap.add_argument("--locator", default="")
    ap.add_argument("--value", type=float, default=None); ap.add_argument("--mean", type=float, default=None)
    ap.add_argument("--mode", type=float, default=None)
    ap.add_argument("--interval", default=None, help='"lo,hi"'); ap.add_argument("--quantiles", default=None, help='"p10:v,p50:v"')
    ap.add_argument("--points", default=None, help='"label:v,label:v" — named point-measures (not probability quantiles)')
    ap.add_argument("--series", default=None, help='"YYYY:v,YYYY:v" — feeds extrapolate_cagr/linear')
    ap.add_argument("--population", default=None); ap.add_argument("--period", default=None)
    ap.add_argument("--check", action="store_true", help="verify the quote, print, do not write")
    a = ap.parse_args()
    add(a.doc_id, a.obs_id, a.statement, a.quote, a.locator, build_measure(a), a.check)

if __name__ == "__main__":
    main()
