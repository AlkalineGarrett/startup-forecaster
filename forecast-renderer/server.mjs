#!/usr/bin/env node
/*
 * Local Monte-Carlo server. Rather than shipping the engine and every distribution to the browser (as the
 * self-contained page does), it imports the (pure, DOM-free) engine directly, runs every project ONCE at
 * startup, and holds the result state in RAM (src/appcore.ts). The
 * browser then receives only rendered HTML fragments:
 *   - GET /            → a shell whose Overview + Pairwise panels are already rendered inline (instant
 *                        paint, zero client-side simulation); project panels are empty, loaded lazily.
 *   - GET /client.mjs  → the thin client (a module), after GET /dom-shared.mjs, the shared DOM layer (a
 *                        plain script whose declarations the client calls).
 *   - GET /api/panel   → one project's rendered panel (first time its tab is opened).
 *   - POST /api/action → a pin / clear / include / select / reset / metric change: the server re-runs
 *                        the affected unit and returns the re-rendered panel + overview-row patch. The
 *                        per-draw arrays never cross the wire — histSVG bins them server-side into a
 *                        compact SVG string.
 *
 * State is a SINGLE session (the server mutates node._override on the shared PROJECTS singletons, just
 * as the in-browser app did). This is a local single-user tool; two concurrent browser tabs would
 * share one state. Run: `node --experimental-strip-types server.mjs` (or `npx startup-forecaster serve`).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ac from "./src/appcore.ts";
import { PORTFOLIO_TITLE } from "../montecarlo-engine/src/portfolio-context.ts";
import { CACHE_BIN, CACHE_HASH, readFreshCache, writeCache } from "./cache-util.mjs";
import { loadPortfolio } from "../montecarlo-engine/portfolio-loader.mjs";

await loadPortfolio(); // attach the portfolio (portfolio.config.mjs bootstrap, else the example) before any appcore call

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8137;

// Boot from the precomputed cache (npx startup-forecaster precompute) when it matches the current engine sources —
// instant startup, no sims. Otherwise fall back to a full init pass. Set MC_NO_CACHE=1 to always
// recompute. A stale/corrupt cache never wins: the source hash must match, and any error recomputes.
function saveCache() {
  if (process.env.MC_NO_CACHE) return;
  try {
    writeCache(ac.snapshotState()); // includes the pairwise matrix once computed
  } catch (e) {
    console.log(`Could not write precompute cache (${e && e.message}).`);
  }
}

const t0 = Date.now();
let booted = false;
if (!process.env.MC_NO_CACHE && existsSync(CACHE_BIN) && existsSync(CACHE_HASH)) {
  try {
    const cached = readFreshCache();
    if (cached) {
      ac.hydrateState(cached);
      booted = true;
      console.log(`Loaded precomputed model from cache in ${Date.now() - t0}ms${ac.pairwiseReady() ? " (pairwise included)" : ""}.`);
    } else {
      console.log("Precompute cache is stale (the model's sources changed) — recomputing. Run `npx startup-forecaster precompute` to refresh it.");
    }
  } catch (e) {
    console.log(`Precompute cache unusable (${e && e.message}) — recomputing.`);
  }
}
if (!booted) {
  console.log("Running the model (one pass over every project)…");
  ac.initAppcore();
  const snap = ac.snapshotState(); // slim: summaries + histogram profiles, no per-draw arrays
  console.log(`Ready in ${Date.now() - t0}ms.`);
  ac.hydrateState(snap); // drop the raw draws from RAM too — regenerated on demand for re-pooling
  saveCache(); // self-heal so the NEXT boot is instant (pairwise gets folded in by the bg job below)
}

/** The shell: tab bar + the Overview (and Archived) panels pre-rendered inline; Pairwise, Grounding and the
 *  project panels load on first open. A tab that would be empty (appcore.optionalTabs) is left out. */
function shellHTML() {
  const css = readFileSync(join(DIR, "styles.css"), "utf8");
  const tabs = ac.tabList(); // active projects → main tab chips
  const allTabs = ac.panelTabList(); // active + archived → panel divs (archived stays drill-through reachable)
  const has = ac.optionalTabs();
  // Pairwise panel is empty at load — computed lazily (async job) the first time its tab is opened.
  const tabChips =
    `<div class="tab active" data-t="ov">Overview</div>` +
    (has.pw ? `<div class="tab" data-t="pw">Pairwise</div>` : "") +
    tabs.map((t) => `<div class="tab" data-t="${t.id}">${ac.esc(t.name)} <span class="ev">${ac.fmt(t.p50, t.cur)}</span></div>`).join("") +
    (has.gr ? `<div class="tab tab-tail" data-t="gr">Grounding</div>` : "") +
    (has.arch ? `<div class="tab tab-arch" data-t="arch">Archived</div>` : "");
  const panels =
    `<div class="panel active" id="panel-ov">${ac.overviewHTML()}</div>` +
    (has.pw ? `<div class="panel" id="panel-pw"></div>` : "") +
    (has.gr ? `<div class="panel" id="panel-gr"></div>` : "") +
    (has.arch ? `<div class="panel" id="panel-arch">${ac.archivedHTML()}</div>` : "") +
    allTabs.map((t) => `<div class="panel${ac.isVariant(t.id) ? " varpanel" : ""}" id="panel-${t.id}"></div>`).join("");
  return (
    "<!doctype html><html lang=en><head><meta charset=utf-8>" +
    '<meta name=viewport content="width=device-width,initial-scale=1">' +
    `<title>${PORTFOLIO_TITLE}</title>` +
    `<style>${css}</style></head><body>` +
    `<div class="wrap"><div class="tabbar" id="tabbar">${tabChips}</div>` +
    `<div id="panels">${panels}</div></div>` +
    '<script src="/dom-shared.mjs"></script><script type="module" src="/client.mjs"></script></body></html>'
  );
}

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
function json(res, obj) { send(res, 200, "application/json; charset=utf-8", JSON.stringify(obj)); }

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

// Async jobs: heavy compute (a re-sim or the pairwise matrix) runs off the request so the event loop
// stays free and the page doesn't freeze. A trigger returns {jobId}; the client polls /api/job?id until
// {status:"done", result}. Yielding inside the compute (appcore) keeps other requests flowing meanwhile.
const jobs = new Map(); // id -> {status:'pending'|'done'|'error', result?, error?}
let jobSeq = 0;
let pwJobId = null; // the in-flight pairwise job, so concurrent tab opens share one compute
function startJob(run) {
  const id = "j" + ++jobSeq;
  jobs.set(id, { status: "pending" });
  Promise.resolve().then(run).then(
    (result) => jobs.set(id, { status: "done", result }),
    (e) => { console.error(e); jobs.set(id, { status: "error", error: String((e && e.message) || e) }); },
  );
  return id;
}
function takeJob(id) {
  const j = jobs.get(id) || { status: "missing" };
  if (j.status === "done" || j.status === "error") jobs.delete(id); // deliver terminal state once
  return j;
}

// Light actions (pin/clear/reset now just record an override; select/metric are view-only) return their
// patch synchronously. Heavy re-sims go through a job → {jobId}.
function handleAction(a) {
  switch (a.type) {
    case "pin": return ac.pin(a.pid, a.unitId || undefined, a.nodeId, a.pos);
    case "clear": return ac.clearOverride(a.key);
    case "reset": return ac.resetProject(a.pid);
    case "select": return ac.selectVariant(a.pid, a.unitId);
    case "metric": ac.setMetric(a.m); return {}; // sets render metric for panels/pairwise; client re-fetches the open panel
    case "ovSeries": return ac.ovSetSeries(a.s); // Overview ranking table: revenue vs net-income lens
    // YoY overlay controls — server re-renders the fragment (no sim), instant:
    case "yoyToggle": return ac.yoyToggle(a.pid);
    case "yoyAll": return ac.yoyAll(!!a.on);
    case "yoySeries": return ac.yoySetSeries(a.s);
    case "yoyStat": return ac.yoySetStat(a.k);
    case "resimulate": return { jobId: startJob(() => ac.resimulate(a.pid)) };
    default: return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (path === "/" || path === "/index.html") return send(res, 200, "text/html; charset=utf-8", shellHTML());
    if (path === "/client.mjs") return send(res, 200, "text/javascript; charset=utf-8", readFileSync(join(DIR, "client.mjs"), "utf8"));
    if (path === "/dom-shared.mjs") return send(res, 200, "text/javascript; charset=utf-8", readFileSync(join(DIR, "src", "dom-shared.mjs"), "utf8"));
    if (path === "/styles.css") return send(res, 200, "text/css; charset=utf-8", readFileSync(join(DIR, "styles.css"), "utf8"));
    if (path === "/api/panel") {
      const id = url.searchParams.get("id") || "";
      return json(res, { html: id === "gr" ? ac.evidenceHTML() : id === "arch" ? ac.archivedHTML() : ac.panelHTML(id) });
    }
    if (path === "/api/pairwise") {
      // Ready → return HTML now; otherwise kick off the async compute job and let the client poll.
      if (ac.pairwiseReady()) return json(res, { html: ac.pairwiseHTML() });
      if (!(pwJobId && jobs.get(pwJobId)?.status === "pending")) {
        pwJobId = startJob(async () => { await ac.computePairwiseAsync(); return { html: ac.pairwiseHTML() }; });
      }
      return json(res, { jobId: pwJobId });
    }
    if (path === "/api/job") return json(res, takeJob(url.searchParams.get("id") || ""));
    if (path === "/api/action" && req.method === "POST") return json(res, handleAction(await readBody(req)));
    send(res, 404, "text/plain", "not found");
  } catch (e) {
    console.error(e);
    send(res, 500, "text/plain", String(e && e.stack ? e.stack : e));
  }
});

server.listen(PORT, () => console.log(`Monte-Carlo model at http://localhost:${PORT}`));

// If the pairwise matrix didn't come from the cache, precompute it in the BACKGROUND now (as a job, so
// a user who opens the tab first shares it rather than triggering a second compute) — the server is
// already serving, so this never delays startup. When it finishes, heal the cache so the next boot has
// pairwise ready instantly. (After an edit, resimulate() invalidates it and the lazy path recomputes.)
if (ac.optionalTabs().pw && !ac.pairwiseReady() && !process.env.MC_NO_CACHE) {
  console.log("Precomputing the pairwise matrix in the background…");
  pwJobId = startJob(async () => {
    await ac.computePairwiseAsync();
    saveCache();
    console.log("Pairwise precomputed and cached.");
    return { html: ac.pairwiseHTML() };
  });
}
