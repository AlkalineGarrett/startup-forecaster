import { test } from "node:test";
import assert from "node:assert/strict";
import { runUnit, N } from "../src/simulate.ts";
import { survival, integrateSubscription } from "../src/cohort.ts";
import { realise } from "../src/accounting.ts";
import { F_EXEC, F_MACRO } from "../src/factors.ts";
import type { ProjectNode, RunUnit, ScenarioState, Rng, MonthTraj } from "../src/types.ts";

const node = (id: string, pctiles: Record<string, number>, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id, label: id, kind: "value", conf: "med", basis: "", urls: [], pctiles, ...extra,
});

// A synthetic subscription SaaS exercised through the real engine.
function saasUnit(): RunUnit {
  const nodes: ProjectNode[] = [
    node("signups", { p10: 5000, p50: 20000, p90: 80000 }, { loadings: { [F_MACRO]: 0.3, [F_EXEC]: 0.5 } }),
    node("conv", { p10: 0.02, p50: 0.05, p90: 0.12 }, { _frac: true, loadings: { [F_EXEC]: 0.4 } }),
    node("arpu", { p10: 15, p50: 30, p90: 60 }, { loadings: { [F_EXEC]: 0.2 } }),
    node("ret1", { p10: 0.35, p50: 0.55, p90: 0.75 }, { _frac: true }),
    node("code_months", { p10: 1, p50: 2, p90: 4 }),
    node("readiness_months", { p10: 6, p50: 12, p90: 24 }),
  ];
  return {
    id: "saas", fx: 1, nodes, rho: {}, margin: () => 0.8,
    sim(s: ScenarioState, _r: Rng, out: MonthTraj) {
      const lag = (s.code_months || 0) + (s.readiness_months || 0);
      const payingAcqPerMo = (s.signups * s.conv) / Math.max(1, 60 - lag);
      const ret1 = s.ret1;
      const S = survival([ret1, Math.min(0.95, ret1 * 1.6), Math.min(0.95, ret1 * 1.9), 0.9, 0.9]);
      const price = s.arpu * realise("usStripe", s.arpu);
      integrateSubscription(out, payingAcqPerMo, lag, price, S);
    },
  };
}

test("engine end-to-end: ordered, finite, non-negative distribution", () => {
  const r = runUnit(saasUnit());
  assert.strictEqual(r.samples.length, N);
  assert.ok(r.p20 <= r.p50 && r.p50 <= r.p80 && r.p80 <= r.p95, "percentiles ordered");
  for (const v of [r.p50, r.mean, r.terminalValue, r.npv, r.afterTax50]) assert.ok(isFinite(v) && v >= 0, `finite ≥ 0: ${v}`);
  assert.ok(r.pSucc >= 0 && r.pSucc <= 1 && r.pFloor >= 0 && r.pFloor <= 1, "probabilities in [0,1]");
});

test("engine is deterministic (same seed → identical outputs)", () => {
  assert.strictEqual(runUnit(saasUnit()).p50, runUnit(saasUnit()).p50);
});

test("new decision outputs behave sensibly", () => {
  const r = runUnit(saasUnit());
  assert.ok(r.afterTax50 < r.p50, "after-tax below gross");
  assert.ok(r.terminalValue > 0, "business terminal value positive");
  assert.ok(Math.abs(r.lagBuild - 2.3) < 1.5, `build lag ≈ mean code_months, got ${r.lagBuild.toFixed(1)}`);
  assert.ok(r.lagInstitutional > r.lagBuild, "institutional lag dominates the schedule");
});

test("stock/flow fix: churned cohort earns far less than stock × price × 12", () => {
  const r = runUnit(saasUnit());
  // Naive (wrong) upper bound: median signups × median conv × median arpu × 12.
  const naive = 20000 * 0.05 * 30 * 12; // = 360k/yr
  assert.ok(r.p50 < naive * 0.6, `cohort median (${Math.round(r.p50)}) well below the naive stock figure (${naive})`);
});
