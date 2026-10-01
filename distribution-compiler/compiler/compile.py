#!/usr/bin/env python3
"""The compiler — deterministic, node-local. Compile a projects/<project>.json against the shared
corpus: resolve references, evaluate computed_value formulae (filling or checking them), construct
each node's distribution, derive its percentiles, and diagnose mismatches/invariants. Emits a
filled build artifact + a source-vs-compiled diff.

  python3 compiler/compile.py projects/<project>.json [--write] [--quiet]

--write persists build/<project>.compiled.json (with the source freshness stamp). Exit 1 on any error.
See compiler/DESIGN.md.
"""
import sys, os, json, copy, hashlib, re, math
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)                                    # the distribution-compiler repo (schema/ lives here)
ROOT = os.environ.get("FORECASTER_DATA") or os.getcwd()    # the data project (corpus/, build/, projects/)
sys.path.insert(0, HERE)
import distributions as D
import formula as F
from refs import REF_RE

TOL = 0.02   # relative tolerance for authored-vs-computed
PARAMS = {"lognormal": ["median", "sigma"], "beta": ["alpha", "beta"], "normal": ["mean", "sd"],
          "gamma": ["shape", "rate"], "uniform": ["low", "high"],
          "generalized_pareto": ["location", "scale", "shape"]}

# Schema validation split by responsibility: jsonschema validates the VALUE envelope (confidence
# int 0-100, missing_document string, reference type, …) and node-level fields; the compiler's
# build_dist validates DISTRIBUTION structure (it is the executable validator for kinds/params).
# This is why a bad template value (qualitative confidence, null missing_document) can't propagate
# silently, without jsonschema fighting the compiler over distribution internals.
try:
    import jsonschema
    _DEFS = json.load(open(f"{PKG}/project-distributions.schema.json"))["$defs"]
    _NODE_V = jsonschema.Draft202012Validator({**_DEFS["node"], "$defs": _DEFS})
except Exception:
    _NODE_V = None

def validate_node(node, diag):
    """Validate the WHOLE authored node against #/$defs/node — value envelopes, measure/quantile
    keys, cross_checks, node fields — so nothing schema-invalid compiles clean. Plus the prose
    direct_value-purity rule the JSON schema can't express."""
    if _NODE_V is not None:
        for e in sorted(_NODE_V.iter_errors(node), key=lambda e: list(e.path)):
            diag.err("/".join(map(str, e.path)) or "(node)", e.message[:120])
    else:
        for f in ("unit", "model_definition", "distribution", "support_score", "reasoning"):
            if f not in node: diag.err("(node)", f"missing required field '{f}'")
    def walk(o):
        if isinstance(o, dict):
            if o.get("value_type") == "direct_value" and any(k in o for k in ("process", "reasoning", "confidence")):
                diag.warn("value", "direct_value carries process/reasoning/confidence — use inferred_value if the number was adjusted")
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(node)

def is_skeleton(node):
    """A not-yet-authored node: no distribution yet, or still carrying the `_todo` placeholder.
    The compiler skips these (they are work-in-progress), so a partially-authored project file still
    compiles clean on its authored nodes and the freshness gate passes as an agent fills nodes in."""
    return (not isinstance(node, dict)) or node.get("distribution") is None or "_todo" in node

def grounding_mix(src):
    """value_type histogram + count of BARE inferred values (no reference/references — pure
    judgement). A grounded inferred (a shape param fit to a referenced anchor) is not bare."""
    mix = {}; bare = 0
    def walk(o):
        nonlocal bare
        if isinstance(o, dict):
            vt = o.get("value_type")
            if vt:
                mix[vt] = mix.get(vt, 0) + 1
                if vt == "inferred_value" and not o.get("reference") and not o.get("references"):
                    bare += 1
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(src)
    return mix, bare

def canon_hash(text):
    """Freshness hash over the CANONICAL JSON (parsed, key-sorted), not the raw bytes — so
    reformatting/prettifying a project file (whitespace-only) does not stale its build artifact.
    Falls back to a raw-text hash if the file isn't valid JSON (mid-edit)."""
    try:
        return hashlib.sha256(json.dumps(json.loads(text), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    except Exception:
        return hashlib.sha256(text.encode()).hexdigest()

def load_corpus(cdir=None):
    base = cdir if cdir else f"{ROOT}/corpus"
    def L(name):
        p = os.path.join(base, name)
        return json.load(open(p)) if os.path.exists(p) else {}
    return L("observations.json"), L("general-knowledge.json"), L("speculations.json")

class Diag(list):
    def __init__(self, node): super().__init__(); self.node = node
    def err(self, path, msg): self.append(("error", self.node, path, msg))
    def warn(self, path, msg): self.append(("warning", self.node, path, msg))

def measure_scalar(m):
    for k in ("value", "mean", "mode"):
        if isinstance(m, dict) and m.get(k) is not None: return m[k]
    return None

def _handle(m):
    """The id-handle a formula operand resolves against: `.value`/`.series`, plus `.low`/`.high`
    from an interval measure (so a computed_value can use an interval observation's endpoints
    directly, e.g. `exp((log(obs_x.low) + log(obs_x.high)) / 2)`, without a duplicate scalar obs)."""
    m = m or {}
    iv = m.get("interval")
    if isinstance(iv, dict):
        lo, hi = iv.get("low"), iv.get("high")
    elif isinstance(iv, (list, tuple)) and len(iv) == 2:
        lo, hi = iv[0], iv[1]
    else:
        lo = hi = None
    return {"value": measure_scalar(m), "series": m.get("series"), "low": lo, "high": hi, "quantiles": m.get("quantiles")}

def resolve_ref(ref, obs, gk, spec):
    """obs_ via a doc_/obs_ path or a bare obs_ id (both look up the flat observations map);
    gk_; spec_ -> {value, series} or None."""
    if ref is None: return None
    if "/" in ref:                                   # doc_<sha>/obs_<id> — the obs id is the key
        _, ok = ref.split("/", 1); o = obs.get(ok)
        if o: return _handle(o.get("measure"))
    if ref.startswith("obs_"):                        # bare obs id
        o = obs.get(ref)
        if o: return _handle(o.get("measure"))
    if ref.startswith("gk_") and ref in gk:
        return _handle(gk[ref].get("measure"))
    if ref.startswith("spec_") and ref in spec:
        return _handle(spec[ref].get("measure"))
    return None

def build_ids(node, ctx_corpus, diag):
    """ctx.ids: obs/gk/spec referenced anywhere + the node's inputs (in_), with input formulae
    evaluated to a fixpoint so a computed_value input can feed another formula (I19: inputs form a DAG)."""
    ids = {}
    for ref in set(re.findall(r'"reference":\s*"([^"]+)"', json.dumps(node))):
        base = ref.split("/")[-1] if "/" in ref else ref
        r = resolve_ref(ref, *ctx_corpus)
        if r: ids[base] = r
    # obs/gk/spec ids referenced directly inside a formula (e.g. extrapolate_cagr(obs_x.series, 2026))
    obs_by_id, gk, spec = ctx_corpus
    for fla in re.findall(r'"formula":\s*"([^"]+)"', json.dumps(node)):
        for tok in set(REF_RE.findall(fla)):
            if tok in ids: continue
            src = obs_by_id.get(tok) or gk.get(tok) or spec.get(tok)
            if src:
                ids[tok] = _handle(src.get("measure"))
    formula_inputs = {}
    for iid, vobj in (node.get("inputs") or {}).items():
        m = vobj.get("measure") or {}
        if vobj.get("formula"):
            formula_inputs[iid] = vobj; ids[iid] = _handle(m); ids[iid]["value"] = None
        else:
            h = _handle(m); val = h["value"]
            if val is None and vobj.get("reference"):    # a bare reference to a corpus obs
                r = resolve_ref(vobj["reference"], *ctx_corpus); val = r.get("value") if r else None
            h["value"] = val; ids[iid] = h
    for _ in range(len(formula_inputs) + 1):             # fixpoint over the input DAG
        progressed = False
        for iid, vobj in formula_inputs.items():
            if ids[iid]["value"] is not None: continue
            try:
                ids[iid]["value"] = F.evaluate(vobj["formula"], {"ids": ids, "segments": [], "splices": []})
                progressed = True
            except Exception:
                pass                                     # dependency not ready this round
        if not progressed: break
    for iid, vobj in formula_inputs.items():
        if ids[iid]["value"] is None:
            diag.err(f"inputs.{iid}", f"input formula [{vobj['formula']}] did not evaluate (unresolved/cyclic dependency)")
    return ids

def resolve_value(vobj, ctx, diag, path):
    """Resolve a value object to a scalar. Fills a computed_value's measure.value from its formula;
    checks it against an authored value if present."""
    if isinstance(vobj, (int, float)): return float(vobj)
    if not isinstance(vobj, dict): return None
    if vobj.get("formula"):
        try: val = F.evaluate(vobj["formula"], ctx)
        except Exception as e: diag.err(path, f"formula error [{vobj['formula']}]: {e}"); return None
        m = vobj.setdefault("measure", {}); authored = m.get("value")
        if authored is not None and abs(authored - val) > TOL * max(1.0, abs(val)):
            diag.err(path, f"computed {val:.6g} ≠ authored {authored:.6g}")
        m["value"] = round(val, 6)                    # FILL
        return val
    ref = vobj.get("reference")
    found = False; rv = None; rmeasure = None           # resolve the reference: in_ from inputs, else corpus
    if ref:
        if ref.startswith("in_"):
            if ref in ctx["ids"]: rmeasure = ctx["ids"][ref]; found = True; rv = rmeasure.get("value")
        else:
            r = resolve_ref(ref, *ctx["_corpus"])
            if r is not None: rmeasure = r; found = True; rv = r.get("value")
        q = vobj.get("quantile")                        # select one point of a stated distribution
        if q and found:
            qs = (rmeasure or {}).get("quantiles") or {}
            if q in qs: rv = qs[q]
            else: diag.warn(path, f"reference '{ref}' has no quantile '{q}' (has: {', '.join(sorted(qs)) or 'none'})")
    m = vobj.get("measure") or {}
    s = measure_scalar(m)
    if s is not None:                                  # inline measure present
        if ref and not found:
            diag.warn(path, f"reference '{ref}' not found (no such id in corpus/inputs) — grounding not machine-checked (I4); using inline measure")
        elif ref and found and vobj.get("value_type") == "direct_value":
            # a direct_value RESTATES its source, so the inline value must agree with it — equal to a
            # scalar, or (when the source is an interval) within [low, high]. An inferred_value's
            # reference is provenance for a JUDGEMENT/TRANSFORM (unit conversion, ÷price, discount),
            # not an equality — checking its inline value against the raw source is noise, so we don't.
            lo, hi = (rmeasure or {}).get("low"), (rmeasure or {}).get("high")
            if rv is not None:
                if abs(rv - s) > TOL * max(1.0, abs(s)):
                    diag.warn(path, f"direct_value inline {s:.6g} ≠ referenced {rv:.6g}")
            elif lo is not None and hi is not None and math.isfinite(lo) and math.isfinite(hi) and hi >= lo:
                if s < lo or s > hi:
                    diag.warn(path, f"direct_value inline {s:.6g} outside referenced interval [{lo:.6g}, {hi:.6g}] of '{ref}'")
            else:
                diag.warn(path, f"reference '{ref}' resolves but has no scalar measure — grounding not machine-checked; using inline measure")
        elif ref and found and rv is None:
            diag.warn(path, f"reference '{ref}' resolves but has no scalar measure — grounding not machine-checked; using inline measure")
        return float(s)
    if rv is not None:                                  # value taken from the resolved reference
        vobj.setdefault("measure", {})["value"] = round(float(rv), 6)   # INLINE it so the compiled
        return float(rv)                                # artifact is fully resolved (self-describing)
    if ref is None and not vobj.get("missing_document"):
        diag.warn(path, "no measure, reference:null, and no missing_document (I14/I15 evidence-debt untracked)")
    diag.err(path, f"value has no measure and no resolvable reference ({ref})")
    return None

def _check_weights(weights, dist, diag, path):
    """I3: weights are non-negative masses summing to 1."""
    if any(w < 0 for w in weights):
        diag.err(f"{path}.allocation", "weights must be non-negative — they are masses (I3)")
    if sum(weights) <= 0:
        diag.err(f"{path}.allocation", "weights sum to <= 0 (I3)")
    elif len(weights) > 1 and abs(sum(weights) - 1.0) > 1e-6:
        diag.warn(f"{path}.allocation", f"weights sum to {sum(weights):.4g}, not 1 (I3) — renormalized")

def _infeasible(kind, p):
    """Common degenerate parametric params that would yield NaN percentiles — caught up front
    with a clear message (backstopped by the non-finite check in check_percentiles)."""
    if any(not math.isfinite(v) for v in p.values()): return "non-finite param"
    if kind == "uniform" and p["low"] >= p["high"]: return "low >= high"
    if kind == "normal" and p["sd"] <= 0: return "sd <= 0"
    if kind == "lognormal" and (p["median"] <= 0 or p["sigma"] <= 0): return "median/sigma <= 0"
    if kind == "gamma" and (p["shape"] <= 0 or p["rate"] <= 0): return "shape/rate <= 0"
    if kind == "beta" and (p["alpha"] <= 0 or p["beta"] <= 0): return "alpha/beta <= 0"
    if kind == "generalized_pareto" and p["scale"] <= 0: return "scale <= 0"
    return None

def build_dist(dist, ctx, diag, path):
    kind = dist.get("kind")
    if kind in PARAMS:
        params = {k: resolve_value(dist.get(k), ctx, diag, f"{path}.{k}") for k in PARAMS[kind]}
        if any(v is None for v in params.values()): return None
        bad = _infeasible(kind, params)
        if bad: diag.err(path, f"infeasible {kind} params: {bad}"); return None
        return D.construct(kind, params)
    if kind == "point_mass":
        atoms = []
        for i, a in enumerate(dist.get("atoms", [])):
            v = resolve_value(a.get("value", a), ctx, diag, f"{path}.atoms[{i}]")
            atoms.append((v, float(a.get("weight", a.get("allocation", 1.0)))))
        if any(v is None for v, _ in atoms): return None
        _check_weights([w for _, w in atoms], dist, diag, path)
        try:
            return D.construct("point_mass", {"_atoms": atoms})
        except ValueError as e:
            diag.err(path, str(e)); return None
    if kind == "weighted_combination":
        comps = []
        for i, c in enumerate(dist.get("components", [])):
            sub = build_dist(c["distribution"], ctx, diag, f"{path}.components[{i}]")
            comps.append((sub, float(c.get("weight", c.get("allocation", 1.0)))))
        if any(d is None for d, _ in comps): return None
        _check_weights([w for _, w in comps], dist, diag, path)
        return D.construct("weighted_combination", {"_components": comps})
    if kind == "splice":
        segs = dist.get("segments", [])
        if len(segs) != 2:
            diag.warn(path, f"splice has {len(segs)} segments; the compiler models body+tail (2) only")
            return None
        at_x = resolve_value(dist["splices"][0]["at"], ctx, diag, f"{path}.splices[0].at")
        body = build_dist(segs[0]["distribution"], ctx, diag, f"{path}.segments[0]")
        if body is None or at_x is None: return None
        if body.cdf(at_x) > 0.999:
            diag.warn(path, "splice threshold is above the body's ~p99.9 — the tail governs ≈0 mass (effectively dropped)")
        ctx2 = dict(ctx); ctx2["segments"] = [body]; ctx2["splices"] = [at_x]
        tail = build_dist(segs[1]["distribution"], ctx2, diag, f"{path}.segments[1]")
        if tail is None: return None
        return D.construct("splice", {"_segments": [body, tail], "_at": at_x})
    if kind == "piecewise":
        anchors = []
        for i, a in enumerate(dist.get("anchors", [])):
            if a.get("prob") is None:
                diag.err(f"{path}.anchors[{i}]", "piecewise anchors need an explicit prob (the stated quantile)"); return None
            anchors.append((a["prob"], resolve_value(a.get("value", a), ctx, diag, f"{path}.anchors[{i}]")))
        try:
            return D.construct("piecewise", {"_anchors": anchors})
        except ValueError as e:
            diag.err(path, str(e)); return None
    if kind == "metalog":
        arr = dist.get("anchors", [])
        anchors = []
        for i, a in enumerate(arr):
            prob = a.get("prob", (i + 1) / (len(arr) + 1))
            x = resolve_value(a.get("value", a), ctx, diag, f"{path}.anchors[{i}]")
            anchors.append((prob, x))
        # accept schema field names as aliases (boundedness/lower/upper/terms) for lower_bound/k
        lb = dist.get("lower_bound"); ub = dist.get("upper_bound")
        if lb is None and dist.get("boundedness") in ("semi-bounded", "lower-semi-bounded", "bounded"):
            lb = dist.get("lower", 0.0)
        if ub is None and dist.get("boundedness") in ("upper-semi-bounded", "bounded"):
            ub = dist.get("upper")
        k = dist.get("k", dist.get("terms", 5))
        bad = [x for _, x in anchors if x is not None and ((lb is not None and x <= lb) or (ub is not None and x >= ub))]
        if bad:
            diag.err(path, f"metalog anchor(s) {bad} on/outside the bounds [{lb}, {ub}] — put boundary mass in zero_mass (lower) or a point_mass component")
            return None
        try:
            d = D.construct("metalog", {"_anchors": anchors, "k": k, "lower_bound": lb, "upper_bound": ub,
                                        "zero_mass": dist.get("zero_mass", 0.0)})
        except ValueError as e:
            diag.err(path, f"{e} — reduce k (now {k}) or zero_mass, or widen the anchor spacing")
            return None
        xs = [x for _, x in anchors if x is not None]   # over-fit lint: k≈n runs the tail past the data
        if xs:
            try:
                p95 = float(d.ppf(0.95)); mx = max(xs)
                if mx > 0 and p95 > 5 * mx:
                    diag.warn(path, f"metalog p95={p95:.4g} ≫ max anchor {mx:.4g} — likely over-fit (k={k}); try a lower k, check with preview.py")
            except Exception:
                pass
        return d
    diag.err(path, f"unknown distribution kind: {kind}")
    return None

def check_percentiles(node, dist, diag):
    """derive percentiles; check authored debug_computed_percentiles; fill them."""
    try: comp = dist.percentiles()
    except Exception as e: diag.err("distribution", f"percentile derivation failed: {e}"); return None
    keys = ["p05", "p10", "p50", "p90", "p95"]
    vals = [comp[k] for k in keys]
    if any(not math.isfinite(v) for v in vals):        # infeasible params → never write NaN to the artifact
        diag.err("distribution", f"non-finite percentiles (infeasible construction): {comp}")
        return None
    if any(vals[i] > vals[i + 1] + 1e-9 for i in range(len(vals) - 1)):
        diag.err("debug_computed_percentiles", f"percentiles not non-decreasing: {comp}")
    unit = (node.get("unit") or "").lower()
    if "fraction 0-1" in unit and (vals[0] < -1e-9 or vals[-1] > 1 + 1e-9):
        diag.err("distribution", f"fraction-unit percentiles out of [0,1]: {comp}")
    authored = node.get("debug_computed_percentiles")
    if isinstance(authored, dict):                     # throwaway readout — warn (compiler overwrites), never block
        for k in keys:
            if authored.get(k) is not None and abs(authored[k] - comp[k]) > TOL * max(1.0, abs(comp[k])):
                diag.warn(f"debug_computed_percentiles.{k}", f"computed {comp[k]:.6g} ≠ authored {authored[k]:.6g} (recomputed)")
    return comp

def compile_node(ref, node, corpus, diag):
    validate_node(node, diag)                          # full #/$defs/node schema validation
    cnode = copy.deepcopy(node)
    ctx = {"ids": build_ids(cnode, corpus, diag), "_corpus": corpus, "segments": [], "splices": []}
    for i, cc in enumerate(cnode.get("cross_checks") or []):   # evaluate a cross_check's computed_value formula
        if isinstance(cc, dict) and cc.get("formula"):
            resolve_value(cc, ctx, diag, f"cross_checks[{i}]")
    dist = build_dist(cnode.get("distribution", {}), ctx, diag, "distribution")
    if dist is not None:
        trunc = cnode.get("truncation")                # apply node truncation (I16) before deriving percentiles
        if isinstance(trunc, dict) and (trunc.get("lower") is not None or trunc.get("upper") is not None):
            b = lambda x: resolve_value(x, ctx, diag, "truncation") if isinstance(x, dict) else x
            try:
                dist = D.truncate(dist, b(trunc.get("lower")), b(trunc.get("upper")))
            except Exception as e:
                diag.err("truncation", str(e)); dist = None
    if dist is not None:
        comp = check_percentiles(cnode, dist, diag)
        if comp is not None: cnode["debug_computed_percentiles"] = comp   # FILL
    return cnode

def diff_lines(src, comp, ref):
    out = []
    s = json.dumps(src.get("debug_computed_percentiles"), sort_keys=True)
    c = json.dumps(comp.get("debug_computed_percentiles"), sort_keys=True)
    if s != c: out.append(f"    debug_computed_percentiles: {src.get('debug_computed_percentiles')} → {comp.get('debug_computed_percentiles')}")
    # filled computed_value slots
    def walk(a, b, path):
        if isinstance(b, dict):
            for k in b:
                if k == "measure" and isinstance(b[k], dict) and (a or {}).get(k, {}).get("value") != b[k].get("value") and b[k].get("value") is not None and (a or {}).get("formula"):
                    out.append(f"    {path}: value {(a or {}).get('measure',{}).get('value')} → {b[k].get('value')}")
                walk((a or {}).get(k) if isinstance(a, dict) else None, b[k], f"{path}.{k}" if path else k)
        elif isinstance(b, list):
            for i, x in enumerate(b): walk(a[i] if isinstance(a, list) and i < len(a) else None, x, f"{path}[{i}]")
    walk(src.get("distribution"), comp.get("distribution"), "distribution")
    return out

def main():
    cdir = sys.argv[sys.argv.index("--corpus") + 1] if "--corpus" in sys.argv else None
    args = [a for a in sys.argv[1:] if not a.startswith("-") and a != cdir]
    if not args: sys.exit("usage: compile.py projects/<project>.json [--write] [--quiet] [--corpus DIR]")
    path = args[0]; write = "--write" in sys.argv; quiet = "--quiet" in sys.argv
    corpus = load_corpus(cdir)
    src_text = open(path, encoding="utf-8").read()
    src = json.loads(src_text)
    src = {k: v for k, v in src.items() if not k.startswith("_")}          # ignore _TEMPLATE meta if any
    compiled = {}; all_diag = []; todo = 0
    for ref, node in src.items():
        if is_skeleton(node):                                             # not yet authored — skip
            compiled[ref] = node; todo += 1; continue
        diag = Diag(ref); compiled[ref] = compile_node(ref, node, corpus, diag); all_diag += list(diag)
    errors = [d for d in all_diag if d[0] == "error"]
    project = os.path.splitext(os.path.basename(path))[0]
    artifact = {"_meta": {"project": project, "source_sha256": canon_hash(src_text),
                          "errors": len(errors), "warnings": len(all_diag) - len(errors),
                          "nodes": len(src), "authored": len(src) - todo, "todo": todo},
                "nodes": compiled}
    if write:
        os.makedirs(f"{ROOT}/build", exist_ok=True)
        json.dump(artifact, open(f"{ROOT}/build/{project}.compiled.json", "w"), indent=1, ensure_ascii=False)

    debt = src_text.count('"missing_document"')
    # grounding mix — a grounded inferred (one carrying a resolving reference, e.g. a shape param
    # fit to a referenced anchor) is fine; only a BARE inferred (no reference) is a judgement to
    # scrutinize. Count them apart.
    mix, bare_inferred = grounding_mix(src)
    if not quiet:
        print(f"== compile {path} — {len(src)} node(s): {len(src)-todo} authored, {todo} todo, "
              + f"{len(errors)} error(s), {len(all_diag)-len(errors)} warning(s)"
              + (f", {debt} declared evidence-gap(s)" if debt else "") + " ==")
        if mix:
            order = ["direct_value", "computed_value", "inferred_value", "value_bounds", "directional"]
            line = " · ".join(f"{mix[k]} {k}" for k in order if mix.get(k))
            if bare_inferred: line += f"  ({bare_inferred} inferred without a reference)"
            print("   grounding: " + line)
            grounded = mix.get("direct_value", 0) + mix.get("computed_value", 0)
            if bare_inferred > grounded:
                print("   ← several values are bare judgement (no reference); can any be read direct/computed or grounded with add_observation?")
            elif mix.get("inferred_value", 0) > grounded:
                print("   ← inference dominates: lognormal/normal params can be computed_value from two source quantiles (preview.py fit / DESIGN.md).")
        for ref in src:
            dl = diff_lines(src[ref], compiled[ref], ref)
            nd = [d for d in all_diag if d[1] == ref]
            if dl or nd:
                print(f"\n● {ref}")
                for lvl, _n, p, m in nd: print(f"    {'✗' if lvl=='error' else '⚠'} {p}: {m}")
                for l in dl: print(l)
        if write: print(f"\nwrote build/{project}.compiled.json")
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    main()
