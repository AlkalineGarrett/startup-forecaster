// B2B SaaS sold per seat: customers won from a reachable market, each with several paid seats.
import { lagNodes, retentionNodes, hostingNode, riskNodes, opexNodes, COLD_START_RAMP } from "./common.mjs";

export const name = "b2b-per-seat";
export const description = "B2B SaaS priced per seat/user: reachable customers × penetration, seats × price per seat, setup fee, support ceiling.";
/** The channel `new` falls back to when neither --channel nor the venture's profile entry names one. */
export const defaults = { channel: "usB2B" };

export function build({ channel, paidTeam = false }) {
  const opex = opexNodes({ paidTeam });
  const nodes = [
    ...lagNodes(),
    { id: "sam", label: "Reachable customers (SAM, count)", kind: "value", unit: "count of organisations", loading: 0.3,
      placeholder: { p10: 300, p50: 1000, p90: 3500 },
      research: "Count of organisations the people selling it can actually reach and sell to in the beachhead (registries, industry associations, census business counts) — not the whole TAM." },
    { id: "penetration", label: "Share of SAM won as paying customers over the horizon", kind: "value", unit: "fraction 0-1", bound: "bounded", loading: 0.6,
      placeholder: { p10: 0.003, p50: 0.02, p90: 0.08 },
      research: "THE crux. Comparable small-vendor market shares, sales-cycle length × the selling capacity of the people doing it, pilot-to-production rates." },
    { id: "seats_per_customer", label: "Paid seats per customer", kind: "value", unit: "count", loading: 0.2,
      placeholder: { p10: 3, p50: 8, p90: 25 },
      research: "Team sizes of the target buyer (job-posting/headcount data, comparables' plan tiers and included seats)." },
    { id: "price_per_seat_mo", label: "Price per seat ({cur}/mo)", kind: "value", unit: "currency per seat per month", loading: 0.2,
      placeholder: { p10: 10, p50: 30, p90: 80 },
      research: "Competitors' pricing pages (seat tiers); the budget line it replaces. A price the person has decided is their answer, not research." },
    { id: "setup_fee", label: "One-time implementation fee per customer ({cur})", kind: "value", unit: "currency",
      placeholder: { p10: 200, p50: 1500, p90: 6000 },
      research: "Comparables' onboarding/implementation fees; whether buyers in this segment accept them." },
    ...retentionNodes("Paying customers (logos)"),
    { id: "nrr_expansion", label: "Net revenue retention (annual expansion ×)", kind: "value", unit: "multiplier per year",
      placeholder: { p10: 0.98, p50: 1.05, p90: 1.15 },
      research: "NRR benchmarks for SMB/mid-market SaaS at this price point (seat growth, upsell)." },
    { id: "ceiling_customers", label: "Max customers the people doing it can onboard + support", kind: "value", unit: "count",
      placeholder: { p10: 20, p50: 60, p90: 200 },
      research: "Support capacity of the people doing it: support/onboarding hours per customer × their available hours (profile: founder hours per week, team); comparable small-SaaS customer counts." },
    hostingNode(),
    ...opex.nodes,
    ...riskNodes(),
  ];
  const model = {
    template: "subscription-cohort",
    customers: ["sam", "penetration"],
    acquisition: { ramp: COLD_START_RAMP.b2b },
    price: ["seats_per_customer", "price_per_seat_mo"],
    retention: { churn: "annual_churn", ramp: "retention_ramp" },
    annualShare: "annual_share",
    channel,
    ceiling: "ceiling_customers",
    expansion: "nrr_expansion",
    setupFee: "setup_fee",
    events: [{ hazard: "risk_hazard", severity: "risk_severity" }],
    lines: { subscription: "Subscription (per-seat SaaS)", setup: "Implementation fees" },
    cogs: [
      { label: "Platform & payment fees", channelFee: 0.03 },
      { label: "Hosting & infrastructure", node: "cogs_hosting_rate" },
    ],
    opex: opex.lines,
  };
  const revNote = "Reachable customers × penetration over the horizon, acquired on a trust cold-start ramp after the build + readiness lag; per-customer MRR = seats × price per seat; tenure-ramped logo retention; capped at the support capacity of the people doing it; net expansion; a one-time implementation fee per new customer; both lines severed by an arriving competitive/platform shock.";
  const judgements = [`Acquisition cold-start ramp ${COLD_START_RAMP.b2b} (the first post-lag month's acquisition rate as a fraction of the average): a judgement, set in the model's \`acquisition.ramp\`.`];
  return { nodes, model, revNote, judgements, type: "B2B SaaS (per seat)" };
}
