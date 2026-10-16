// Grounding coverage: for every node the simulation samples, is its distribution COMPILED (built from a
// grounded construction, with a support score) or HAND-AUTHORED (sampled from the percentiles typed into
// the project file)? A portfolio can mix both; this shows where it does.
//
//   node --experimental-strip-types coverage.mjs                 # one row per project
//   node --experimental-strip-types coverage.mjs <project-id>    # every node of that project
//   node --experimental-strip-types coverage.mjs --json          # machine-readable, all nodes (hand nodes carry
//                                                                 their authored pctiles/prov/basis/urls/bound)
//   … [<project-id> …] [--drivers]                               # only these projects; --drivers attaches the outcome
//                                                                 drivers + headline (from the fresh precompute
//                                                                 snapshot, else running each once)
// Compiled nodes also carry their GROUNDING (sourced / judgement / placeholder, from what the distribution
// references in the distribution-data project — simulation/compiled.mjs groundingOf).
//
// It also lists ORPHANS — compiled keys that match no sampled node (a renamed project or node, a dropped
// variant): data that was meant to drive the model but silently doesn't, or now lands somewhere else.
//
// Compiled nodes are banded by support score like the UI bars (≥60 sourced · ≥40 inferred · else guess).
// Runs the portfolio named by portfolio.config.mjs (default: the example). No simulation is run (but see --drivers).
import { loadPortfolio } from "./portfolio-loader.mjs";
import { PROJECTS, DISTRIBUTIONS, currencyOf } from "./src/portfolio-context.ts";
import { CONFIG } from "./config.mjs";
import { SUPPORT_HIGH, SUPPORT_MID } from "./src/apply-distributions.ts";
import { corpusKinds, sourceNodes, groundingOf } from "./simulation/compiled.mjs";

await loadPortfolio();

const band = (s) => (s == null ? "guess" : s >= SUPPORT_HIGH ? "sourced" : s >= SUPPORT_MID ? "inferred" : "guess");

/** Every sampled node of a project: each unit's (base, then each variant) graph nodes, plus the
 *  price-sweep-only nodes the optimizer draws (priceSweep.extraNodes, tagged `sweep`). */
function nodesOf(p) {
  const out = [];
  const add = (prefix, unit, nodes, sweep) => { for (const n of nodes || []) out.push({ key: `${prefix}::${n.id}`, unit, n, sweep }); };
  add(p.id, "base", p.nodes, false);
  add(p.id, "base", p.priceSweep?.extraNodes, true);
  for (const v of p.variants || []) {
    add(`${p.id}::${v.id}`, v.id, v.nodes, false);
    add(`${p.id}::${v.id}`, v.id, v.priceSweep?.extraNodes, true);
  }
  return out;
}

// Grounding of each compiled node, read from the distribution-data project's source (when configured).
const SOURCE = CONFIG.distributionData ? sourceNodes(CONFIG.distributionData) : {};
const KINDS = CONFIG.distributionData ? corpusKinds(CONFIG.distributionData) : new Map();

function classify({ key, unit, n, sweep }) {
  const d = DISTRIBUTIONS[key];
  if (d) {
    const g = groundingOf(SOURCE[key], KINDS);
    return { key, unit, sweep, node: n.id, label: n.label, source: "compiled", support: d.support ?? null, band: band(d.support),
      grounding: SOURCE[key] ? g.cls : null, refs: g.refs, gaps: g.gaps };
  }
  // Hand-authored: export what was authored, so a scaffolder (distribution-compiler/compiler/scaffold.mjs)
  // can lift it into the data project verbatim. `bound` is the metalog bound the hand path samples with.
  const bound = n.bound ?? (n.kind === "gate" || n._frac ? "bounded" : "semi-lo");
  return {
    key, unit, sweep, node: n.id, label: n.label, source: "hand", kind: n.kind, bound,
    pctiles: n.pctiles || {}, prov: n.prov || {}, conf: n.conf || "", basis: n.basis || "", urls: n.urls || [],
  };
}

const used = new Set(PROJECTS.flatMap((p) => nodesOf(p).map((x) => x.key)));
const orphans = Object.keys(DISTRIBUTIONS).filter((k) => !used.has(k)).sort();
const orphanGroups = Object.entries(orphans.reduce((acc, k) => {
  const pre = k.split("::").slice(0, -1).join("::");
  (acc[pre] ||= []).push(k);
  return acc;
}, {}));

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("-"));
const selected = ids.length ? PROJECTS.filter((p) => ids.includes(p.id)) : PROJECTS;
const rows = selected.map((p) => ({ id: p.id, name: p.name, cur: p.cur, currency: currencyOf(p), nodes: nodesOf(p).map(classify) }));

// --drivers: attach each selected project's outcome drivers (rank correlation of each node with revenue — the
// engine's tornado) and the headline, so research can go where it moves the answer. They are read from the
// precompute snapshot (forecast-renderer's .cache, written by `startup-forecaster simulate`) when it is current with
// the sources — it holds each project's run(p) result (a variant project's under its base unit, which is
// run(p)) — and otherwise each project is run once here.
if (args.includes("--drivers")) {
  const { run } = await import("./src/simulate.ts");
  const { ovResult } = await import("./src/units.ts");
  const { readFreshCache } = await import("../forecast-renderer/cache-util.mjs");
  let cached = null;
  try { cached = readFreshCache()?.R ?? null; } catch { /* unreadable cache: compute */ }
  for (const row of rows) {
    const p = PROJECTS.find((x) => x.id === row.id);
    const c = cached && ovResult(cached, p);
    const r = c && Array.isArray(c.tornado) ? c : run(p);
    row.headline = { p20: r.p20, p50: r.p50, p80: r.p80, mean: r.mean };
    const rank = new Map(r.tornado.map((b, i) => [b.id, { rank: i + 1, corr: b.corr }]));
    for (const n of row.nodes) if (n.unit === "base" && !n.sweep) n.driver = rank.get(n.node) || null;
  }
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ projects: rows, orphans }, null, 2));
} else if (ids.length) {
  const r = rows[0];
  if (!r) { console.error(`no project "${ids[0]}" — one of: ${PROJECTS.map((x) => x.id).join(", ")}`); process.exit(2); }
  console.log(`${r.name} (${r.id})\n`);
  for (const x of r.nodes) {
    const what = x.source === "compiled"
      ? `compiled  ${String(x.support ?? "–").padStart(3)}  ${x.band.padEnd(9)}${x.grounding ? "  " + x.grounding : ""}`
      : `HAND           ${x.urls.length ? x.urls.length + " url(s)" : "no urls"}${x.conf ? " · conf " + x.conf : ""}`;
    console.log(`  ${x.key.padEnd(52)} ${what}${x.sweep ? "  (price sweep)" : ""}`);
  }
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`${pad("project", 26)}${padL("nodes", 6)}${padL("sourced", 9)}${padL("inferred", 9)}${padL("guess", 7)}${padL("placeholder", 12)}${padL("hand", 6)}  compiled`);
  let tot = 0, comp = 0;
  for (const r of rows) {
    const c = (f) => r.nodes.filter(f).length;
    const s = c((x) => x.band === "sourced" && x.source === "compiled");
    const i = c((x) => x.band === "inferred" && x.source === "compiled");
    const g = c((x) => x.band === "guess" && x.source === "compiled");
    const ph = c((x) => x.source === "compiled" && x.grounding === "placeholder");
    const h = c((x) => x.source === "hand");
    tot += r.nodes.length; comp += r.nodes.length - h;
    const pct = r.nodes.length ? Math.round((100 * (r.nodes.length - h)) / r.nodes.length) : 0;
    console.log(`${pad(r.id, 26)}${padL(r.nodes.length, 6)}${padL(s, 9)}${padL(i, 9)}${padL(g, 7)}${padL(ph, 12)}${padL(h, 6)}  ${padL(pct + "%", 4)}`);
  }
  console.log(`\n${comp}/${tot} sampled nodes compiled (${Math.round((100 * comp) / tot)}%)` + (comp < tot ? `; the other ${tot - comp} sample hand-authored percentiles.` : ".") +
    " Compiled is not grounded: a placeholder (a preset's unresearched prior) and a guess compile too.");
  if (orphans.length) {
    console.log(`\n${orphans.length} compiled distribution(s) match no sampled node:`);
    for (const [pre, ks] of orphanGroups) console.log(`  ${pre.padEnd(34)} ${ks.length}`);
  }
}
