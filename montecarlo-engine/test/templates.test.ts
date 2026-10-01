import { test } from "node:test";
import assert from "node:assert/strict";
import { subscriptionCohort, applyModel, type SubscriptionCohortModel } from "../src/templates.ts";
import { HORIZON_MONTHS } from "../src/types.ts";

const base: SubscriptionCohortModel = {
  template: "subscription-cohort",
  customers: ["sam", "penetration"],
  price: ["seats", "price_per_seat"],
  retention: { churn: "churn", ramp: "ramp" },
  annualShare: "annual_share",
  channel: "usB2B",
  lines: { subscription: "Subscription", setup: "Setup fees" },
  cogs: [{ label: "Payment fees", channelFee: 0.03 }, { label: "Hosting", node: "hosting" }],
  opex: [{ label: "Accounting", node: "opex_a" }, { label: "Tooling", node: "opex_b" }],
  tvMultiple: 0,
};
const state = () => ({ sam: 400, penetration: 0.05, seats: 10, price_per_seat: 30, churn: 0.2, ramp: 0.2, annual_share: 0.6,
  hosting: 0.07, opex_a: 3000, opex_b: 1200, setup_fee: 500, launched: 1 } as Record<string, number>);
const run = (m: SubscriptionCohortModel, s = state()) => {
  const w = subscriptionCohort(m);
  const out = new Float64Array(HORIZON_MONTHS);
  const parts = Object.fromEntries(w.revenueLines.map((l) => [l, new Float64Array(HORIZON_MONTHS)]));
  w.sim(s, () => 0.5, out, parts);
  return { w, out, parts, s };
};

test("subscription-cohort: revenue starts at once without lag nodes and grows as customers accumulate", () => {
  const { out } = run(base);
  assert.ok(out[0] > 0 && out[30] > out[1], "active base accumulates");
});

test("subscription-cohort: a failed launch gate earns nothing", () => {
  const s = state(); s.launched = 0;
  const { out } = run({ ...base, gate: "launched" }, s);
  assert.ok(out.every((v) => v === 0));
});

test("subscription-cohort: setup fees are a separate line, folded into the total", () => {
  const { out: subOnly } = run(base);
  const { w, out, parts } = run({ ...base, setupFee: "setup_fee" });
  assert.deepEqual(w.revenueLines, ["Subscription", "Setup fees"]);
  for (let t = 0; t < HORIZON_MONTHS; t++) {
    assert.equal(parts["Subscription"][t], subOnly[t]);
    assert.ok(Math.abs(out[t] - (parts["Subscription"][t] + parts["Setup fees"][t])) < 1e-9);
  }
  assert.ok(parts["Setup fees"][5] > 0);
});

test("subscription-cohort: cost lines, margin and opex derive from the spec", () => {
  const { w, s } = run(base);
  assert.deepEqual(w.cogsLines!.map((c) => c.label), ["Payment fees", "Hosting"]);
  assert.equal(w.margin!(s), 1 - (s._platformRate + 0.07));
  assert.equal(w.cost!(s), 4200);
  assert.equal(w.tvMultiple!(s), 0);
});

test("applyModel fills a data-only unit and never overwrites what the unit sets itself", () => {
  const custom = () => {};
  const unit = applyModel({ id: "x", model: base, sim: custom } as Record<string, unknown> & { model: SubscriptionCohortModel });
  assert.equal(unit.sim, custom);
  assert.ok(typeof (unit as Record<string, unknown>).margin === "function");
  const json = applyModel(JSON.parse(JSON.stringify({ id: "y", model: base })));
  assert.equal(typeof json.sim, "function", "a JSON-parsed project gets a sim from its model");
});
