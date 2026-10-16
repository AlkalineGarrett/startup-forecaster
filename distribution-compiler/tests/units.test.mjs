// Units: the bounded-fraction check (a unit that says "fraction 0-1" must keep its percentiles in
// [0, 1]) and scaffold's reading of a label's trailing unit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Diag, FRACTION_UNIT, compileNode } from "../compiler/compile.mjs";
import { UNITISH, unitOf } from "../compiler/scaffold.mjs";

const NO_CORPUS = new Map();   // an empty corpus index (refs.mjs corpusIndex)
const v = (x) => ({ value_type: "inferred_value", measure: { value: x }, reasoning: "test", confidence: 10 });
/** A normal node whose upper percentiles pass 1. */
const node = (unit) => ({ unit, model_definition: "a share", support_score: 10, reasoning: "test",
  distribution: { kind: "normal", mean: v(0.9), sd: v(0.2) } });
const errors = (unit) => {
  const diag = new Diag("demo::share");
  compileNode(node(unit), NO_CORPUS, diag);
  return diag.filter(([sev]) => sev === "error").map(([, , path, msg]) => `${path}: ${msg}`);
};

test("a fraction unit bounds the percentiles to [0, 1], however it is written", () => {
  for (const unit of ["fraction 0-1", "Fraction 0-1 (share of churn)", "fraction (0-1)", "fraction 0–1", "share converting (fraction 0-1), higher is better"]) {
    assert.ok(FRACTION_UNIT.test(unit), unit);
    assert.ok(errors(unit).some((e) => e.includes("out of [0,1]")), unit);
  }
});

test("other units are not bounded", () => {
  for (const unit of ["count", "fraction of churn", "USD 0-100", "fraction 0-10"]) {
    assert.ok(!FRACTION_UNIT.test(unit), unit);
    assert.deepEqual(errors(unit), [], unit);
  }
});

const hand = (label, key = "demo::price") => ({ key, node: key.split("::").pop(), label, bound: "semi-lo" });

test("scaffold reads a currency unit in any common symbol or ISO code", () => {
  for (const [label, unit] of [
    ["Seat price (USD/mo)", "USD/mo"], ["Seat price (€/mo)", "€/mo"], ["Plan price (¥ per month)", "¥ per month"],
    ["Plan price (₹/yr)", "₹/yr"], ["Plan price (₩)", "₩"], ["Plan price (₽ per seat)", "₽ per seat"],
    ["Plan price (JPY per seat)", "JPY per seat"], ["Plan price (in BRL)", "in BRL"], ["Fee (CHF)", "CHF"],
  ]) assert.equal(unitOf(hand(label)), unit, label);
});

test("a parenthetical gloss is not a unit", () => {
  for (const label of ["Signups (agentic coding)", "Adoption (try it free)", "Churn (euro-area plans)"]) {
    assert.equal(unitOf(hand(label)), "level (see model_definition)", label);
  }
  assert.ok(!UNITISH.test("try") && UNITISH.test("TRY") && !UNITISH.test("eurozone"));
});
