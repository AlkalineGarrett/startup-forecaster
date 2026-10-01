// What both static-artifact builders (build-artifact.mjs: the slim topline; build-full-artifact.mjs: every
// panel) share: attach the portfolio, restore the precomputed state (or compute it), apply the project subset
// (MC_PROJECTS), compute the pairwise matrix when the subset can form pairs, bake the toggle-switchable views,
// and write the page next to the live build (dirname of the config's `out`; MC_OUT names the file).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { deserialize } from "node:v8";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_BIN, CACHE_HASH, sourceHash } from "./cache-util.mjs";
import { loadPortfolio } from "./portfolio-loader.mjs";
import { CONFIG } from "./config.mjs";

export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
export const METRICS = ["p20", "p50", "mean", "p80"];

/** Attach the portfolio and bring appcore to its static state; returns { ac, SEL, showPw }. */
export async function prepareStatic() {
  await loadPortfolio(); // portfolio.config.mjs bootstrap, else the example — before any appcore call
  const ac = await import("./src/appcore.ts");
  // Prefer the precompute cache (the same static state the server serves); else compute fresh.
  if (existsSync(CACHE_BIN) && existsSync(CACHE_HASH) && readFileSync(CACHE_HASH, "utf8").trim() === sourceHash()) {
    ac.hydrateState(deserialize(readFileSync(CACHE_BIN)));
    console.log("hydrated from precompute cache" + (ac.pairwiseReady() ? " (pairwise included)" : ""));
  } else {
    ac.initAppcore();
    console.log("no valid cache — computed fresh");
  }
  // Optionally restrict to a chosen SUBSET of projects (comma-separated ids in MC_PROJECTS).
  const SEL = (process.env.MC_PROJECTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (SEL.length) { ac.selectProjects(SEL); console.log("restricted to: " + SEL.join(", ")); }
  const showPw = ac.pairwiseEligibleCount() >= 2; // drop Pairwise when the subset can't form a pair
  if (showPw && !ac.pairwiseReady()) { await ac.computePairwiseAsync(); console.log("computed pairwise"); }
  return { ac, SEL, showPw };
}

/** Bake the toggle-switchable views — Pairwise per statistic, the Year-over-year card per series × statistic,
 *  the Overview ranking per lens — then restore the defaults the inline panels render at. */
export function bakeStatViews(ac, showPw) {
  const pw = {}, yoy = {}, ovrank = {};
  if (showPw) for (const m of METRICS) { ac.setMetric(m); pw[m] = ac.pairwiseHTML(); }
  ac.setMetric("p50");
  for (const s of ["rev", "net"]) for (const k of METRICS) { ac.yoySetSeries(s); yoy[s + "|" + k] = ac.yoySetStat(k).yoyHTML; }
  ac.yoySetSeries("net"); ac.yoySetStat("p50"); // default — matches the client's yoySel
  for (const s of ["net", "rev"]) ovrank[s] = ac.ovSetSeries(s).ovRankHTML;
  ac.ovSetSeries("net"); // default — matches the client's ovSel + the baked overview
  return { pw, yoy, ovrank };
}

/** JSON safe to inline in a <script> (escapes "</"). */
export const inlineJson = (o) => JSON.stringify(o).replace(/<\//g, "<\\/");
export const engineFile = (name) => readFileSync(join(ENGINE_DIR, name), "utf8");

/** Write the page next to the live build; returns the path. */
export function writeArtifact(defaultName, content) {
  const out = join(dirname(CONFIG.out), process.env.MC_OUT || defaultName);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content);
  return out;
}
