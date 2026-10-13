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
//   CORROBORATE the page needs a rendered browser (JS/app-store/levels-style) — no agent can fetch it;
//               a human captures it, or it is re-fetched and the quote confirmed, and recorded.
//   REGROUND    the core is an analyst COMPILATION ("substitute analysis", a `Sources:` line naming
//               several domains) — it can never be a single primary. Re-ground each figure on its own
//               single-source page, or reclassify the doc origin to `derivative` (reasoning). These are
//               exactly the docs an audit marks `not_a_source`.
//
// Classification is a heuristic to route the work; the human/agent makes the call. Two-root model:
// transcription flag is on the observation (PROJECT); doc identity/core is under GROUNDING.
//
//     node check_transcribed.mjs            # report + worklist
//     node check_transcribed.mjs --json      # machine-readable
import { existsSync } from "node:fs";
import { ROOTS } from "./paths.mjs";
import { parse } from "./lib/args.mjs";
import { dumps, load } from "./lib/json.mjs";
import { isMain, lines, print, readText, runMain, urlHost } from "./lib/util.mjs";

// hosts that render client-side / gate content — no agent (curl/WebFetch) can capture them faithfully
const BROWSER_ONLY = ["play.google.com", "apps.apple.com", "levels.fyi"];
const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]+\.(?:com|ai|us|io|app|org|net|pt|fyi|co))\b/gi;

/** single-source transcription vs analyst compilation. */
function classify(coreText, ownUrl) {
  const head = lines(coreText).slice(0, 6).join("\n").toLowerCase();
  if (head.includes("substitute") || head.includes("substitute-analysis")) return "compilation";
  const own = ownUrl ? urlHost(ownUrl).replaceAll("www.", "") : "";
  for (const line of lines(coreText)) {
    const low = line.toLowerCase();
    if (low.startsWith("sources:") || low.startsWith("source:")) {
      const doms = new Set([...line.matchAll(DOMAIN_RE)].map((m) => m[1].toLowerCase()));
      doms.delete(own);
      if (doms.size >= 2) return "compilation";
    }
  }
  return "single";
}

export function build() {
  const { PROJECT, GROUNDING } = ROOTS;
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
    const host = urlHost(url).replaceAll("www.", "");
    const kind = coreText ? classify(coreText, url) : "single";
    let action;
    if (kind === "compilation") action = "REGROUND";
    else if (BROWSER_ONLY.some((b) => host.endsWith(b))) action = "CORROBORATE";   // human capture — JS/app-store/levels
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
  const rows = build();
  if (a.json) {
    print(dumps(rows, { indent: 2 }));
    return;
  }
  const byAction = {};
  for (const r of rows) byAction[r.action] = (byAction[r.action] || 0) + 1;
  print(`${rows.length} transcribed docs backing ${rows.reduce((n, r) => n + r.n_obs, 0)} observations. ` +
    "Corroboration worklist:\n");
  for (const [act, blurb] of [["UPGRADE", "agent re-fetch + install_source (→ capture:fetched)"],
    ["CORROBORATE", "human capture — JS/app-store/levels page no agent can fetch"],
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
