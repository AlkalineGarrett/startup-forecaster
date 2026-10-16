#!/usr/bin/env node
// The compiler — deterministic, node-local. Compile a projects/<project>.json against the shared
// corpus: resolve references, evaluate computed_value formulae (filling or checking them), construct
// each node's distribution, derive its percentiles, and diagnose mismatches/invariants. Emits a
// filled build artifact + a source-vs-compiled diff.
//
//   npx startup-forecaster compile projects/<project>.json [--write] [--quiet] [--corpus DIR]
//
// --write persists build/<project>.compiled.json (with the source freshness stamp). Exit 1 on any error.
// See compiler/DESIGN.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "../../shared/is-main.mjs";
import { WorkspaceError, dataRoot } from "./workspace.mjs";
import * as D from "./distributions.mjs";
import * as F from "./formula.mjs";
import { corpusIndex, idsIn, readCorpus } from "./refs.mjs";
import { canonHash, dumps, loads } from "./json.mjs";
import { validator } from "./jsonschema.mjs";
import { round, sig } from "./format.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE);                                     // this package
/** Where the schema this validates against lives: this package. */
export const SCHEMA_PKG = PKG;

export const TOL = 0.02;   // relative tolerance for authored-vs-computed
export const PARAMS = {
  lognormal: ["median", "sigma"], beta: ["alpha", "beta"], normal: ["mean", "sd"],
  gamma: ["shape", "rate"], uniform: ["low", "high"],
  generalized_pareto: ["location", "scale", "shape"],
};

// ---------- JSON value helpers ----------
const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof D.Dist);
/** Present and non-empty: an empty \`measure: {}\`, list or string counts as absent, as do null, false and 0. */
const truthy = (v) => {
  if (v === null || v === undefined || v === false || v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
};
const get = (o, k, dflt = null) => (isDict(o) && Object.hasOwn(o, k) ? o[k] : dflt);
/** A value as a number (a numeric string converts; anything else becomes NaN and fails the feasibility checks). */
const toNum = (v) => (typeof v === "number" ? v : Number(v));
/** A value as diagnostics print it. */
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v ?? null));
const sig6 = (v) => sig(toNum(v), 6);

// Schema validation split by responsibility: the JSON schema validates the VALUE envelope (confidence
// int 0-100, missing_document string, reference type, …) and node-level fields; the compiler's
// buildDist validates DISTRIBUTION structure (it is the executable validator for kinds/params).
// This is why a bad template value (qualitative confidence, null missing_document) can't propagate
// silently, without the schema fighting the compiler over distribution internals.
const NODE_V = (() => {
  try {
    const defs = loads(readFileSync(join(SCHEMA_PKG, "project-distributions.schema.json"), "utf8")).$defs;
    return validator({ ...defs.node, $defs: defs }, defs);
  } catch {
    return null;
  }
})();

/** Validate the WHOLE authored node against #/$defs/node — value envelopes, measure/quantile
 *  keys, cross_checks, node fields — so nothing schema-invalid compiles clean. Plus the prose
 *  direct_value-purity rule the JSON schema can't express. */
export function validateNode(node, diag) {
  if (NODE_V !== null) {
    for (const e of NODE_V(node)) diag.err(e.path.join("/") || "(node)", e.message.slice(0, 120));
  } else {
    for (const f of ["unit", "model_definition", "distribution", "support_score", "reasoning"]) {
      if (!(isDict(node) && Object.hasOwn(node, f))) diag.err("(node)", `missing required field '${f}'`);
    }
  }
  const walk = (o) => {
    if (isDict(o)) {
      if (o.value_type === "direct_value" && ["process", "reasoning", "confidence"].some((k) => Object.hasOwn(o, k))) {
        diag.warn("value", "direct_value carries process/reasoning/confidence — use inferred_value if the number was adjusted");
      }
      for (const v of Object.values(o)) walk(v);
    } else if (Array.isArray(o)) {
      for (const x of o) walk(x);
    }
  };
  walk(node);
}

/** A not-yet-authored node: no distribution yet, or still carrying the `_todo` placeholder.
 *  The compiler skips these (they are work-in-progress), so a partially-authored project file still
 *  compiles clean on its authored nodes and the freshness gate passes as an agent fills nodes in. */
export function isSkeleton(node) {
  return !isDict(node) || get(node, "distribution") === null || Object.hasOwn(node, "_todo");
}

/** value_type histogram + count of BARE inferred values (no reference/references — pure
 *  judgement). A grounded inferred (a shape param fit to a referenced anchor) is not bare. */
export function groundingMix(src) {
  const mix = {};
  let bare = 0;
  const walk = (o) => {
    if (isDict(o)) {
      const vt = get(o, "value_type");
      if (truthy(vt)) {
        mix[vt] = (mix[vt] || 0) + 1;
        if (vt === "inferred_value" && !truthy(get(o, "reference")) && !truthy(get(o, "references"))) bare += 1;
      }
      for (const v of Object.values(o)) walk(v);
    } else if (Array.isArray(o)) {
      for (const x of o) walk(x);
    }
  };
  walk(src);
  return [mix, bare];
}

export { canonHash };   // the freshness hash over the canonical JSON (see json.mjs)

/** The corpus of a corpus/ folder as the shared index (refs.mjs corpusIndex: id → { kind, entry, placeholder }). */
export const loadCorpus = (cdir) => corpusIndex(readCorpus(cdir, loads));

/** One node's diagnostics: ["error"|"warning", node, path, message] entries. */
export class Diag extends Array {
  static get [Symbol.species]() { return Array; }
  constructor(node) { super(); this.node = node; }
  err(path, msg) { this.push(["error", this.node, path, msg]); }
  warn(path, msg) { this.push(["warning", this.node, path, msg]); }
}

export function measureScalar(m) {
  for (const k of ["value", "mean", "mode"]) if (isDict(m) && get(m, k) !== null) return m[k];
  return null;
}

/** The id-handle a formula operand resolves against: `.value`/`.series`, plus `.low`/`.high`
 *  from an interval measure (so a computed_value can use an interval observation's endpoints
 *  directly, e.g. `exp((log(obs_x.low) + log(obs_x.high)) / 2)`, without a duplicate scalar obs). */
function handle(m) {
  m = truthy(m) ? m : {};
  const iv = get(m, "interval");
  let lo = null, hi = null;
  if (isDict(iv)) { lo = get(iv, "low"); hi = get(iv, "high"); }
  else if (Array.isArray(iv) && iv.length === 2) { [lo, hi] = iv; }
  return { value: measureScalar(m), series: get(m, "series"), low: lo, high: hi, quantiles: get(m, "quantiles") };
}

/** A corpus reference — a bare id, or a doc_<sha>/<obs id> path to an observation — as its id-handle, or
 *  null when the corpus index (loadCorpus) has no such id (an observation must also have content). */
export function resolveRef(ref, corpus) {
  if (ref === null || ref === undefined) return null;
  const path = ref.includes("/"), e = corpus.get(path ? ref.slice(ref.indexOf("/") + 1) : ref);
  if (!e || (path && e.kind !== "obs")) return null;
  if (e.kind === "obs" && !truthy(e.entry)) return null;
  return handle(get(e.entry, "measure"));
}

/** ctx.ids: obs/gk/spec referenced anywhere + the node's inputs (in_), with input formulae
 *  evaluated to a fixpoint so a computed_value input can feed another formula (I19: inputs form a DAG). */
function buildIds(node, ctxCorpus, diag) {
  const ids = {};
  const text = dumps(node);
  for (const ref of new Set([...text.matchAll(/"reference":\s*"([^"]+)"/g)].map((m) => m[1]))) {
    const base = ref.includes("/") ? ref.split("/").pop() : ref;
    const r = resolveRef(ref, ctxCorpus);
    if (r) ids[base] = r;
  }
  // corpus ids referenced directly inside a formula (e.g. extrapolate_cagr(obs_x.series, 2026))
  const corpusSrc = (tok) => { const e = ctxCorpus.get(tok); return e && truthy(e.entry) ? e.entry : undefined; };
  for (const [, fla] of text.matchAll(/"formula":\s*"([^"]+)"/g)) {
    for (const tok of idsIn(fla, corpusSrc)) {
      if (!Object.hasOwn(ids, tok)) ids[tok] = handle(get(corpusSrc(tok), "measure"));
    }
  }
  const formulaInputs = {};
  const inputs = truthy(get(node, "inputs")) ? node.inputs : {};
  for (const [iid, vobj] of Object.entries(inputs)) {
    const m = truthy(get(vobj, "measure")) ? vobj.measure : {};
    if (truthy(get(vobj, "formula"))) {
      formulaInputs[iid] = vobj; ids[iid] = handle(m); ids[iid].value = null;
    } else {
      const h = handle(m);
      let val = h.value;
      if (val === null && truthy(get(vobj, "reference"))) {   // a bare reference to a corpus obs
        const r = resolveRef(vobj.reference, ctxCorpus); val = r ? r.value : null;
      }
      h.value = val; ids[iid] = h;
    }
  }
  const n = Object.keys(formulaInputs).length;
  for (let round = 0; round < n + 1; round++) {         // fixpoint over the input DAG
    let progressed = false;
    for (const [iid, vobj] of Object.entries(formulaInputs)) {
      if (ids[iid].value !== null) continue;
      try {
        ids[iid].value = (F.evaluate(vobj.formula, { ids, segments: [], splices: [] }));
        progressed = true;
      } catch {
        // dependency not ready this round
      }
    }
    if (!progressed) break;
  }
  for (const [iid, vobj] of Object.entries(formulaInputs)) {
    if (ids[iid].value === null) diag.err(`inputs.${iid}`, `input formula [${vobj.formula}] did not evaluate (unresolved/cyclic dependency)`);
  }
  return ids;
}

/** Resolve a value object to a scalar. Fills a computed_value's measure.value from its formula;
 *  checks it against an authored value if present. */
export function resolveValue(vobj, ctx, diag, path) {
  if (typeof vobj === "number") return vobj;
  if (!isDict(vobj)) return null;
  if (truthy(get(vobj, "formula"))) {
    let val;
    try { val = F.evaluate(vobj.formula, ctx); }
    catch (e) { diag.err(path, `formula error [${vobj.formula}]: ${e.message}`); return null; }
    if (!Object.hasOwn(vobj, "measure")) vobj.measure = {};
    const m = vobj.measure, authored = get(m, "value");
    if (authored !== null && Math.abs(toNum(authored) - val) > TOL * Math.max(1.0, Math.abs(val))) {
      diag.err(path, `computed ${sig(val)} ≠ authored ${sig6(authored)}`);
    }
    m.value = round(val, 6);                   // FILL
    return val;
  }
  const ref = get(vobj, "reference");
  let rv = null, rmeasure = null;      // resolve the reference: in_ from inputs, else corpus
  if (truthy(ref)) {
    if (ref.startsWith("in_")) {
      if (Object.hasOwn(ctx.ids, ref)) { rmeasure = ctx.ids[ref]; rv = get(rmeasure, "value"); }
    } else {
      const r = resolveRef(ref, ctx._corpus);
      if (r !== null) { rmeasure = r; rv = r.value; }
    }
  }
  const found = rmeasure !== null;
  if (truthy(ref)) {
    const q = get(vobj, "quantile");                  // select one point of a stated distribution
    if (truthy(q) && found) {
      const qs0 = get(rmeasure, "quantiles");
      const qs = truthy(qs0) ? qs0 : {};
      if (Object.hasOwn(qs, q)) rv = qs[q];
      else {
        const has = Object.keys(qs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(", ") || "none";
        diag.warn(path, `reference '${ref}' has no quantile '${q}' (has: ${has})`);
      }
    }
  }
  const m = truthy(get(vobj, "measure")) ? vobj.measure : {};
  const s = measureScalar(m);
  if (s !== null) {                                   // inline measure present
    if (truthy(ref) && !found) {
      diag.warn(path, `reference '${ref}' not found (no such id in corpus/inputs) — grounding not machine-checked (I4); using inline measure`);
    } else if (truthy(ref) && found && get(vobj, "value_type") === "direct_value") {
      // a direct_value RESTATES its source, so the inline value must agree with it — equal to a
      // scalar, or (when the source is an interval) within [low, high]. An inferred_value's
      // reference is provenance for a JUDGEMENT/TRANSFORM (unit conversion, ÷price, discount),
      // not an equality — checking its inline value against the raw source is noise, so we don't.
      const lo = get(rmeasure, "low"), hi = get(rmeasure, "high");
      if (rv !== null) {
        if (Math.abs(toNum(rv) - toNum(s)) > TOL * Math.max(1.0, Math.abs(toNum(s)))) {
          diag.warn(path, `direct_value inline ${sig6(s)} ≠ referenced ${sig6(rv)}`);
        }
      } else if (lo !== null && hi !== null && Number.isFinite(toNum(lo)) && Number.isFinite(toNum(hi)) && toNum(hi) >= toNum(lo)) {
        if (toNum(s) < toNum(lo) || toNum(s) > toNum(hi)) {
          diag.warn(path, `direct_value inline ${sig6(s)} outside referenced interval [${sig6(lo)}, ${sig6(hi)}] of '${ref}'`);
        }
      } else {
        diag.warn(path, `reference '${ref}' resolves but has no scalar measure — grounding not machine-checked; using inline measure`);
      }
    } else if (truthy(ref) && found && rv === null) {
      diag.warn(path, `reference '${ref}' resolves but has no scalar measure — grounding not machine-checked; using inline measure`);
    }
    return toNum(s);
  }
  if (rv !== null) {                                  // value taken from the resolved reference
    if (!Object.hasOwn(vobj, "measure")) vobj.measure = {};
    vobj.measure.value = round(toNum(rv), 6); // INLINE it so the compiled
    return toNum(rv);                               // artifact is fully resolved (self-describing)
  }
  if (ref === null && !truthy(get(vobj, "missing_document"))) {
    diag.warn(path, "no measure, reference:null, and no missing_document (I14/I15 evidence-debt untracked)");
  }
  diag.err(path, `value has no measure and no resolvable reference (${show(ref)})`);
  return null;
}

/** I3: weights are non-negative masses summing to 1. */
function checkWeights(weights, diag, path) {
  let total = 0;
  for (const w of weights) total += w;
  if (weights.some((w) => w < 0)) diag.err(`${path}.allocation`, "weights must be non-negative — they are masses (I3)");
  if (total <= 0) diag.err(`${path}.allocation`, "weights sum to <= 0 (I3)");
  else if (weights.length > 1 && Math.abs(total - 1.0) > 1e-6) {
    diag.warn(`${path}.allocation`, `weights sum to ${sig(total, 4)}, not 1 (I3) — renormalized`);
  }
}

/** Common degenerate parametric params that would yield NaN percentiles — caught up front
 *  with a clear message (backstopped by the non-finite check in checkPercentiles). */
function infeasible(kind, p) {
  if (Object.values(p).some((v) => !Number.isFinite(v))) return "non-finite param";
  if (kind === "uniform" && p.low >= p.high) return "low >= high";
  if (kind === "normal" && p.sd <= 0) return "sd <= 0";
  if (kind === "lognormal" && (p.median <= 0 || p.sigma <= 0)) return "median/sigma <= 0";
  if (kind === "gamma" && (p.shape <= 0 || p.rate <= 0)) return "shape/rate <= 0";
  if (kind === "beta" && (p.alpha <= 0 || p.beta <= 0)) return "alpha/beta <= 0";
  if (kind === "generalized_pareto" && p.scale <= 0) return "scale <= 0";
  return null;
}

const valueOf = (a) => (Object.hasOwn(a, "value") ? a.value : a);   // a.get("value", a)

/** D.construct, with a construction its params cannot support (DistError) reported at `path` (its message
 *  plus `hint`) and null returned. */
function tryConstruct(kind, params, diag, path, hint = "") {
  try {
    return D.construct(kind, params);
  } catch (e) {
    if (!(e instanceof D.DistError)) throw e;
    diag.err(path, e.message + hint);
    return null;
  }
}

export function buildDist(dist, ctx, diag, path) {
  const kind = get(dist, "kind");
  if (Object.hasOwn(PARAMS, kind)) {
    const params = {};
    for (const k of PARAMS[kind]) params[k] = resolveValue(get(dist, k), ctx, diag, `${path}.${k}`);
    if (Object.values(params).some((v) => v === null)) return null;
    const bad = infeasible(kind, params);
    if (bad) { diag.err(path, `infeasible ${kind} params: ${bad}`); return null; }
    return D.construct(kind, params);
  }
  if (kind === "point_mass") {
    const atoms = [];
    (get(dist, "atoms") || []).forEach((a, i) => {
      const v = resolveValue(valueOf(a), ctx, diag, `${path}.atoms[${i}]`);
      atoms.push([v, toNum(Object.hasOwn(a, "weight") ? a.weight : Object.hasOwn(a, "allocation") ? a.allocation : 1.0)]);
    });
    if (atoms.some(([v]) => v === null)) return null;
    checkWeights(atoms.map(([, w]) => w), diag, path);
    return tryConstruct("point_mass", { _atoms: atoms }, diag, path);
  }
  if (kind === "weighted_combination") {
    const comps = [];
    (get(dist, "components") || []).forEach((c, i) => {
      const sub = buildDist(c.distribution, ctx, diag, `${path}.components[${i}]`);
      comps.push([sub, toNum(Object.hasOwn(c, "weight") ? c.weight : Object.hasOwn(c, "allocation") ? c.allocation : 1.0)]);
    });
    if (comps.some(([d]) => d === null)) return null;
    checkWeights(comps.map(([, w]) => w), diag, path);
    return tryConstruct("weighted_combination", { _components: comps }, diag, path);
  }
  if (kind === "splice") {
    const segs = get(dist, "segments") || [];
    if (segs.length !== 2) {
      diag.warn(path, `splice has ${segs.length} segments; the compiler models body+tail (2) only`);
      return null;
    }
    const atX = resolveValue(dist.splices[0].at, ctx, diag, `${path}.splices[0].at`);
    const body = buildDist(segs[0].distribution, ctx, diag, `${path}.segments[0]`);
    if (body === null || atX === null) return null;
    if (body.cdf(atX) > 0.999) {
      diag.warn(path, "splice threshold is above the body's ~p99.9 — the tail governs ≈0 mass (effectively dropped)");
    }
    const ctx2 = { ...ctx, segments: [body], splices: [atX] };
    const tail = buildDist(segs[1].distribution, ctx2, diag, `${path}.segments[1]`);
    if (tail === null) return null;
    return D.construct("splice", { _segments: [body, tail], _at: atX });
  }
  if (kind === "piecewise") {
    const anchors = [];
    const arr = get(dist, "anchors") || [];
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (get(a, "prob") === null) {
        diag.err(`${path}.anchors[${i}]`, "piecewise anchors need an explicit prob (the stated quantile)"); return null;
      }
      anchors.push([toNum(a.prob), resolveValue(valueOf(a), ctx, diag, `${path}.anchors[${i}]`)]);
    }
    return tryConstruct("piecewise", { _anchors: anchors }, diag, path);
  }
  if (kind === "metalog") {
    const arr = get(dist, "anchors") || [];
    const anchors = arr.map((a, i) => {
      const prob = Object.hasOwn(a, "prob") ? toNum(a.prob) : (i + 1) / (arr.length + 1);
      return [prob, resolveValue(valueOf(a), ctx, diag, `${path}.anchors[${i}]`)];
    });
    // accept schema field names as aliases (boundedness/lower/upper/terms) for lower_bound/k
    let lb = get(dist, "lower_bound"), ub = get(dist, "upper_bound");
    const bnd = get(dist, "boundedness");
    if (lb === null && ["semi-bounded", "lower-semi-bounded", "bounded"].includes(bnd)) lb = Object.hasOwn(dist, "lower") ? dist.lower : 0;
    if (ub === null && ["upper-semi-bounded", "bounded"].includes(bnd)) ub = get(dist, "upper");
    const k = Object.hasOwn(dist, "k") ? dist.k : Object.hasOwn(dist, "terms") ? dist.terms : 5;
    const lbN = lb === null ? null : toNum(lb), ubN = ub === null ? null : toNum(ub);
    const bad = anchors.map(([, x]) => x).filter((x) => x !== null && ((lbN !== null && x <= lbN) || (ubN !== null && x >= ubN)));
    if (bad.length) {
      diag.err(path, `metalog anchor(s) ${JSON.stringify(bad)} on/outside the bounds [${show(lb)}, ${show(ub)}] — put boundary mass in zero_mass (lower) or a point_mass component`);
      return null;
    }
    const d = tryConstruct("metalog", {
      _anchors: anchors, k, lower_bound: lbN, upper_bound: ubN,
      zero_mass: Object.hasOwn(dist, "zero_mass") ? dist.zero_mass : 0.0,
    }, diag, path, ` — reduce k (now ${show(k)}) or zero_mass, or widen the anchor spacing`);
    if (d === null) return null;
    const xs = anchors.map(([, x]) => x).filter((x) => x !== null);   // over-fit lint: k≈n runs the tail past the data
    if (xs.length) {
      try {
        const p95 = d.ppf(0.95), mx = Math.max(...xs);
        if (mx > 0 && p95 > 5 * mx) {
          diag.warn(path, `metalog p95=${sig(p95, 4)} ≫ max anchor ${sig(mx, 4)} — likely over-fit (k=${show(k)}); try a lower k, check with preview.mjs`);
        }
      } catch {
        // a lint only
      }
    }
    return d;
  }
  diag.err(path, `unknown distribution kind: ${show(kind)}`);
  return null;
}

/** A unit that declares the quantity a fraction bounded to [0, 1]: "fraction 0-1", "fraction (0–1)", any
 *  case, hyphen or en dash, anywhere in the unit (SCHEMA.md §3). Its derived percentiles must lie in [0, 1]. */
export const FRACTION_UNIT = /\bfraction\s*\(?\s*0\s*[-\u2013]\s*1(?![\d.])/i;

/** derive percentiles; check authored debug_computed_percentiles; fill them. */
function checkPercentiles(node, dist, diag) {
  let comp;
  try { comp = dist.percentiles(); }
  catch (e) { diag.err("distribution", `percentile derivation failed: ${e.message}`); return null; }
  const keys = ["p05", "p10", "p50", "p90", "p95"];
  const vals = keys.map((k) => comp[k]);
  if (vals.some((v) => !Number.isFinite(v))) {        // infeasible params → never write NaN to the artifact
    diag.err("distribution", `non-finite percentiles (infeasible construction): ${JSON.stringify(comp)}`);
    return null;
  }
  if (vals.some((v, i) => i < vals.length - 1 && v > vals[i + 1] + 1e-9)) {
    diag.err("debug_computed_percentiles", `percentiles not non-decreasing: ${JSON.stringify(comp)}`);
  }
  const unit = String(get(node, "unit") ?? "");                 // a non-string unit is a schema error already
  if (FRACTION_UNIT.test(unit) && (vals[0] < -1e-9 || vals[vals.length - 1] > 1 + 1e-9)) {
    diag.err("distribution", `fraction-unit percentiles out of [0,1]: ${JSON.stringify(comp)}`);
  }
  const authored = get(node, "debug_computed_percentiles");
  if (isDict(authored)) {                             // throwaway readout — warn (compiler overwrites), never block
    for (const k of keys) {
      const a = get(authored, k);
      if (a !== null && Math.abs(toNum(a) - comp[k]) > TOL * Math.max(1.0, Math.abs(comp[k]))) {
        diag.warn(`debug_computed_percentiles.${k}`, `computed ${sig(comp[k])} ≠ authored ${sig6(a)} (recomputed)`);
      }
    }
  }
  return comp;
}

export function compileNode(node, corpus, diag) {
  validateNode(node, diag);                           // full #/$defs/node schema validation
  const cnode = structuredClone(node);
  const ctx = { ids: buildIds(cnode, corpus, diag), _corpus: corpus, segments: [], splices: [] };
  (truthy(get(cnode, "cross_checks")) ? cnode.cross_checks : []).forEach((cc, i) => {   // a cross_check's computed_value formula
    if (isDict(cc) && truthy(get(cc, "formula"))) resolveValue(cc, ctx, diag, `cross_checks[${i}]`);
  });
  let dist = buildDist(Object.hasOwn(cnode, "distribution") ? cnode.distribution : {}, ctx, diag, "distribution");
  if (dist !== null) {
    const trunc = get(cnode, "truncation");           // apply node truncation (I16) before deriving percentiles
    if (isDict(trunc) && (get(trunc, "lower") !== null || get(trunc, "upper") !== null)) {
      const b = (x) => (isDict(x) ? resolveValue(x, ctx, diag, "truncation") : x === null ? null : toNum(x));
      try {
        dist = D.truncate(dist, b(get(trunc, "lower")), b(get(trunc, "upper")));
      } catch (e) {
        diag.err("truncation", e.message); dist = null;
      }
    }
  }
  if (dist !== null) {
    const comp = checkPercentiles(cnode, dist, diag);
    if (comp !== null) cnode.debug_computed_percentiles = comp;   // FILL
  }
  return cnode;
}

function diffLines(src, comp) {
  const out = [];
  src = isDict(src) ? src : {}; comp = isDict(comp) ? comp : {};
  const sp = get(src, "debug_computed_percentiles"), cp = get(comp, "debug_computed_percentiles");
  if (dumps(sp, { sortKeys: true }) !== dumps(cp, { sortKeys: true })) {
    out.push(`    debug_computed_percentiles: ${show(sp)} → ${show(cp)}`);
  }
  // filled computed_value slots
  const walk = (a, b, path) => {
    if (isDict(b)) {
      const ad = truthy(a) ? a : {};
      for (const k of Object.keys(b)) {
        if (k === "measure" && isDict(b[k])) {
          const av = get(get(ad, k, {}), "value"), bv = get(b[k], "value");
          if (av !== bv && bv !== null && truthy(get(ad, "formula"))) {
            out.push(`    ${path}: value ${show(get(get(ad, "measure", {}), "value"))} → ${show(bv)}`);
          }
        }
        walk(isDict(a) ? get(a, k) : null, b[k], path ? `${path}.${k}` : k);
      }
    } else if (Array.isArray(b)) {
      b.forEach((x, i) => walk(Array.isArray(a) && i < a.length ? a[i] : null, x, `${path}[${i}]`));
    }
  };
  walk(get(src, "distribution"), get(comp, "distribution"), "distribution");
  return out;
}

/** Outside a workspace compile still runs on an explicit file: its data project is the one holding the file
 *  (<data>/projects/<id>.json), or null when the file isn't in a projects/ folder. */
function fileProject(given) {
  const dir = dirname(resolve(given));
  return existsSync(given) && basename(dir) === "projects" ? dirname(dir) : null;
}

/** compile <project file> — returns the exit code. The data project (corpus/ read, build/ written) is the
 *  workspace's (workspace.mjs dataRoot, overrides included), else fileProject(). */
export async function main(argv) {
  const ci = argv.indexOf("--corpus");
  const cdir = ci >= 0 ? argv[ci + 1] : null;
  const args = argv.filter((a) => !a.startsWith("-") && a !== cdir);
  const usage = "usage: compile.mjs <project file> [--write] [--quiet] [--corpus DIR]\n" +
    "  <project file>: e.g. distributions/projects/<id>.json from the workspace root, or projects/<id>.json\n" +
    "  (a path is tried from the current directory, then from the data project).\n";
  if (argv.includes("-h") || argv.includes("--help")) { process.stdout.write(usage); return 0; }
  if (!args.length) { process.stderr.write(usage); return 1; }
  const given = args[0], write = argv.includes("--write"), quiet = argv.includes("--quiet");
  let root;
  try { root = await dataRoot(); } catch (e) {
    if (!(e instanceof WorkspaceError)) throw e;
    root = fileProject(given);
    if (!root && (write || !cdir)) {
      process.stderr.write(`compile: ${e.message}\n  Outside a workspace, compile needs the file in a data project's projects/ folder ` +
        "(or --corpus DIR, without --write).\n");
      return 2;
    }
  }
  const path = !root || existsSync(given) || !existsSync(join(root, given)) ? given : join(root, given);
  const corpus = loadCorpus(cdir || `${root}/corpus`);
  const srcText = readFileSync(path, "utf8");
  const all = loads(srcText);
  const src = {};
  for (const [k, v] of Object.entries(all)) if (!k.startsWith("_")) src[k] = v;   // ignore _TEMPLATE meta if any
  const compiled = {};
  let allDiag = [], todo = 0;
  for (const [ref, node] of Object.entries(src)) {
    if (isSkeleton(node)) { compiled[ref] = node; todo += 1; continue; }   // not yet authored — skip
    const diag = new Diag(ref);
    compiled[ref] = compileNode(node, corpus, diag);
    allDiag = allDiag.concat([...diag]);
  }
  const errors = allDiag.filter((d) => d[0] === "error");
  const n = Object.keys(src).length;
  const project = basename(path, extname(path));
  const artifact = {
    _meta: {
      project, source_sha256: canonHash(srcText),
      errors: errors.length, warnings: allDiag.length - errors.length,
      nodes: n, authored: n - todo, todo,
    },
    nodes: compiled,
  };
  if (write) {
    mkdirSync(`${root}/build`, { recursive: true });
    writeFileSync(`${root}/build/${project}.compiled.json`, dumps(artifact, { indent: 1 }));
  }

  const debt = srcText.split('"missing_document"').length - 1;
  // grounding mix — a grounded inferred (one carrying a resolving reference, e.g. a shape param
  // fit to a referenced anchor) is fine; only a BARE inferred (no reference) is a judgement to
  // scrutinize. Count them apart.
  const [mix, bareInferred] = groundingMix(src);
  if (!quiet) {
    const lines = [];
    lines.push(`== compile ${path} — ${n} node(s): ${n - todo} authored, ${todo} todo, `
      + `${errors.length} error(s), ${allDiag.length - errors.length} warning(s)`
      + (debt ? `, ${debt} declared evidence-gap(s)` : "") + " ==");
    if (Object.keys(mix).length) {
      const order = ["direct_value", "computed_value", "inferred_value", "value_bounds", "directional"];
      let line = order.filter((k) => mix[k]).map((k) => `${mix[k]} ${k}`).join(" · ");
      if (bareInferred) line += `  (${bareInferred} inferred without a reference)`;
      lines.push("   grounding: " + line);
      const grounded = (mix.direct_value || 0) + (mix.computed_value || 0);
      if (bareInferred > grounded) {
        lines.push("   ← several values are bare judgement (no reference); can any be read direct/computed or grounded with add_observation?");
      } else if ((mix.inferred_value || 0) > grounded) {
        lines.push("   ← inference dominates: lognormal/normal params can be computed_value from two source quantiles (preview.mjs fit / DESIGN.md).");
      }
    }
    for (const ref of Object.keys(src)) {
      const dl = diffLines(src[ref], compiled[ref]);
      const nd = allDiag.filter((d) => d[1] === ref);
      if (dl.length || nd.length) {
        lines.push(`\n● ${ref}`);
        for (const [lvl, , p, m] of nd) lines.push(`    ${lvl === "error" ? "✗" : "⚠"} ${p}: ${m}`);
        for (const l of dl) lines.push(l);
      }
    }
    if (write) lines.push(`\nwrote build/${project}.compiled.json`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  return errors.length ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
