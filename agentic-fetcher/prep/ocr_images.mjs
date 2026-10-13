// Second-pass OCR: images inside saved HTML pages (their `_files/` assets), standalone images,
// and inline data:image blobs embedded in HTML. macOS Vision via ocrtool (built from ocr.swift beside
// this tool) — RUN OUTSIDE THE SANDBOX (dangerouslyDisableSandbox). Keeps only meaningful-text results.
//
// Usage: node prep/ocr_images.mjs [root ...] [--force]     (default root: sources)
//
// Output:
//   - per owning page:  <page>.images.ocr.txt   (one section per image with text)
//   - standalone image: <image>.ocr.txt
//   - inline data-URI:  <page>.inline-<n>.ocr.txt
//   - report:           ocr-images-<date>.md   (covers all roots given this run)
// Idempotent: skips writing a sidecar that already exists unless --force.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative } from "node:path";
import { ROOTS, ocrtool } from "../paths.mjs";
import { decode, isMain, print, readText, run, runMain, today } from "../lib/util.mjs";

/** Every file under root: [directory, file name] pairs (dot-directories included, as before). */
const walkFiles = (root) => {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.parentPath, e.name]);
  } catch { return []; }
};

const MIN_BYTES = 3072;
const MIN_ALNUM = 40;
const RASTER = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp"];

export async function main(argv = process.argv.slice(2)) {
  const { GROUNDING } = ROOTS;
  const TODAY = today();
  const OCR = ocrtool();
  const FORCE = argv.includes("--force");
  const ROOT_ARGS = argv.filter((a) => !a.startsWith("--"));
  const ROOT_LIST = ROOT_ARGS.length ? ROOT_ARGS : ["."];
  const HDR = `# Image-OCR sidecar (macOS Vision, generated ${TODAY})\n` +
    "# Text recognized from images embedded in this saved page. Durable, searchable copy.\n";

  const ocr = (path) => {
    let out;
    try {
      out = decode(run(OCR, [path], { timeout: 120 }).stdout, "replace").replace(/\r\n?/g, "\n");
    } catch {
      return "";
    }
    if (out.startsWith("FAILED-OCR") || out.slice(0, 80).includes("nilError")) return "";
    return out.trim();
  };
  const alnum = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
  const owningPage = (rel) => {
    const m = /^(.*)_files\//.exec(rel);
    if (m) {
      for (const ext of [".html", ".htm"]) {
        const cand = m[1] + ext;
        if (existsSync(join(GROUNDING, cand))) return cand;
      }
      return m[1] + ".html";
    }
    return null;
  };

  const AGG = { scanned: 0, kept: 0, short: 0, failed: 0, inline: 0, inline_pages: 0 };
  const ALL_PAGES = new Map();   // "root/page" -> [[imgrel, text], …]

  const processRoot = (rootname) => {
    const SRC = normalize(join(GROUNDING, rootname));
    const images = [];
    for (const [base, fn] of walkFiles(SRC)) {
      if (!RASTER.includes(extname(fn).toLowerCase())) continue;
      const full = join(base, fn);
      try { if (statSync(full).size < MIN_BYTES) continue; } catch { continue; }
      images.push(relative(SRC, full));
    }
    images.sort();
    const pageSections = new Map(), standalone = [];
    for (const rel of images) {
      AGG.scanned++;
      const txt = ocr(join(GROUNDING, rel));
      if (!txt) { AGG.failed++; continue; }
      if (alnum(txt) < MIN_ALNUM) { AGG.short++; continue; }
      AGG.kept++;
      const page = owningPage(rel);
      if (page) {
        if (!pageSections.has(page)) pageSections.set(page, []);
        pageSections.get(page).push([rel, txt]);
      } else standalone.push([rel, txt]);
    }
    // write per-page aggregated OCR
    for (const [page, secs] of [...pageSections].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const outp = join(GROUNDING, page + ".images.ocr.txt");
      ALL_PAGES.set(`${rootname}/${page}`, secs);
      if (existsSync(outp) && !FORCE) continue;
      const body = [HDR, `# Owning page: ${page}`, `# ${secs.length} image(s) with recognized text.`, ""];
      for (const [img, txt] of secs) {
        body.push(`===== IMAGE ${relative(dirname(outp), join(GROUNDING, img))} =====`);
        body.push(txt); body.push("");
      }
      writeFileSync(outp, body.join("\n"), "utf8");
    }
    for (const [img, txt] of standalone) {
      const outp = join(GROUNDING, img + ".ocr.txt");
      ALL_PAGES.set(`${rootname}/${img} (standalone)`, [[img, txt]]);
      if (existsSync(outp) && !FORCE) continue;
      writeFileSync(outp, HDR + `# Source image: ${img}\n\n` + txt + "\n", "utf8");
    }
    // inline data:image blobs
    const DATA_RE = /data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]{6000,}={0,2})/g;
    for (const [base, fn] of walkFiles(SRC)) {
      {
        const low = fn.toLowerCase();
        if (!low.endsWith(".html") && !low.endsWith(".htm")) continue;
        const full = join(base, fn), rel = relative(SRC, full);
        let html;
        try { html = readText(full, "replace"); } catch { continue; }
        let hit = false, i = -1;
        for (const [, ext, b64] of html.matchAll(DATA_RE)) {
          i++;
          const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
          const raw = Buffer.from(padded, "base64");
          if (raw.length < MIN_BYTES) continue;
          const dir = mkdtempSync(join(tmpdir(), "ocr-inline-"));
          const tmp = join(dir, "img." + ext.replace("jpeg", "jpg"));
          writeFileSync(tmp, raw);
          const txt = ocr(tmp);
          rmSync(dir, { recursive: true, force: true });
          if (!txt || alnum(txt) < MIN_ALNUM) continue;
          const outp = join(GROUNDING, `${rel}.inline-${i}.ocr.txt`);
          AGG.inline++; hit = true;
          if (existsSync(outp) && !FORCE) continue;
          writeFileSync(outp, HDR + `# Inline data:image #${i} in ${rel}\n\n` + txt + "\n", "utf8");
        }
        if (hit) AGG.inline_pages++;
      }
    }
  };

  for (const r of ROOT_LIST) processRoot(r);

  // ---------- report ----------
  const rep = [`# Second-pass image OCR (${TODAY})`, "",
    `Roots: ${ROOT_LIST.join(", ")}. macOS Vision on on-disk raster images >= ${MIN_BYTES} bytes and ` +
    `inline data:image blobs; kept results with >= ${MIN_ALNUM} alphanumeric chars.`, "",
    `- images scanned: **${AGG.scanned}**`,
    `- kept (meaningful text): **${AGG.kept}**`,
    `- skipped (text too short / decorative): ${AGG.short}`,
    `- OCR returned nothing / failed (textless photos, spacers): ${AGG.failed}`,
    `- pages/standalone images with an OCR sidecar: **${ALL_PAGES.size}**`,
    `- inline data:image blobs OCR'd: ${AGG.inline} across ${AGG.inline_pages} page(s)`, "",
    "## Pages with the most recognized image text", ""];
  const chars = (secs) => secs.reduce((n, [, t]) => n + t.length, 0);
  const top = [...ALL_PAGES].sort((a, b) => chars(b[1]) - chars(a[1])).slice(0, 60);
  for (const [page, secs] of top) {
    const sample = secs[0][1].replace(/\s+/g, " ").slice(0, 120);
    rep.push(`- \`${page}\` — ${secs.length} img, ${chars(secs)} chars — e.g. “${sample}…”`);
  }
  writeFileSync(`${GROUNDING}/ocr-images-${TODAY}.md`, rep.join("\n") + "\n", "utf8");
  print(`scanned=${AGG.scanned} kept=${AGG.kept} short=${AGG.short} failed=${AGG.failed} ` +
    `sidecars=${ALL_PAGES.size} inline=${AGG.inline}`);
  print("wrote ocr-images-<date>.md");
}

if (isMain(import.meta.url)) runMain(main);
