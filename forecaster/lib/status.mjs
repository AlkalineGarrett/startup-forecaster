// `forecaster status <id>` — how grounded a venture is, and what to research next. The per-node report is the
// engine's (montecarlo-engine coverage.mjs --drivers: one classifier, shared with `npm run coverage`); this adds
// the venture's open fetch requests and the human-readable view. Each node's class comes from the evidence its
// distribution references in the distribution-data project:
//   placeholder  only the preset's `…_placeholder` speculation — unresearched
//   judgement    speculations / general-knowledge priors, but no sourced observation
//   sourced      at least one sourced observation (obs_…)
//   missing      no distribution in the data project at all (the model will refuse to run it)
// plus any reference left as a tracked gap (reference: null + missing_document), and the venture's open
// fetch-queue requests. Nodes are ranked by how strongly they drive the outcome (the engine's rank
// correlation of each node with revenue), so research goes where it moves the answer.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The engine's per-node report for these ventures (classification + outcome drivers), in one run. */
function engineCoverage(pf, ids) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(pf.engine, "coverage.mjs"), "--json", "--drivers", ...ids],
    { cwd: pf.root, env: { ...process.env, MC_CONFIG: pf.configPath }, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) return { error: (r.stderr || "").trim().split("\n").slice(-3).join(" ") };
  return JSON.parse(r.stdout);
}

function openRequests(pf, id) {
  const q = pf.groundingSources && join(pf.groundingSources, "fetch-queue.jsonl");
  if (!q || !existsSync(q)) return [];
  return readFileSync(q, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.status !== "resolved" && (r.for || []).some((f) => String(f).startsWith(`${id}::`)))
    .map((r) => ({ url: r.url, for: r.for, lane: r.lane || null, why: r.why }));
}

const ORDER = { missing: 0, placeholder: 1, judgement: 2, sourced: 3 };

export function ventureStatuses(pf, ids) {
  const cov = engineCoverage(pf, ids);
  return ids.map((id) => {
    const row = (cov.projects || []).find((p) => p.id === id);
    if (!row) return { id, headline: null, cur: "", error: cov.error || `no project "${id}" in the portfolio model`, counts: {}, nodes: [], queue: openRequests(pf, id) };
    // the venture's own graph (not variants / price-sweep nodes), classified by the engine
    const nodes = row.nodes.filter((n) => n.unit === "base" && !n.sweep).map((n) => ({
      node: n.node,
      cls: n.source === "compiled" && n.grounding ? n.grounding : "missing",
      refs: n.refs || [], gaps: n.gaps || [],
      support: n.support ?? null,
      compiled: n.source === "compiled",
      driver: n.driver || null,
    }));
    // research order: drivers first (by rank), then the rest; placeholders before judgement before sourced
    nodes.sort((a, b) => (a.driver ? a.driver.rank : 99) - (b.driver ? b.driver.rank : 99) || ORDER[a.cls] - ORDER[b.cls]);
    const counts = Object.fromEntries(Object.keys(ORDER).map((k) => [k, nodes.filter((n) => n.cls === k).length]));
    return { id, headline: row.headline || null, cur: row.cur || "", error: null, counts, nodes, queue: openRequests(pf, id) };
  });
}

export function printStatus(s) {
  const fmt = (v) => (v == null ? "–" : Math.round(v).toLocaleString("en-US"));
  console.log(`${s.id}${s.headline ? `  ·  avg yearly revenue P20 ${s.cur}${fmt(s.headline.p20)} · P50 ${s.cur}${fmt(s.headline.p50)} · P80 ${s.cur}${fmt(s.headline.p80)}` : ""}`);
  if (s.error) console.log(`  (could not run the model: ${s.error})`);
  const c = s.counts;
  console.log(`  ${c.sourced} sourced · ${c.judgement} judgement · ${c.placeholder} placeholder${c.missing ? ` · ${c.missing} MISSING` : ""}   (of ${s.nodes.length} nodes)`);
  if (c.placeholder && s.headline) console.log("  NOTE: placeholder nodes are generic preset priors — the outcome above is not yet a forecast of this venture.");
  console.log("");
  console.log(`  ${"node".padEnd(30)}${"status".padEnd(13)}${"support".padStart(8)}   driver`);
  for (const n of s.nodes) {
    const d = n.driver ? `#${n.driver.rank} (ρ ${n.driver.corr.toFixed(2)})` : "";
    console.log(`  ${n.node.padEnd(30)}${n.cls.padEnd(13)}${String(n.support ?? "–").padStart(8)}   ${d}${n.gaps.length ? `   gap: ${n.gaps.join("; ")}` : ""}`);
  }
  if (s.queue.length) {
    console.log(`\n  open fetch requests (${s.queue.length}):`);
    for (const r of s.queue) console.log(`    • [${r.lane || "?"}] ${r.url}  → ${r.for.join(", ")}`);
  }
  const next = s.nodes.find((n) => n.cls === "placeholder" || n.cls === "missing") || s.nodes.find((n) => n.cls === "judgement" && n.driver);
  if (next) console.log(next.cls === "judgement"
    ? `\n  next: ground \`${next.node}\` — the strongest driver still resting on judgement — with sourced observations.`
    : `\n  next: research \`${next.node}\` (see the research brief), then \`npm run pipeline\`.`);
}
