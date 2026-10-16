#!/usr/bin/env node
// Tighten transcribed sources — the check for observations grounded on a *typed* core, not raw bytes.
//
// `capture: "transcribed"` means an agent typed the source content into a file instead of archiving the
// page's bytes. The quote then only self-verifies against that transcription — it is NOT proof the live
// source says it. This tool surfaces every transcribed doc, classifies how it can be made *tight*, and
// emits a corroboration worklist. Tight means one of:
//
//   UPGRADE     re-fetch the URL with curl/WebFetch and `install_source.mjs` the real bytes → the doc
//               becomes capture:fetched and the quote verifies against the true page. (agent-fetchable)
//   CORROBORATE the page needs a rendered browser — no agent can fetch it; a human captures it, or it is
//               re-fetched and the quote confirmed, and recorded. A host counts as browser-only when it is
//               an app store (play.google.com, apps.apple.com), when the fetch queue holds a human_only
//               request for it, or when the workspace config lists it in `browserOnlyHosts`.
//   REGROUND    the core is an analyst COMPILATION — it can never be a single primary. Its first lines
//               call it a compilation ("compilation", "substitute analysis"), or a `Sources:` line lists
//               two or more sources, or a `Source(s):` line names two or more domains besides the doc's
//               own. Re-ground each figure on its own single-source page, or reclassify the doc origin to
//               `derivative` (reasoning). These are exactly the docs an audit marks `not_a_source`.
//
// Classification is a heuristic to route the work; the human/agent makes the call. Two-root model:
// transcription flag is on the observation (PROJECT); doc identity/core is under GROUNDING.
//
//     npx startup-forecaster check-transcribed            # report + worklist
//     npx startup-forecaster check-transcribed --json      # machine-readable
import { existsSync } from "node:fs";
import { ROOTS } from "./paths.mjs";
import { configList } from "../distribution-compiler/compiler/workspace.mjs";
import * as fr from "./fetch_request.mjs";
import { parse } from "./lib/args.mjs";
import { dumps, load } from "./lib/json.mjs";
import { isMain, lines, print, readText, runMain } from "./lib/util.mjs";

// hosts that render client-side / gate content — no agent (curl/WebFetch) can capture them faithfully
export const BROWSER_ONLY = ["play.google.com", "apps.apple.com"];

/** Host names in a line: any TLD, but not file names (report.pdf, data.csv). */
const DOMAIN_RE = /(?<![\p{L}\p{N}_.@-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63})(?![\p{L}\p{N}_-])/giu;
const FILE_EXT = new Set(["pdf", "html", "htm", "txt", "csv", "tsv", "json", "xlsx", "xls", "doc", "docx", "md", "png", "jpg", "jpeg", "gif", "zip"]);
export const domainsIn = (line) => new Set([...line.matchAll(DOMAIN_RE)].map((m) => m[1].toLowerCase().replace(/^www\./, ""))
  .filter((d) => !FILE_EXT.has(d.slice(d.lastIndexOf(".") + 1))));

/** A header line that calls the core a compilation of sources. */
const COMPILATION_MARK = /\b(compilation|compiled from|substitute[- ]analysis)\b/i;
/** Items of a "Sources:" list that only date the capture ("captured 2026-09"), not a source. */
const DATING = /^(captured|accessed|retrieved|fetched|as of)\b|^\d{4}(-\d{2}){0,2}$/i;

/** single-source transcription vs analyst compilation. */
export function classify(coreText, ownUrl) {
  const head = lines(coreText).slice(0, 6);
  if (head.some((l) => COMPILATION_MARK.test(l))) return "compilation";
  const own = fr.domain(ownUrl);
  for (const line of lines(coreText)) {
    const m = /^\s*(sources?)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const doms = domainsIn(m[2]);
    doms.delete(own);
    if (doms.size >= 2) return "compilation";
    if (m[1].toLowerCase() === "sources") {                    // a plural list: count its items
      const items = m[2].split(m[2].includes(";") ? ";" : ",").map((x) => x.trim().replace(/\.$/, "")).filter((x) => x && !DATING.test(x));
      if (items.length >= 2) return "compilation";
    }
  }
  return "single";
}

/** Hosts whose pages only a live browser renders: the built-ins, the config's browserOnlyHosts, and every
 *  host the fetch queue routed to a person (a human_only request, resolved or not). */
export async function browserOnlyHosts() {
  const hosts = new Set([...BROWSER_ONLY, ...(await configList("browserOnlyHosts")).map((h) => h.toLowerCase().replace(/^www\./, ""))]);
  for (const r of fr.readQueue()) if (fr.lane(r) === "human_only" && fr.domain(r.url)) hosts.add(fr.domain(r.url));
  return hosts;
}

export async function build() {
  const { PROJECT, GROUNDING } = ROOTS;
  const browserOnly = [...(await browserOnlyHosts())];
  const docs = load(`${GROUNDING}/documents.json`);
  const obs = load(`${PROJECT}/corpus/observations.json`);
  // transcribed docs = those any transcribed observation points at, or capture==transcribed
  const byDoc = new Map();
  for (const [oid, o] of Object.entries(obs)) {
    const d = (typeof o.doc === "string" && docs[o.doc]) || {};
    if (o.source_capture === "transcribed" || d.capture === "transcribed") {
      if (!byDoc.has(o.doc)) byDoc.set(o.doc, []);
      byDoc.get(o.doc).push(oid);
    }
  }

  const rows = [];
  for (const [docid, oids] of [...byDoc].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const d = docs[docid] || {};
    const url = d.url || "";
    const core = d.core;
    let coreText = "";
    const coreOk = Boolean(core) && existsSync(`${GROUNDING}/${core}`);
    if (coreOk) coreText = readText(`${GROUNDING}/${core}`, "replace");
    const host = fr.domain(url);
    const kind = coreText ? classify(coreText, url) : "single";
    let action;
    if (kind === "compilation") action = "REGROUND";
    else if (browserOnly.some((b) => host === b || host.endsWith("." + b))) action = "CORROBORATE";   // human capture
    else action = "UPGRADE";                                                        // agent-fetchable: re-fetch + install real bytes
    rows.push({ doc: docid, url, host, kind, action, audit: d.audit ?? null, observations: oids, n_obs: oids.length });
  }
  return rows;
}

export async function main() {
  const a = parse(process.argv.slice(2), {
    prog: "check_transcribed.mjs",
    description: "Transcribed sources and how to make each one tight (UPGRADE / CORROBORATE / REGROUND).",
    options: { json: { flag: true, help: "machine-readable rows" } },
  });
  const rows = await build();
  if (a.json) {
    print(dumps(rows, { indent: 2 }));
    return;
  }
  const byAction = {};
  for (const r of rows) byAction[r.action] = (byAction[r.action] || 0) + 1;
  print(`${rows.length} transcribed docs backing ${rows.reduce((n, r) => n + r.n_obs, 0)} observations. ` +
    "Corroboration worklist:\n");
  for (const [act, blurb] of [["UPGRADE", "agent re-fetch + install_source (→ capture:fetched)"],
    ["CORROBORATE", "human capture — a page only a live browser renders, so no agent can fetch it"],
    ["REGROUND", "analyst compilation — reground per-source or reclassify derivative"]]) {
    const group = rows.filter((r) => r.action === act);
    if (!group.length) continue;
    print(`── ${act}  (${group.length} docs) — ${blurb}`);
    for (const r of group) {
      print(`     ${r.doc}  ${r.url}`);
      print(`        obs: ${r.observations.join(", ")}`);
    }
  }
  print(`\nsummary: ${JSON.stringify(byAction)}`);
  print("A transcribed doc is not tight until UPGRADE/CORROBORATE confirms the live page, or REGROUND " +
    "replaces the compilation with real single-source grounding.");
}

if (isMain(import.meta.url)) runMain(main);
