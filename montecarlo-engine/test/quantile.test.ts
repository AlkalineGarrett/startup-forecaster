import { test } from "node:test";
import assert from "node:assert/strict";
import { ptsOf, interpLog, quant, frac, nodeAxis } from "../src/quantile.ts";
import type { ProjectNode } from "../src/types.ts";

const valueNode = (): ProjectNode => ({
  id: "v", label: "v", kind: "value", conf: "med", basis: "", urls: [],
  pctiles: { p10: 100, p50: 1000, p90: 10000 },
});

test("ptsOf builds sorted [prob,value] points and honours an override curve", () => {
  const pts = ptsOf(valueNode());
  assert.deepStrictEqual(pts, [[0.1, 100], [0.5, 1000], [0.9, 10000]]);
  const override = ptsOf(valueNode(), { p50: 5 });
  assert.deepStrictEqual(override, [[0.5, 5]]);
});

test("interpLog is log-linear between positive endpoints", () => {
  // geometric midpoint of 100 and 10000 is 1000
  assert.ok(Math.abs(interpLog([0, 100], [1, 10000], 0.5) - 1000) < 1e-6);
  // linear when an endpoint is non-positive
  assert.strictEqual(interpLog([0, 0], [1, 10], 0.5), 5);
});

test("quant is monotonic non-decreasing across u", () => {
  const P = ptsOf(valueNode());
  let prev = -Infinity;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const v = quant(P, u);
    assert.ok(v >= prev - 1e-9, `not monotonic at u=${u}`);
    prev = v;
  }
  assert.strictEqual(quant([], 0.5), 0, "empty → 0");
  assert.strictEqual(quant([[0.5, 42]], 0.9), 42, "single point → that value");
});

test("frac clamps fractions to [1e-4, 0.995] and others to >= 0", () => {
  const fracNode: ProjectNode = { id: "f", label: "", kind: "value", conf: "", basis: "", urls: [], _frac: true };
  assert.strictEqual(frac(fracNode, 2), 0.995);
  assert.strictEqual(frac(fracNode, -1), 1e-4);
  assert.strictEqual(frac(fracNode, 0.3), 0.3);
  const plain: ProjectNode = { id: "p", label: "", kind: "value", conf: "", basis: "", urls: [] };
  assert.strictEqual(frac(plain, -5), 0);
  assert.strictEqual(frac(plain, 12345), 12345);
});

test("nodeAxis maps position<->value consistently, monotonically, and clamped", () => {
  const ax = nodeAxis(valueNode()); // p10:100, p50:1000, p90:10000 → log axis
  for (const t of [0.1, 0.5, 0.9]) {
    assert.ok(Math.abs(ax.toT(ax.toValue(t)) - t) < 1e-9, `round-trip at t=${t}`);
  }
  assert.ok(ax.toValue(0.2) < ax.toValue(0.8), "higher position → higher value");
  assert.ok(ax.toT(1e-12) >= 0 && ax.toT(1e12) <= 1, "positions clamp to [0,1]");
});
