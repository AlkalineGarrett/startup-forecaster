#!/usr/bin/env node
// Slice the not-yet-verified corpus into balanced batch files for audit agents (see AUDIT.md).
//
//     node audit_prepare.mjs obs [N]     # observation-legitimacy batches (default N=6)
//     node audit_prepare.mjs docs [N]     # document-metadata batches
//
// Writes build/audit/batch_<tag>.json (gitignored). Each batch keeps a document's observations together
// and balances by observation (or document) count. Only entries not already `"audit": "verified"` are
// included, so re-running after a partial pass slices just the remainder.
//
// Two-root model: observations are the flat map under PROJECT (corpus/observations.json), each carrying
// a `doc` backref; document identity (title/url/core) is the shared registry under GROUNDING.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { ROOTS } from "./paths.mjs";   // observations under PROJECT; doc identity under GROUNDING
import { dumps, load, markKey } from "./lib/json.mjs";
import { die, isMain, print, runMain } from "./lib/util.mjs";

const verified = (e) => e !== null && typeof e === "object" && !Array.isArray(e) && e.audit === "verified";
const get = (o, k, d = null) => (o !== null && typeof o === "object" && Object.hasOwn(o, k) ? o[k] : d);

export async function main(argv = process.argv.slice(2)) {
  const { PROJECT, GROUNDING } = ROOTS;
  const mode = argv.length > 0 ? argv[0] : "obs";
  const N = argv.length > 1 ? Number(argv[1]) : 6;
  if (!["obs", "docs"].includes(mode) || !Number.isInteger(N) || N < 1) die("usage: audit_prepare.mjs [obs|docs] [N>=1]");
  const reg = existsSync(`${GROUNDING}/documents.json`) ? load(`${GROUNDING}/documents.json`) : {};
  const obsPath = `${PROJECT}/corpus/observations.json`;
  const allobs = existsSync(obsPath) ? load(obsPath) : {};
  const outDir = `${PROJECT}/build/audit`;
  mkdirSync(outDir, { recursive: true });

  // group unverified observations by their source doc (backref)
  const byDoc = new Map();
  for (const [oid, ov] of Object.entries(allobs)) {
    if (verified(ov)) continue;
    const dk = get(ov, "doc");
    if (!byDoc.has(dk)) byDoc.set(dk, {});
    byDoc.get(dk)[oid] = ov;
  }

  // unit of work = a document; weight = its unverified-observation count (obs mode) or 1 (docs mode)
  const items = [];
  for (const [dk, obs] of byDoc) {
    const dv = (typeof dk === "string" && reg[markKey(dk)]) || {};
    let weight;
    if (mode === "obs") {
      weight = Object.keys(obs).length;
    } else {
      // audit only in-use documents (those backing at least one observation) not yet verified
      if (verified(dv)) continue;
      weight = 1;
    }
    items.push([dk, dv, obs, weight]);
  }
  items.sort((a, b) => b[3] - a[3]);                          // largest first for balanced greedy fill

  const batches = Array.from({ length: N }, () => []), loads = new Array(N).fill(0);
  for (const [dk, dv, obs, w] of items) {
    const i = loads.indexOf(Math.min(...loads));
    batches[i].push([dk, dv, obs]);
    loads[i] += w;
  }

  const tags = Array.from({ length: N }, (_, i) => String.fromCodePoint(65 + i));   // A, B, C, …
  let total = 0;
  for (let t = 0; t < N; t++) {
    const tag = tags[t], batch = batches[t];
    if (!batch.length) continue;
    const out = {};
    for (const [dk, dv, obs] of batch) {
      const rec = { title: get(dv, "title"), url: get(dv, "url"), publisher: get(dv, "publisher"),
        origin: get(dv, "origin", "primary"), core: get(dv, "core") };
      if (mode === "obs") rec.observations = obs;
      out[dk === null ? "null" : markKey(dk)] = rec;
      total += mode === "obs" ? Object.keys(obs).length : 1;
    }
    writeFileSync(`${outDir}/batch_${tag}.json`, dumps(out, { indent: 1 }), "utf8");
    const n = mode === "obs" ? batch.reduce((s, [, , o]) => s + Object.keys(o).length, 0) : batch.length;
    print(`build/audit/batch_${tag}.json: ${batch.length} docs, ${n} ${mode === "obs" ? "obs" : "docs"}`);
  }
  print(`total ${mode}: ${total} across ${batches.filter((b) => b.length).length} batches (only unverified entries)`);
}

if (isMain(import.meta.url)) runMain(main);
