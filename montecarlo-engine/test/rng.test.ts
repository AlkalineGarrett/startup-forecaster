import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, rnorm, erf, phi } from "../src/rng.ts";

test("mulberry32 is deterministic and in [0,1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.strictEqual(x, b(), "same seed must produce the same stream");
    assert.ok(x >= 0 && x < 1, "output must be in [0,1)");
  }
  assert.notStrictEqual(mulberry32(1)(), mulberry32(2)(), "different seeds differ");
});

test("rnorm returns finite draws", () => {
  const r = mulberry32(7);
  let sum = 0;
  const K = 5000;
  for (let i = 0; i < K; i++) {
    const z = rnorm(r);
    assert.ok(Number.isFinite(z));
    sum += z;
  }
  assert.ok(Math.abs(sum / K) < 0.1, "sample mean should be near 0");
});

test("erf and phi hit known reference points", () => {
  assert.ok(Math.abs(erf(0)) < 1e-6, "erf(0) ≈ 0 (approximation)");
  assert.ok(Math.abs(erf(1) - 0.8427) < 1e-3);
  assert.ok(Math.abs(erf(-1) + 0.8427) < 1e-3, "erf is odd");
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 2e-3);
  assert.ok(phi(-5) >= 0 && phi(5) <= 1);
});
