#!/usr/bin/env node
// Source-archive integrity — the node-free invariants over MANIFEST.csv + the sources/ tree.
// Needs no project/node data.
//
//   S1  every manifest row's stored file exists on disk
//   S2  sha256 is unique per artifact (identical bytes collapse to one row; crawl summary rows exempt)
//   S5  every evidence document on disk is in the manifest — by path, or by content-hash for a
//       byte-identical copy. The reverse of S1: a PASS proves nothing is missing.
//
// Run from repo root or sources/:  node check_sources.mjs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { ROOTS } from "./paths.mjs";   // the archive to check is GROUNDING; the corpus (S6/S7) is under PROJECT
import { readCsvFile } from "./lib/csv.mjs";
import { load } from "./lib/json.mjs";
import { isMain, print, runMain } from "./lib/util.mjs";

const NO_HASH = "-";
const DOC_EXT = new Set([".html", ".htm", ".pdf", ".txt", ".xlsx", ".xls", ".doc", ".docx", ".json", ".gz"]);

function excluded(rel, fn) {
  const ext = extname(fn).toLowerCase();
  if (rel.includes("_files/")) return true;                     // browser-save support
  if (rel.split("/").some((seg) => seg.startsWith("_"))) return true;  // _-prefixed = staging/derived (browser-save _files, _clean extractions, _extract.py helpers, _clean_reviews.txt)
  if (rel.startsWith(".git/")) return true;                     // repo metadata (the cache is a git backup)
  if (rel.startsWith("cores/")) return true;                    // derived text layer, not manifest evidence
  if (rel.startsWith("assets/")) return true;                   // never evidence
  if (rel.startsWith("fetch-lists/")) return true;              // source-acquisition worklists
  if (fn === "manual-manifest.csv" || fn === "documents.json" || fn.endsWith(".ocr.txt")) return true;  // index/side records
  if (!rel.includes("/") && ([".csv", ".md", ".py"].includes(ext) || fn === ".DS_Store")) return true;  // repo metadata/tools
  if (fn === ".DS_Store") return true;
  return false;
}

export async function main() {
  const { PROJECT, GROUNDING } = ROOTS;
  const SRC = GROUNDING;
  const MAN = readCsvFile(join(SRC, "MANIFEST.csv"));
  const fail = [];
  const check = (inv, bad, note) => { for (const b of bad) fail.push([inv, b, note]); };

  // S1
  check("S1", MAN.filter((r) => !existsSync(join(SRC, r.stored))).map((r) => r.stored),
    "manifest row has no file on disk");
  // S2
  const counts = new Map();
  for (const r of MAN) counts.set(r.sha256, (counts.get(r.sha256) || 0) + 1);
  check("S2", [...counts].filter(([s, n]) => n > 1 && s !== NO_HASH).map(([s]) => s),
    "sha256 shared by more than one artifact");

  // S5 — reverse: every evidence doc on disk is manifested (by path or by content hash)
  const storedSet = new Set(MAN.map((r) => r.stored));
  const shaSet = new Set(MAN.filter((r) => r.sha256 !== NO_HASH).map((r) => r.sha256));
  const s5 = [];
  for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const fn = e.name, full = join(e.parentPath, fn), rel = full.slice(SRC.replace(/\/$/, "").length + 1);
    if (storedSet.has(rel) || excluded(rel, fn)) continue;
    if (!DOC_EXT.has(extname(fn).toLowerCase())) continue;
    const h = createHash("sha256").update(readFileSync(full)).digest("hex");
    if (!shaSet.has(h)) s5.push(rel);
  }
  check("S5", s5, "evidence file on disk is absent from the manifest (by path and by content)");

  // S6/S7 — corpus↔archive: the doc registry nodes ground against must stay consistent with the byte
  // archive. S6: every registered doc's `core` pointer resolves to a non-empty file (a node quote-
  // matches against that core). S7: every registered source's bytes are in the manifest (computed
  // derivatives are exempt — they have no archived source). Skipped if there is no corpus (isolated runs).
  const corpusPath = join(GROUNDING, "documents.json");          // the doc-identity registry lives with the cache now
  let checks = "S1 S2 S5";
  if (existsSync(corpusPath)) {
    const docs = load(corpusPath);
    const missingCore = [], unmanifested = [];
    for (const [did, dv] of Object.entries(docs)) {
      const core = dv.core;
      if (core && (!existsSync(join(GROUNDING, core)) || statSync(join(GROUNDING, core)).size === 0)) {
        missingCore.push(`${did} -> ${core}`);
      }
      const sha = dv.sha256;
      const isDerived = Boolean(dv.derivation_kind) || dv.origin === "derivative";
      if (sha && !isDerived && !shaSet.has(sha)) unmanifested.push(`${did} (sha ${sha.slice(0, 12)})`);
    }
    check("S6", missingCore, "corpus doc's core file is missing or empty");
    check("S7", unmanifested, "corpus doc's sha256 is not in the manifest (byte archive)");
    checks = "S1 S2 S5 S6 S7";

    // S8 — audit coverage. `verification` (quote-in-core) is stamped at write time, but the
    // legitimacy AUDIT (AUDIT.md) is a separate pass that must actually run; freshly-added
    // observations are `audit: unaudited` (or the field is absent) until it does. A whole batch once
    // slipped through un-reviewed, so this is now an enforced gate: an observation is un-reviewed
    // unless its `audit` is `verified` or `flagged` (a deliberate "known defect, do not use" state).
    const obsPath = join(PROJECT, "corpus", "observations.json");
    if (existsSync(obsPath)) {
      const allobs = load(obsPath);
      const unreviewed = Object.entries(allobs).filter(([, ov]) => !["verified", "flagged"].includes(ov.audit)).map(([oid]) => oid);
      check("S8", unreviewed, "observation not yet audited (run audit_prepare.mjs → audit → mark_audited.mjs)");
      checks = "S1 S2 S5 S6 S7 S8";
    }
  }

  if (fail.length) {
    print(`FAIL — ${fail.length} violation(s)`);
    for (const [inv, item, note] of fail.slice(0, 40)) print(`  ${inv}  ${item}  (${note})`);
    return 1;
  }
  print(`PASS — ${MAN.length} artifacts`);
  print(`  checked: ${checks}`);
  print("  S5 PASS ⇒ every evidence document on disk is in the manifest — nothing is missing.");
  if (checks.includes("S6")) print("  S6/S7 PASS ⇒ every corpus doc's core exists and its bytes are archived — grounding is intact.");
  return 0;
}

if (isMain(import.meta.url)) runMain(main);
