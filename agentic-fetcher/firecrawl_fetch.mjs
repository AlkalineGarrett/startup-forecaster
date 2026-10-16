#!/usr/bin/env node
// Fetch queued pages through Firecrawl and install them into the source archive.
//
// Firecrawl renders a page in its own browser, so it gets many pages curl can't: JavaScript-rendered pages,
// most bot walls, some PDFs. Each page that comes back is installed like `install-source` does (raw bytes →
// archive, a text core, MANIFEST row, corpus doc), and its queue entry is resolved. Pages already in the
// archive are skipped, so a rerun picks up where the last one stopped.
//
//     npx startup-forecaster firecrawl                       # every pending request in the queue, in one go
//     npx startup-forecaster firecrawl --list                # show what would be fetched, spend nothing
//     npx startup-forecaster firecrawl fetch-list.md         # only the pages in a list: a `fetch-request export` file
//                                                    # (--md or --csv) or one URL per line; `-` reads stdin
//
// Needs FIRECRAWL_API_KEY. It spends the key holder's Firecrawl credits, so it runs when the person runs it.
// Retries only on Firecrawl's rate limit (waiting the time it asks for); any other failure moves on to the
// next page, and ten failures in a row stop the run. Failed pages stay in the queue.
import { readFileSync } from "node:fs";
import { parse } from "./lib/args.mjs";
import { parseCsvRecords } from "./lib/csv.mjs";
import { Exit, die, isMain, print, runMain } from "./lib/util.mjs";
import { archivedUrls, lane, pageKey, readQueue } from "./fetch_request.mjs";
import { install } from "./install_source.mjs";

const API = () => (process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev").replace(/\/+$/, "");
const WAIT_BUFFER_S = 2, MAX_TRIES = 3, MAX_FAILS_IN_A_ROW = 10;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const short = (u) => (u.length > 80 ? u.slice(0, 77) + "…" : u);

/** The URLs in a fetch list: a `fetch-request export` (markdown or --csv), or one URL per line. Deduplicated by
 *  page, in file order. */
export function urlsFromList(text) {
  const lines = text.split(/\r?\n/);
  let urls;
  if (/^# Human fetch worklist/m.test(text)) {
    urls = lines.map((l) => l.match(/^## \[[^\]]*\] (\S+)/)?.[1]).filter(Boolean);   // the export's entry headings
  } else if (/^\s*priority,url,/i.test(lines[0] || "")) {
    urls = parseCsvRecords(text).map((r) => r.url).filter(Boolean);
  } else {
    urls = lines.map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).map((l) => l.split(/\s/)[0]);
  }
  const seen = new Set();
  return urls.filter((u) => !seen.has(pageKey(u)) && seen.add(pageKey(u)));
}

/** One Firecrawl scrape → { ok: true, data, ext, title } | { ok: false, wait?: seconds, error }. The raw HTML is
 *  archived when there is one (the core is then extracted like any saved page); a PDF or other document comes back
 *  as Firecrawl's text, archived as markdown. */
export async function scrapeOnce(url, key, fetchImpl = fetch) {
  let res, body;
  try {
    res = await fetchImpl(`${API()}/v2/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ["rawHtml", "markdown"] }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: `request failed: ${e.message}` };
  }
  const msg = body.error || body.message || `HTTP ${res.status}`;
  if (res.status === 429 || /rate limit/i.test(msg)) {
    const said = [res.headers.get("retry-after"), msg.match(/retry after (\d+)\s*s/i)?.[1]]
      .map((v) => (v == null || v === "" ? NaN : Number(v))).find(Number.isFinite);
    return { ok: false, wait: said ?? 60, error: msg };   // Firecrawl's stated wait, else a minute
  }
  if (res.status === 401 || res.status === 402) return { ok: false, fatal: true, error: `${msg} (HTTP ${res.status})` };
  if (!res.ok || body.success === false) return { ok: false, error: msg };
  const d = body.data || {}, meta = d.metadata || {};
  if (meta.statusCode >= 400) return { ok: false, error: `the site answered ${meta.statusCode}` };
  const title = [meta.title, meta.ogTitle].find((t) => typeof t === "string" && t.trim())?.trim() || null;
  if (d.rawHtml && d.rawHtml.trim()) return { ok: true, data: Buffer.from(d.rawHtml, "utf8"), ext: "html", title };
  if (d.markdown && d.markdown.trim()) return { ok: true, data: Buffer.from(d.markdown, "utf8"), ext: "md", title };
  return { ok: false, error: "Firecrawl returned no content" };
}

/** A scrape with retries on the rate limit only. */
export async function scrape(url, key, fetchImpl = fetch, wait = sleep) {
  for (let attempt = 1; ; attempt++) {
    const r = await scrapeOnce(url, key, fetchImpl);
    if (r.ok || r.wait === undefined || attempt >= MAX_TRIES) return r;
    print(`   ⏳ rate limited; waiting ${r.wait + WAIT_BUFFER_S}s (retry ${attempt}/${MAX_TRIES - 1})`);
    await wait(r.wait + WAIT_BUFFER_S);
  }
}

const SPEC = {
  prog: "firecrawl_fetch.mjs",
  description: "Fetch queued pages through Firecrawl and install them into the source archive.",
  positionals: ["file?"],
  options: {
    lane: { choices: ["human_only", "agent_fetchable", "all"], default: "all",
      help: "with no list file: which pending requests to fetch" },
    list: { flag: true, help: "show what would be fetched and stop (no Firecrawl calls)" },
  },
};

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, wait = sleep } = {}) {
  const a = parse(argv, SPEC);
  let urls;
  if (a.file) {
    urls = urlsFromList(readFileSync(a.file === "-" ? 0 : a.file, "utf8"));   // "-" reads stdin
  } else {
    urls = readQueue().filter((r) => r.status !== "resolved" && (a.lane === "all" || lane(r) === a.lane)).map((r) => r.url);
  }
  const archived = archivedUrls();
  const todo = urls.filter((u) => !archived.has(pageKey(u)));
  const skipped = urls.length - todo.length;
  print(`${todo.length} page(s) to fetch` + (skipped ? `, ${skipped} already archived (skipped)` : ""));
  if (a.list) { for (const u of todo) print(`  ${u}`); return; }
  if (!todo.length) return;
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) die("FIRECRAWL_API_KEY is not set");

  let installed = 0, failsInARow = 0;
  const failed = [];
  for (const [i, url] of todo.entries()) {
    print(`[${i + 1}/${todo.length}] ${short(url)}`);
    const r = await scrape(url, key, fetchImpl, wait);
    if (!r.ok) {
      print(`   ✗ ${r.error}`);
      failed.push([url, r.error]);
      if (r.fatal) { print("   stopping: the Firecrawl key or credits are the problem, not this page"); break; }
      if (++failsInARow >= MAX_FAILS_IN_A_ROW) { print(`   stopping: ${MAX_FAILS_IN_A_ROW} failures in a row`); break; }
      continue;
    }
    failsInARow = 0;
    let how;
    try {
      [, how] = await install(r.data, url, r.title || url, { tier: "fetched", origin: "firecrawl", srcName: `page.${r.ext}`, capture: "fetched" });
    } catch (e) {
      if (!(e instanceof Exit)) throw e;
      print(`   ✗ ${e.message}`);                                // e.g. an empty page: it stays queued
      failed.push([url, e.message]);
      continue;
    }
    if (how === "installed" || how === "exists") installed++;
  }
  print(`\ndone: ${installed} installed, ${failed.length} failed` + (skipped ? `, ${skipped} already archived` : ""));
  if (failed.length) {
    print("still in the queue (save these by hand, then `npx startup-forecaster install-source <file> --url <url>`):");
    for (const [u, e] of failed) print(`  ${u}  — ${e}`);
  }
}

if (isMain(import.meta.url)) runMain(() => main());
