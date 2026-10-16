#!/usr/bin/env node
// Scaffold — lift a simulator's HAND-AUTHORED nodes into the data project, so every node a model
// samples goes through the one grounded route (projects/<project>.json → compile → simulator).
//
// A hand-authored node is a set of judged percentiles typed straight into the model. This makes that
// judgement explicit and tracked, without changing what is sampled:
//
//   • a speculation  spec_<project>__<node>  in corpus/speculations.json — the authored quantiles
//     (measure.quantiles) with the node's own reasoning verbatim (+ any URLs it cited, which are NOT
//     yet observations); and
//   • a node  "<project>::<node>"  in projects/<project>.json — a metalog through the same percentiles
//     (exact fit: k = number of anchors, the same bound the simulator's hand path uses; see below for
//     the cases where the hand path interpolates instead), each anchor a
//     direct_value restating one of the speculation's stated quantiles (`quantile: "pNN"`, checked by
//     the compiler). An exact-fit metalog through the same points is the
//     simulator's own hand-path sampler, so the scaffold is numerically a no-op.
//
// support_score is held below 40 (the "guess" band): a speculation is judgement, not evidence, until
// someone grounds it — re-point an anchor at a real observation, or rebuild the node's construction
// from evidence, and raise the score. Existing nodes are never touched.
//
// Input is the simulator's coverage export (montecarlo-engine: `coverage.mjs --json`), or any JSON of the same
// shape ({ projects: [{ id, nodes: [{ key, label, kind, bound, pctiles, prov, conf, basis, urls, source: "hand" }] }] }).
// A node may override what the scaffold would derive: `unit`, `support`, `spec_id`, `reasoning`, `spec_statement`,
// `spec_reasoning` (startup-forecaster uses these to seed its labelled placeholder priors).
//
//   node --experimental-strip-types coverage.mjs --json > cov.json
//   npx startup-forecaster scaffold cov.json <project-id> [--nodes a,b] [--write]
//
// Without --write it prints what it would add. The data project is the workspace's (see workspace.mjs).
// Where the simulator's hand path cannot fit an exact metalog (a percentile on a bound, e.g. "p10 = 0
// setup fee", or a non-monotone fit) it interpolates the points empirically; the scaffold emits the
// `piecewise` kind there, which is that same interpolation. A constant becomes a single point_mass atom.
// So in every case the compiled node samples exactly what the hand path sampled.
//
// While it read-modify-writes speculations.json it holds an exclusive `speculations.json.lock` file,
// so concurrent scaffolds take turns.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMain } from "../../shared/is-main.mjs";
import { parseArgs } from "node:util";
import * as D from "./distributions.mjs";
import { dataRoot } from "./workspace.mjs";
import { dumps, loads } from "./json.mjs";
import { sig } from "./format.mjs";

export const PCT = [["p01", 0.01], ["p05", 0.05], ["p10", 0.10], ["p25", 0.25], ["p50", 0.50], ["p75", 0.75], ["p90", 0.90], ["p95", 0.95], ["p99", 0.99]];
export const SUPPORT_CAP = 35;                                // stays in the "guess" band (< 40)

const has = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
const getOr = (o, k, d = null) => (has(o, k) ? o[k] : d);
const truthy = (v) => !(v === null || v === undefined || v === false || v === "" || v === 0
  || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length));

function load(path, dflt) {
  if (!existsSync(path)) return [dflt, "\n"];
  const s = readFileSync(path, "utf8");
  return [loads(s), s.endsWith("\n") ? "\n" : ""];
}

function dump(path, obj, tail) {
  writeFileSync(path, dumps(obj, { indent: 1 }) + tail);
}

export function specId(key) {
  return "spec_" + key.toLowerCase().replaceAll("::", "__").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// A unit word stands alone: \b on Unicode word characters (JS's \b is ASCII-only).
const W = "[\\p{L}\\p{N}_]";
// ISO 4217 codes for the currencies most often priced in, matched in capitals only ("TRY" is a currency, "try" is not).
const ISO = "USD|EUR|GBP|JPY|CNY|INR|KRW|RUB|CHF|CAD|AUD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|BRL|MXN|ARS|CLP|COP|PEN|ZAR|NGN|KES|EGP|AED|SAR|ILS|SGD|HKD|TWD|THB|MYR|IDR|PHP|VND|PKR|BDT|UAH";
const UNIT_WORD = new RegExp(`[$€£¥₹₩₽%×/]|(?<!${W})(count|months?|years?|weeks?|days?|hours?|x)(?!${W})`, "iu");
const ISO_CODE = new RegExp(`(?<!${W})(${ISO})(?!${W})`, "u");
/** True when a label's parenthetical reads like a unit: a currency symbol or ISO code, %, ×, /, a count or a duration. */
export const UNITISH = { test: (s) => UNIT_WORD.test(s) || ISO_CODE.test(s) };

/** The node's unit: a fraction when bounded; a duration from a `…_months`/`…_years` id; otherwise the
 *  label's trailing parenthetical ONLY when it reads like a unit (currency, %, ×, count, time) — labels
 *  often end in a gloss ("(agentic coding)") that is not a unit. */
export function unitOf(n) {
  if (n.bound === "bounded") return "fraction 0-1";
  const node = getOr(n, "node") || n.key.split("::").pop();
  if (node.endsWith("_months") || node === "months") return "months";
  if (node.endsWith("_years") || node === "years") return "years";
  const m = /\(([^()]*)\)\s*$/u.exec(n.label);
  return m && UNITISH.test(m[1]) ? m[1] : "level (see model_definition)";
}

export function supportOf(n) {
  const prov = Object.values(getOr(n, "prov", {}));
  let base = { low: 20, med: 28, medium: 28, high: 32 }[getOr(n, "conf", "")] ?? 20;
  if (prov.includes("sourced")) base += 5;
  return Math.min(base, SUPPORT_CAP);
}

/** → [node_key, node, spec_key, spec, note] for one hand-authored node. */
export function scaffold(n, project) {
  const key = n.key;
  const pts = PCT.filter(([k]) => getOr(n.pctiles, k) !== null).map(([k, p]) => [p, n.pctiles[k], k]);
  if (pts.length < 2) throw new D.DistError("fewer than 2 authored percentiles — nothing to fit");
  const bounded = n.bound === "bounded";
  const lower = n.bound === "unbounded" ? null : 0;
  const upper = bounded ? 1 : null;
  const sid = getOr(n, "spec_id") || specId(key);
  const unit = getOr(n, "unit") || unitOf(n);
  const val = (v, k) => ({ value_type: "direct_value", reference: sid, quantile: k, measure: { unit, value: v } });
  const anchors = pts.map(([p, v, k]) => ({ prob: p, value: val(v, k) }));
  let note = "";
  // Mirror the simulator's hand path (montecarlo-engine buildMarginal): an exact-fit metalog when every
  // point is strictly inside the bounds and the fit is monotone; otherwise its empirical interpolation,
  // which `piecewise` reproduces exactly. A constant is one atom.
  const inside = pts.every(([, v]) => (lower === null || v > lower) && (upper === null || v < upper));
  let dist;
  if (new Set(pts.map(([, v]) => v)).size === 1) {
    dist = { kind: "point_mass", atoms: [{ value: val(pts[0][1], pts[0][2]), weight: 1 }] };
    note = "constant — a single point_mass atom";
  } else {
    dist = { kind: "metalog", k: anchors.length };
    if (lower !== null) dist.lower_bound = lower;
    if (upper !== null) dist.upper_bound = upper;
    dist.anchors = anchors;
    let feasible = inside;
    if (feasible) {
      try {
        D.construct("metalog", { _anchors: pts.map(([p, v]) => [p, v]), k: pts.length, lower_bound: lower, upper_bound: upper });
      } catch (e) {
        if (!(e instanceof D.DistError)) throw e;
        feasible = false;
      }
    }
    if (!feasible) {
      dist = { kind: "piecewise", anchors };
      note = "piecewise — " + (!inside ? "a point sits on a bound" : "no monotone exact metalog") + "; the hand path interpolated here too";
    }
  }
  const what = { metalog: "an exact-fit metalog", piecewise: "a piecewise interpolation", point_mass: "a single atom" }[dist.kind];
  const node = {
    unit,
    model_definition: n.label,
    distribution: dist,
    support_score: has(n, "support") ? n.support : supportOf(n),
    reasoning: getOr(n, "reasoning") || (getOr(n, "basis") || n.label).trim()
      + ` [Scaffolded from the model's hand-authored percentiles: ${what} through the quantiles stated in ${sid}. Not yet grounded — re-point anchors at real observations to ground it.]`,
  };
  const parts = key.split("::");
  if (parts.length === 3) node.variant = { base_project: parts[0], variant: parts[1] };
  const stated = PCT.filter(([k]) => getOr(n.pctiles, k) !== null);
  const quantiles = {};
  for (const [k] of stated) quantiles[k] = n.pctiles[k];
  const spec = {
    statement: getOr(n, "spec_statement") || `Authored judgement for ${project} '${n.label}': `
      + stated.map(([k]) => `${k}=${sig(n.pctiles[k])}`).join(", "),
    reasoning: getOr(n, "spec_reasoning") || (getOr(n, "basis") || "").trim()
      + (truthy(getOr(n, "urls")) ? " Cited (not yet observations): " + n.urls.join(" · ") : ""),
    measure: { unit, quantiles },
  };
  return [key, node, sid, spec, note];
}

// ---------- the command line ----------
const USAGE = "usage: scaffold.mjs <coverage.json | -> <project> [--nodes a,b] [--write]";
function cli(argv) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { nodes: { type: "string" }, write: { type: "boolean", default: false }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (positionals.length !== 2) throw new Error("expected <coverage> and <project>");
  return { coverage: positionals[0], project: positionals[1], nodes: values.nodes ?? null, write: values.write };
}

/** An exclusive lock beside `path` (Node has no flock): created with O_EXCL, removed on release. */
function lockFile(path) {
  const lock = `${path}.lock`;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 0; ; tries++) {
    try {
      closeSync(openSync(lock, "wx"));
      return () => { try { unlinkSync(lock); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== "EEXIST" || tries > 600) throw e;
      Atomics.wait(wait, 0, 0, 50);   // another scaffold holds it: retry for up to ~30 s
    }
  }
}

/** scaffold — returns the exit code. Writes into the workspace's data project (workspace.mjs dataRoot). */
async function main(argv) {
  let a;
  try { a = cli(argv); } catch (e) {
    process.stderr.write(`${USAGE}\n${e.message}\n`);
    return 2;
  }
  const cov = loads(readFileSync(a.coverage === "-" ? 0 : a.coverage, "utf8"));
  const proj = cov.projects.find((p) => p.id === a.project);
  if (!proj) { process.stderr.write(`no project '${a.project}' in the coverage export\n`); return 1; }
  const want = truthy(a.nodes) ? new Set(a.nodes.split(",")) : null;
  const hand = proj.nodes.filter((n) => n.source === "hand" && (want === null || want.has(n.node)));

  const root = await dataRoot();   // throws outside a workspace (FORECASTER_DATA overrides)
  const ppath = join(root, "projects", `${a.project}.json`);
  const spath = join(root, "corpus", "speculations.json");
  mkdirSync(dirname(spath), { recursive: true });
  const release = lockFile(spath);             // hold an exclusive lock on the corpus file while we read-modify-write
  const out = [];
  try {
    const [nodes, ntail] = load(ppath, {});
    const [specs, stail] = load(spath, {});
    let added = 0, skipped = 0;
    for (const n of hand) {
      let r;
      try { r = scaffold(n, a.project); } catch (e) {
        if (!(e instanceof D.DistError)) throw e;
        out.push(`  SKIP ${n.key}: ${e.message}`); skipped += 1; continue;
      }
      const [key, node, sid, spec, note] = r;
      if (Object.hasOwn(nodes, key)) { out.push(`  keep ${key} (already in projects/${a.project}.json)`); skipped += 1; continue; }
      nodes[key] = node;
      if (!Object.hasOwn(specs, sid)) specs[sid] = spec;
      added += 1;
      const d = node.distribution;
      const shape = d.kind === "metalog" ? `metalog k=${d.k}` : d.kind;
      out.push(`  add  ${key}  ← ${shape}, support ${node.support_score}` + (note ? `  [${note}]` : ""));
    }
    if (a.write && added) {
      dump(ppath, nodes, ntail || "\n");
      dump(spath, specs, stail || "\n");
    }
    out.push(`${added} node(s) ${a.write ? "written" : "would be added (dry run; --write to apply)"}, ${skipped} skipped.`);
  } finally {
    release();
    if (out.length) process.stdout.write(out.join("\n") + "\n");
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
