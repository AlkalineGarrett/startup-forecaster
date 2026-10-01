#!/usr/bin/env python3
"""Compose a DERIVATIVE document: a new corpus doc whose content is DERIVED from one or more
originals — then cite it like any other source. Two kinds:

  • COMPUTED (--compute)   — a statistic/blend over records (mean, median, percentiles, cagr, …).
                             Reproducible by construction, so it is the STRONGER evidence.
  • REASONING (--reasoning) — a reasoned synthesis or summary over the sources, optionally with a
                             scalar conclusion (--value). A judgement, so it is WEAKER evidence.

Either way the tool writes a transparent core (derived_from + method/reasoning + result + provenance)
and registers a `doc_<sha>` with `origin: "derivative"`, `derivation_kind`, `derived_from`, and a
`derivation` block. An observation is added for the result/conclusion, whose quote matches the core —
so it self-verifies. Prefer a computed derivative when the number can be computed; use a reasoning
derivative when the conclusion is a judgement the sources support but do not arithmetically yield.

    # median seat price across five tools whose prices were read from their own source docs:
    python3 make_derivative.py \
        --title "Median seat price across vector tools (derived)" \
        --from doc_8de2/obs_recraft_12 --from doc_628f/obs_vectorizer_899 \
        --records "12,29,22.99,8.99,5.49" --compute median \
        --unit "USD/mo" --obs obs_median_seat_price \
        --statement "Median monthly seat price across 5 vector tools = derived"

    # a statistic over a series already in the corpus (pulls the series values):
    python3 make_derivative.py --title "CAGR of UPAC stock (derived)" \
        --records-from doc_bb86/obs_upac_stock_series --compute cagr \
        --unit "fraction/yr" --obs obs_upac_cagr --statement "UPAC stock CAGR 2021-2024 = derived"

Methods: mean median sum count min max stdev p05 p10 p25 p50 p75 p90 p95 range cagr.
Deterministic: the same inputs always give the same doc_<sha> (dedupe). Honors FORECASTER_DATA.
The audit (AUDIT.md) still applies: a reviewer checks the transcribed records against the
originals in `derived_from` before the derivative doc is marked verified.
"""
import sys, os, re, json, math, fcntl, hashlib, argparse
import numpy as np

from paths import PROJECT, GROUNDING   # derivative doc + observation → PROJECT/corpus; derived core → GROUNDING/cores

def _percentile(xs, p): return float(np.percentile(xs, p))

def compute(method, xs):
    xs = [float(x) for x in xs]
    a = np.array(xs, dtype=float)
    if not len(a): raise ValueError("no records to compute over")
    P = {"p05": 5, "p10": 10, "p25": 25, "p50": 50, "p75": 75, "p90": 90, "p95": 95}
    if method in P: return _percentile(a, P[method])
    if method == "mean": return float(a.mean())
    if method == "median": return float(np.median(a))
    if method == "sum": return float(a.sum())
    if method == "count": return float(len(a))
    if method == "min": return float(a.min())
    if method == "max": return float(a.max())
    if method == "range": return float(a.max() - a.min())
    if method == "stdev": return float(a.std(ddof=1)) if len(a) > 1 else 0.0
    if method == "cagr":                                     # first→last compound annual growth (needs >=2)
        if len(a) < 2 or a[0] <= 0: raise ValueError("cagr needs >=2 positive records (first must be > 0)")
        return float((a[-1] / a[0]) ** (1.0 / (len(a) - 1)) - 1.0)
    raise ValueError(f"unknown method '{method}'")

def _series_values(measure):
    if measure.get("series"):
        return [pt["value"] if isinstance(pt, dict) else pt[1] for pt in measure["series"]]
    if measure.get("quantiles"):
        return list(measure["quantiles"].values())
    if measure.get("points"):
        return list(measure["points"].values())
    if measure.get("interval"):
        iv = measure["interval"]
        return [iv["low"], iv["high"]] if isinstance(iv, dict) else list(iv)
    v = measure.get("value")
    return [v] if v is not None else []

def _resolve_records_from(ref, obs):
    ok = ref.split("/", 1)[1] if "/" in ref else ref
    o = obs.get(ok)
    if not o: raise SystemExit(f"--records-from: {ref} not found in observations")
    xs = _series_values(o.get("measure") or {})
    if not xs: raise SystemExit(f"--records-from: {ref} has no series/quantiles/interval/value to compute over")
    return xs

def main():
    ap = argparse.ArgumentParser(description="Compose a derivative corpus document (computed or reasoned).")
    ap.add_argument("--title", required=True)
    ap.add_argument("--from", dest="sources", action="append", default=[],
                    help="a source doc_<sha> or doc_<sha>/obs_<id> this is derived from (repeatable)")
    # COMPUTED derivative (strong evidence — reproducible):
    ap.add_argument("--records", default=None, help='explicit data: "12,29,22.99"')
    ap.add_argument("--records-from", dest="records_from", default=None,
                    help="doc_<sha>/obs_<id> whose series/quantiles/interval supplies the data")
    ap.add_argument("--compute", default=None, help="a statistic: mean median p50 cagr … (computed derivative)")
    # REASONING/SUMMARY derivative (a judgement over sources — weaker evidence):
    ap.add_argument("--reasoning", default=None,
                    help="the derived reasoning/summary text (reasoning derivative; give --value for a scalar conclusion)")
    ap.add_argument("--value", type=float, default=None, help="the conclusion value of a reasoning derivative")
    ap.add_argument("--unit", default=None)
    ap.add_argument("--obs", default=None, help="also add an observation with this id for the result/conclusion")
    ap.add_argument("--statement", default=None)
    ap.add_argument("--check", action="store_true", help="preview, do not write")
    a = ap.parse_args()
    if bool(a.compute) == bool(a.reasoning):
        ap.error("give exactly one of --compute (computed derivative) or --reasoning (reasoning derivative)")

    reg_path = f"{GROUNDING}/documents.json"                 # source-identity registry (shared cache)
    reg = json.load(open(reg_path)) if os.path.exists(reg_path) else {}
    def _load(name):
        p = f"{PROJECT}/corpus/{name}"
        return json.load(open(p)) if os.path.exists(p) else {}
    obs, gk, spec = _load("observations.json"), _load("general-knowledge.json"), _load("speculations.json")
    for s in a.sources:                                      # provenance must resolve (doc, gk, or spec)
        base = s.split("/", 1)[0]
        if not (base in reg or base in gk or base in spec):
            ap.error(f"--from {s}: unknown id {base} (not a doc_/gk_/spec_ in the corpus)")

    if a.compute:                                            # ---- computed derivative (strong) ----
        if a.records:
            xs = [float(x) for x in a.records.split(",") if x.strip() != ""]
        elif a.records_from:
            xs = _resolve_records_from(a.records_from, obs)
            if a.records_from.split("/", 1)[0] not in [s.split("/", 1)[0] for s in a.sources]:
                a.sources.append(a.records_from)             # a series source is also provenance
        else:
            ap.error("--compute needs --records or --records-from")
        kind = "computed"; result = round(compute(a.compute, xs), 6)
        derivation = {"kind": kind, "method": a.compute, "inputs": xs, "result": result, "unit": a.unit,
                      "derived_from": a.sources, "description": a.title}
        result_line = f"Result: {a.compute} = {result}" + (f" {a.unit}" if a.unit else "")
        body = (f"Method: {a.compute}  (computed — reproducible, stronger evidence)\n"
                f"Records (n={len(xs)}): {', '.join(str(x) for x in xs)}\n{result_line}\n")
        provenance = ("Provenance: each record is transcribed from its source document (see 'Derived from'); "
                      "the audit checks the records against those originals before this doc is marked verified.")
    else:                                                    # ---- reasoning / summary derivative (weaker) ----
        kind = "reasoning"; result = round(a.value, 6) if a.value is not None else None
        derivation = {"kind": kind, "method": "reasoning", "reasoning": a.reasoning, "result": result,
                      "unit": a.unit, "derived_from": a.sources, "description": a.title}
        result_line = (f"Conclusion: {result}" + (f" {a.unit}" if a.unit else "")) if result is not None \
                      else f"Summary: {a.title}"
        body = (f"Kind: reasoning (a judgement/synthesis over the sources — weaker evidence than a computed "
                f"derivative)\nReasoning: {a.reasoning}\n{result_line}\n")
        provenance = ("Provenance: this is the analyst/agent's reasoning over the sources in 'Derived from'; "
                      "the audit checks the reasoning is sound and those sources actually support it before "
                      "this doc is marked verified.")

    sha = hashlib.sha256(json.dumps(derivation, sort_keys=True).encode()).hexdigest()
    doc_id = f"doc_{sha[:12]}"
    core = (f"# Derivative document — {a.title}\n"
            f"origin: derivative ({kind}; made by make_derivative.py)\n"
            f"Derived from: {', '.join(a.sources) or '(supplied inline)'}\n"
            f"{body}\n{provenance}\n")

    if a.check:
        print(f"[check] {doc_id}  ({kind})  {result_line}")
        print(f"[check] {'DUPLICATE (already in registry)' if doc_id in reg else 'new derivative'}")
        print("[check] core preview:\n    " + core.replace("\n", "\n    "))
        return

    core_rel = f"cores/{doc_id}.txt"
    os.makedirs(f"{GROUNDING}/cores", exist_ok=True)
    open(f"{GROUNDING}/{core_rel}", "w", encoding="utf-8").write(core)

    # 1) register the derivative's IDENTITY (+ derivation provenance) in the shared registry (GROUNDING)
    fh = open(reg_path, "a+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0); body = fh.read().strip(); reg = json.loads(body) if body else {}
        entry = reg.get(doc_id) or {}
        entry.update({"sha256": sha, "title": a.title, "url": "", "publisher": "derived",
                      "origin": "derivative", "derivation_kind": kind, "derived_from": a.sources,
                      "derivation": derivation, "core": core_rel, "verification": "unchecked"})
        reg[doc_id] = entry
        fh.seek(0); fh.truncate(); json.dump(reg, fh, indent=1, ensure_ascii=False); fh.write("\n")
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()

    # 2) the derived result as a project OBSERVATION (flat map under PROJECT), with a doc backref
    if a.obs:
        measure = ({"unit": a.unit} if a.unit else {})
        if result is not None: measure["value"] = result
        obs_rec = {
            "statement": a.statement or (f"{a.compute} over {len(xs)} records = {result}" if a.compute else a.title),
            "measure": measure, "quote": result_line, "locator": "derivation result line",
            "verification": "unchecked", "audit": "unaudited", "derived": True, "derivation_kind": kind,
            "doc": doc_id}
        obs_path = f"{PROJECT}/corpus/observations.json"
        os.makedirs(os.path.dirname(obs_path), exist_ok=True)
        fh = open(obs_path, "a+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.seek(0); body = fh.read().strip(); obsmap = json.loads(body) if body else {}
            obsmap[a.obs] = obs_rec
            fh.seek(0); fh.truncate(); json.dump(obsmap, fh, indent=1, ensure_ascii=False); fh.write("\n")
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN); fh.close()

    print(f"derivative {doc_id} ({kind}): {result_line}")
    print(f"  core: {core_rel}   derived_from: {', '.join(a.sources) or '(inline)'}")
    if a.obs:
        print(f"  obs {doc_id}/{a.obs} added (quote self-verifies against the core)")
        print(f"  → cite it:  \"reference\": \"{doc_id}/{a.obs}\"")

if __name__ == "__main__":
    main()
