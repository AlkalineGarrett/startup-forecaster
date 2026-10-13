// scaffold.mjs lifts a simulator's hand-authored node into a project file + a speculation; compiling
// the result must reproduce the authored percentiles exactly, with every anchor machine-checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "../compiler/scaffold.mjs";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const COMPILER = join(PKG, "compiler", "compile.mjs");
const SCAFFOLD = join(PKG, "compiler", "scaffold.mjs");

const hand = (key, pctiles, bound = "semi-lo", label = "Free signups (count)") => ({
  key, node: key.split("::").pop(), label, source: "hand", kind: "value", bound,
  pctiles, prov: Object.fromEntries(Object.keys(pctiles).map((k) => [k, "inferred"])), conf: "low", basis: "why", urls: ["https://x.example"],
});

test("anchors restate the speculation's quantiles", () => {
  const [, node, sid, spec, note] = scaffold(hand("demo::signups", { p10: 200, p50: 1500, p90: 42000 }), "demo");
  const d = node.distribution;
  assert.ok(d.kind === "metalog" && d.k === 3 && d.lower_bound === 0 && !("upper_bound" in d));
  assert.deepEqual(d.anchors.map((a) => [a.prob, a.value.quantile, a.value.reference]), [[0.1, "p10", sid], [0.5, "p50", sid], [0.9, "p90", sid]]);
  assert.deepEqual(spec.measure.quantiles, { p10: 200, p50: 1500, p90: 42000 });
  assert.ok(node.support_score < 40 && note === "");
});

test("fractions are doubly bounded", () => {
  const [, node] = scaffold(hand("demo::conv", { p10: 0.01, p50: 0.03, p90: 0.08 }, "bounded"), "demo");
  assert.ok(node.distribution.kind === "metalog" && node.distribution.upper_bound === 1);
});

test("a point on a bound falls back to piecewise, like the hand path", () => {
  for (const [pct, bound] of [[{ p10: 0, p50: 3000, p90: 12000 }, "semi-lo"], [{ p01: 0.4, p50: 0.82, p90: 0.98, p99: 1 }, "bounded"]]) {
    const [, node, , , note] = scaffold(hand("demo::x", pct, bound), "demo");
    const d = node.distribution;
    assert.ok(d.kind === "piecewise" && note.includes("bound"));
    assert.deepEqual(d.anchors.map((a) => a.value.measure.value), Object.values(pct));
  }
});

test("a constant is one atom", () => {
  const [, node] = scaffold(hand("demo::units", { p10: 1, p50: 1, p90: 1 }, "bounded"), "demo");
  assert.ok(node.distribution.kind === "point_mass" && node.distribution.atoms[0].value.measure.value === 1);
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "dcjs-"));
  mkdirSync(join(root, "projects")); mkdirSync(join(root, "corpus"));
  for (const f of ["observations.json", "general-knowledge.json", "speculations.json"]) writeFileSync(join(root, "corpus", f), "{}\n");
  return root;
}

test("scaffold then compile round-trips", () => {
  const root = workspace();
  const cov = { projects: [{ id: "demo", nodes: [
    hand("demo::signups", { p01: 40, p10: 200, p50: 1500, p90: 42000, p99: 400000 }),
    hand("demo::conv", { p10: 0.01, p50: 0.03, p90: 0.08 }, "bounded", "Conversion"),
    hand("demo::head", { p01: 0.4, p10: 0.55, p50: 0.82, p90: 0.98, p99: 1 }, "bounded", "Headwind"),
    hand("demo::fee", { p10: 0, p50: 3000, p90: 12000 }, "semi-lo", "Setup fee (USD)"),
    hand("demo::units", { p10: 1, p50: 1, p90: 1 }, "bounded", "Units"),
  ] }] };
  writeFileSync(join(root, "cov.json"), JSON.stringify(cov));
  const env = { ...process.env, FORECASTER_DATA: root };
  const s = spawnSync(process.execPath, [SCAFFOLD, join(root, "cov.json"), "demo", "--write"], { env, encoding: "utf8" });
  assert.equal(s.status, 0, s.stderr);
  const r = spawnSync(process.execPath, [COMPILER, "projects/demo.json", "--write"], { env, cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("0 error(s), 0 warning(s)"));
  const built = JSON.parse(readFileSync(join(root, "build", "demo.compiled.json"), "utf8")).nodes;
  let q = built["demo::signups"].debug_computed_percentiles;
  assert.ok(Math.abs(q.p10 - 200) < 1e-3 && Math.abs(q.p50 - 1500) < 1e-2 && Math.abs(q.p90 - 42000) < 1);
  q = built["demo::conv"].debug_computed_percentiles;
  assert.ok(Math.abs(q.p50 - 0.03) < 1e-6 && q.p95 < 1);
  q = built["demo::fee"].debug_computed_percentiles;
  assert.ok(q.p10 === 0 && Math.abs(q.p50 - 3000) < 1e-6 && Math.abs(q.p95 - 12000 * 4 ** (0.05 / 0.4)) < 1e-3);
});

test("compile rejects an anchor outside the bounds", () => {
  const root = workspace();
  const node = { unit: "fraction 0-1", model_definition: "x", support_score: 10, reasoning: "x",
    distribution: { kind: "metalog", k: 3, lower_bound: 0, upper_bound: 1,
      anchors: [[0.1, 0.5], [0.5, 0.9], [0.9, 1.0]].map(([p, v]) => ({ prob: p, value: { value_type: "inferred_value", measure: { value: v }, reasoning: "x", confidence: 10 } })) } };
  writeFileSync(join(root, "projects", "demo.json"), JSON.stringify({ "demo::x": node }));
  const r = spawnSync(process.execPath, [COMPILER, "projects/demo.json"], { env: { ...process.env, FORECASTER_DATA: root }, cwd: root, encoding: "utf8" });
  assert.ok(r.status === 1 && r.stdout.includes("outside the bounds") && !r.stderr.includes("Error"));
});
