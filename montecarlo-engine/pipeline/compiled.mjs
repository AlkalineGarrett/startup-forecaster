// The compiled node graphs a portfolio's model is built from: <distributionData>/build/<project>.compiled.json
// (distribution-compiler output), restricted to projects whose SOURCE (projects/<project>.json) still
// exists — build/ is unversioned, so a removed or set-aside project's leftover output must not leak in.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function compiledFiles(distributionData) {
  const build = join(distributionData, "build"), projects = join(distributionData, "projects");
  if (!existsSync(build)) return [];
  return readdirSync(build)
    .filter((f) => f.endsWith(".compiled.json") && !f.startsWith("_"))
    .filter((f) => existsSync(join(projects, f.replace(/\.compiled\.json$/, ".json"))))
    .sort()
    .map((f) => join(build, f));
}

// ---- Evidence references and grounding (the one implementation; coverage.mjs, gen-evidence and
//      startup-forecaster all use these) ----

const REF_RE = /\b(obs_[A-Za-z0-9_]+|gk_[A-Za-z0-9_]+|spec_[A-Za-z0-9_]+)\b/g;

/** Every corpus id (obs_ / gk_ / spec_) mentioned anywhere in `v`, in traversal order; `keep(id)` filters. */
export function evidenceRefs(v, keep = () => true, into = new Set()) {
  if (typeof v === "string") { let m; REF_RE.lastIndex = 0; while ((m = REF_RE.exec(v))) if (keep(m[1])) into.add(m[1]); }
  else if (Array.isArray(v)) for (const x of v) evidenceRefs(x, keep, into);
  else if (v && typeof v === "object") for (const x of Object.values(v)) evidenceRefs(x, keep, into);
  return into;
}

/** The source nodes of a distribution-data project (projects/*.json, merged; `_` keys skipped). */
export function sourceNodes(distributionData) {
  const dir = join(distributionData, "projects"), out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort()) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(dir, f), "utf8")))) if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

/**
 * How a node's DISTRIBUTION is grounded (cross-checks and prose don't count — only what builds the numbers):
 *   sourced      references at least one sourced observation (obs_…)
 *   placeholder  references only `…_placeholder` speculations (a startup-forecaster preset prior)
 *   judgement    speculations / general-knowledge priors, no sourced observation
 *   missing      no distribution in the data project
 * plus `gaps`: references left as tracked gaps (reference: null + missing_document).
 */
export function groundingOf(node) {
  if (!node) return { cls: "missing", refs: [], gaps: [] };
  const gaps = [];
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ("reference" in v && v.reference === null && v.missing_document) gaps.push(v.missing_document);
      Object.values(v).forEach(walk);
    }
  })(node.distribution || {});
  const refs = [...evidenceRefs(node.distribution || {})];
  const cls = refs.some((r) => r.startsWith("obs_")) ? "sourced"
    : refs.length && refs.every((r) => r.endsWith("_placeholder")) ? "placeholder" : "judgement";
  return { cls, refs, gaps };
}
