#!/usr/bin/env node
// Install a new source into the archive end-to-end, so an agent can ground a node against it.
//
// Give it a file an agent already fetched (or a URL to fetch with curl) and it:
//   1. hashes the bytes (sha256) and DEDUPES — a byte-identical source already in the archive is
//      reported, not duplicated;
//   2. stores the raw file under sources/<tier>/ (the durable byte archive);
//   3. extracts a lean, searchable CORE to cores/doc_<sha12>.txt — HTML stripped to text, a text PDF
//      via pdftotext, a scanned PDF or an image via OCR (lib/ocr.mjs: FORECASTER_OCR, else macOS
//      Vision), an xlsx's cell values, a gz's text, a json/txt/md/csv verbatim. Any other file is
//      refused, and so is a file whose core comes out empty: nothing could be quote-verified against it;
//   4. appends a MANIFEST.csv row and registers a `doc_<sha12>` identity in the shared registry
//      (GROUNDING/documents.json: title/url/publisher/core) ready for add_observation.mjs;
//   5. if the source fulfils a queued human-fetch request (matching URL), marks it resolved.
//
//     # an agent that already has the bytes (saved a WebFetch/download to a file):
//     npx forecaster install-source path/to/saved.html --url https://x.com/p --title "X pricing"
//
//     # fetch the URL directly with curl (needs network access):
//     npx forecaster install-source --url https://x.com/p --title "X pricing"
//
//     # verify/inspect only — hash, dedupe check, extracted core preview; no write:
//     npx forecaster install-source path/to/saved.html --url https://x.com/p --check
//
// Cleaning is deliberately lean (the core is the text layer search.mjs + add_observation quote-match
// against). Re-running on the same bytes is a no-op. Paths resolve through paths.mjs (the workspace, or
// FORECASTER_DATA / GROUNDING_SOURCES). The MANIFEST columns and type vocabulary are in lib/manifest.mjs.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { basename, dirname, extname, join } from "node:path";
import { ROOTS } from "./paths.mjs";   // PROJECT holds corpus/; GROUNDING holds the source cache
import { parse, usageError } from "./lib/args.mjs";
import { readCsvFile, writeRecord, writerow } from "./lib/csv.mjs";
import { unescape } from "./lib/html.mjs";
import { dumps, loads } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { IMAGE_EXT, MAN_COLS, TEXT_EXT } from "./lib/manifest.mjs";
import { ocrBackend } from "./lib/ocr.mjs";
import { NotAZip, xlsxText } from "./lib/xlsx.mjs";
import { Exit, decode, die, eprint, isMain, print, run, runMain, urlPath, which } from "./lib/util.mjs";
import * as fr from "./fetch_request.mjs";

const slug = (s, n = 48) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n) || "source";

const SUPPORTED = "html, pdf, text (txt/md/csv/tsv), json, xlsx, gz (of text or HTML) and images (through OCR)";

/** Fewer non-whitespace characters than this is an empty core: install refuses to register it. */
export const MIN_CORE_CHARS = 20;
const dense = (s) => (s || "").replace(/\s/g, "").length;

/** True when the bytes read as UTF-8 text (no NUL bytes, no invalid sequences). */
function looksText(data) {
  if (data.includes(0)) return false;
  try { decode(data, "strict"); return true; } catch { return false; }
}

/** [file extension, MANIFEST type] from the file name, else by sniffing the first bytes. The type is one of
 * lib/manifest.mjs TYPES, or null for bytes no extractor reads (install refuses those). */
export function extAndType(fname, data) {
  const ext = extname(fname).toLowerCase().replace(/^\./, "");
  const starts = (...bytes) => data.length >= bytes.length && bytes.every((b, i) => b === null || data[i] === b);
  const zip = starts(0x50, 0x4b, 0x03, 0x04);
  if (ext === "html" || ext === "htm") return ["html", "html"];
  if (ext === "pdf" || data.subarray(0, 5).toString("latin1") === "%PDF-") return ["pdf", "pdf"];
  if (ext === "xlsx") return ["xlsx", "xlsx"];
  if (ext === "gz" || starts(0x1f, 0x8b)) return ["gz", "gz"];
  if (IMAGE_EXT.includes(ext)) return [ext, "image"];
  if (starts(0x89, 0x50, 0x4e, 0x47)) return ["png", "image"];
  if (starts(0xff, 0xd8, 0xff)) return ["jpg", "image"];
  if (starts(0x47, 0x49, 0x46, 0x38)) return ["gif", "image"];
  if (starts(0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50)) return ["webp", "image"];
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return ["tiff", "image"];
  if (zip) return [ext || "zip", null];                         // a docx/pptx/zip: no extractor reads it
  if (ext === "json") return ["json", "json"];
  if (TEXT_EXT.includes(ext)) return [ext, "text"];
  const head = data.subarray(0, 512).toString("latin1").replace(/^[ \t\n\r\v\f]+/, "").toLowerCase();
  if (head.startsWith("<html") || head.includes("<!doctype html") || head.includes("<body")) return ["html", "html"];
  if (!looksText(data)) return [ext || "bin", null];
  if (/^[[{]/.test(head)) {
    try { JSON.parse(decode(data, "strict")); return [ext || "json", "json"]; } catch { /* text that starts with a bracket */ }
  }
  return [ext || "txt", "text"];
}

// ---- core extraction (the lean, searchable text layer) ----
export function htmlToText(data) {
  let s = decode(data, "replace");
  s = s.replace(/<(script|style|noscript|svg|head)(?![\p{L}\p{N}_])[\s\S]*?<\/\1>/giu, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = unescape(s);
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.split(/\r\n?|[\n\u2028\u2029]/).map((ln) => ln.trim()).filter(Boolean).join("\n");
}

/** Text PDF → pdftotext. Image-only (scan) → the OCR backend (lib/ocr.mjs). Returns [text, how].
 * Stops (Exit) when pdftotext is missing, or when the PDF needs OCR and no backend can run. */
export function pdfToText(path) {
  if (!which("pdftotext")) {
    die("reading a PDF needs `pdftotext` (poppler: brew install poppler, or apt install poppler-utils); not found on PATH");
  }
  let r;
  try {
    r = run("pdftotext", ["-q", path, "-"], { timeout: 120 });
  } catch (e) {
    die(`pdftotext failed on ${path}: ${e.message}`);
  }
  const txt = decode(r.stdout, "replace").replace(/\r\n?/g, "\n");
  if (r.code !== 0 && !dense(txt)) die(`pdftotext could not read ${path} (exit ${r.code}); is it a valid PDF?`);
  if (dense(txt) >= 200) return [txt, "pdftotext"];
  let backend;                                               // scanned PDF: OCR it
  try {
    backend = ocrBackend("pdf");
  } catch (e) {
    if (e instanceof Exit) die(`${path} has almost no text layer (${dense(txt)} characters), so it needs OCR: ${e.message}`);
    throw e;
  }
  let ocr;
  try {
    ocr = backend.ocr(path);
  } catch (e) {
    die(`OCR (${backend.name}) failed on ${path}: ${e.message}`);
  }
  return dense(ocr) >= dense(txt) ? [ocr, "ocr"] : [txt, "pdftotext-thin"];
}

/** An image → the OCR backend. */
function imageToText(path) {
  const backend = ocrBackend("image");
  try {
    return [backend.ocr(path), "ocr"];
  } catch (e) {
    die(`OCR (${backend.name}) failed on ${path}: ${e.message}`);
  }
}

/** [core text, how] for the stored file at `storedAbs`, read as MANIFEST type `kind`. */
export function extractCore(storedAbs, kind) {
  const data = readFileSync(storedAbs);
  if (kind === "html") return [htmlToText(data), "html-strip"];
  if (kind === "pdf") return pdfToText(storedAbs);
  if (kind === "image") return imageToText(storedAbs);
  if (kind === "xlsx") {
    try {
      return [xlsxText(storedAbs), "xlsx-cells"];
    } catch (e) {
      if (!(e instanceof NotAZip)) throw e;
      if (looksText(data)) return [htmlToText(data), "html-strip"];   // a page saved under an .xlsx name
      die(`${storedAbs} is named .xlsx but is not a spreadsheet`);
    }
  }
  if (kind === "gz") {
    let raw;
    try { raw = gunzipSync(data); } catch (e) { die(`${storedAbs}: not a readable gzip file (${e.message})`); }
    if (!looksText(raw)) die(`${storedAbs}: the gzip holds binary data, not text; unpack it and install the file inside`);
    const head = raw.subarray(0, 2000).toString("latin1").toLowerCase();
    return head.includes("<html") || head.includes("<body") || head.includes("<!doctype html")
      ? [htmlToText(raw), "gunzip+html-strip"] : [decode(raw, "strict"), "gunzip"];
  }
  if (kind === "json" || kind === "text") return [decode(data, "replace"), "verbatim"];
  die(`can't extract text from ${storedAbs}: supported are ${SUPPORTED}`);
}

// ---- archive registration (MANIFEST + corpus doc), file-locked ----
function loadManifest() {
  const p = `${ROOTS.GROUNDING}/MANIFEST.csv`;
  return existsSync(p) ? readCsvFile(p) : [];
}

function findExisting(sha) {
  for (const r of loadManifest()) if (r.sha256 === sha) return r;
  return null;
}

async function writeManifestRow(row) {
  const p = `${ROOTS.GROUNDING}/MANIFEST.csv`;
  const exists = existsSync(p);
  await withLock(p, () => {
    let text = "";
    if (!exists || statSync(p).size === 0) text += writerow(MAN_COLS);
    text += writeRecord(MAN_COLS, row);
    appendFileSync(p, text, "utf8");
  });
}

async function registerDoc(docId, meta) {
  const p = `${ROOTS.GROUNDING}/documents.json`;              // the shared source-identity registry
  await withLock(p, () => {
    const body = readFileSync(p, "utf8").trim();
    const docs = body ? loads(body) : {};
    if (!Object.hasOwn(docs, docId)) docs[docId] = meta;
    rewrite(p, dumps(docs, { indent: 1 }) + "\n");
  });
}

export async function install(data, url, title, { tier = "manual", origin = "agent-install", srcName = "source", check = false, capture = null } = {}) {
  const GROUNDING = ROOTS.GROUNDING;
  const sha = createHash("sha256").update(data).digest("hex"), sha12 = sha.slice(0, 12), docId = `doc_${sha12}`;
  const [kindExt, typ] = extAndType(srcName, data);
  if (typ === null) {
    die(`refusing ${srcName}: no extractor reads .${kindExt} files (supported: ${SUPPORTED}). Convert it to one ` +
      "of these, or type its figures into a .txt and install that with --capture transcribed.");
  }
  const domain = fr.domain(url) || "unknown";
  const existing = findExisting(sha);
  if (existing && !check) {
    print(`already archived: ${docId}  (sha match, stored ${existing.stored}) — not duplicated`);
    await resolveRequest(url);
    return [docId, "exists"];
  }
  /** The core, refusing an empty or near-empty one: a doc must have text to quote-verify against. */
  const coreOf = (path) => {
    const [text, how] = extractCore(path, typ);
    if (dense(text) < MIN_CORE_CHARS) {
      die(`refusing ${srcName}: its extracted core (via ${how}) has ${dense(text)} non-blank characters, fewer than ` +
        `${MIN_CORE_CHARS}. Nothing could be quote-verified against it. A JS-rendered page saved before it ` +
        "rendered, a challenge page or a blank scan gives this; save the rendered page, or OCR it.");
    }
    return [text, how];
  };
  const stem = `${tier}/${slug(domain)}__${slug(title || srcName)}`;
  let storedRel = `${stem}.${kindExt}`;
  // Titles that share a long prefix truncate to the same slug ("… (page 2)" / "… (page 3)"); a
  // different source must never overwrite another's raw bytes, so disambiguate with the content hash.
  if (existsSync(`${GROUNDING}/${storedRel}`)) {
    storedRel = `${stem}-${sha12}.${kindExt}`;
  }
  const storedAbs = `${GROUNDING}/${storedRel}`;
  if (check) {
    const dir = mkdtempSync(join(tmpdir(), "install-check-"));
    const tmp = join(dir, `source.${kindExt}`);
    writeFileSync(tmp, data);
    let coreText, how;
    try {
      [coreText, how] = coreOf(tmp);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    print(`[check] ${docId}  type=${typ}  bytes=${data.length}  domain=${domain}`);
    print(`[check] ${existing ? "DUPLICATE of " + existing.stored : "new source"}`);
    print(`[check] core via ${how}: ${coreText.length} chars; preview:\n    ` + coreText.slice(0, 280).replaceAll("\n", "\n    "));
    return [docId, "check"];
  }
  mkdirSync(dirname(storedAbs), { recursive: true });
  const existed = existsSync(storedAbs);
  writeFileSync(storedAbs, data);
  let coreText, how;
  try {
    [coreText, how] = coreOf(storedAbs);
  } catch (e) {                                              // nothing is registered: take the raw file back out
    if (!existed) rmSync(storedAbs, { force: true });
    rmSync(`${storedAbs}.ocr.txt`, { force: true });
    throw e;
  }
  const coreRel = `cores/${docId}.txt`;
  mkdirSync(`${GROUNDING}/cores`, { recursive: true });
  writeFileSync(`${GROUNDING}/${coreRel}`, coreText, "utf8");
  // capture provenance: `fetched` = the core is the archived page's own bytes; `transcribed` = an
  // agent typed the figures into a text file (a JS-rendered page WebFetch could read but curl can't).
  // A transcribed core self-verifies against our OWN text, so a transcribed numeric fact is weaker
  // evidence — surfaced here and by add_observation so it can be gated on a second source / audit.
  const low = (url || "").toLowerCase();
  const looksTranscribed = typ === "text" && ![".txt", ".md", ".csv", ".tsv"].some((e) => low.endsWith(e));
  const cap = capture || (looksTranscribed ? "transcribed" : "fetched");
  if (looksTranscribed && !capture) {
    eprint("  ⚠ this looks like a TRANSCRIPTION (a text file for a web URL) — recording capture:transcribed. " +
      "Pass --capture fetched if it is really the page's own text.");
  }
  await writeManifestRow({ id: `${slug(domain)}__${sha12}`, tier, domain,
    title: title || srcName, url: url || "", type: typ, bytes: String(data.length),
    copies: "1", sha256: sha, stored: storedRel, origin, status: "installed" });
  await registerDoc(docId, { sha256: sha, title: title || srcName, url: url || "",
    publisher: domain, core: coreRel, capture: cap });
  await resolveRequest(url);
  print(`installed ${docId}  (${typ}, ${data.length} bytes)  core via ${how}: ${coreText.length} chars`);
  print(`  raw:  ${GROUNDING}/${storedRel}`);
  print(`  core: ${GROUNDING}/${coreRel}`);
  print(`  → ground it:  npx forecaster add-observation ${docId} obs_<id> --value <v> --unit <u> ` +
    '--statement <s> --quote "<verbatim from the core>"');
  return [docId, "installed"];
}

/** If a queued fetch request matches this URL, mark it resolved — and REPORT it (so a silent
 * no-op on a canonical-vs-requested URL mismatch is visible, not swallowed). */
async function resolveRequest(url) {
  if (!url) return;
  try {
    const n = await fr.resolve(url, "installed");
    if (n) {
      print(`  ✓ resolved ${n} queued fetch request(s) for this URL`);
      return;
    }
    const dom = fr.domain(url);                                // exact URL matched nothing — flag a same-domain
    const pend = fr.readQueue()                                // pending request (likely a canonical/redirect
      .filter((r) => r.status !== "resolved" && fr.domain(r.url ?? null) === dom);   // URL mismatch)
    if (pend.length) {
      eprint(`  ⚠ a queued fetch on ${dom} is still PENDING and did not match this URL exactly: ` +
        `${pend[0].url}\n    if this install covers it, resolve it: ` +
        `npx forecaster fetch-request resolve --url ${pend[0].url}`);
    }
  } catch {
    // never let queue bookkeeping fail an install
  }
}

const SPEC = {
  prog: "install_source.mjs",
  description: "Install a new source into the archive (raw + core + manifest + corpus doc).",
  positionals: ["file?"],
  options: {
    url: { help: "the source URL (provenance; or fetched with curl when no file is given)" },
    title: {},
    tier: { default: "manual", help: "the archive folder to store it under (firecrawl uses fetched)" },
    origin: { default: "agent-install" },
    capture: { choices: ["fetched", "transcribed"],
      help: "fetched = the core is the page's own bytes; transcribed = an agent typed the figures " +
        "(JS-rendered page). Auto-detected for text files on a web URL." },
    check: { flag: true, help: "hash + dedupe + core preview, no write" },
  },
};

export async function main() {
  const a = parse(process.argv.slice(2), SPEC);
  let data, name;
  if (a.file) {
    data = readFileSync(a.file);
    name = basename(a.file);
  } else if (a.url) {
    let r;
    try {
      r = run("curl", ["-fsSL", "--max-time", "60", a.url], { timeout: 90 });
    } catch (e) {
      die(`fetch error: ${e.message}. Queue it for a human: npx forecaster fetch-request add --url ${a.url} ...`);
    }
    if (r.code !== 0 || !r.stdout.length) {
      die(`curl fetch failed (${r.code}). Save the file yourself and pass it, or queue it: ` +
        `npx forecaster fetch-request add --url ${a.url} --why '...' --for <project::node>`);
    }
    data = r.stdout;
    name = basename(urlPath(a.url)) || "source";
  } else {
    usageError(SPEC, "give a file, or --url to fetch");
  }
  if (!a.title && !a.url) eprint("note: no --title/--url given; provenance will be thin");
  await install(data, a.url, a.title, { tier: a.tier, origin: a.origin, srcName: name, check: a.check, capture: a.capture });
}

if (isMain(import.meta.url)) runMain(main);
