// Fold each page's image-OCR into its lean core so `cores/doc_<sha>.txt` is a single, complete,
// grep-able text layer (page text + recovered chart/screenshot figures). Exact match only: a
// sources page sidecar -> that page's own core (via MANIFEST sha). Idempotent (skips if already
// folded).
// Run: node prep/fold_ocr_into_cores.mjs --write
import { appendFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOTS } from "../paths.mjs";
import { readdirSync } from "node:fs";
import { readCsvFile } from "../lib/csv.mjs";
import { isMain, lines, print, readText, runMain, today } from "../lib/util.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { GROUNDING } = ROOTS;
  const man = new Map(readCsvFile(`${GROUNDING}/MANIFEST.csv`).map((m) => [m.stored, m.sha256]));
  const MARK = `\n===== IMAGE OCR (folded from page assets, macOS Vision ${today()}) =====\n`;
  const folded = [], skipped = [];
  const sidecars = readdirSync(GROUNDING, { recursive: true })
    .filter((p) => p.endsWith(".images.ocr.txt") && !p.split("/").some((seg) => seg.startsWith(".")))
    .sort().map((p) => join(GROUNDING, p));
  for (const sc of sidecars) {
    const page = relative(GROUNDING, sc).replace(/\.images\.ocr\.txt$/, "");
    const sha = man.get(page);
    const core = sha ? `${GROUNDING}/cores/doc_${sha.slice(0, 12)}.txt` : null;
    if (!(core && existsSync(core))) { skipped.push(page); continue; }
    const body = readText(core, "replace");
    if (body.includes("IMAGE OCR (folded")) { folded.push([page, "already"]); continue; }
    let ocr = readText(sc, "replace");
    // drop the sidecar's own header lines, keep the recognized text
    ocr = lines(ocr).filter((l) => !l.startsWith("#")).join("\n");
    if (argv.includes("--write")) appendFileSync(core, MARK + ocr.trim() + "\n", "utf8");
    folded.push([page, "folded"]);
  }
  print(`folded into cores: ${folded.filter(([, s]) => s === "folded").length} | already: ${folded.filter(([, s]) => s === "already").length} | no-core: ${skipped.length}`);
  for (const [p, s] of folded) print(`  [${s}] ${p}`);
  if (skipped.length) print("  (no matching core, left as sidecar only):", JSON.stringify(skipped));
}

if (isMain(import.meta.url)) runMain(main);
