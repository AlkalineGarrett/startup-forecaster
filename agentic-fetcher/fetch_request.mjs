#!/usr/bin/env node
// The fetch queue — a handoff channel for sources an agent needs but could not retrieve itself.
//
// Agents fetch their own sources (curl + install_source). When a fetch fails, the agent appends a
// request here and STOPS grounding that node — it does not guess. Each request carries a `lane`:
//
//   • agent_fetchable  — a normal public page whose fetch failed once (DNS, a 403, a timeout); the MAIN
//                        interactive session retries it. Between fan-out
//                        phases the main session runs `drain`, fetches + installs each (which
//                        auto-resolves the entry), and a follow-up pass grounds the now-real observation.
//   • human_only       — no agent can reach it (gated, paywalled, JS-rendered, login/VPN-walled, a PDF
//                        behind a portal). It falls through to the human worklist (`export`).
//
// An agent queues optimistically as `agent_fetchable`; if the main session's own fetch then fails, it
// `defer`s the request to `human_only`. Many parallel agents pool into one file-locked queue.
//
//     # an agent queues a source whose fetch failed; dedupes/merges by URL:
//     npx forecaster fetch-request add --url https://example.com/pricing \
//         --why "holds the competitor's monthly plan price" --for habit-app::competitor_price --priority med
//     #   ...or, if the page is clearly gated and no agent can reach it:
//     npx forecaster fetch-request add --url https://portal.example.com/report --lane human_only --why "..." --for ...
//
//     # the MAIN session, between fan-out phases — fetch everything the agents couldn't:
//     npx forecaster fetch-request drain                # the agent_fetchable worklist to fetch + install
//     npx forecaster install-source <saved-file> --url <url> --title "..."   # auto-resolves the entry
//     #   if the main session's own fetch fails too, hand it to the human:
//     npx forecaster fetch-request defer --url <url> --note "main WebFetch failed: <err>"
//
//     # the human, at end of run — only the sources no agent could reach:
//     npx forecaster fetch-request list                 # pending (add --all for resolved too)
//     npx forecaster fetch-request export --md           # a markdown worklist to work through
//     npx forecaster fetch-request export --csv > todo.csv
//
//     # mark done by hand if you fetched without install_source (install_source resolves automatically):
//     npx forecaster fetch-request resolve --url <url>
//
// Always run `check` first — a source is often already archived under a redirected/canonical URL.
// The queue is fetch-queue.jsonl in the source archive (one JSON object per line), file-locked
// (lib/lock.mjs). Paths resolve through paths.mjs.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ROOTS } from "./paths.mjs";   // PROJECT holds corpus/; GROUNDING holds the source cache + queue
import { parse, usageError } from "./lib/args.mjs";
import { parseCsv, readCsvFile, writerow } from "./lib/csv.mjs";
import { dumps, load, loads } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { isMain, lines, print, readText, runMain, urlHost, writeOut } from "./lib/util.mjs";

export const queuePath = () => `${ROOTS.GROUNDING}/fetch-queue.jsonl`;
export const PRIORITIES = ["top", "high", "med", "low"];
export const LANES = ["agent_fetchable", "human_only"];
const get = (r, k, d = null) => (Object.hasOwn(r, k) ? r[k] : d);
const prioIndex = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : PRIORITIES.indexOf("med"));
const list = (xs) => JSON.stringify(xs);

export const domain = (u) => urlHost(u || "").replace(/^www\./, "").toLowerCase();

/** A request's lane. Rows without one default to human_only — never silently assume an
 * unlabeled row is agent-fetchable (that would drop it from the human worklist without a fetch). */
export function lane(r) {
  const l = get(r, "lane");
  return LANES.includes(l) ? l : "human_only";
}

/** The archive's index, from one pass over MANIFEST.csv, url-aliases.csv and documents.json:
 *  manDomains -> [stored] and docDomains -> [title] and aliasesText for domain-level dedupe, plus `urls`, the
 *  set of page keys (pageKey) already archived. An EXACT URL match is a definite 'already archived' (stronger
 *  than the domain-level hint), and it catches a canonical/redirected URL recorded in url-aliases that a
 *  domain check on a different host would miss. */
function archiveIndex() {
  const G = ROOTS.GROUNDING;
  const manDomains = new Map(), docDomains = new Map(), urls = new Set();
  let aliases = "";
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const mp = `${G}/MANIFEST.csv`;
  if (existsSync(mp)) {
    for (const m of readCsvFile(mp)) {
      const d = domain(m.url);
      if (d) push(manDomains, d, m.stored);
      if (m.url) urls.add(pageKey(m.url));
    }
  }
  const ap = `${G}/url-aliases.csv`;
  if (existsSync(ap)) {
    const text = readText(ap);
    aliases = text.toLowerCase();
    for (const row of parseCsv(text)) {
      for (const cell of row) if (cell.trim().startsWith("http")) urls.add(pageKey(cell.trim()));
    }
  }
  const dp = `${G}/documents.json`;
  if (existsSync(dp)) {
    for (const dv of Object.values(load(dp))) {
      const d = domain(dv.url);
      if (d) push(docDomains, d, String(dv.title || "").slice(0, 44));
      if (dv.url) urls.add(pageKey(dv.url));
    }
  }
  return { manDomains, docDomains, aliases, urls };
}

/** Domain-level archive matches for a URL: [storedFiles, corpusTitles, inAliases]. */
function archiveHits(url, idx = archiveIndex()) {
  const { manDomains, docDomains, aliases } = idx;
  const dom = domain(url);
  return [manDomains.get(dom) || [], docDomains.get(dom) || [], Boolean(dom && aliases.includes(dom))];
}

/** Set of page keys (pageKey) already in the archive — MANIFEST + corpus + url-aliases rows. */
export const archivedUrls = () => archiveIndex().urls;

/** For every PENDING request, flag whether its source may ALREADY be in the archive — by domain
 * against MANIFEST.csv, url-aliases.csv, and corpus/documents.json. A hit means: verify the specific
 * content is in that archived core before fetching it (a source is often archived under a
 * redirected/canonical URL). Run it before fetching anything. */
function archiveCheck() {
  const idx = archiveIndex();
  const pend = readQueue().filter((r) => get(r, "status") !== "resolved");
  let hits = 0;
  print(`== archive check: ${pend.length} pending request(s) ==\n`);
  for (const r of rank(pend)) {
    const [mh, dh, al] = archiveHits(r.url, idx);
    if (mh.length || dh.length || al) {
      hits++;
      print(`  ‼ POSSIBLE MATCH  [${get(r, "priority")}/${lane(r)}] ${r.url}`);
      if (mh.length) print(`      archived files: ${list(mh.slice(0, 4))}`);
      if (dh.length) print(`      corpus docs:    ${list(dh.slice(0, 4))}`);
      if (al) print("      appears in url-aliases.csv");
      print("      → verify the needed figure is in that core; if so, resolve() it — do not re-fetch.");
    } else {
      print(`  · not in archive   [${get(r, "priority")}/${lane(r)}] ${r.url}`);
    }
  }
  print(`\n${hits} of ${pend.length} pending request(s) may already be archived — verify content before fetching.`);
}

export function readQueue() {
  const Q = queuePath();
  if (!existsSync(Q)) return [];
  const out = [];
  for (const ln of lines(readText(Q))) {
    if (ln.trim()) {
      try { out.push(loads(ln)); } catch { /* skip a corrupt line */ }
    }
  }
  return out;
}

const normUrl = (u) => (u || "").trim().replace(/\/+$/, "");

// Query parameters that only track a visit; they never change which page it is.
const TRACKING = /^(utm_.*|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|ref_src|source|igshid|si)$/;

/** The key two URLs share when they are the same page: no scheme, www., fragment, trailing slash or tracking
 *  parameters, lowercased, the remaining query sorted. The rest of the query is kept, since it often names
 *  the page (news.ycombinator.com/item?id=…). */
export function pageKey(u) {
  const low = (u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("#")[0];
  const q = low.indexOf("?");
  const path = (q < 0 ? low : low.slice(0, q)).replace(/\/+$/, "");
  const params = (q < 0 ? "" : low.slice(q + 1)).split("&").filter((p) => p && !TRACKING.test(p.split("=")[0])).sort();
  return path + (params.length ? "?" + params.join("&") : "");
}
const jsonLines = (rows) => rows.map((r) => dumps(r) + "\n").join("");   // one {"k": v, …} per line
const parseRows = (text) => lines(text.replace(/\r\n?/g, "\n")).filter((l) => l.trim()).map((l) => loads(l));

/** Append or merge a request. Returns the stored record. File-locked read-modify-write. */
export async function add(url, why, forNodes, priority = "med", requestedBy = "agent", suggestedFilename = null, laneName = "agent_fetchable") {
  url = normUrl(url);
  if (!PRIORITIES.includes(priority)) priority = "med";
  if (!LANES.includes(laneName)) laneName = "agent_fetchable";
  const Q = queuePath();
  mkdirSync(dirname(Q), { recursive: true });
  return withLock(Q, () => {
    const rows = parseRows(readFileSync(Q, "utf8"));
    const cur = rows.find((r) => normUrl(get(r, "url")) === url);
    let rec;
    if (cur) {                                                   // merge into the existing request
      for (const n of forNodes || []) {
        if (!Object.hasOwn(cur, "for")) cur.for = [];
        if (!cur.for.includes(n)) cur.for.push(n);
      }
      if (why && !(get(cur, "why") || "").includes(why)) {
        cur.why = ((get(cur, "why") || "") + " | " + why).replace(/^[ |]+|[ |]+$/g, "");
      }
      if (PRIORITIES.indexOf(priority) < prioIndex(get(cur, "priority", "med"))) {
        cur.priority = priority;                                 // keep the most urgent
      }
      if (!Object.hasOwn(cur, "lane")) cur.lane = laneName;      // optimistic: agent_fetchable wins at
      if (laneName === "agent_fetchable") cur.lane = "agent_fetchable";   // add time (drain defers on fail)
      rec = cur;
    } else {
      rec = { url, why: why || "", for: [...(forNodes || [])], priority, lane: laneName,
        requested_by: requestedBy, suggested_filename: suggestedFilename, status: "pending" };
      rows.push(rec);
    }
    rewrite(Q, jsonLines(rows));
    return rec;
  });
}

/** File-locked: apply fn(row) to every pending row matching url. Returns count mutated. */
async function mutate(url, fn) {
  url = normUrl(url);
  const Q = queuePath();
  if (!existsSync(Q)) return 0;
  return withLock(Q, () => {
    const rows = parseRows(readFileSync(Q, "utf8"));
    let n = 0;
    for (const r of rows) {
      if (normUrl(get(r, "url")) === url && get(r, "status") !== "resolved") { fn(r); n++; }
    }
    rewrite(Q, jsonLines(rows));
    return n;
  });
}

/** Mark every pending request matching this URL resolved. Returns how many. File-locked. */
export function resolve(url, note = null) {
  return mutate(url, (r) => {
    r.status = "resolved";
    if (note) r.resolution = note;
  });
}

/** Flip every pending request matching this URL to the human_only lane — the main session tried
 * and could not fetch it, so it must fall through to the human worklist. Returns how many. */
export function defer(url, note = null) {
  return mutate(url, (r) => {
    r.lane = "human_only";
    if (note) r.defer_note = note;
  });
}

function rank(rows) {
  const n = (r) => (get(r, "for", []) || []).length;
  return [...rows].sort((a, b) => prioIndex(get(a, "priority", "med")) - prioIndex(get(b, "priority", "med")) || n(b) - n(a));
}

/** The agent_fetchable worklist for the MAIN session to fetch + install NOW. Flags any whose
 * domain is already archived (verify before fetching — principle 1). */
function drain() {
  const idx = archiveIndex();
  const pend = readQueue().filter((r) => get(r, "status") !== "resolved" && lane(r) === "agent_fetchable");
  print(`== drain: ${pend.length} agent-fetchable request(s) for the main session to fetch ==\n`);
  for (const r of rank(pend)) {
    const [mh, dh, al] = archiveHits(r.url, idx);
    const flag = mh.length || dh.length || al ? "   ‼ may already be archived — verify first" : "";
    print(`  • [${get(r, "priority", "med")}] ${r.url}${flag}`);
    if (get(r, "why")) print(`      why: ${r.why}`);
    if (get(r, "for")?.length) print(`      unblocks: ${r.for.join(", ")}`);
    if (mh.length) print(`      archived files: ${list(mh.slice(0, 4))}`);
    if (dh.length) print(`      corpus docs:    ${list(dh.slice(0, 4))}`);
    print(`      fetch → npx forecaster install-source <saved> --url ${r.url} --title "..."   (auto-resolves)`);
  }
  if (!pend.length) {
    print("  (nothing to fetch — no agent_fetchable requests pending)");
    return;
  }
  print("\n  If the main session's own WebFetch fails on one, hand it to the human:");
  print('    npx forecaster fetch-request defer --url <url> --note "main WebFetch failed: <err>"');
}

const SPECS = {
  add: { options: {
    url: { required: true }, why: { default: "" },
    for: { multiple: true, dest: "for_nodes", help: "project::node this unblocks" },
    priority: { choices: PRIORITIES, default: "med" }, by: { default: "agent" },
    lane: { choices: LANES, default: "agent_fetchable", help: "agent_fetchable (a public page to retry) or human_only (no agent can reach it)" },
    filename: { help: "suggested save filename" },
    force: { flag: true, help: "queue even if this exact page is already archived (a fresh capture)" },
  } },
  list: { options: { all: { flag: true, help: "include resolved" } } },
  resolve: { options: { url: { required: true }, note: {} } },
  defer: { description: "Flip a request to human_only after the main session's fetch failed.", options: { url: { required: true }, note: {} } },
  export: { options: { md: { flag: true }, csv: { flag: true } } },
  drain: { description: "The agent_fetchable worklist for the main session to fetch + install." },
  check: { description: "Flag pending requests whose source may already be in the archive." },
};
const TOP = { prog: "fetch_request.mjs", positionals: [`{${Object.keys(SPECS).join(",")}}`],
  description: "Fetch queue: a handoff channel for sources an agent cannot retrieve itself." };

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd || !Object.hasOwn(SPECS, cmd)) {
    if (cmd === "-h" || cmd === "--help") parse(["-h"], TOP);
    usageError(TOP, cmd ? `invalid command '${cmd}' (choose from ${Object.keys(SPECS).join(", ")})` : "a command is required");
  }
  const args = parse(argv.slice(1), { prog: `fetch_request.mjs ${cmd}`, ...SPECS[cmd] });

  if (cmd === "check") { archiveCheck(); return; }
  if (cmd === "drain") { drain(); return; }

  if (cmd === "add") {
    const idx = archiveIndex();
    if (idx.urls.has(pageKey(args.url)) && !args.force) {   // this page is already archived — definite
      print("⚠ NOT queued — this page is already archived (MANIFEST/corpus/alias). " +
        "Ground from its core; --force only to re-capture.");
      return;
    }
    // Other pages of the same site in the archive are only a hint: they may hold the figure, so say so,
    // but a different page (another filing, another thread) is a different source and is queued.
    const [mh, dh] = archiveHits(args.url, idx);
    if (mh.length || dh.length) {
      print(`  note: other ${domain(args.url)} pages are archived; check their cores for the figure too.`);
      if (dh.length) print(`    corpus docs:    ${list(dh.slice(0, 4))}`);
    }
    const rec = await add(args.url, args.why, args.for_nodes, args.priority, args.by, args.filename, args.lane);
    print(`queued [${rec.priority}/${get(rec, "lane")}] ${rec.url}  (unblocks ${rec.for.length} node(s))`);
  } else if (cmd === "list") {
    const rows = readQueue();
    const show = args.all ? rows : rows.filter((r) => get(r, "status") !== "resolved");
    const pend = rows.filter((r) => get(r, "status") !== "resolved");
    const af = pend.filter((r) => lane(r) === "agent_fetchable").length, ho = pend.length - af;
    print(`== fetch-queue: ${pend.length} pending (${af} agent-fetchable, ${ho} human-only) / ${rows.length} total ==`);
    for (const r of rank(show)) {
      const mark = get(r, "status") === "resolved" ? "✓" : "•";
      print(`  ${mark} [${get(r, "priority", "med")}/${lane(r)}] ${r.url}`);
      if (get(r, "why")) print(`      why: ${r.why}`);
      if (get(r, "for")?.length) print(`      unblocks: ${r.for.join(", ")}`);
    }
  } else if (cmd === "resolve") {
    print(`resolved ${await resolve(args.url, args.note)} request(s) for ${args.url}`);
  } else if (cmd === "defer") {
    print(`deferred ${await defer(args.url, args.note)} request(s) to human_only for ${args.url}`);
  } else if (cmd === "export") {
    const pend = rank(readQueue().filter((r) => get(r, "status") !== "resolved" && lane(r) === "human_only"));
    if (args.csv) {
      writeOut(writerow(["priority", "url", "why", "unblocks", "suggested_filename"]));
      for (const r of pend) {
        writeOut(writerow([get(r, "priority"), r.url, get(r, "why"), (get(r, "for", []) || []).join(";"), get(r, "suggested_filename") || ""]));
      }
    } else {
      print(`# Human fetch worklist — ${pend.length} source(s) no agent could reach\n`);
      print("`npx forecaster firecrawl` fetches this whole list through Firecrawl in one go (needs FIRECRAWL_API_KEY);\nsave whatever it can't get by hand.\n");
      for (const r of pend) {
        print(`## [${get(r, "priority", "med")}] ${r.url}`);
        if (get(r, "why")) print(`- why: ${r.why}`);
        if (get(r, "for")?.length) print(`- unblocks: ${r.for.join(", ")}`);
        print(`- after saving: \`npx forecaster install-source <saved-file> --url ${r.url} --title "..."\`\n`);
      }
    }
  }
}

if (isMain(import.meta.url)) runMain(main);
