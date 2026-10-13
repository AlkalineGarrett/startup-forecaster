#!/usr/bin/env node
// Install a new source into the archive end-to-end, so an agent can ground a node against it.
//
// Give it a file an agent already fetched (or a URL to fetch with curl) and it:
//   1. hashes the bytes (sha256) and DEDUPES — a byte-identical source already in the archive is
//      reported, not duplicated;
//   2. stores the raw file under sources/<tier>/ (the durable byte archive);
//   3. extracts a lean, searchable CORE to cores/doc_<sha12>.txt — HTML stripped to text, a text PDF
//      via pdftotext, an image-only (scanned) PDF via the macOS-Vision OCR sidecar (ocr_pdf.sh);
//   4. appends a MANIFEST.csv row and registers a `doc_<sha12>` identity in the shared registry
//      (GROUNDING/documents.json: title/url/publisher/core) ready for add_observation.mjs;
//   5. if the source fulfils a queued human-fetch request (matching URL), marks it resolved.
//
//     # an agent that already has the bytes (saved a WebFetch/download to a file):
//     node install_source.mjs path/to/saved.html --url https://x.com/p --title "X pricing"
//
//     # fetch the URL directly with curl (needs network; may require running outside the sandbox):
//     node install_source.mjs --url https://x.com/p --title "X pricing"
//
//     # verify/inspect only — hash, dedupe check, extracted core preview; no write:
//     node install_source.mjs path/to/saved.html --url https://x.com/p --check
//
// Cleaning is deliberately lean (the core is the text layer search.mjs + add_observation quote-match
// against). Re-running on the same bytes is a no-op. Paths resolve through paths.mjs (the workspace, or
// FORECASTER_DATA / GROUNDING_SOURCES). The OCR route runs ocr_pdf.sh.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { HERE, ROOTS } from "./paths.mjs";   // PROJECT holds corpus/; GROUNDING holds the source cache
import { parse, usageError } from "./lib/args.mjs";
import { readCsvFile, writeRecord, writerow } from "./lib/csv.mjs";
import { unescape } from "./lib/html.mjs";
import { dumps, loads } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { decode, die, eprint, isMain, print, readText, run, runMain, urlHost, urlPath } from "./lib/util.mjs";
import * as fr from "./fetch_request.mjs";

export const MAN_COLS = ["id", "tier", "domain", "title", "url", "type", "bytes", "copies", "sha256", "stored", "origin", "status"];

const slug = (s, n = 48) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n) || "source";

/** [file extension, core type] from the file name, else by sniffing the first bytes. */
export function extAndType(fname, data) {
  const ext = extname(fname).toLowerCase().replace(/^\./, "");
  if (ext === "html" || ext === "htm") return ["html", "html"];
  if (ext === "pdf") return ["pdf", "pdf"];
  if (["txt", "md", "csv"].includes(ext)) return [ext, "text"];
  const head = data.subarray(0, 512).toString("latin1").replace(/^[ \t\n\r\v\f]+/, "").toLowerCase();
  if (head.startsWith("<html") || head.includes("<!doctype html") || head.includes("<body")) return ["html", "html"];
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return ["pdf", "pdf"];
  return [ext || "bin", "text"];
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

/** Text PDF → pdftotext. Image-only (scan) → macOS Vision OCR sidecar. Returns [text, how].
 * `ocr` is the OCR script (default: ocr_pdf.sh beside this tool; a missing path skips OCR). */
export function pdfToText(path, ocr = `${HERE}/ocr_pdf.sh`) {
  let txt = "";
  try {
    txt = decode(run("pdftotext", ["-q", path, "-"], { timeout: 120 }).stdout, "replace").replace(/\r\n?/g, "\n");
  } catch {
    // pdftotext missing or timed out: fall through with no text
  }
  if (txt.replace(/\s/g, "").length >= 200) return [txt, "pdftotext"];
  if (existsSync(ocr)) {                                       // scanned PDF — OCR it (Vision, offline)
    try {
      const r = run(ocr, [path], { timeout: 600 });
      if (r.code !== 0) throw new Error(`ocr_pdf.sh exited ${r.code}`);
      const side = `${path}.ocr.txt`;
      if (existsSync(side)) return [readText(side, "replace"), "ocr"];
    } catch (e) {
      return [txt, `ocr-failed:${e.message}`];
    }
  }
  return [txt, "pdftotext-thin"];
}

export function extractCore(storedAbs, kind, ocr = undefined) {
  const data = readFileSync(storedAbs);
  if (kind === "html") return [htmlToText(data), "html-strip"];
  if (kind === "pdf") return pdfToText(storedAbs, ocr);
  return [decode(data, "replace"), "verbatim"];
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
  const domain = urlHost(url || "").replaceAll("www.", "") || "unknown";
  const existing = findExisting(sha);
  if (existing && !check) {
    print(`already archived: ${docId}  (sha match, stored ${existing.stored}) — not duplicated`);
    await resolveRequest(url);
    return [docId, "exists"];
  }
  let storedRel = `${tier}/${slug(domain)}__${slug(title || srcName)}.${kindExt}`;
  // Titles that share a long prefix truncate to the same slug ("… (page 2)" / "… (page 3)"); a
  // different source must never overwrite another's raw bytes, so disambiguate with the content hash.
  if (existsSync(`${GROUNDING}/${storedRel}`)) {
    storedRel = `${tier}/${slug(domain)}__${slug(title || srcName)}-${sha.slice(0, 12)}.${kindExt}`;
  }
  const storedAbs = `${GROUNDING}/${storedRel}`;
  if (check) {
    const dir = mkdtempSync(join(tmpdir(), "install-check-"));
    const tmp = join(dir, `source.${kindExt}`);
    writeFileSync(tmp, data);
    let coreText, how;
    try {
      [coreText, how] = extractCore(tmp, typ);
    } finally {
      rmSync(tmp, { force: true });
    }
    print(`[check] ${docId}  type=${typ}  bytes=${data.length}  domain=${domain}`);
    print(`[check] ${existing ? "DUPLICATE of " + existing.stored : "new source"}`);
    print(`[check] core via ${how}: ${coreText.length} chars; preview:\n    ` + coreText.slice(0, 280).replaceAll("\n", "\n    "));
    return [docId, "check"];
  }
  mkdirSync(dirname(storedAbs), { recursive: true });
  writeFileSync(storedAbs, data);
  const [coreText, how] = extractCore(storedAbs, typ);
  const coreRel = `cores/${docId}.txt`;
  mkdirSync(`${GROUNDING}/cores`, { recursive: true });
  writeFileSync(`${GROUNDING}/${coreRel}`, coreText, "utf8");
  // capture provenance: `fetched` = the core is the archived page's own bytes; `transcribed` = an
  // agent typed the figures into a text file (a JS-rendered page WebFetch could read but curl can't).
  // A transcribed core self-verifies against our OWN text, so a transcribed numeric fact is weaker
  // evidence — surfaced here and by add_observation so it can be gated on a second source / audit.
  const low = (url || "").toLowerCase();
  const looksTranscribed = typ === "text" && how === "verbatim" && ![".txt", ".md", ".csv"].some((e) => low.endsWith(e));
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
  print(`  → ground it:  node add_observation.mjs ${docId} obs_<id> --value <v> --unit <u> ` +
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
        `node fetch_request.mjs resolve --url ${pend[0].url}`);
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
    tier: { default: "manual" },
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
      die(`fetch error: ${e.message}. Queue it for a human: node fetch_request.mjs add --url ${a.url} ...`);
    }
    if (r.code !== 0 || !r.stdout.length) {
      die(`curl fetch failed (${r.code}). Save the file yourself and pass it, or queue it: ` +
        `node fetch_request.mjs add --url ${a.url} --why '...' --for <project::node>`);
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
