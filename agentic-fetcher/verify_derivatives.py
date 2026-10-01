#!/usr/bin/env python3
"""Algorithmic re-verification of every `computed` derivative document (AUDIT.md, Audit 3).

A computed derivative records `derivation = { method, inputs, result, derived_from }`. Because the
method is deterministic, the derivative is *reproducible*: recomputing `method(inputs)` must reproduce
`result`. This tool does exactly that for every `origin: derivative`, `derivation_kind: computed`
document in the shared registry, and reports:

  ARITHMETIC  result == compute(method, inputs)        — fully mechanical, PASS/FAIL
  PROVENANCE  each doc/obs id in derived_from resolves, and its measure value is present among the
              recorded inputs                            — mechanical where derived_from is a doc/obs
              pair; reported as INFO (a page-enumeration derivative lists source pages, not obs, so
              its inputs legitimately don't map 1:1 — that part is Audit-3 step 1, read by an agent).

Exit status: 0 iff every computed derivative reproduces (ARITHMETIC PASS). Reuses make_derivative's
own `compute()` so the check matches how the value was produced. Two-root model: derivative identity
+ derivation live in GROUNDING/documents.json; observations in PROJECT/corpus/observations.json.

    python3 verify_derivatives.py            # human-readable report
    python3 verify_derivatives.py --json      # machine verdicts
"""
import sys, os, json, argparse
from paths import PROJECT, GROUNDING
from make_derivative import compute

TOL = 1e-6   # inputs/result are stored rounded to 6 dp


def _measure_scalar(m):
    if not isinstance(m, dict): return None
    for k in ("value", "mean", "mode"):
        if m.get(k) is not None: return float(m[k])
    return None


def verify():
    docs = json.load(open(f"{GROUNDING}/documents.json"))
    opath = f"{PROJECT}/corpus/observations.json"
    obs = json.load(open(opath)) if os.path.exists(opath) else {}

    verdicts = []
    for docid, d in docs.items():
        if d.get("origin") != "derivative" or d.get("derivation_kind") != "computed":
            continue
        der = d.get("derivation") or {}
        method, inputs, result = der.get("method"), der.get("inputs"), der.get("result")
        v = {"doc": docid, "method": method, "inputs": inputs, "result": result,
             "arithmetic": "FAIL", "recomputed": None, "provenance": []}
        try:
            rec = compute(method, inputs)
            v["recomputed"] = round(rec, 6)
            v["arithmetic"] = "PASS" if abs(rec - float(result)) <= max(TOL, abs(result) * 1e-9) else "FAIL"
        except Exception as e:
            v["recomputed"] = f"error: {e}"
        # provenance: for each derived_from that is a doc/obs pair, does its measure value appear in inputs?
        for ref in der.get("derived_from", []):
            if "/" not in ref:
                v["provenance"].append({"ref": ref, "kind": "doc-only", "note": "page/source doc (no obs) — read by agent"})
                continue
            oid = ref.split("/", 1)[1]
            o = obs.get(oid)
            if o is None:
                v["provenance"].append({"ref": ref, "kind": "obs", "resolves": False})
                continue
            val = _measure_scalar(o.get("measure"))
            present = val is not None and any(abs(val - float(x)) <= max(TOL, abs(val) * 1e-3) for x in inputs)
            v["provenance"].append({"ref": ref, "kind": "obs", "resolves": True,
                                    "measure_value": val, "in_inputs": present})
        verdicts.append(v)
    return verdicts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    verdicts = verify()
    if a.json:
        print(json.dumps(verdicts, indent=2));
        return 0 if all(v["arithmetic"] == "PASS" for v in verdicts) else 1

    ok = 0
    for v in verdicts:
        mark = "✓" if v["arithmetic"] == "PASS" else "✗"
        print(f"{mark} {v['doc']}  {v['method']}({v['inputs']}) = {v['recomputed']}  (recorded {v['result']})  [{v['arithmetic']}]")
        for p in v["provenance"]:
            if p["kind"] == "doc-only":
                print(f"     · {p['ref']}  — {p['note']}")
            elif not p.get("resolves"):
                print(f"     ✗ {p['ref']}  — obs does not resolve")
            else:
                flag = "in inputs" if p.get("in_inputs") else "NOT in inputs (check transform: FX/price-divide/etc.)"
                print(f"     · {p['ref']}  measure={p['measure_value']}  — {flag}")
        ok += v["arithmetic"] == "PASS"
    print(f"\n{ok}/{len(verdicts)} computed derivatives reproduce arithmetically.")
    return 0 if ok == len(verdicts) else 1


if __name__ == "__main__":
    sys.exit(main())
