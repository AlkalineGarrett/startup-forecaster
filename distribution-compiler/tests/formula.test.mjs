// The closed formula grammar: arithmetic + min/max/extrapolate_cagr/extrapolate_linear/slope_match
// over ids and structure. Also that it refuses anything outside the grammar.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as F from "../compiler/formula.mjs";
import * as D from "../compiler/distributions.mjs";

const approx = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.abs(b);

test("arithmetic and ids", () => {
  assert.equal(F.evaluate("2 + 3 * 4", {}), 14);
  assert.equal(F.evaluate("(2 + 3) * 4", {}), 20);
  assert.equal(F.evaluate("2 ** 3 - 1", {}), 7);
  const ctx = { ids: { in_a: { value: 10 }, in_b: { value: 3 } } };
  assert.equal(F.evaluate("in_a.value * in_b.value", ctx), 30);
  assert.ok(approx(F.evaluate("in_a.value / in_b.value", ctx), 10 / 3));
});

test("min / max", () => {
  const ctx = { ids: { in_a: { value: 5 }, in_b: { value: 2 } } };
  assert.equal(F.evaluate("min(in_a.value, in_b.value)", ctx), 2);
  assert.equal(F.evaluate("max(in_a.value, in_b.value, 9)", ctx), 9);
});

test("extrapolate_cagr over a {period,value} series", () => {
  const ctx = { ids: { obs_s: { series: [{ period: 2021, value: 78841 }, { period: 2024, value: 236888 }] } } };
  const cagr = (236888 / 78841) ** (1 / 3) - 1;
  assert.ok(approx(F.evaluate("extrapolate_cagr(obs_s.series, 2026)", ctx), 236888 * (1 + cagr) ** 2));
});

test("extrapolate_cagr over [period, value] pairs", () => {
  const ctx = { ids: { obs_s: { series: [[2020, 100], [2022, 144]] } } };   // 20%/yr
  assert.ok(approx(F.evaluate("extrapolate_cagr(obs_s.series, 2023)", ctx), 172.8, 1e-6));
});

test("extrapolate_linear", () => {
  const ctx = { ids: { obs_s: { series: [{ period: 2020, value: 10 }, { period: 2022, value: 20 }] } } };
  assert.ok(approx(F.evaluate("extrapolate_linear(obs_s.series, 2024)", ctx), 30));
});

test("slope_match", () => {
  const sigma = (Math.log(400) - Math.log(20)) / 1.2816;
  const body = D.construct("lognormal", { median: 20, sigma });
  const r = F.evaluate("slope_match(segments[0], splices[0])", { segments: [body], splices: [400], ids: {} });
  // continuity: sigma_gpd = (1 - F(x)) / f(x) at x=400
  assert.ok(approx(r, (1 - body.cdf(400)) / body.pdf(400)));
  assert.ok(approx(r, 532.755, 1e-3));
});

test("nested functions", () => {
  assert.equal(F.evaluate("max(min(in_a.value, 10), sqrt(in_a.value))", { ids: { in_a: { value: 4 } } }), 4);
  assert.ok(approx(F.evaluate("log(exp(2))", {}), 2));
});

test("precedence and errors", () => {
  assert.equal(F.evaluate("-2 ** 2", {}), -4);
  assert.equal(F.evaluate("2 ** -1", {}), 0.5);
  assert.equal(F.evaluate("2 ** 3 ** 2", {}), 512);   // right-associative
  assert.throws(() => F.evaluate("1 / 0", {}), { name: "FormulaError", message: "division by zero" });
  assert.throws(() => F.evaluate("log(0)", {}), { message: "log of a non-positive number" });
  assert.throws(() => F.evaluate("sqrt(-1)", {}), { message: "sqrt of a negative number" });
  assert.throws(() => F.evaluate("in_x.value + 1", { ids: { in_x: { value: null } } }), { message: "+ needs a number, got null" });
  assert.throws(() => F.evaluate("in_x.nope", { ids: { in_x: { value: 1 } } }), { message: "no field .nope" });
  assert.throws(() => F.evaluate("nope.value", {}), { message: "unknown id in formula: nope" });
  assert.throws(() => F.evaluate("3 % 2", {}), { message: "operator % is not in the grammar" });
  assert.throws(() => F.evaluate("1 +", {}), { message: "syntax error: unexpected end of formula" });
});

test("the grammar rejects arbitrary code", () => {
  assert.throws(() => F.evaluate("__import__('os').system('echo hi')", {}));
  assert.throws(() => F.evaluate("open('x')", {}));
});
