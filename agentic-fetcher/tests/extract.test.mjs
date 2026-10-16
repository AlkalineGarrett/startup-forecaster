// What install-source can read: a PDF through pdftotext (or OCR when it is a scan), the other file types
// through their extractors, and a refusal for anything else. Missing tools are simulated by running the
// tool with a PATH that lacks them. A refused file leaves nothing behind: no raw file, row or registry entry.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { extAndType } from "../install_source.mjs";
import { readCsvFile } from "../lib/csv.mjs";
import { kind } from "../lib/manifest.mjs";
import { which } from "../lib/util.mjs";
import { runTool, tmpPath, twoRoots, zip } from "./helpers.mjs";

const PDFTOTEXT = which("pdftotext");

/** A one-page PDF showing `lines` in Helvetica (no lines: a page with no text layer, like a scan). */
function pdf(lines) {
  const esc = (s) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = lines.length ? `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET` : "";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}` +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const TEXT_LINES = [
  "Field crew scheduling: annual plan pricing for small contractors.",
  "The Crew plan is 29 dollars per seat per month, billed yearly.",
  "The Fleet plan is 49 dollars per seat per month, with dispatch.",
  "Both plans include a 14 day free trial and unlimited job sites.",
];

/** A temp directory holding only the named executables (symlinks), for a PATH that lacks the rest. */
function binWith(...names) {
  const dir = tmpPath();
  for (const n of names) symlinkSync(which(n), join(dir, n));
  return dir;
}

/** An executable shell script standing in for an OCR engine. */
function script(body) {
  const p = join(tmpPath(), "fake-ocr.sh");
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function roots(extraEnv = {}) {
  const r = twoRoots();
  writeFileSync(join(r.gs, "documents.json"), "{}");
  const env = { ...r.env, ...extraEnv };
  delete env.FORECASTER_OCR;
  if (extraEnv.FORECASTER_OCR) env.FORECASTER_OCR = extraEnv.FORECASTER_OCR;
  return { ...r, env };
}

/** Nothing was registered or left in the archive. */
function assertNothingInstalled(gs) {
  assert.deepEqual(JSON.parse(readFileSync(join(gs, "documents.json"), "utf8")), {});
  assert.ok(!existsSync(join(gs, "MANIFEST.csv")) || readCsvFile(join(gs, "MANIFEST.csv")).length === 0);
  assert.ok(!existsSync(join(gs, "manual")) || readdirSync(join(gs, "manual")).length === 0, "raw file left behind");
  assert.deepEqual(readdirSync(join(gs, "cores")), []);
}

async function install(file, data, env, ...extra) {
  const tmp = tmpPath(), src = join(tmp, file);
  writeFileSync(src, data);
  return runTool("install_source.mjs", [src, "--url", `https://crew.example/${file}`, "--title", `Crew ${file}`, ...extra], env);
}

const onlyRow = (gs) => {
  const rows = readCsvFile(join(gs, "MANIFEST.csv"));
  assert.equal(rows.length, 1);
  return rows[0];
};
const coreOf = (gs, row) => readFileSync(join(gs, "cores", `doc_${row.sha256.slice(0, 12)}.txt`), "utf8");

// ---- F1: PDFs ----

test("a PDF is refused, naming pdftotext, when pdftotext is not installed", async () => {
  const { gs, env } = roots({ PATH: tmpPath() });              // an empty PATH: no pdftotext
  const r = await install("plans.pdf", pdf(TEXT_LINES), env);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /pdftotext/);
  assertNothingInstalled(gs);
});

test("a text PDF installs through pdftotext", { skip: !PDFTOTEXT && "pdftotext is not installed" }, async () => {
  const { gs, env } = roots({ PATH: `${binWith("pdftotext")}:/bin:/usr/bin` });
  const r = await install("plans.pdf", pdf(TEXT_LINES), env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /core via pdftotext/);
  const row = onlyRow(gs);
  assert.equal(row.type, "pdf");
  assert.match(coreOf(gs, row), /The Crew plan is 29 dollars per seat per month/);
});

test("a scanned PDF with no OCR backend is refused, naming what is missing", { skip: !PDFTOTEXT && "pdftotext is not installed" }, async () => {
  const { gs, env } = roots({ PATH: binWith("pdftotext") });   // pdftotext, but no pdftoppm (and no FORECASTER_OCR)
  const r = await install("scan.pdf", pdf([]), env);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /needs OCR/);
  assert.match(r.stderr, /FORECASTER_OCR/);
  if (process.platform === "darwin") assert.match(r.stderr, /pdftoppm/);
  assertNothingInstalled(gs);
});

test("FORECASTER_OCR plugs in any OCR engine for a scanned PDF", { skip: !PDFTOTEXT && "pdftotext is not installed" }, async () => {
  const ocr = script('echo "Scanned rate card: the Crew plan is 29 dollars per seat. ($1)"');
  const { gs, env } = roots({ PATH: `${binWith("pdftotext")}:/bin:/usr/bin`, FORECASTER_OCR: ocr });
  const r = await install("scan.pdf", pdf([]), env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /core via ocr/);
  const core = coreOf(gs, onlyRow(gs));
  assert.match(core, /Scanned rate card: the Crew plan is 29 dollars per seat/);
  assert.match(core, /\(\/.*\/manual\/[^/]+\.pdf\)/, "the OCR command is given the stored file's path");
});

test("an OCR engine that fails, or finds no text, registers nothing", { skip: !PDFTOTEXT && "pdftotext is not installed" }, async () => {
  for (const [body, why] of [["exit 0", /fewer than 20/], ['echo "engine crashed" >&2; exit 3', /failed.*engine crashed/s]]) {
    const { gs, env } = roots({ PATH: `${binWith("pdftotext")}:/bin:/usr/bin`, FORECASTER_OCR: script(body) });
    const r = await install("scan.pdf", pdf([]), env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, why);
    assertNothingInstalled(gs);
  }
});

// ---- F2: other file types ----

test("xlsx, json and gz go through their extractors", async () => {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const cases = [
    ["rates.xlsx", zip({
      "xl/sharedStrings.xml": `<sst ${ns}><si><t>Crew plan per seat</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${ns}><sheetData><row><c t="s"><v>0</v></c><c><v>29</v></c></row></sheetData></worksheet>`,
    }), "xlsx", /Crew plan per seat\t29/],
    ["plans.json", '{"plans": [{"name": "Crew", "usd_per_seat_month": 29}]}', "json", /"usd_per_seat_month": 29/],
    ["page.html.gz", gzipSync("<html><body><p>The Fleet plan is 49 dollars per seat.</p></body></html>"), "gz", /^The Fleet plan is 49 dollars per seat\.$/m],
  ];
  for (const [file, data, type, inCore] of cases) {
    const { gs, env } = roots();
    const r = await install(file, data, env);
    assert.equal(r.code, 0, `${file}: ${r.stderr}`);
    const row = onlyRow(gs);
    assert.equal(row.type, type, file);
    assert.match(coreOf(gs, row), inCore, file);
    assert.doesNotMatch(r.stderr, /TRANSCRIPTION/, `${file} is the source's own bytes`);
  }
});

test("an image goes through OCR", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const { gs, env } = roots({ FORECASTER_OCR: script('echo "Screenshot: Crew plan 29 dollars per seat per month"') });
  const r = await install("pricing-shot.png", png, env);
  assert.equal(r.code, 0, r.stderr);
  const row = onlyRow(gs);
  assert.equal(row.type, "image");
  assert.match(coreOf(gs, row), /Crew plan 29 dollars per seat per month/);
});

test("a file no extractor reads is refused", async () => {
  for (const [file, data] of [
    ["blob.bin", Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])],
    ["spec.docx", zip({ "word/document.xml": "<w:document/>" })],
    ["archive.gz", gzipSync(Buffer.from([0, 0, 0, 1, 2, 3, 255, 0]))],
  ]) {
    const { gs, env } = roots();
    const r = await install(file, data, env);
    assert.equal(r.code, 1, file);
    assert.match(r.stderr, /refusing|binary data/, file);
    assertNothingInstalled(gs);
  }
});

test("an empty page is refused, and --check reports it without writing", async () => {
  const { gs, env } = roots();
  const shell = "<html><head><script>render()</script></head><body><div id=app></div></body></html>";
  for (const extra of [[], ["--check"]]) {
    const r = await install("app.html", shell, env, ...extra);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /refusing app\.html: its extracted core .* fewer than 20/);
  }
  assertNothingInstalled(gs);
});

test("types: named by extension, else sniffed; one vocabulary for every tool", () => {
  const t = (name, data) => extAndType(name, Buffer.from(data, "latin1"))[1];
  assert.equal(t("a.HTM", "x"), "html");
  assert.equal(t("download", "%PDF-1.7 …"), "pdf");
  assert.equal(t("download", "\x89PNG\r\n\x1a\n…"), "image");
  assert.equal(t("download", '{"a": 1}'), "json");
  assert.equal(t("download", "plain words"), "text");
  assert.equal(t("notes.md", "# x"), "text");
  assert.equal(t("blob", "\0\0\0"), null);
  // older MANIFEST rows say txt/htm/png; every reader maps them onto the same types
  assert.deepEqual(["txt", "text", "htm", "png", "JPG", "pdf", "crawl"].map(kind), ["text", "text", "html", "image", "image", "pdf", "crawl"]);
});
