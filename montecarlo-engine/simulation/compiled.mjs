// The compiled node graphs a portfolio's model is built from: <distributionData>/build/<project>.compiled.json
// (distribution-compiler output), restricted to projects whose SOURCE (projects/<project>.json) still
// exists — build/ is unversioned, so a removed or set-aside project's leftover output must not leak in.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { corpusIndex, idsIn } from "../../distribution-compiler/compiler/refs.mjs";

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

/** The corpus of a distribution-data project: the shared index (refs.mjs corpusIndex), id -> { kind ("obs" |
 *  "gk" | "spec"), entry, placeholder }. A token is an evidence reference only when it is one of these ids:
 *  observation ids carry many prefixes (obs_, ret_, rate_, …). */
export const corpusKinds = (distributionData) => corpusIndex(distributionData);

/** Every corpus id mentioned anywhere in `v`, in traversal order; `isId(token)` says which tokens are ids. */
export function evidenceRefs(v, isId, into = new Set()) {
  if (typeof v === "string") for (const id of idsIn(v, isId)) into.add(id);
  else if (Array.isArray(v)) for (const x of v) evidenceRefs(x, isId, into);
  else if (v && typeof v === "object") for (const x of Object.values(v)) evidenceRefs(x, isId, into);
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
 * How a node's DISTRIBUTION is grounded, from its distribution and the inputs feeding it (cross-checks and prose
 * don't count — only what builds the numbers):
 *   sourced      references at least one sourced observation
 *   placeholder  references only placeholder priors (a startup-forecaster preset's; the corpus index marks them)
 *   judgement    speculations / general-knowledge priors, no sourced observation
 *   missing      no distribution in the data project
 * plus `gaps`: references left as tracked gaps (reference: null + missing_document).
 */
export function groundingOf(node, corpus) {
  if (!node) return { cls: "missing", refs: [], gaps: [] };
  const gaps = [];
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ("reference" in v && v.reference === null && v.missing_document) gaps.push(v.missing_document);
      Object.values(v).forEach(walk);
    }
  })([node.inputs || {}, node.distribution || {}]);
  // The node's inputs (in_…) feed the distribution, so their references build the numbers too.
  const refs = [...evidenceRefs([node.inputs || {}, node.distribution || {}], (id) => corpus.has(id))];
  const cls = refs.some((r) => corpus.get(r).kind === "obs") ? "sourced"
    : refs.length && refs.every((r) => corpus.get(r).placeholder) ? "placeholder" : "judgement";
  return { cls, refs, gaps };
}
