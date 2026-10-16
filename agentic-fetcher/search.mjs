#!/usr/bin/env node
// General source search — for a fresh agent searching across ALL sources.
//
// Searches the source text layer (cores/ + image-OCR sidecars) and returns, for every matching
// source, ONE merged record with all of that source's data unified: title, url, publisher, the raw
// archived file, the lean core, and every OCR sidecar — each with matching snippets. Backed by
// documents.json. No project/node mapping — sources are about sources; for node→evidence use
// the projects/ layer.
//
//     npx startup-forecaster search "net revenue retention"      # literal phrase; falls back to any-of-words if 0
//     npx startup-forecaster search "\\b3[0-9]% churn"            # a real regex (has metachars) — used as-is
//     npx startup-forecaster search "seat price" --sources 40 --context 2
//
// A query with regex metacharacters is a JavaScript regular expression, matched case-insensitively
// with the u flag (so \w, \b and \d are ASCII; use \p{L} for any letter).
import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { ROOTS } from "./paths.mjs";   // cores + MANIFEST + documents.json (identity registry) under GROUNDING
import { parse, usageError } from "./lib/args.mjs";
import { readCsvFile } from "./lib/csv.mjs";
import { load } from "./lib/json.mjs";
import { isMain, lines, print, readText, runMain } from "./lib/util.mjs";

const SPEC = {
  prog: "search.mjs",
  description: "Search every core and OCR sidecar. A query with regex metacharacters is a JavaScript " +
    "regular expression (flags i and u); otherwise a literal phrase, falling back to any of its words.",
  positionals: ["query"],
  options: {
    sources: { number: true, default: 30, help: "how many sources to show" },
    context: { number: true, default: 1, help: "lines of context around each match" },
  },
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Every *.ocr.txt under root (skipping dot-directories). */
const ocrSidecars = (root) => readdirSync(root, { recursive: true })
  .filter((p) => p.endsWith(".ocr.txt") && !p.split("/").some((seg) => seg.startsWith(".")))
  .map((p) => join(root, p));

export async function main(argv = process.argv.slice(2)) {
  const GROUNDING = ROOTS.GROUNDING;
  const G = (p) => join(GROUNDING, p);
  const a = parse(argv, SPEC);
  const raw = a.query, MAXS = a.sources, CTX = a.context;

  const docs = existsSync(G("documents.json")) ? load(G("documents.json")) : {};
  const bySha = new Map(Object.values(docs).map((d) => [d.sha256.slice(0, 12), d]));
  const man = new Map(readCsvFile(G("MANIFEST.csv")).map((m) => [m.stored, m]));
  const sha2stored = new Map([...man].map(([s, m]) => [m.sha256.slice(0, 12), s]));

  const sourceKey = (path) => {
    const m = /^doc_([0-9a-f]{12})\.txt$/.exec(basename(path));
    if (m) return m[1];
    const stored = relative(GROUNDING, path).replace(/(\.images)?\.ocr\.txt$/, "").replace(/\.inline-\d+$/, "");
    return man.has(stored) ? man.get(stored).sha256.slice(0, 12) : null;
  };

  const cores = existsSync(G("cores")) ? readdirSync(G("cores")).filter((n) => n.endsWith(".txt") && !n.startsWith(".")).sort() : [];
  const FILES = cores.map((n) => G(`cores/${n}`)).concat(ocrSidecars(GROUNDING).sort());

  const run = (pat) => {
    const merged = new Map();
    for (const f of FILES) {
      let ls;
      try { ls = lines(readText(f, "replace")); } catch { continue; }
      const sn = [];
      ls.forEach((l, i) => {
        if (!pat.test(l)) return;
        sn.push(ls.slice(Math.max(0, i - CTX), i + CTX + 1).map((x) => x.trim().slice(0, 160)));
      });
      if (!sn.length) continue;
      const key = sourceKey(f) || f;
      if (!merged.has(key)) merged.set(key, []);
      merged.get(key).push([basename(f).startsWith("doc_") ? "core" : "ocr-sidecar", relative(GROUNDING, f), sn]);
    }
    return merged;
  };
  const re = (src) => {
    try { return new RegExp(src, "iu"); } catch (e) { return usageError(SPEC, `invalid regular expression: ${e.message}`); }
  };

  let note = "", merged;
  const words = raw.split(/\s+/).filter(Boolean);
  if (/[\\|()[\]{}^$+?*]/.test(raw)) {
    merged = run(re(raw));                                   // a real regex — use verbatim
  } else {
    merged = run(re(escapeRe(raw)));                         // literal phrase first
    if (!merged.size && words.length > 1) {                  // nothing? fall back to any-of-words
      const toks = words.filter((t) => t.length > 2).map(escapeRe);
      merged = run(re(`(?<![\\p{L}\\p{N}_])(?:${toks.join("|")})(?![\\p{L}\\p{N}_])`));   // whole words, any script
      note = `(no exact-phrase match — showing any-of-words: ${words.join(" | ")}, ranked by density)`;
    }
  }

  if (note) print(note);
  print(`== "${raw}" — ${merged.size} source(s) match ==\n`);
  const weight = (files) => files.reduce((n, [, , sn]) => n + sn.length, 0);
  const ranked = [...merged].sort((x, y) => weight(y[1]) - weight(x[1]));
  for (const [i, [key, files]] of ranked.entries()) {
    if (i >= MAXS) { print(`… +${merged.size - MAXS} more sources (raise --sources, or use a precise regex)`); break; }
    const d = bySha.get(key);
    const stored = sha2stored.get(key);
    const title = d?.title || (stored && man.get(stored).title) || key;
    print(`● ${title.slice(0, 80)}`);
    if (d) print(`  doc_${key}  |  ${d.publisher ?? ""}  |  ${d.url || ""}`);
    if (stored) print(`  raw: ${stored}`);
    for (const [kind, rel, sn] of files) {
      print(`  ${kind}: ${rel}`);
      for (const ctx of sn.slice(0, 3)) {
        for (const c of ctx) print(`      ${c}`);
        print();
      }
      if (sn.length > 3) print(`      … +${sn.length - 3} more matching lines\n`);
    }
  }
}

if (isMain(import.meta.url)) runMain(main);
