// Portfolio settings with neutral defaults: payment channels, cost timing, shared factors, tax, unit defaults.
// (Own file: the settings are process-global, and node --test runs each file in its own process.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { configurePortfolio, taxDescription, pairAttentionOverhead, GLOBAL_FACTORS } from "../src/portfolio-context.ts";
import { realise, channelSpec, npvOf } from "../src/accounting.ts";
import { runUnit, runCombined } from "../src/simulate.ts";
import { applyModel } from "../src/templates.ts";
import type { MonthTraj, ProjectNode, RunUnit, ScenarioState } from "../src/types.ts";

const close = (a: number, b: number, msg: string, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const fixed = (id: string, v: number): ProjectNode => ({ id, label: id, kind: "value", conf: "low", pctiles: { p10: v * 0.999, p50: v, p90: v * 1.001 } });
const flat = (id: string, perYear: number, extra: Partial<RunUnit> = {}): RunUnit => ({
  id, fx: 1, rho: {}, nodes: [], margin: () => 1,
  sim: (_s, _r, out: MonthTraj) => { out.fill(perYear / 12); }, ...extra,
});

test("neutral defaults", () => {
  assert.equal(pairAttentionOverhead(), 0);
  assert.deepEqual(GLOBAL_FACTORS, ["macro"]);
  assert.equal(taxDescription(), "no tax configured");
  const flat1 = new Float64Array(12).fill(1000);
  close(npvOf(flat1), [...Array(12)].reduce((a, _x, t) => a + 1000 / Math.pow(1.1, (t + 1) / 12), 0), "discount rate defaults to 10%");
});

test("an unknown payment channel throws, listing the valid names; a workspace can add channels", () => {
  assert.throws(() => realise("nope", 10), /unknown payment channel "nope" — one of: .*usStripe/);
  const model = { template: "subscription-cohort" as const, customers: [10], price: [5], retention: { retention: "r" }, annualShare: 0, channel: "nope", lines: { subscription: "S" } };
  assert.throws(() => applyModel({ model }), /unknown payment channel "nope"/, "a template's channel is checked when it is resolved");
  configurePortfolio({ channels: { myPsp: { realisation: 0.9, fixedFee: 0 } } });
  assert.equal(realise("myPsp", 10), 0.9);
  assert.equal(channelSpec("usStripe").fixedFee, 0.7, "built-ins keep their values");
  assert.throws(() => configurePortfolio({ channels: { bad: { realisation: 2, fixedFee: 0 } } }), /channels\.bad/);
});

test("costsStart: 'start' charges from month 0, 'readiness' from code_months, 'launch' after readiness too", () => {
  const unit = flat("c", 0, { nodes: [fixed("code_months", 18), fixed("readiness_months", 12)], cost: () => 1200 });
  const yr = () => runUnit(unit).costStat!.map((y) => y.p50);
  const start = yr();
  close(start[0], 1200, "start: year 1 pays the full cost", 1e-3);
  configurePortfolio({ costsStart: "readiness" });
  const ready = yr();
  close(ready[0], 0, "readiness: nothing during the build", 1e-3);
  close(ready[1], 600, "readiness: half of year 2 (from month 18)", 2e-3);
  close(ready[2], 1200, "readiness: full from year 3", 1e-3);
  configurePortfolio({ costsStart: "launch" });
  const launch = yr();
  close(launch[1], 0, "launch: nothing before month 30", 1e-3);
  close(launch[2], 600, "launch: half of year 3", 2e-3);
  // A cost line's own `from` overrides the portfolio setting.
  const lines = runUnit({ ...unit, cost: () => 1200, costLines: [{ label: "Salaries", amount: () => 1000, from: "start" }, { label: "Audit", amount: () => 200 }] });
  close(lines.costStat![0].p50, 1000, "only the 'start' line runs in year 1", 1e-3);
  close(lines.statementLines!.opcost![1].stat[2].p50, 100, "the other follows costsStart (launch: half of year 3)", 2e-3);
  assert.throws(() => configurePortfolio({ costsStart: "never" as never }), /costsStart/);
  configurePortfolio({ costsStart: "start" });
});

test("a custom globalFactors list couples two projects through a shared factor", () => {
  const seen: Record<string, number[]> = { a: [], b: [] };
  const unit = (id: string): RunUnit => ({
    id, fx: 1, rho: {}, margin: () => 1,
    nodes: [{ ...fixed("x", 0), pctiles: { p10: 1, p50: 2, p90: 4 }, loadings: { shared: 0.9 } }],
    sim: (s: ScenarioState, _r, out: MonthTraj) => { seen[id].push(s.x); out.fill(s.x); },
  });
  const corr = (): number => {
    seen.a = []; seen.b = [];
    runCombined([unit("a"), unit("b")]); // one simulation: the two units' draws come from one stream
    const a = seen.a, b = seen.b, n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  };
  assert.ok(Math.abs(corr()) < 0.2, "by default 'shared' is project-local: the two draw it independently");
  configurePortfolio({ globalFactors: ["macro", "shared"] });
  assert.ok(corr() > 0.6, "listed as global, it is drawn once per iteration for both");
  assert.throws(() => configurePortfolio({ globalFactors: Array.from({ length: 12 }, (_, i) => `f${i}`) }), /1\.\.11/);
  assert.throws(() => configurePortfolio({ globalFactors: ["macro", "macro"] }), /distinct/);
  configurePortfolio({ globalFactors: ["macro"] });
});

test("a business unit's own afterTax is honoured; runCombined keeps each unit's own", () => {
  configurePortfolio({ businessTax: 0.2 });
  const hooked = flat("hooked", 10000, { afterTax: (rev, _gp, _s, opcost) => rev * 0.5 - opcost });
  const plain = flat("plain", 10000);
  close(runUnit(hooked).afterTax50, 5000, "the unit's hook, not the 20% rate");
  close(runUnit(plain).afterTax50, 8000, "no hook → the business rate");
  close(runCombined([hooked, plain]).afterTax50, 5000 + 8000, "combined net = the sum of each unit's own net");
  configurePortfolio({ businessAfterTax: (pretax) => pretax - 1000, taxNote: "flat 1000 levy" });
  close(runUnit(plain).afterTax50, 9000, "a business schedule wins over the rate");
  close(runUnit(hooked).afterTax50, 5000, "the unit's hook still wins");
  assert.equal(taxDescription(), "flat 1000 levy");
});

test("a business unit with no margin needs a default; defaults also set the terminal multiple", () => {
  const bare = flat("bare", 10000, { margin: undefined });
  assert.throws(() => runUnit(bare), /unit "bare": no gross margin/);
  assert.equal(runUnit(flat("income", 10000, { margin: undefined, personal: true })).grossMargin, 1, "an income track needs none");
  assert.equal(runUnit(flat("tv", 10000)).terminalValue, 0, "no multiple → no terminal value");
  configurePortfolio({ defaults: { margin: 0.8, tvMultiple: 3 } });
  const r = runUnit(bare);
  close(r.grossMargin, 0.8, "the default margin applies");
  close(r.terminalValue, 30000, "the default multiple applies", 1e-3);
});

test("an income track respects a margin when one is given", () => {
  configurePortfolio({ personalAfterTax: (g) => g });
  close(runUnit(flat("job", 10000, { personal: true, margin: undefined })).afterTax50, 10000, "no cost of revenue by default");
  close(runUnit(flat("freelance", 10000, { personal: true, margin: () => 0.9 })).afterTax50, 9000, "its margin is the cost of revenue");
});

test("per-venture settings set a project's currency and price currency; its symbol and fx derive from them", () => {
  const proj = { id: "app", name: "App", nodes: [], margin: 0.8, sim: () => ({}), variants: [{ id: "v", nodes: [], rho: {}, sim: () => ({}) }] } as any;
  const own = { id: "own", name: "Own", nodes: [], margin: 0.8, sim: () => ({}) } as any;
  configurePortfolio({ reportingCurrency: { code: "EUR", symbol: "€" }, exchangeRates: { USD: 0.8 },
    projects: [proj, own], ventures: { app: { currency: "EUR", priceCurrency: "USD" } } });
  assert.equal(proj.currency, "EUR");
  assert.equal(proj.priceCurrency, "USD");
  assert.equal(proj.cur, "€");
  assert.equal(proj.fx, 0.8, "USD prices into a EUR venture: the profile's rate");
  assert.equal(proj.variants[0].fx, 0.8, "a variant takes its project's currencies");
  assert.equal(own.cur, "€", "no profile entry: the reporting currency");
  assert.equal(own.fx, 1);
  const usd = { id: "usd", name: "Usd", nodes: [], margin: 0.8, sim: () => ({}) } as any;
  configurePortfolio({ projects: [usd], ventures: { usd: { currency: "USD" } } });
  assert.equal(usd.cur, "$");
  assert.equal(usd.fx, 1, "prices in the venture's own currency");
  const gbp = { id: "gbp", name: "Gbp", nodes: [], margin: 0.8, sim: () => ({}) } as any;
  assert.throws(() => configurePortfolio({ projects: [gbp], ventures: { gbp: { priceCurrency: "GBP" } } }), /venture "gbp" prices in GBP .* no GBP rate/);
});
