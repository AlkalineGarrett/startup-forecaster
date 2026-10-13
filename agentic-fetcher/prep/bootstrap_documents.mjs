// Bootstrap documents.json from the reusable source archive (sources/MANIFEST.csv).
//
// For the new run we reuse the archived source *files*; this seeds the grounded-schema document
// corpus (schema/SCHEMA.md §2) with one skeleton per source so the run authors observations onto a
// known set rather than re-cataloging. Judgement fields (origin, trust_score, capture) are left for
// the run to assess. Also writes empty general-knowledge.json and speculations.json scaffolds.
//
// Run: node prep/bootstrap_documents.mjs --write
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { ROOTS } from "../paths.mjs";   // MANIFEST/cores + documents.json (identity registry) under GROUNDING; corpus scaffolds under PROJECT
import { readCsvFile } from "../lib/csv.mjs";
import { dumps } from "../lib/json.mjs";
import { isMain, print, runMain } from "../lib/util.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { PROJECT, GROUNDING } = ROOTS;
  const man = readCsvFile(`${GROUNDING}/MANIFEST.csv`);

  const docs = {};
  let skippedAsset = 0, skippedNohash = 0;
  for (const m of man) {
    if (m.status === "asset") { skippedAsset++; continue; }       // never evidence
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

  if (argv.includes("--write")) {
    // the doc-identity registry is shared → GROUNDING; the project corpus scaffolds → PROJECT
    writeFileSync(`${GROUNDING}/documents.json`, dumps(docs, { indent: 1 }) + "\n", "utf8");
    mkdirSync(`${PROJECT}/corpus`, { recursive: true });
    for (const name of ["observations.json", "general-knowledge.json", "speculations.json"]) {
      const p = `${PROJECT}/corpus/${name}`;
      if (!existsSync(p)) writeFileSync(p, "{}\n", "utf8");
    }
    print("wrote GROUNDING/documents.json (identity) + PROJECT/corpus/{observations,general-knowledge,speculations}.json scaffolds");
  }
}

if (isMain(import.meta.url)) runMain(main);
