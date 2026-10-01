import { test } from "node:test";
import assert from "node:assert/strict";
import { survival, integrateSubscription, flatAfterLag, logistic, timeToEvent, applyEventFrom, demandMultiplier } from "../src/cohort.ts";
import { realise, npvOf, runRate60, expansionFor } from "../src/accounting.ts";
import { PERSONAL_AFTER_TAX, BUSINESS_TAX, configurePortfolio } from "../src/portfolio-context.ts";
import { mulberry32 } from "../src/rng.ts";

test("declining hazard retains ~12x more of the cohort by year 4 than a flat rate (§8)", () => {
  const flat = survival([0.28, 0.28, 0.28, 0.28, 0.28]);
  const declining = survival([0.3, 0.54, 0.63, 0.71, 0.71]);
  const ratio = declining[48] / flat[48];
  assert.ok(ratio > 9 && ratio < 15, `year-4 retention ratio ≈ 12×, got ${ratio.toFixed(1)}`);
  assert.ok(flat[0] === 1 && declining[0] === 1, "just-acquired survival is 1");
});

test("demandMultiplier: identity at the reference price", () => {
  // at the category reference price the estimate is unchanged (=1); this is what keeps the additive
  // variants' headline untouched and anchors the clinician headline re-baseline.
  for (const ref of [4, 7.4, 40]) {
    assert.strictEqual(demandMultiplier(ref, ref, 0.4, ref * 2.2), 1, `overlay not identity at ref=${ref}`);
  }
});

test("demandMultiplier: revenue(price) is single-peaked (a real optimum exists)", () => {
  // conversion multiplier × price, inelastic (eps 0.4) + a WTP ceiling: revenue rises, peaks once,
  // then collapses — not monotone (the whole reason price can be an output).
  const ref = 40, eps = 0.4, wtp = 92;   // clinician-scale
  const grid = Array.from({ length: 60 }, (_, i) => 5 + i * 3);
  const rev = grid.map((p) => p * demandMultiplier(p, ref, eps, wtp));
  let peaks = 0;
  for (let i = 1; i < rev.length - 1; i++) if (rev[i] > rev[i - 1] && rev[i] >= rev[i + 1]) peaks++;
  assert.strictEqual(peaks, 1, `revenue(price) should have exactly one interior peak, got ${peaks}`);
  const argmax = grid[rev.indexOf(Math.max(...rev))];
  assert.ok(argmax > ref && argmax < wtp, `optimum should sit between ref and the WTP ceiling, got ${argmax.toFixed(1)}`);
});

test("integrateSubscription: zero before lag, positive after, capped by the ceiling", () => {
  const out = new Float64Array(60);
  const S = survival([0.5, 0.6, 0.7, 0.7, 0.7]);
  integrateSubscription(out, 100, 6, 10, S, 300); // 100 acq/mo, lag 6, €10/mo, ceiling 300 active
  assert.strictEqual(out[0], 0, "nothing before lag");
  assert.strictEqual(out[5], 0, "still nothing at month 5");
  assert.ok(out[7] > 0, "revenue after lag");
  const peakActive = Math.max(...Array.from(out)) / 10;
  assert.ok(peakActive <= 300 + 1e-6, `active base capped at ceiling, got ${peakActive.toFixed(0)}`);
});

test("flatAfterLag pays a constant monthly revenue after the lag (jobs)", () => {
  const out = new Float64Array(60);
  flatAfterLag(out, 4, 5000);
  assert.strictEqual(out[3], 0);
  assert.strictEqual(out[4], 5000);
  assert.strictEqual(out[59], 5000);
});

test("logistic value transfer is ~0 below the midpoint and ~1 well above", () => {
  assert.ok(logistic(0.1, 0.5, 12) < 0.02, "sub-threshold ≈ 0");
  assert.ok(logistic(0.9, 0.5, 12) > 0.98, "well above ≈ 1");
  assert.ok(Math.abs(logistic(0.5, 0.5, 12) - 0.5) < 1e-9, "midpoint = 0.5");
});

test("timeToEvent respects the hazard; applyEventFrom damages forward only", () => {
  assert.strictEqual(timeToEvent(0, mulberry32(1)), 60, "zero hazard never arrives in window");
  const out = new Float64Array(60).fill(100);
  applyEventFrom(out, 24, 0.4);
  assert.strictEqual(out[23], 100, "before the event untouched");
  assert.ok(Math.abs(out[24] - 40) < 1e-9, "severity applied from the event month");
});

test("accounting: realisation, NPV < undiscounted, expansion gating", () => {
  assert.ok(realise("euConsumerVAT", 10) < realise("usStripe", 10), "EU consumer collects less than US Stripe");
  assert.ok(realise("usStripe", 5) < realise("usStripe", 50), "fixed fees hurt small tickets more");
  const flat = new Float64Array(60).fill(1000);
  assert.ok(npvOf(flat) < 60000 && npvOf(flat) > 0, "discounting reduces the sum");
  assert.ok(Math.abs(runRate60(flat) - 12000) < 1e-6, "run-rate = 12 × steady monthly");
  assert.strictEqual(expansionFor(10), 1.0);
  assert.ok(expansionFor(200) > 1);
});

test("tax model: default is no-tax; configurePortfolio injects a jurisdiction", () => {
  // Unconfigured, the engine assumes no jurisdiction: personal after-tax is identity, business tax 0.
  assert.strictEqual(PERSONAL_AFTER_TAX(50000), 50000, "default personal = no tax");
  assert.strictEqual(BUSINESS_TAX, 0, "default business tax = 0");
  // A portfolio supplies its own schedule + rate (live bindings update).
  configurePortfolio({ personalAfterTax: (g) => g * 0.6, businessTax: 0.25 });
  assert.strictEqual(PERSONAL_AFTER_TAX(50000), 30000, "injected personal schedule applies");
  assert.strictEqual(BUSINESS_TAX, 0.25, "injected business rate applies");
});
