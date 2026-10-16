// Extract clean `core` text from each archived document -> cores/doc_<sha12>.txt
// HTML -> boilerplate-stripped text (tag-stack + class/id heuristics + main/article preference, on the
// lib/html.mjs tokenizer). PDF -> pdftotext; image-only PDFs + standalone images routed to an OCR worklist.
//
// An existing core is never overwritten unless --force is given: observations quote-verify against the
// stored cores, so silently re-extracting them (with a different extractor) could break verified quotes.
//
// Run: npx startup-forecaster extract-cores [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOTS } from "../paths.mjs";
import { readCsvFile } from "../lib/csv.mjs";
import { tokens } from "../lib/html.mjs";
import { isAsset, kind } from "../lib/manifest.mjs";
import { decode, die, isMain, print, readText, run, runMain, which } from "../lib/util.mjs";

const SKIP = new Set(["script", "style", "head", "noscript", "svg", "form", "button", "iframe", "template", "select", "option"]);
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "li", "tr", "section", "article", "header", "td", "th", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "main", "figure", "figcaption", "dt", "dd"]);
const BOILER = ["cookie", "consent", "gdpr", "onetrust", "cc-window", "cmp-", "nav", "navbar", "navigation",
  "menu", "footer", "sidebar", "subscribe", "newsletter", "signup", "popup", "modal", "overlay",
  "lightbox", "social", "share-", "sharing", "advert", "adslot", "-ads", "promo", "breadcrumb",
  "pagination", "banner", "masthead", "skip-to", "skip-link", "sr-only", "visually-hidden",
  "screen-reader", "offcanvas", "toolbar", "topbar", "related", "recommend", "site-header",
  "global-header"];

function boiler(attrs) {
  const s = attrs.filter(([k]) => k === "class" || k === "id" || k === "role").map(([, v]) => v || "").join(" ").toLowerCase();
  if (s.includes("content") || s.includes("article") || s.includes("main")) return false;   // protect content-ish
  return BOILER.some((kw) => s.includes(kw));
}

/** [title, raw text pieces] of an HTML text; contentOnly keeps only text inside <main>/<article>. */
export function extract(html, contentOnly) {
  const stack = [], out = [];
  let title = null, inTitle = false;
  const skipping = () => stack.some((s) => s[1]);
  const inContent = () => stack.some((s) => s[0] === "main" || s[0] === "article");
  for (const t of tokens(html)) {
    if (t.type === "start") {
      if (t.tag === "title") inTitle = true;
      if (VOID.has(t.tag) || t.selfClosing) {
        if (t.tag === "br" && !skipping()) out.push("\n");
        continue;
      }
      stack.push([t.tag, SKIP.has(t.tag) || boiler(t.attrs) || skipping()]);
      if (BLOCK.has(t.tag) && !skipping()) out.push("\n");
    } else if (t.type === "end") {
      if (t.tag === "title") inTitle = false;
      if (VOID.has(t.tag)) continue;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i][0] === t.tag) {
          stack.length = i;
          if (BLOCK.has(t.tag) && !skipping()) out.push("\n");
          break;
        }
      }
    } else {
      if (inTitle && title === null) title = t.text.trim();
      if (skipping() || (contentOnly && !inContent())) continue;
      out.push(t.text);
    }
  }
  return [title || "", out.join("")];
}

const NOISE = new Set(["always active", "accept all", "reject all", "customize", "cookie", "duration", "description"]);
export function cleanWs(s) {
  s = s.replaceAll(" ", " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  // drop lines that are pure boilerplate noise
  const keep = [];
  for (const ln of s.split("\n")) {
    const l = ln.trim();
    if (!l) { keep.push(""); continue; }
    if (NOISE.has(l.toLowerCase())) continue;
    keep.push(l);
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** [title, text] of an HTML file. */
export function htmlToText(path) {
  const raw = readText(path, "replace");
  const contentOnly = /<(main|article)[\s>]/i.test(raw);
  let [title, txt] = extract(raw, contentOnly);
  txt = cleanWs(txt);
  if (contentOnly && txt.length < 200) {                    // main/article mis-detected — retry whole body
    [title, txt] = extract(raw, false);
    txt = cleanWs(txt);
  }
  return [title, txt];
}

/** A PDF's text layer ("" when it has none, e.g. a scan). Stops when pdftotext is not installed. */
export function pdfToText(path) {
  if (!which("pdftotext")) die("extracting PDF cores needs `pdftotext` (poppler: brew install poppler, or apt install poppler-utils); not found on PATH");
  try { return decode(run("pdftotext", ["-layout", path, "-"], { timeout: 120 }).stdout, "replace"); } catch { return ""; }
}

export async function main(argv = process.argv.slice(2)) {
  const { GROUNDING } = ROOTS;
  const FORCE = argv.includes("--force");
  const CORES = `${GROUNDING}/cores`;
  mkdirSync(CORES, { recursive: true });
  const man = readCsvFile(`${GROUNDING}/MANIFEST.csv`);
  let done = 0, skipped = 0, kept = 0;
  const ocrPdfs = [], ocrImgs = [], errors = [];
  for (const m of man) {
    const typ = kind(m.type);                                // older rows say txt/htm/png; kind() maps them
    const sha = (m.sha256 ?? "").trim(), stored = (m.stored ?? "").trim();
    if (isAsset(m) || !sha || sha === "-" || !stored) { skipped++; continue; }
    const path = join(GROUNDING, stored);
    if (!existsSync(path)) { errors.push(["missing", stored]); continue; }
    const out = join(CORES, `doc_${sha.slice(0, 12)}.txt`);
    if (existsSync(out) && !FORCE) { kept++; continue; }     // never silently replace a stored core
    try {
      if (typ === "html") {
        const [title, txt] = htmlToText(path);
        if (txt.length < 40) { errors.push(["empty_html", stored]); continue; }
        writeFileSync(out, `# core: ${m.title || title}\n# url: ${m.url ?? ""}\n# doc_${sha.slice(0, 12)}  (${typ}, from ${stored})\n\n` + txt + "\n", "utf8");
        done++;
      } else if (typ === "pdf") {
        const txt = pdfToText(path);
        if (txt.trim().length < 200) { ocrPdfs.push([sha, stored]); continue; }
        writeFileSync(out, `# core: ${m.title ?? ""}\n# url: ${m.url ?? ""}\n# doc_${sha.slice(0, 12)}  (pdf, from ${stored})\n\n` + txt.trim() + "\n", "utf8");
        done++;
      } else if (typ === "text") {
        const txt = readText(path, "replace").trim();
        if (txt.length < 40) { skipped++; continue; }
        writeFileSync(out, `# core: ${m.title ?? ""}\n# doc_${sha.slice(0, 12)} (${m.type})\n\n` + txt + "\n", "utf8");
        done++;
      } else if (typ === "image") {
        ocrImgs.push([sha, stored]);
      } else {                                               // json/xlsx/gz: extract-remaining reads them
        skipped++;
      }
    } catch (e) {
      errors.push([String(e.message).slice(0, 40), stored]);
    }
  }
  let tsv = "";
  for (const [sha, stored] of ocrPdfs) tsv += `pdf\t${sha}\t${stored}\n`;
  for (const [sha, stored] of ocrImgs) tsv += `img\t${sha}\t${stored}\n`;
  writeFileSync(`${GROUNDING}/ocr-worklist.tsv`, tsv, "utf8");
  print("cores written:", done, "| kept (exist; --force to rewrite):", kept, "| skipped:", skipped,
    `| OCR: ${ocrPdfs.length} pdf + ${ocrImgs.length} img`, "| errors:", errors.length);
}

if (isMain(import.meta.url)) runMain(main);
