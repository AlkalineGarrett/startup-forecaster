// FICTIONAL fixture portfolio for the renderer's portability tests. Not a model of anything.
// Reporting in EUR; "Beta" is a USD venture (converted at 0.5 wherever ventures combine). Three-year horizon,
// a flat 21% business tax, and a node marked hidden that must never reach the UI.
import type { Project, ProjectNode, ScenarioState, MonthTraj } from "../../../../montecarlo-engine/src/types.ts";
import { configurePortfolio } from "../../../../montecarlo-engine/src/portfolio-context.ts";

const val = (id: string, label: string, pctiles: Record<string, number>, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id, label, kind: "value", conf: "low", basis: "fixture value", urls: [], pctiles, ...extra,
});
const flatSim = (s: ScenarioState, _r: () => number, out: MonthTraj): void => {
  for (let t = 0; t < out.length; t++) out[t] = (s.monthly * (1 + t / out.length)) * s.secret_knob;
};

export const alpha: Project = {
  id: "alpha", name: "Alpha Euro", type: "Fixture business", one: "Fixture.",
  nodes: [
    val("monthly", "Monthly revenue", { p10: 2000, p50: 6000, p90: 15000 }),
    val("secret_knob", "Secret knob", { p10: 0.8, p50: 1, p90: 1.2 }, { hidden: true }),
  ],
  revNote: "Fixture.", sim: flatSim, margin: () => 0.9, cost: () => 6000,
};

export const beta: Project = {
  id: "beta", name: "Beta Dollar", type: "Fixture business", one: "Fixture.",
  nodes: [
    val("monthly", "Monthly revenue", { p10: 3000, p50: 9000, p90: 25000 }),
    val("secret_knob", "Secret knob", { p10: 0.8, p50: 1, p90: 1.2 }, { hidden: true }),
  ],
  revNote: "Fixture.", sim: flatSim, margin: () => 0.85,
  variants: [
    {
      id: "lean", name: "Lean", revNote: "Fixture.", rho: {},
      nodes: [
        val("monthly", "Monthly revenue", { p10: 1000, p50: 4000, p90: 10000 }),
        val("secret_knob", "Secret knob", { p10: 0.8, p50: 1, p90: 1.2 }, { hidden: true }),
      ],
      sim: flatSim, margin: () => 0.85,
    },
  ],
};

configurePortfolio({
  title: "Portable fixture",
  horizonYears: 3, headlineFromYear: 2,
  reportingCurrency: { code: "EUR", symbol: "€" },
  exchangeRates: { USD: 0.5 },
  successThreshold: 4000, decisionFloor: 10000,
  businessTax: 0.21,
  projects: [alpha, beta],
  ventures: { beta: { currency: "USD" } }, // as a workspace's profile passes it; alpha has no entry (reporting)
  pairwiseIds: ["alpha", "beta"],
});
