// Money across ventures: each venture reports in its own currency; anything combining ventures converts into
// the reporting currency; the thresholds are reporting-currency settings converted per venture. (Own file:
// node --test runs each file in its own process, so the portfolio settings set here can't leak.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { configurePortfolio, toReporting, reportingCurrency, thresholdsFor, withCur, curOf } from "../src/portfolio-context.ts";
import { runUnit, runCombined, supermix } from "../src/simulate.ts";
import { runPortfolio, computePairwise } from "../src/pairwise.ts";
import { curSym, fmt, heatVars, inReporting } from "../src/format.ts";
import type { MonthTraj, Project, RunUnit } from "../src/types.ts";

/** A unit earning exactly `perYear` every year (in its own currency), with no cost of revenue. */
const flat = (id: string, perYear: number, currency?: string): RunUnit => ({
  id, fx: 1, rho: {}, nodes: [], margin: () => 1, ...(currency ? { currency } : {}),
  sim: (_s, _r, out: MonthTraj) => { out.fill(perYear / 12); },
});
const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test("defaults: USD reporting, no rates", () => {
  assert.deepEqual(reportingCurrency(), { code: "USD", symbol: "$" });
  assert.equal(toReporting(flat("a", 1)), 1);
  assert.throws(() => toReporting("EUR"), /no exchange rate for EUR/);
});

test("a venture in a currency with no rate is an error at configure time, naming the venture", () => {
  const p = { id: "gbp-venture", name: "x", currency: "GBP", type: "", one: "", nodes: [], revNote: "", sim: () => {}, margin: () => 1 } as Project;
  assert.throws(() => configurePortfolio({ projects: [p] }), /venture "gbp-venture" is in GBP .* no GBP rate/);
});

test("reporting EUR with a USD rate: per-venture results stay in their own currency", () => {
  configurePortfolio({ reportingCurrency: { code: "EUR", symbol: "€" }, exchangeRates: { USD: 0.5 }, projects: [] });
  assert.equal(curSym(), "€", "fmt defaults to the reporting symbol");
  assert.equal(fmt(2000), "€2k");
  assert.equal(toReporting({ currency: "USD" }), 0.5);
  const usd = runUnit(flat("usd", 10000, "USD"));
  assert.equal(usd.currency, "USD");
  close(usd.p50, 10000, "a USD venture's revenue is reported in USD");
  const eur = runUnit(flat("eur", 10000));
  assert.equal(eur.currency, "EUR", "no currency → the reporting currency");
});

test("thresholds are reporting-currency settings, converted into each venture's currency", () => {
  configurePortfolio({ successThreshold: 6000, decisionFloor: 12000 });
  assert.deepEqual(thresholdsFor({ currency: "USD" }), { successThreshold: 12000, decisionFloor: 24000 });
  const usd = runUnit(flat("usd", 10000, "USD")); // $10k = €5k: below the €6k threshold
  assert.equal(usd.thr, 12000);
  assert.equal(usd.floor, 24000);
  assert.equal(usd.pSucc, 0);
  assert.equal(usd.pFloor, 1);
  const eur = runUnit(flat("eur", 10000)); // €10k: clears €6k, below the €12k floor
  assert.equal(eur.thr, 6000);
  assert.equal(eur.pSucc, 1);
  assert.equal(eur.pFloor, 1);
  configurePortfolio({ referenceP90: 50000 });
  assert.equal(thresholdsFor({ currency: "USD" }).referenceP90, 100000, "referenceP90 converts too");
  assert.equal(thresholdsFor({ currency: "USD", refP90: 7 }).referenceP90, 7, "a project's own refP90 wins");
});

test("runCombined converts mixed currencies into reporting; a same-currency combination stays put", () => {
  const mixed = runCombined([flat("eur", 10000), flat("usd", 10000, "USD")]);
  assert.equal(mixed.currency, "EUR");
  close(mixed.p50, 10000 + 10000 * 0.5, "EUR + USD×rate");
  close(mixed.afterTax50, 15000, "the net converts too");
  const both = runCombined([flat("u1", 10000, "USD"), flat("u2", 10000, "USD")]);
  assert.equal(both.currency, "USD");
  close(both.p50, 20000, "same-currency sum is not converted");
  const forced = runCombined([flat("u1", 10000, "USD")], { currency: "EUR" });
  close(forced.p50, 5000, "an explicit result currency");
  const pooled = supermix([runUnit(flat("eur", 10000)), runUnit(flat("usd", 10000, "USD"))]);
  assert.equal(pooled.currency, "EUR");
  close(pooled.mean, (10000 + 5000) / 2, "a mixed supermix pools in reporting");
});

test("pairwise cells are in the reporting currency", async () => {
  const proj = (id: string, perYear: number, currency?: string): Project => ({
    ...flat(id, perYear, currency), name: id, type: "", one: "", revNote: "",
  }) as unknown as Project;
  configurePortfolio({ projects: [proj("a", 10000), proj("b", 10000, "USD")], pairwiseIds: ["a", "b"], pairAttentionOverhead: 0 });
  const m = await computePairwise(runPortfolio());
  const solo = Object.fromEntries(m.labels.map((l, i) => [l, m.solo[i]]));
  close(solo.b.p50, 5000, "a USD venture's solo cell is converted");
  close(m.res[1][0]!.p50, 15000, "the pair sums in reporting");
});

test("a render scope sets the venture's symbol and its rate into reporting", () => {
  assert.equal(curOf("USD"), "$");
  assert.equal(curOf(undefined), "€", "no currency → the reporting symbol");
  const inUsd = withCur({ currency: "USD" }, () => ({ sym: curSym(), s: fmt(2000), rep: inReporting(2000), heat: heatVars(120000) }));
  assert.deepEqual(inUsd, { sym: "$", s: "$2k", rep: 1000, heat: heatVars(60000) }, "colours sit on the reporting scale");
  assert.equal(curSym(), "€", "the scope is restored");
  assert.equal(inReporting(2000), 2000);
});
