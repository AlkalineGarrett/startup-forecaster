// Fill the holes in the cores/ text layer so a cross-corpus grep is (near) complete.
// Generates cores/doc_<sha12>.txt for non-asset/non-crawl artifacts that lack one (never overwrites):
//   - xlsx  -> zip + cell values (sharedStrings + each sheet) — lib/xlsx.mjs
//   - gz    -> gunzip, keep if it decodes to text
//   - txt   -> already text; extract into a core
//   - html  -> re-run the boilerplate-stripper; keep if >800 chars (recovers pages the first
//              aggressive pass dropped). Genuinely-empty pages (404/challenge/SPA) stay coreless.
// Run: node prep/extract_remaining.mjs --write
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ROOTS } from "../paths.mjs";
import { readCsvFile } from "../lib/csv.mjs";
import { unescape } from "../lib/html.mjs";
import { dumps, loads } from "../lib/json.mjs";
import { NotAZip, xlsxText } from "../lib/xlsx.mjs";
import { decode, isMain, print, readText, runMain, today } from "../lib/util.mjs";

export function stripHtml(t) {
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = unescape(t);
  return t.replace(/\n\s*\n+/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

/** The text derived for one artifact of type `typ` (throws on an unreadable file). */
export function extractRemaining(src, typ) {
  let text = "";
  if (typ === "xlsx") {
    try {
      text = xlsxText(src);
    } catch (e) {
      if (!(e instanceof NotAZip)) throw e;
      text = stripHtml(readText(src, "replace"));               // P6: mislabeled — actually HTML
    }
  } else if (typ === "json") {
    const raw = readText(src, "replace");
    try { text = dumps(loads(raw), { indent: 1 }); } catch { text = raw; }
  } else if (typ === "gz") {
    const raw = gunzipSync(readFileSync(src));
    try { text = decode(raw, "strict"); } catch { text = ""; }
    if (text.slice(0, 200).includes("<") && text.slice(0, 2000).includes(">")) text = stripHtml(text);
  } else if (typ === "txt") {
    text = readText(src, "replace").trim();
  } else if (typ === "html") {
    text = stripHtml(readText(src, "replace"));
  }
  return text;
}

export async function main(argv = process.argv.slice(2)) {
  const { GROUNDING } = ROOTS;
  const TODAY = today();
  const man = readCsvFile(`${GROUNDING}/MANIFEST.csv`);
  const coreDir = `${GROUNDING}/cores`;
  const cores = new Set(existsSync(coreDir) ? readdirSync(coreDir).filter((n) => n.startsWith("doc_") && n.endsWith(".txt")).map((n) => n.slice(4, 16)) : []);
  const WRITE = argv.includes("--write");

  const made = { xlsx: 0, gz: 0, txt: 0, html: 0, json: 0 };
  const empty = [];
  for (const m of man) {
    if (m.status === "asset" || m.tier === "crawls") continue;
    const sha = m.sha256;
    if (cores.has(sha.slice(0, 12))) continue;
    const src = join(GROUNDING, m.stored), typ = m.type;
    if (!existsSync(src)) continue;
    let text;
    try {
      text = extractRemaining(src, typ);
    } catch (e) {
      empty.push([typ, m.stored, `err:${e.message}`]);
      continue;
    }
    const minlen = ["xlsx", "txt", "json"].includes(typ) ? 40 : 800;
    if (text.length < minlen) { empty.push([typ, m.stored, `${text.length}chars`]); continue; }
    const core = join(GROUNDING, "cores", `doc_${sha.slice(0, 12)}.txt`);
    const hdr = `# core for ${m.stored}\n# title: ${m.title ?? ""}\n# url: ${m.url ?? ""}\n# (generated ${TODAY} by extract_remaining.mjs; type=${typ})\n\n`;
    if (WRITE && !existsSync(core)) writeFileSync(core, hdr + text + "\n", "utf8");
    made[typ] += 1;
  }

  print("cores generated (or would generate) for previously-coreless artifacts:", JSON.stringify(made));
  print(`still coreless (genuinely empty/non-text): ${empty.length}`);
  const byType = {};
  for (const [t] of empty) byType[t] = (byType[t] || 0) + 1;
  print("  by type:", JSON.stringify(byType));
  for (const [t, s, why] of empty.slice(0, 8)) print(`    [${t}] ${s}  (${why})`);
}

if (isMain(import.meta.url)) runMain(main);
