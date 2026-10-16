// Bootstrap documents.json from the reusable source archive (sources/MANIFEST.csv).
//
// Seeds the source-identity registry (distribution-compiler/schema/SCHEMA.md §2) with one entry per
// archived source, so observations can be authored onto a known set rather than re-cataloging. Fields
// that need a judgement (origin, capture) are left for the audit. Also writes empty observations.json,
// general-knowledge.json and speculations.json scaffolds under PROJECT/corpus/ when they are missing.
//
// An existing documents.json is MERGED: a source already registered is left exactly as it is (its title,
// audit, capture…), and only sources it lacks are added. --force replaces the file wholesale instead,
// dropping every audit and correction recorded in it.
//
// Run: npx forecaster bootstrap-documents [--write [--force]]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ROOTS } from "../paths.mjs";   // MANIFEST/cores + documents.json (identity registry) under GROUNDING; corpus scaffolds under PROJECT
import { readCsvFile } from "../lib/csv.mjs";
import { dumps, loads } from "../lib/json.mjs";
import { isAsset } from "../lib/manifest.mjs";
import { isMain, print, runMain } from "../lib/util.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { PROJECT, GROUNDING } = ROOTS;
  const man = readCsvFile(`${GROUNDING}/MANIFEST.csv`);

  const docs = {};
  let skippedAsset = 0, skippedNohash = 0;
  for (const m of man) {
    if (isAsset(m)) { skippedAsset++; continue; }               // never evidence
    const sha = (m.sha256 || "").trim();
    if (!sha || sha === "-") { skippedNohash++; continue; }       // crawl summary rows carry no content hash
    const key = `doc_${sha.slice(0, 12)}`;
    const core = `cores/doc_${sha.slice(0, 12)}.txt`;
    const rec = {
      sha256: sha,
      title: m.title || null,
      url: m.url || null,
      publisher: m.domain || "",
    };
    if (existsSync(`${GROUNDING}/${core}`)) rec.core = core;
    docs[key] = rec;
  }

  print(`documents: ${Object.keys(docs).length}  (skipped ${skippedAsset} assets, ${skippedNohash} no-hash crawl rows)`);
  const withCore = Object.values(docs).filter((d) => "core" in d).length;
  print(`  with a lean core: ${withCore} | metadata-only: ${Object.keys(docs).length - withCore}`);

  const regPath = `${GROUNDING}/documents.json`;
  const body = existsSync(regPath) ? readFileSync(regPath, "utf8").trim() : "";
  const force = argv.includes("--force");
  let out = docs;
  if (body && !force) {                                         // merge: never touch a registered source
    const have = loads(body);
    const added = Object.keys(docs).filter((k) => !Object.hasOwn(have, k));
    out = have;
    for (const k of added) out[k] = docs[k];
    print(`  merge into the existing documents.json: ${added.length} new, ${Object.keys(docs).length - added.length} already registered (kept as they are)`);
  } else if (body) {
    print("  --force: documents.json is REPLACED, dropping every audit and correction it holds");
  }

  if (argv.includes("--write")) {
    // the doc-identity registry is shared → GROUNDING; the project corpus scaffolds → PROJECT
    writeFileSync(regPath, dumps(out, { indent: 1 }) + "\n", "utf8");
    mkdirSync(`${PROJECT}/corpus`, { recursive: true });
    for (const name of ["observations.json", "general-knowledge.json", "speculations.json"]) {
      const p = `${PROJECT}/corpus/${name}`;
      if (!existsSync(p)) writeFileSync(p, "{}\n", "utf8");
    }
    print("wrote GROUNDING/documents.json (identity) + PROJECT/corpus/{observations,general-knowledge,speculations}.json scaffolds");
  }
}

if (isMain(import.meta.url)) runMain(main);
