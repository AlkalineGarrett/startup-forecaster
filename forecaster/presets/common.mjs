// Building blocks shared by the presets. A node spec is everything the scaffolder needs to declare the
// node in the model, seed its placeholder distribution, and brief the researcher:
//   { id, label, kind: "value"|"gate", unit, bound?: "bounded" (a fraction in [0,1]), loading?: number
//     (on the shared execution factor), placeholder: { p10, p50, p90 }, research: "what grounds it" }
//
// PLACEHOLDERS ARE NOT FINDINGS. They are deliberately wide, generic priors that let a new venture's model
// run end to end on day one. Every one is recorded as a `…_placeholder` speculation (support 5) and
// `forecaster status` reports it as unresearched until a researched distribution replaces it.

export const lagNodes = () => [
  { id: "code_months", label: "Months to build the software (agentic coding)", kind: "value", unit: "months", loading: -0.2,
    placeholder: { p10: 1, p50: 3, p90: 8 },
    research: "The founder's own measured build velocity on comparable scope (past projects, sprint history), scaled to this product's software scope. Not industry averages." },
  { id: "readiness_months", label: "Months to real-world readiness (compliance · trust · content · distribution)", kind: "value", unit: "months", loading: -0.25,
    placeholder: { p10: 1, p50: 4, p90: 12 },
    research: "What gates first revenue beyond code: certifications or audits, store/marketplace review, content to author, a first reference customer. Find each gate's documented duration." },
];

export const retentionNodes = (who) => [
  { id: "annual_churn", label: `${who} lost per year`, kind: "value", unit: "fraction 0-1 per year", bound: "bounded", loading: -0.3,
    placeholder: { p10: 0.15, p50: 0.4, p90: 0.7 },
    research: "Annual churn for this category and price point: subscription benchmarks (RevenueCat, ChartMogul, Recurly) or a direct comparable's disclosures. Logo churn for B2B." },
  { id: "retention_ramp", label: "Tenure retention ramp (per-year uplift)", kind: "value", unit: "multiplier per year", bound: "bounded",
    placeholder: { p10: 0.05, p50: 0.2, p90: 0.45 },
    research: "How much renewal improves with tenure (cohort retention curves flattening after year 1). Benchmarks' year-2+ vs year-1 retention." },
  { id: "annual_share", label: "Plan mix — share on annual plans/contracts", kind: "value", unit: "fraction 0-1", bound: "bounded",
    placeholder: { p10: 0.15, p50: 0.4, p90: 0.75 },
    research: "Share of paying customers on annual vs monthly billing for comparable products (benchmarks; comparables' pricing pages showing annual discounts)." },
];

export const hostingNode = (what = "hosting & infrastructure") => ({
  id: "cogs_hosting_rate", label: `Cost of revenue — ${what} (share of revenue)`, kind: "value", unit: "fraction of revenue", bound: "bounded",
  placeholder: { p10: 0.02, p50: 0.06, p90: 0.15 },
  research: "Hosting / inference / third-party API cost per customer ÷ price. Vendor pricing pages (cloud, LLM, SMS, maps…) × expected usage.",
});

export const riskNodes = () => [
  { id: "risk_hazard", label: "Annual chance a competitor or platform closes the wedge", kind: "value", unit: "probability per year", bound: "bounded",
    placeholder: { p10: 0.03, p50: 0.1, p90: 0.25 },
    research: "How often incumbents/platforms have shipped the same feature or changed terms in this space (dated precedents)." },
  { id: "risk_severity", label: "Revenue retained after that shock", kind: "value", unit: "fraction 0-1", bound: "bounded",
    placeholder: { p10: 0.3, p50: 0.6, p90: 0.85 },
    research: "What happened to comparable products after such an event (revenue/usage retained)." },
];
