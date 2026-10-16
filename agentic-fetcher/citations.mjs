#!/usr/bin/env node
// Derive, on demand, which nodes cite each observation — replacing the stored `cited_by` field.
//
// `cited_by` was a hand-maintained cache of "which project::node uses this observation." It drifts:
// nodes get renamed/removed and the list is not updated, leaving phantom citations (a `cited_by`
// naming a node that no longer exists) and missing ones. The true map is always recoverable by scanning
// `projects/*.json` for each observation id — that is what this tool does, so the correlation/usage
// record is never stale.
//
// An observation is *referenced* if its id appears in a `reference`/`references`/`records-from`/formula
// in any project node, OR (indirectly) if it feeds a derivative document that a project references.
//
//     npx forecaster citations                      # obs_id -> [project::node, ...] (+ orphan report)
//     npx forecaster citations --json               # machine-readable index
//     npx forecaster citations --orphans            # only observations no node uses (direct or indirect)
//
// Two-root: observations under PROJECT/corpus, projects under PROJECT/projects, derivative identity
// under GROUNDING/documents.json.
import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { ROOTS } from "./paths.mjs";
import { corpusIndex, idsIn, readCorpus } from "../distribution-compiler/compiler/refs.mjs";   // the shared definition of a reference and the corpus (single source)
import { parse } from "./lib/args.mjs";
import { dumps, load, loads } from "./lib/json.mjs";
import { isMain, print, readText, runMain } from "./lib/util.mjs";

// node keys are "project::node" or "project::variant::node"; project/variant ids may contain hyphens
// (my-app, field-crew, habit-app, …) — the hyphen MUST be in the class or attribution breaks.
const NODE_RE = /"([A-Za-z0-9_-]+(?:::[A-Za-z0-9_-]+)+)"\s*:\s*\{/g;

function projectText() {
  const dir = `${ROOTS.PROJECT}/projects`;
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort() : [];
  return new Map(files.map((f) => [basename(f).slice(0, -5), readText(`${dir}/${f}`)]));
}

/** Map each obs id mentioned in the file to the set of node keys whose block contains it.
 * Node blocks are delimited by top-level "project::node": { keys; good enough for attribution. */
function nodeRefs(text, isObs) {
  const spans = [...text.matchAll(NODE_RE)].map((m) => [m.index, m[1]]);
  const out = new Map();
  spans.forEach(([pos, node], i) => {
    const end = i + 1 < spans.length ? spans[i + 1][0] : text.length;
    for (const oid of idsIn(text.slice(pos, end), isObs)) {
      if (!out.has(oid)) out.set(oid, new Set());
      out.get(oid).add(node);
    }
  });
  return out;
}

export function buildIndex() {
  const { PROJECT, GROUNDING } = ROOTS;
  const corpus = corpusIndex(readCorpus(`${PROJECT}/corpus`, loads));
  const obsIds = [...corpus].filter(([, e]) => e.kind === "obs").map(([id]) => id);
  const isObs = (id) => corpus.get(id)?.kind === "obs";
  const docs = existsSync(`${GROUNDING}/documents.json`) ? load(`${GROUNDING}/documents.json`) : {};
  const ptext = projectText();

  // direct: obs id -> nodes (best-effort attribution)
  const index = new Map(obsIds.map((oid) => [oid, new Set()]));
  const allrefs = new Map();
  for (const text of ptext.values()) {
    for (const [oid, nodes] of nodeRefs(text, isObs)) {
      if (!allrefs.has(oid)) allrefs.set(oid, new Set());
      for (const n of nodes) allrefs.get(oid).add(n);
    }
  }
  for (const oid of obsIds) for (const n of allrefs.get(oid) || []) index.get(oid).add(n);

  // authoritative "referenced at all" test: the id appears literally in some project file. This is
  // robust to any attribution miss; if it matches but block-attribution didn't, record it unlocated.
  const joined = [...ptext.values()].join("\n");
  for (const oid of obsIds) {
    if (!index.get(oid).size && joined.includes(oid)) index.get(oid).add("(referenced; node unlocated)");
  }

  // indirect: an obs feeds a derivative (derived_from) that a project references
  const referencedDocs = new Set();
  for (const text of ptext.values()) for (const m of text.match(/doc_[0-9a-f]{12}/g) || []) referencedDocs.add(m);
  for (const [docid, d] of Object.entries(docs)) {
    if (d.origin !== "derivative" || !referencedDocs.has(docid)) continue;
    for (const src of (d.derivation || {}).derived_from ?? []) {
      if (src.includes("/")) {
        const soid = src.slice(src.indexOf("/") + 1);
        if (index.has(soid) && !index.get(soid).size) index.get(soid).add(`(via derivative ${docid})`);
      }
    }
  }
  return new Map([...index].map(([k, v]) => [k, [...v].sort()]));
}

export async function main() {
  const a = parse(process.argv.slice(2), {
    prog: "citations.mjs",
    description: "Which project nodes cite each observation (derived from projects/*.json).",
    options: { json: { flag: true, help: "machine-readable index" }, orphans: { flag: true, help: "only observations no node uses" } },
  });
  const idx = buildIndex();
  const orphans = [...idx].filter(([, v]) => !v.length).map(([k]) => k).sort();
  if (a.json) {
    print(dumps(Object.fromEntries(idx), { indent: 2 }));
    return;
  }
  if (a.orphans) {
    print(`${orphans.length} orphan observations (no node uses them, directly or via a derivative):`);
    for (const o of orphans) print(`  ${o}`);
    return;
  }
  const used = [...idx].filter(([, v]) => v.length).map(([k]) => k);
  print(`${used.length}/${idx.size} observations are referenced by at least one node; ${orphans.length} orphaned.`);
  for (const oid of used.sort()) print(`  ${oid}: ${idx.get(oid).join(", ")}`);
  if (orphans.length) {
    print(`\nORPHANS (${orphans.length}):`);
    for (const o of orphans) print(`  ${o}`);
  }
}

if (isMain(import.meta.url)) runMain(main);
