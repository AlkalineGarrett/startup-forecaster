import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarginal, qAt } from "../src/metalog.ts";

const at = (ps: [number, number][]) => ps.map(([y, x]) => ({ y, x }));

test("metalog recovers the quantiles it was fit to (semi-lo counts)", () => {
  const qs = at([[0.01, 90], [0.1, 350], [0.5, 3000], [0.9, 50000], [0.99, 380000]]);
  const m = buildMarginal(qs, "semi-lo", 0);
  assert.strictEqual(m.kind, "metalog", "well-ordered quantiles should fit a feasible metalog");
  for (const { y, x } of qs) {
    const got = qAt(m, y);
    assert.ok(Math.abs(got - x) / x < 0.02, `Q(${y}) ≈ ${x}, got ${got}`);
  }
});

test("metalog quantile function is monotone increasing", () => {
  const m = buildMarginal(at([[0.1, 750], [0.5, 1300], [0.9, 3000]]), "semi-lo", 0);
  let prev = -Infinity;
  for (let u = 0.001; u < 1; u += 0.01) {
    const v = qAt(m, u);
    assert.ok(v >= prev - 1e-6, `monotone at u=${u}`);
    prev = v;
  }
});

test("bounded (0,1) fractions stay strictly inside the bounds", () => {
  const m = buildMarginal(at([[0.1, 0.03], [0.5, 0.11], [0.9, 0.28]]), "bounded", 0, 1);
  for (let u = 0.001; u < 1; u += 0.02) {
    const v = qAt(m, u);
    assert.ok(v > 0 && v < 1, `fraction in (0,1) at u=${u}, got ${v}`);
  }
  assert.ok(Math.abs(qAt(m, 0.5) - 0.11) < 0.01, "median honoured");
});

test("semi-lo values stay above the lower bound", () => {
  const m = buildMarginal(at([[0.1, 1], [0.5, 3], [0.9, 6]]), "semi-lo", 0);
  for (let u = 0.001; u < 1; u += 0.05) assert.ok(qAt(m, u) > 0, `> 0 at u=${u}`);
});

test("falls back to empirical interpolation when metalog would be infeasible", () => {
  // Two points can't feasibly fit >2-term shapes; a single point is degenerate.
  const one = buildMarginal(at([[0.5, 42]]), "semi-lo", 0);
  assert.strictEqual(one.kind, "empirical");
  assert.strictEqual(qAt(one, 0.9), 42);
});
