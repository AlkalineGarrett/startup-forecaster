#!/usr/bin/env python3
"""Add a general-knowledge prior or a speculation to the shared corpus, safely (file-locked), so a
node can reference `gk_<id>` / `spec_<id>`. The sibling of add_observation.py:

  general_knowledge — a broadly-held reference-class prior admissible WITHOUT a single citation.
  speculation       — a stated-but-unsourced load-bearing guess.

Both are `{ statement, measure?, reasoning }` (schema §2). No quote/document — `reasoning` carries
the justification (why it is admissible / why we lean on it and what would confirm it).

  python3 add_knowledge.py gk gk_saas_rule_of_40 \
      --statement "Healthy SaaS growth+margin ≈ 40% (Rule of 40)" \
      --reasoning "Widely-cited investor heuristic; used as a soft sanity bound, not a hard source." \
      --value 40 --unit "%"

  python3 add_knowledge.py spec spec_entrant_undercut \
      --statement "A solo entrant prices ~30% under the incumbent solo tier" \
      --reasoning "No source for this specific entrant; standard undercut assumption. Confirm at launch."
"""
import sys, os, json, argparse, fcntl
from paths import PROJECT   # general-knowledge.json / speculations.json live under PROJECT/corpus
_HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = {"gk": ("corpus/general-knowledge.json", "gk_", "general_knowledge"),
         "spec": ("corpus/speculations.json", "spec_", "speculation")}
try:
    import jsonschema
except ImportError:
    jsonschema = None
from paths import schema_defs
_DEFS = schema_defs() if jsonschema else None   # the schema lives in distribution-compiler (single source)

def add(kind, entry_id, statement, reasoning, value, unit, mean, population, period, interval=None):
    rel, prefix, defname = KINDS[kind]
    if not entry_id.startswith(prefix):
        sys.exit(f"{kind} id must start with '{prefix}' (got {entry_id})")
    entry = {"statement": statement, "reasoning": reasoning}
    if value is not None or mean is not None or unit or interval:
        m = {}
        if unit: m["unit"] = unit
        if value is not None: m["value"] = value
        if mean is not None: m["mean"] = mean
        if interval:                                     # "lo,hi" -> {low, high} (schema §7)
            lo, hi = (float(x) for x in interval.split(","))
            if lo >= hi: sys.exit(f"--interval low must be < high (got {lo},{hi})")
            m["interval"] = {"low": lo, "high": hi}
        if population: m["population"] = population
        if period: m["period"] = period
        entry["measure"] = m
    if jsonschema:
        errs = list(jsonschema.Draft202012Validator({**_DEFS[defname], "$defs": _DEFS}).iter_errors(entry))
        if errs: sys.exit("schema error: " + "; ".join(e.message for e in errs[:3]))
    path = f"{PROJECT}/{rel}"
    fh = open(path, "r+", encoding="utf-8"); fcntl.flock(fh, fcntl.LOCK_EX)
    try:
        fh.seek(0); data = json.load(fh)
        data[entry_id] = entry
        fh.seek(0); fh.truncate(); json.dump(data, fh, indent=1, ensure_ascii=False); fh.write("\n"); fh.flush()
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN); fh.close()
    print(f"{entry_id} -> {rel}: {entry}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["gk", "spec"]); ap.add_argument("id")
    ap.add_argument("--statement", required=True); ap.add_argument("--reasoning", required=True)
    ap.add_argument("--value", type=float, default=None); ap.add_argument("--mean", type=float, default=None)
    ap.add_argument("--unit", default=None); ap.add_argument("--population", default=None); ap.add_argument("--period", default=None)
    ap.add_argument("--interval", default=None, help='"lo,hi" -> {low, high}')
    a = ap.parse_args()
    add(a.kind, a.id, a.statement, a.reasoning, a.value, a.unit, a.mean, a.population, a.period, a.interval)

if __name__ == "__main__":
    main()
