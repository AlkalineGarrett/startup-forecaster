// A short horizon: everything sized from horizonYears, including ramp.ts cumF. (Own file: process-global setting.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { configurePortfolio } from "../src/portfolio-context.ts";
import { HORIZON_MONTHS, HORIZON_YEARS, headlineSpan, modelYears } from "../src/types.ts";
import { cumF } from "../src/ramp.ts";
import { runUnit, runCombined } from "../src/simulate.ts";
import { survival } from "../src/cohort.ts";
import type { MonthTraj, RunUnit } from "../src/types.ts";

test("horizonYears 3: cumF and every output sized to 3 years", () => {
  configurePortfolio({ horizonYears: 3, headlineFromYear: 2 });
  assert.equal(HORIZON_YEARS, 3);
  assert.equal(HORIZON_MONTHS, 36);
  assert.deepEqual(modelYears(), [1, 2, 3]);
  assert.equal(headlineSpan(), "years 2–3");
  assert.equal(cumF(1), 3, "three full years");
  assert.ok(Math.abs(cumF(3) - 2) < 1e-12, "1/3 + 2/3 + 1");
  assert.equal(survival([0.5]).length, 36);
  let len = 0;
  const unit: RunUnit = { id: "u", fx: 1, rho: {}, nodes: [], margin: () => 1, cost: () => 120,
    sim: (_s, _r, out: MonthTraj) => { len = out.length; for (let t = 0; t < out.length; t++) out[t] = Math.floor(t / 12) + 1; } };
  const r = runUnit(unit);
  assert.equal(len, 36, "the sim writes a 36-month trajectory");
  assert.equal(r.p50, 12 * (2 + 3) / 2, "headline = average of years 2–3");
  for (const k of ["yearRevenue", "yearNet", "costStat", "yearCogs", "yearTax"] as const) assert.equal(r[k]!.length, 3, `${k} has 3 years`);
  assert.equal(r.sYearRev!.length, 3);
  assert.equal(runCombined([unit, unit]).yearRevenue!.length, 3);
  assert.equal(r.yearRevenue![2].p50, 36);
});
