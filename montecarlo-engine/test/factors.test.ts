import { test } from "node:test";
import assert from "node:assert/strict";
import { idioCoef, latentU, localFactorNames, rhoToLoadings, F_EXEC, F_MACRO } from "../src/factors.ts";
import { haltonPoint, globalFactors } from "../src/qmc.ts";
import { mulberry32, rnorm } from "../src/rng.ts";

test("idioCoef = sqrt(1 - sum lambda^2), clamped", () => {
  assert.ok(Math.abs(idioCoef({ a: 0.6 }) - 0.8) < 1e-12);
  assert.strictEqual(idioCoef({ a: 1, b: 1 }), 0, "over-specified loadings clamp to 0");
  assert.strictEqual(idioCoef({}), 1);
});

test("shared factor loading induces positive correlation between two nodes", () => {
  const r = mulberry32(42);
  const L = { [F_MACRO]: 0.8 };
  const icA = idioCoef(L);
  const icB = idioCoef(L);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  const nN = 4000;
  for (let i = 0; i < nN; i++) {
    const z = { [F_MACRO]: rnorm(r) };
    const ua = latentU(L, icA, z, rnorm(r));
    const ub = latentU(L, icB, z, rnorm(r));
    sx += ua; sy += ub; sxy += ua * ub; sxx += ua * ua; syy += ub * ub;
  }
  const cov = sxy / nN - (sx / nN) * (sy / nN);
  const corr = cov / Math.sqrt((sxx / nN - (sx / nN) ** 2) * (syy / nN - (sy / nN) ** 2));
  assert.ok(corr > 0.5, `strong shared loading → high correlation, got ${corr.toFixed(2)}`);
});

test("localFactorNames excludes globals; rhoToLoadings maps onto exec", () => {
  assert.deepStrictEqual(rhoToLoadings(0.4), { [F_EXEC]: 0.4 });
  assert.deepStrictEqual(rhoToLoadings(0), {});
  const names = localFactorNames([{ [F_MACRO]: 0.5, chan_warm: 0.7 }, { [F_EXEC]: 0.3 }]);
  assert.ok(names.includes("chan_warm") && names.includes(F_EXEC) && !names.includes(F_MACRO));
});

test("scrambled Halton is well-distributed and globalFactors is reproducible", () => {
  const shift = [0.11, 0.37];
  let m = 0;
  const nN = 2000;
  for (let i = 0; i < nN; i++) m += haltonPoint(i, 2, shift)[0];
  assert.ok(Math.abs(m / nN - 0.5) < 0.02, "1st dim mean ≈ 0.5");
  const g1 = globalFactors(7, shift);
  const g2 = globalFactors(7, shift);
  assert.deepStrictEqual(g1, g2, "same index+shift → same factors (CRN reproducible)");
  assert.ok(isFinite(g1[F_MACRO]) && isFinite(g1.ai_demand));
});
