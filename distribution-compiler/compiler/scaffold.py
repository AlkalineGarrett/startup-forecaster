#!/usr/bin/env python3
"""Scaffold — lift a simulator's HAND-AUTHORED nodes into the data project, so every node a model
samples goes through the one grounded route (projects/<project>.json → compile → simulator).

A hand-authored node is a set of judged percentiles typed straight into the model. This makes that
judgement explicit and tracked, without changing what is sampled:

  • a speculation  spec_<project>__<node>  in corpus/speculations.json — the authored quantiles
    (measure.quantiles) with the node's own reasoning verbatim (+ any URLs it cited, which are NOT
    yet observations); and
  • a node  "<project>::<node>"  in projects/<project>.json — a metalog through the same percentiles
    (exact fit: k = number of anchors, the same bound the simulator's hand path uses; see below for
    the cases where the hand path interpolates instead), each anchor a
    direct_value restating one of the speculation's stated quantiles (`quantile: "pNN"`, checked by
    the compiler). An exact-fit metalog through the same points is the
    simulator's own hand-path sampler, so the scaffold is numerically a no-op.

support_score is held below 40 (the "guess" band): a speculation is judgement, not evidence, until
someone grounds it — re-point an anchor at a real observation, or rebuild the node's construction
from evidence, and raise the score. Existing nodes are never touched.

Input is the simulator's coverage export (montecarlo-engine: `coverage.mjs --json`), or any JSON of the same
shape ({ projects: [{ id, nodes: [{ key, label, kind, bound, pctiles, prov, conf, basis, urls, source: "hand" }] }] }).
A node may override what the scaffold would derive: `unit`, `support`, `spec_id`, `reasoning`, `spec_statement`,
`spec_reasoning` (startup-forecaster uses these to seed its labelled placeholder priors).

  node --experimental-strip-types coverage.mjs --json > cov.json
  python3 compiler/scaffold.py cov.json <project-id> [--nodes a,b] [--write]

Without --write it prints what it would add. The data project is FORECASTER_DATA (default: cwd).
Where the simulator's hand path cannot fit an exact metalog (a percentile on a bound, e.g. "p10 = 0
setup fee", or a non-monotone fit) it interpolates the points empirically; the scaffold emits the
`piecewise` kind there, which is that same interpolation. A constant becomes a single point_mass atom.
So in every case the compiled node samples exactly what the hand path sampled.
"""
import sys, os, json, re, fcntl, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import distributions as D

ROOT = os.environ.get("FORECASTER_DATA") or os.getcwd()
PCT = [("p01", .01), ("p05", .05), ("p10", .10), ("p25", .25), ("p50", .50), ("p75", .75), ("p90", .90), ("p95", .95), ("p99", .99)]
SUPPORT_CAP = 35                                             # stays in the "guess" band (< 40)


def load(path, default):
    if not os.path.exists(path): return default, "\n"
    s = open(path).read()
    return json.loads(s), ("\n" if s.endswith("\n") else "")


def dump(path, obj, tail):
    with open(path, "w") as f:
        f.write(json.dumps(obj, indent=1, ensure_ascii=False) + tail)


def spec_id(key):
    return "spec_" + re.sub(r"[^a-z0-9]+", "_", key.lower().replace("::", "__")).strip("_")


UNITISH = re.compile(r"[$€£%×/]|\b(count|months?|years?|weeks?|days?|hours?|x)\b", re.I)


def unit_of(n):
    """The node's unit: a fraction when bounded; a duration from a `…_months`/`…_years` id; otherwise the
    label's trailing parenthetical ONLY when it reads like a unit (currency, %, ×, count, time) — labels
    often end in a gloss ("(agentic coding)") that is not a unit."""
    if n["bound"] == "bounded": return "fraction 0-1"
    node = n.get("node") or n["key"].split("::")[-1]
    if node.endswith("_months") or node == "months": return "months"
    if node.endswith("_years") or node == "years": return "years"
    m = re.search(r"\(([^()]*)\)\s*$", n["label"])
    return m.group(1) if m and UNITISH.search(m.group(1)) else "level (see model_definition)"


def support_of(n):
    prov = list(n.get("prov", {}).values())
    base = {"low": 20, "med": 28, "medium": 28, "high": 32}.get(n.get("conf", ""), 20)
    if "sourced" in prov: base += 5
    return min(base, SUPPORT_CAP)


def scaffold(n, project):
    """→ (node_key, node, spec_key, spec, note) for one hand-authored node."""
    key = n["key"]
    pts = [(p, n["pctiles"][k], k) for k, p in PCT if n["pctiles"].get(k) is not None]
    if len(pts) < 2:
        raise ValueError("fewer than 2 authored percentiles — nothing to fit")
    bounded = n["bound"] == "bounded"
    lower = None if n["bound"] == "unbounded" else 0
    upper = 1 if bounded else None
    sid = n.get("spec_id") or spec_id(key)
    unit = n.get("unit") or unit_of(n)
    val = lambda v, k: {"value_type": "direct_value", "reference": sid, "quantile": k, "measure": {"unit": unit, "value": v}}
    anchors = [{"prob": round(p, 10), "value": val(v, k)} for p, v, k in pts]
    note = ""
    # Mirror the simulator's hand path (montecarlo-engine buildMarginal): an exact-fit metalog when every
    # point is strictly inside the bounds and the fit is monotone; otherwise its empirical interpolation,
    # which `piecewise` reproduces exactly. A constant is one atom.
    inside = all((lower is None or v > lower) and (upper is None or v < upper) for _, v, _ in pts)
    if len({v for _, v, _ in pts}) == 1:
        dist = {"kind": "point_mass", "atoms": [{"value": val(pts[0][1], pts[0][2]), "weight": 1.0}]}
        note = "constant — a single point_mass atom"
    else:
        dist = {"kind": "metalog", "k": len(anchors)}
        if lower is not None: dist["lower_bound"] = lower
        if upper is not None: dist["upper_bound"] = upper
        dist["anchors"] = anchors
        feasible = inside
        if feasible:
            try: D.construct("metalog", {"_anchors": [(p, v) for p, v, _ in pts], "k": len(pts), "lower_bound": lower, "upper_bound": upper})
            except ValueError: feasible = False
        if not feasible:
            dist = {"kind": "piecewise", "anchors": anchors}
            note = "piecewise — " + ("a point sits on a bound" if not inside else "no monotone exact metalog") + "; the hand path interpolated here too"
    node = {
        "unit": unit,
        "model_definition": n["label"],
        "distribution": dist,
        "support_score": n.get("support", support_of(n)),
        "reasoning": n.get("reasoning") or (n.get("basis") or n["label"]).strip()
        + f" [Scaffolded from the model's hand-authored percentiles: "
          + {"metalog": "an exact-fit metalog", "piecewise": "a piecewise interpolation", "point_mass": "a single atom"}[dist["kind"]]
          + f" through the quantiles stated in {sid}. Not yet grounded — re-point anchors at real observations to ground it.]",
    }
    parts = key.split("::")
    if len(parts) == 3:
        node["variant"] = {"base_project": parts[0], "variant": parts[1]}
    spec = {
        "statement": n.get("spec_statement") or f"Authored judgement for {project} '{n['label']}': "
                     + ", ".join(f"{k}={n['pctiles'][k]:g}" for k, _ in PCT if n["pctiles"].get(k) is not None),
        "reasoning": n.get("spec_reasoning") or (n.get("basis") or "").strip()
                     + (" Cited (not yet observations): " + " · ".join(n["urls"]) if n.get("urls") else ""),
        "measure": {"unit": unit, "quantiles": {k: n["pctiles"][k] for k, _ in PCT if n["pctiles"].get(k) is not None}},
    }
    return key, node, sid, spec, note


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("coverage", help="coverage.mjs --json export ('-' for stdin)")
    ap.add_argument("project")
    ap.add_argument("--nodes", help="comma-separated node ids (default: every hand-authored node)")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    cov = json.load(sys.stdin if a.coverage == "-" else open(a.coverage))
    proj = next((p for p in cov["projects"] if p["id"] == a.project), None)
    if not proj: sys.exit(f"no project '{a.project}' in the coverage export")
    want = set(a.nodes.split(",")) if a.nodes else None
    hand = [n for n in proj["nodes"] if n["source"] == "hand" and (want is None or n["node"] in want)]

    ppath = os.path.join(ROOT, "projects", f"{a.project}.json")
    spath = os.path.join(ROOT, "corpus", "speculations.json")
    lock = open(spath, "a")                      # hold an exclusive lock on the corpus file while we read-modify-write
    fcntl.flock(lock, fcntl.LOCK_EX)
    nodes, ntail = load(ppath, {})
    specs, stail = load(spath, {})

    added = skipped = 0
    for n in hand:
        try:
            key, node, sid, spec, note = scaffold(n, a.project)
        except ValueError as e:
            print(f"  SKIP {n['key']}: {e}"); skipped += 1; continue
        if key in nodes:
            print(f"  keep {key} (already in projects/{a.project}.json)"); skipped += 1; continue
        nodes[key] = node
        if sid not in specs: specs[sid] = spec
        added += 1
        d = node["distribution"]
        shape = f"metalog k={d['k']}" if d["kind"] == "metalog" else d["kind"]
        print(f"  add  {key}  ← {shape}, support {node['support_score']}" + (f"  [{note}]" if note else ""))
    if a.write and added:
        dump(ppath, nodes, ntail or "\n")
        dump(spath, specs, stail or "\n")
    print(f"{added} node(s) {'written' if a.write else 'would be added (dry run; --write to apply)'}, {skipped} skipped.")


if __name__ == "__main__":
    main()
