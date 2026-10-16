import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, fmtShort, esc, confClass, confLabel, setCurrency, curSym, setMoneyBands, moneyBands, heatVars } from "../src/format.ts";

test("the engine's default currency is neutral; a portfolio sets its own", () => {
  assert.strictEqual(curSym(), "$");
  assert.strictEqual(fmt(1200), "$1k");
});

test("fmt scales the unit to the number: whole units, k, M", () => {
  setCurrency("€");
  assert.strictEqual(fmt(0), "€0");
  assert.strictEqual(fmt(0.3), "€0");
  assert.strictEqual(fmt(-0.2), "€0", "rounds to zero → no sign");
  assert.strictEqual(fmt(400), "€400", "small values are not shown as 0");
  assert.strictEqual(fmt(999.4), "€999");
  assert.strictEqual(fmt(999.6), "€1k");
  assert.strictEqual(fmt(1200), "€1k");
  assert.strictEqual(fmt(120000), "€120k");
  assert.strictEqual(fmt(235400), "€235k");
  assert.strictEqual(fmt(999_700), "€1M");
  assert.strictEqual(fmt(2500000), "€2.5M");
  assert.strictEqual(fmt(12_340_000), "€12.3M");
  assert.strictEqual(fmt(250_000_000), "€250M");
  assert.strictEqual(fmt(1_250_000_000), "€1,250M", "Intl grouping");
  assert.strictEqual(fmt(-2627), "−€3k");
  assert.strictEqual(fmt(1200, "$"), "$1k", "an explicit symbol wins");
  setCurrency("$");
});

test("money colour bands are configurable and validated", () => {
  const before = heatVars(75000);
  setMoneyBands([500000, 1000000, 2000000]);
  assert.deepEqual(moneyBands(), [500000, 1000000, 2000000]);
  assert.notStrictEqual(heatVars(75000), before, "75k sits lower on a larger scale");
  assert.throws(() => setMoneyBands([3, 2, 1] as [number, number, number]));
  setMoneyBands([50000, 100000, 200000]);
  assert.strictEqual(heatVars(75000), before);
});

test("fmtShort renders bare magnitudes and small fractions", () => {
  assert.strictEqual(fmtShort(30), "30");
  assert.strictEqual(fmtShort(1200), "1.2k");
  assert.strictEqual(fmtShort(15000), "15k");
  assert.strictEqual(fmtShort(2_500_000), "2.5M");
  assert.strictEqual(fmtShort(0.025), "0.025");
});

test("esc neutralises HTML metacharacters", () => {
  assert.strictEqual(esc("a & b < c > d"), "a &amp; b &lt; c &gt; d");
});

test("confClass / confLabel map free text to levels", () => {
  assert.strictEqual(confClass("high"), "high");
  assert.strictEqual(confClass("med"), "med");
  assert.strictEqual(confClass("low"), "low");
  assert.strictEqual(confClass("anything else"), "low");
  assert.strictEqual(confLabel("low"), "low conf / prior");
});
