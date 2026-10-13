// Generate the portfolio's compiled-distributions module (config `generated.distributions`) from the
// distribution-compiler output in the config's `distributionData` project. For each node key
// `project::node` (variants `project::variant::node`) it emits a normalized DistSpec (kind + resolved
// scalar params, structural kinds nested), the optional truncation, the derived percentiles (for the UI
// bars), the support score, the reasoning, and the provenance lines the UI shows.
//
//   node pipeline/gen-distributions.mjs      (run from the workspace, or MC_CONFIG=…)
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { CONFIG } from "../config.mjs";
import { compiledFiles } from "./compiled.mjs";

if (!CONFIG.distributionData || !CONFIG.generated.distributions) {
  console.log("gen-distributions: no `distributionData` / `generated.distributions` in the config — nothing to do.");
  process.exit(0);
}
const OUT = CONFIG.generated.distributions;

/** A compiled value-object (or bare number) → its resolved scalar. */
function scalar(v) {
  if (typeof v === "number") return v;
  if (!v || typeof v !== "object") return null;
  const m = v.measure || {};
  for (const k of ["value", "mean", "mode"]) if (m[k] != null) return m[k];
  return null;
}

const PARAM = {
  lognormal: ["median", "sigma"], beta: ["alpha", "beta"], normal: ["mean", "sd"],
  gamma: ["shape", "rate"], uniform: ["low", "high"], generalized_pareto: ["location", "scale", "shape"],
};

/** A compiled `distribution` block → a normalized DistSpec (scalars inlined, structure nested). */
function spec(dist) {
  const kind = dist.kind;
  if (PARAM[kind]) {
    const out = { kind };
    for (const k of PARAM[kind]) out[k] = scalar(dist[k]);
    return out;
  }
  if (kind === "point_mass") {
    return { kind, atoms: dist.atoms.map((a) => ({ value: scalar(a.value != null ? a.value : a), weight: Number(a.weight ?? a.allocation ?? 1) })) };
  }
  if (kind === "weighted_combination") {
    return { kind, components: dist.components.map((c) => ({ d: spec(c.distribution), weight: Number(c.weight ?? c.allocation ?? 1) })) };
  }
  if (kind === "splice") {
    return { kind, body: spec(dist.segments[0].distribution), tail: spec(dist.segments[1].distribution), at: scalar(dist.splices[0].at) };
  }
  if (kind === "piecewise") {
    return { kind, anchors: dist.anchors.map((a) => ({ prob: a.prob, value: scalar(a.value != null ? a.value : a) })) };
  }
  if (kind === "metalog") {
    const arr = dist.anchors;
    let lb = dist.lower_bound;
    if (lb == null && ["semi-bounded", "lower-semi-bounded", "bounded"].includes(dist.boundedness)) lb = dist.lower ?? 0;
    let ub = dist.upper_bound;
    if (ub == null && ["upper-semi-bounded", "bounded"].includes(dist.boundedness)) ub = dist.upper ?? null;
    return {
      kind,
      anchors: arr.map((a, i) => ({ prob: a.prob ?? (i + 1) / (arr.length + 1), value: scalar(a.value != null ? a.value : a) })),
      k: dist.k ?? dist.terms ?? 5,
      lower_bound: lb ?? null,
      ...(ub != null ? { upper_bound: ub } : {}),
      zero_mass: dist.zero_mass ?? 0,
    };
  }
  throw new Error(`unknown kind: ${kind}`);
}

/** Compact number for the human distribution-structure label. */
function fnum(x) {
  if (x == null || Number.isNaN(x)) return "?";
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString("en-US");
  if (a === 0) return "0";
  if (a < 1) return String(Number(x.toPrecision(2)));
  return String(Number(x.toFixed(2)));
}
const wpct = (w, tot) => `${Math.round((w / tot) * 100)}%`;

/** A readable one-line description of the distribution's structure (kind + grounded params). */
function kindLabel(d) {
  switch (d.kind) {
    case "lognormal": return `lognormal · median ${fnum(d.median)}, σ ${fnum(d.sigma)}`;
    case "beta": return `beta(α ${fnum(d.alpha)}, β ${fnum(d.beta)})`;
    case "normal": return `normal(μ ${fnum(d.mean)}, σ ${fnum(d.sd)})`;
    case "gamma": return `gamma(shape ${fnum(d.shape)}, rate ${fnum(d.rate)})`;
    case "uniform": return `uniform [${fnum(d.low)}, ${fnum(d.high)}]`;
    case "generalized_pareto": return `generalized Pareto (loc ${fnum(d.location)}, scale ${fnum(d.scale)}, ξ ${fnum(d.shape)})`;
    case "point_mass": {
      const tot = d.atoms.reduce((s, a) => s + a.weight, 0) || 1;
      return `point mass · ${d.atoms.map((a) => `${fnum(a.value)} @ ${wpct(a.weight, tot)}`).join(" + ")}`;
    }
    case "weighted_combination": {
      const tot = d.components.reduce((s, c) => s + c.weight, 0) || 1;
      return `mixture · ${d.components.map((c) => `${wpct(c.weight, tot)} ${c.d.kind}`).join(" + ")}`;
    }
    case "splice": return `splice · ${d.body.kind} body + ${d.tail.kind} tail @ ${fnum(d.at)}`;
    case "piecewise": return `piecewise · through ${d.anchors.length} stated quantiles`;
    case "metalog": return `metalog · ${d.k}-term${d.lower_bound != null ? `, ≥ ${fnum(d.lower_bound)}` : ""}${d.upper_bound != null ? `, ≤ ${fnum(d.upper_bound)}` : ""}`;
    default: return d.kind;
  }
}

/** Every `process` string in the distribution tree (how each parameter was derived), in order, deduped. */
function processLines(dist) {
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.process === "string" && !seen.has(o.process)) { seen.add(o.process); out.push(o.process); }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(dist);
  return out;
}

/** Cross-checks as short lines: corroborations vs tensions. */
function checkLines(node) {
  return (node.cross_checks || [])
    .filter((c) => !c.superseded_by)
    .map((c) => {
      const mark = c.usage === "refutation" || c.usage === "tension" ? "✗" : "✓";
      const text = c.process || c.reasoning || c.basis || c.usage || "";
      return `${mark} ${text}`;
    })
    .filter((s) => s.length > 2);
}

function truncOf(node) {
  const t = node.truncation;
  if (!t || typeof t !== "object") return undefined;
  const lo = t.lower != null ? scalar(t.lower) : undefined;
  const hi = t.upper != null ? scalar(t.upper) : undefined;
  if (lo == null && hi == null) return undefined;
  const out = {};
  if (lo != null) out.lower = lo;
  if (hi != null) out.upper = hi;
  return out;
}

const out = {};
let count = 0;
for (const f of compiledFiles(CONFIG.distributionData)) {
  const nodes = JSON.parse(readFileSync(f, "utf8")).nodes || {};
  for (const [key, node] of Object.entries(nodes)) {
    if (!node.distribution) continue;
    const dp = node.debug_computed_percentiles || {};
    const d = spec(node.distribution);
    const rec = { d };
    const trunc = truncOf(node);
    if (trunc) rec.trunc = trunc;
    rec.pctiles = { p05: dp.p05 ?? null, p10: dp.p10 ?? null, p50: dp.p50 ?? null, p90: dp.p90 ?? null, p95: dp.p95 ?? null };
    if (node.support_score != null) rec.support = node.support_score;
    if (node.reasoning) rec.basis = node.reasoning;
    // richer provenance for the UI (WO20 §UI): structure, definition, derivation, checks.
    rec.klabel = kindLabel(d);
    if (node.model_definition) rec.def = node.model_definition;
    if (node.unit) rec.unit = node.unit;
    const proc = processLines(node.distribution);
    if (proc.length) rec.proc = proc;
    const checks = checkLines(node);
    if (checks.length) rec.checks = checks;
    if (node.reconciliation && node.reconciliation.process) rec.recon = node.reconciliation.process;
    out[key] = rec;
    count++;
  }
}

const body =
  `// AUTO-GENERATED by montecarlo-engine pipeline/gen-distributions.mjs — do not edit. ${count} nodes from ${basename(CONFIG.distributionData)}.\n` +
  `// Portfolio data: attaches the compiled distributions to the engine via configurePortfolio().\n` +
  `import { configurePortfolio } from "${CONFIG.engineImport}/portfolio-context.ts";\n\n` +
  `configurePortfolio({ distributions: ${JSON.stringify(out, null, 0)} });\n`;

writeFileSync(OUT, body);
console.log(`Wrote ${OUT} — ${count} nodes.`);
