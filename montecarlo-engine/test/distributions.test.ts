import { test } from "node:test";
import assert from "node:assert/strict";
import { construct } from "../src/distributions.ts";
import { buildMarginal, qAt } from "../src/metalog.ts";

const anchors = (ps: [number, number][]) => ps.map(([prob, value]) => ({ prob, value }));

test("compiled metalog with lower+upper bound stays in range and hits its anchors", () => {
  const a = anchors([[0.1, 0.05], [0.5, 0.3], [0.9, 0.8]]);
  const d = construct({ kind: "metalog", anchors: a, k: 3, lower_bound: 0, upper_bound: 1 });
  for (const { prob, value } of a) assert.ok(Math.abs(d.ppf(prob) - value) < 1e-9, `p${prob * 100} → ${d.ppf(prob)}`);
  assert.ok(d.ppf(1e-6) > 0 && d.ppf(1 - 1e-6) < 1, "bounded tails stay inside (0,1)");
  assert.deepEqual(d.support, [0, 1]);
});

test("compiled metalog with only an upper bound", () => {
  const a = anchors([[0.1, 2], [0.5, 7], [0.9, 9.5]]);
  const d = construct({ kind: "metalog", anchors: a, k: 3, upper_bound: 10 });
  for (const { prob, value } of a) assert.ok(Math.abs(d.ppf(prob) - value) < 1e-9);
  assert.ok(d.ppf(1 - 1e-6) < 10);
});

test("a compiled exact-fit metalog samples like the hand-authored path through the same quantiles", () => {
  // Scaffolded nodes rely on this: k = n anchors, lower bound 0 ≡ buildMarginal(…, "semi-lo", 0).
  const pts: [number, number][] = [[0.01, 40], [0.1, 200], [0.5, 1500], [0.9, 42000], [0.99, 400000]];
  const d = construct({ kind: "metalog", anchors: anchors(pts), k: 5, lower_bound: 0 });
  const m = buildMarginal(pts.map(([y, x]) => ({ y, x })), "semi-lo", 0);
  for (const u of [0.02, 0.2, 0.5, 0.7, 0.95]) {
    const a = d.ppf(u), b = qAt(m, u);
    assert.ok(Math.abs(a - b) / b < 1e-6, `u=${u}: compiled ${a} vs hand ${b}`);
  }
});

test("piecewise reproduces the hand path's empirical fallback exactly (incl. a zero anchor)", () => {
  // p10 = 0 makes the hand path's bounded/semi-lo metalog infeasible → it interpolates empirically.
  const pts: [number, number][] = [[0.1, 0], [0.5, 3000], [0.9, 12000]];
  const d = construct({ kind: "piecewise", anchors: anchors(pts) });
  const m = buildMarginal(pts.map(([y, x]) => ({ y, x })), "semi-lo", 0);
  assert.strictEqual(m.kind, "empirical");
  for (const u of [1e-6, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99]) assert.strictEqual(d.ppf(u), Math.max(0, qAt(m, u)), `u=${u}`);
});
