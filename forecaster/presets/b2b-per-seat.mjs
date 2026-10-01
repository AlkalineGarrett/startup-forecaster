// B2B SaaS sold per seat: customers won from a reachable market, each with several paid seats.
import { lagNodes, retentionNodes, hostingNode, riskNodes } from "./common.mjs";

export const name = "b2b-per-seat";
export const description = "B2B SaaS priced per seat/user: reachable customers × penetration, seats × price per seat, setup fee, support ceiling.";
export const defaults = { channel: "usB2B", cur: "$", fx: 1 };

export function build({ channel }) {
  const nodes = [
    ...lagNodes(),
    { id: "sam", label: "Reachable customers (SAM, count)", kind: "value", unit: "count of organisations", loading: 0.3,
      placeholder: { p10: 200, p50: 1000, p90: 5000 },
      research: "Count of organisations a solo founder can actually reach and sell to in the beachhead (registries, industry associations, census business counts) — not the whole TAM." },
    { id: "penetration_5y", label: "Share of SAM won as paying customers over 5 years", kind: "value", unit: "fraction 0-1", bound: "bounded", loading: 0.6,
      placeholder: { p10: 0.003, p50: 0.02, p90: 0.08 },
      research: "THE crux. Comparable solo/small-vendor market shares, sales-cycle length × founder selling capacity, pilot-to-production rates." },
    { id: "seats_per_customer", label: "Paid seats per customer", kind: "value", unit: "count", loading: 0.2,
      placeholder: { p10: 3, p50: 10, p90: 40 },
      research: "Team sizes of the target buyer (job-posting/headcount data, comparables' plan tiers and included seats)." },
    { id: "price_per_seat_mo", label: "Price per seat ($/mo)", kind: "value", unit: "currency per seat per month", loading: 0.2,
      placeholder: { p10: 10, p50: 30, p90: 80 },
      research: "Competitors' pricing pages (seat tiers); the budget line it replaces." },
    { id: "setup_fee", label: "One-time implementation fee per customer", kind: "value", unit: "currency",
      placeholder: { p10: 200, p50: 1500, p90: 6000 },
      research: "Comparables' onboarding/implementation fees; whether buyers in this segment accept them." },
    ...retentionNodes("Paying customers (logos)"),
    { id: "nrr_expansion", label: "Net revenue retention (annual expansion ×)", kind: "value", unit: "multiplier per year",
      placeholder: { p10: 0.98, p50: 1.05, p90: 1.15 },
      research: "NRR benchmarks for SMB/mid-market SaaS at this price point (seat growth, upsell)." },
    { id: "ceiling_customers", label: "Max customers a solo founder can onboard + support", kind: "value", unit: "count",
      placeholder: { p10: 20, p50: 60, p90: 200 },
      research: "Support/onboarding hours per customer × the founder's available hours; comparable solo SaaS customer counts." },
    hostingNode(),
    { id: "opex_usd_yr", label: "Operating cost — compliance, accounting & tooling ($/yr)", kind: "value", unit: "currency per year",
      placeholder: { p10: 1000, p50: 5000, p90: 20000 },
      research: "Genuine third-party cash only (audits, certifications, accountant, required tooling) — never the founder's own time." },
    ...riskNodes(),
  ];
  const model = {
    template: "subscription-cohort",
    customers: ["sam", "penetration_5y"],
    acquisition: { ramp: 0.25 },
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
    opex: [{ label: "Compliance, accounting & tooling", node: "opex_usd_yr" }],
  };
  const revNote = "Reachable customers × 5-year penetration, acquired on a trust cold-start ramp after the build + readiness lag; per-customer MRR = seats × price per seat; tenure-ramped logo retention; capped at the solo support ceiling; net expansion; a one-time implementation fee per new customer; both lines severed by an arriving competitive/platform shock.";
  return { nodes, model, revNote, type: "B2B SaaS (per seat)" };
}
