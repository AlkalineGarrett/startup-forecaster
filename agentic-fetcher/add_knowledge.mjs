#!/usr/bin/env node
// Add a general-knowledge prior or a speculation to the shared corpus, safely (file-locked), so a
// node can reference `gk_<id>` / `spec_<id>`. The sibling of add_observation.mjs:
//
//   general_knowledge — a broadly-held reference-class prior admissible WITHOUT a single citation.
//   speculation       — a stated-but-unsourced load-bearing guess.
//
// Both are `{ statement, measure?, reasoning }` (schema §2). No quote/document — `reasoning` carries
// the justification (why it is admissible / why we lean on it and what would confirm it).
//
//   node add_knowledge.mjs gk gk_saas_rule_of_40 \
//       --statement "Healthy SaaS growth+margin ≈ 40% (Rule of 40)" \
//       --reasoning "Widely-cited investor heuristic; used as a soft sanity bound, not a hard source." \
//       --value 40 --unit "%"
//
//   node add_knowledge.mjs spec spec_entrant_undercut \
//       --statement "A solo entrant prices ~30% under the incumbent solo tier" \
//       --reasoning "No source for this specific entrant; standard undercut assumption. Confirm at launch."
import { existsSync, readFileSync } from "node:fs";
import { ROOTS, schemaDefs } from "./paths.mjs";   // general-knowledge.json / speculations.json live under PROJECT/corpus
import { validator } from "../distribution-compiler/compiler/jsonschema.mjs";   // the schema lives in distribution-compiler (single source)
import { parse } from "./lib/args.mjs";
import { dumps, loads, markKey } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { die, isMain, print, runMain, toNumber } from "./lib/util.mjs";

export const KINDS = {
  gk: ["corpus/general-knowledge.json", "gk_", "general_knowledge"],
  spec: ["corpus/speculations.json", "spec_", "speculation"],
};

export async function add(kind, entryId, statement, reasoning, value, unit, mean, population, period, interval = null) {
  const [rel, prefix, defname] = KINDS[kind];
  if (!entryId.startsWith(prefix)) die(`${kind} id must start with '${prefix}' (got ${entryId})`);
  const entry = { statement, reasoning };
  if ((value !== null && value !== undefined) || (mean !== null && mean !== undefined) || unit || interval) {
    const m = {};
    if (unit) m.unit = unit;
    if (value !== null && value !== undefined) m.value = value;
    if (mean !== null && mean !== undefined) m.mean = mean;
    if (interval) {                                            // "lo,hi" -> {low, high} (schema §7)
      const parts = interval.split(",").map(toNumber);
      if (parts.length !== 2 || parts.includes(null)) die(`--interval must be "lo,hi" (got ${interval})`);
      const [lo, hi] = parts;
      if (lo >= hi) die(`--interval low must be < high (got ${lo},${hi})`);
      m.interval = { low: lo, high: hi };
    }
    if (population) m.population = population;
    if (period) m.period = period;
    entry.measure = m;
  }
  const defs = schemaDefs();
  const errs = validator({ ...defs[defname], $defs: defs }, defs)(entry);
  if (errs.length) die("schema error: " + errs.slice(0, 3).map((e) => e.message).join("; "));
  const path = `${ROOTS.PROJECT}/${rel}`;
  if (!existsSync(path)) die(`${path} does not exist (create it with {} first)`);
  await withLock(path, () => {
    const data = loads(readFileSync(path, "utf8"));
    data[markKey(entryId)] = entry;
    rewrite(path, dumps(data, { indent: 1 }) + "\n");
  });
  print(`${entryId} -> ${rel}: ${dumps(entry)}`);
}

export async function main() {
  const a = parse(process.argv.slice(2), {
    prog: "add_knowledge.mjs",
    description: "Add a general-knowledge prior (gk) or a speculation (spec) to the corpus.",
    positionals: ["kind", "id"],
    choices: { kind: ["gk", "spec"] },
    options: {
      statement: { required: true }, reasoning: { required: true },
      value: { number: true }, mean: { number: true },
      unit: {}, population: {}, period: {},
      interval: { help: '"lo,hi" -> {low, high}' },
    },
  });
  await add(a.kind, a.id, a.statement, a.reasoning, a.value, a.unit, a.mean, a.population, a.period, a.interval);
}

if (isMain(import.meta.url)) runMain(main);
