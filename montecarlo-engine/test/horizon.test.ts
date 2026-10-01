// A portfolio can model a longer runway: the horizon and the headline window are configuration, not
// constants. (Own file: node --test runs each file in its own process, so the global setting can't leak.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { configurePortfolio } from "../src/portfolio-context.ts";
import { HORIZON_MONTHS, HORIZON_YEARS, headlineSpan } from "../src/types.ts";
import { runUnit } from "../src/simulate.ts";
import type { MonthTraj, ScenarioState } from "../src/types.ts";

test("a 10-year horizon with a years-3–10 headline", () => {
  configurePortfolio({ horizonYears: 10, headlineFromYear: 3 });
  assert.equal(HORIZON_MONTHS, 120);
  assert.equal(HORIZON_YEARS, 10);
  assert.equal(headlineSpan(), "years 3–10");
  // Revenue of 1 per month in year k (k = 1..10): the headline averages years 3–10 → 12 × (3+…+10)/8 = 78.
  const sim = (_s: ScenarioState, _r: unknown, out: MonthTraj) => { for (let t = 0; t < out.length; t++) out[t] = Math.floor(t / 12) + 1; };
  const r = runUnit({ id: "flat", fx: 1, rho: {}, sim, nodes: [{ id: "x", label: "x", kind: "value", conf: "low", pctiles: { p10: 1, p50: 2, p90: 3 } }] } as never);
  assert.equal(r.p50, 78);
  assert.equal(r.yearRevenue!.length, 10);
  assert.equal(r.yearRevenue![9].p50, 120);
  assert.throws(() => configurePortfolio({ horizonYears: 4, headlineFromYear: 5 }), /headlineFromYear/);
});
