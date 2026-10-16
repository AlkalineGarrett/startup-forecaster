// OCR pass: image-only PDFs + standalone images listed in ocr-worklist.tsv (written by extract-cores)
// -> cores/. Uses the OCR backend in lib/ocr.mjs: FORECASTER_OCR when set, else macOS Vision
// (ocr_pdf.sh + ocrtool, built from ocr.swift on first use). Stops up front when no backend can run.
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOTS } from "../paths.mjs";
import { readCsvFile } from "../lib/csv.mjs";
import { ocrBackend } from "../lib/ocr.mjs";
import { die, isMain, lines, print, readText, runMain } from "../lib/util.mjs";

export async function main() {
  const { GROUNDING } = ROOTS;
  const CORES = `${GROUNDING}/cores`;
  const worklist = `${GROUNDING}/ocr-worklist.tsv`;
  if (!existsSync(worklist)) die(`no ${worklist}: run \`npx startup-forecaster extract-cores\` first, which writes it`);
  const work = lines(readText(worklist)).filter((l) => l.trim());
  if (!work.length) { print("OCR worklist is empty"); return; }
  const backends = {};
  const backend = (kind) => (backends[kind] ??= ocrBackend(kind === "pdf" ? "pdf" : "image"));   // Exit names what is missing
  const man = new Map(readCsvFile(`${GROUNDING}/MANIFEST.csv`).map((m) => [m.sha256, m]));
  let done = 0;
  for (const line of work) {
    const parts = line.split("\t");
    if (parts.length !== 3) throw new Error(`ocr-worklist.tsv: expected kind<TAB>sha<TAB>stored, got: ${line}`);
    const [kind, sha, stored] = parts;
    const path = join(GROUNDING, stored), out = join(CORES, `doc_${sha.slice(0, 12)}.txt`);
    const m = man.get(sha) || {};
    const hdr = `# core (OCR): ${m.title ?? ""}\n# url: ${m.url ?? ""}\n# doc_${sha.slice(0, 12)}  (${kind}, OCR of ${stored})\n\n`;
    const b = backend(kind);
    try {
      let txt = b.ocr(path);
      if (kind === "pdf") txt = txt.split("\n").filter((l) => !l.startsWith("#")).join("\n");   // drop the sidecar's header lines
      txt = txt.trim();
      if (txt.length < 20) { print("  weak OCR:", stored, `(${txt.length}c)`); continue; }
      writeFileSync(out, hdr + txt + "\n", "utf8");
      done++;
      print(`  ok  doc_${sha.slice(0, 12)}  (${txt.length} chars)  ${basename(stored)}`);
    } catch (e) {
      print("  FAIL", stored, String(e.message).slice(0, 160));
    }
  }
  print("OCR cores written:", done);
}

if (isMain(import.meta.url)) runMain(main);
