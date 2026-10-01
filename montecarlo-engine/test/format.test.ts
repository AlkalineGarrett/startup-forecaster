import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, fmtShort, esc, confClass, confLabel, setCurrency, curSym, setMoneyBands, moneyBands, heatVars } from "../src/format.ts";

test("the engine's default currency is neutral; a portfolio sets its own", () => {
  assert.strictEqual(curSym(), "$");
  assert.strictEqual(fmt(1200), "$1k");
});

test("fmt rounds to the nearest whole thousand, always in k", () => {
  setCurrency("€");
  assert.strictEqual(fmt(0), "€0");
  assert.strictEqual(fmt(400), "€0"); // rounds below 500 → plain €0
  assert.strictEqual(fmt(600), "€1k");
  assert.strictEqual(fmt(120000), "€120k");
  assert.strictEqual(fmt(235400), "€235k");
  assert.strictEqual(fmt(2500000), "€2,500k"); // everything in k (no M)
  assert.strictEqual(fmt(-2627), "−€3k");
  assert.strictEqual(fmt(50).indexOf("€"), 0);
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
