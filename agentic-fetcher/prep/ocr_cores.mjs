// OCR pass (macOS Vision, must run OUTSIDE sandbox): image-only PDFs + standalone images -> cores/
// Uses ocr_pdf.sh and ocrtool (built from ocr.swift on first use).
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { HERE, ROOTS, ocrtool } from "../paths.mjs";
import { readCsvFile } from "../lib/csv.mjs";
import { decode, isMain, lines, print, readText, run, runMain } from "../lib/util.mjs";

export async function main() {
  const { GROUNDING } = ROOTS;
  const CORES = `${GROUNDING}/cores`;
  const man = new Map(readCsvFile(`${GROUNDING}/MANIFEST.csv`).map((m) => [m.sha256, m]));
  let done = 0;
  for (const line of lines(readText(`${GROUNDING}/ocr-worklist.tsv`))) {
    const parts = line.split("\t");
    if (parts.length !== 3) throw new Error(`ocr-worklist.tsv: expected kind<TAB>sha<TAB>stored, got: ${line}`);
    const [kind, sha, stored] = parts;
    const path = join(GROUNDING, stored), out = join(CORES, `doc_${sha.slice(0, 12)}.txt`);
    const m = man.get(sha) || {};
    const hdr = `# core (OCR): ${m.title ?? ""}\n# url: ${m.url ?? ""}\n# doc_${sha.slice(0, 12)}  (${kind}, OCR of ${stored})\n\n`;
    try {
      let txt;
      if (kind === "pdf") {
        const r = run(`${HERE}/ocr_pdf.sh`, [path], { timeout: 600 });
        if (r.code !== 0) throw new Error(`ocr_pdf.sh exited ${r.code}`);
        txt = readText(path + ".ocr.txt", "replace");
        // drop the sidecar's own header comment lines
        txt = txt.split("\n").filter((l) => !l.startsWith("#")).join("\n");
      } else {
        txt = decode(run(ocrtool(), [path], { timeout: 300 }).stdout, "replace");
      }
      txt = txt.trim();
      if (txt.length < 20) { print("  weak OCR:", stored, `(${txt.length}c)`); continue; }
      writeFileSync(out, hdr + txt + "\n", "utf8");
      done++;
      print(`  ok  doc_${sha.slice(0, 12)}  (${txt.length} chars)  ${basename(stored)}`);
    } catch (e) {
      print("  FAIL", stored, String(e.message).slice(0, 80));
    }
  }
  print("OCR cores written:", done);
}

if (isMain(import.meta.url)) runMain(main);
