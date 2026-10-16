// ─────────────────────────────────────────────────────────────────────────────────────────────
// EXAMPLE PORTFOLIO — entirely fictional. Not a real venture, not real research, not advice.
//
// This is the reference portfolio the public montecarlo-engine ships with: a made-up "habit tracker"
// business with two revenue lines, authored against the same public API the real models use
// (Project + the cohort/accounting helpers), and attached to the engine via configurePortfolio().
// It exists to (a) document the authoring contract and (b) give the engine's own tests a portfolio
// to run — every number here is invented to exercise the machinery, not to model anything real.
//
// It uses AUTHORED percentiles (no compiled distribution data), so the sampler takes its metalog
// fallback path. Fraction nodes carry an explicit `bound: "bounded"` so they stay in [0,1].
//
// It runs on the engine's neutral defaults: USD reporting, no tax, costs from month 0, one shared factor
// ("macro"), no pairwise attention haircut. A real workspace sets its own in configurePortfolio.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import type { Project, ProjectNode, Correlations } from "../src/types.ts";
import { configurePortfolio } from "../src/portfolio-context.ts";

// Small authoring helpers to keep the node list readable (fictional data — no sources/provenance).
const val = (id: string, label: string, pctiles: Record<string, number>, frac = false): ProjectNode => ({
  id, label, kind: "value", conf: "low", basis: "fictional example value", urls: [], pctiles,
  ...(frac ? { bound: "bounded" as const } : {}),
});
const gate = (id: string, label: string, pctiles: Record<string, number>): ProjectNode => ({
  id, label, kind: "gate", conf: "low", basis: "fictional example gate", urls: [], pctiles,
});

// ── Project 1: a consumer freemium subscription (habit-tracking app) ────────────────────────────
export const habit_tracker: Project = {
  id: "habit-tracker", name: "Habit Tracker", type: "Consumer subscription (example)",
  one: "Fictional freemium habit-tracking app: free tier funnels into a paid subscription. Example data only.",
  // The revenue model is DATA: the subscription-cohort template (src/templates.ts) reads these node ids.
  model: {
    template: "subscription-cohort",
    gate: "public_launch",
    customers: ["signups", "free_to_paid"],          // paying subscribers won over the window
    price: ["arpu_usd_mo"],
    retention: { churn: "annual_churn", factors: [1.2, 1.35, 1.45, 1.5] },
    annualShare: "annual_share",
    channel: "appStoreSBP",
    lines: { subscription: "Subscription" },
    cogs: [{ label: "App-store & payment fees", channelFee: 0.15 }],
    tvMultiple: "tv_multiple",
  },
  nodes: [
    gate("public_launch", "Ships and reaches the store's discovery surface", { p10: 0.6, p50: 0.82, p90: 0.95 }),
    val("signups", "Free sign-ups over 5 years", { p10: 2000, p50: 20000, p90: 150000 }),
    val("free_to_paid", "Share of free users who pay", { p10: 0.02, p50: 0.05, p90: 0.1 }, true),
    val("arpu_usd_mo", "Revenue per payer ($/mo)", { p10: 3, p50: 5, p90: 9 }),
    val("annual_churn", "Paying subscribers lost per year", { p10: 0.4, p50: 0.6, p90: 0.8 }, true),
    val("annual_share", "Share of payers on annual plans", { p10: 0.2, p50: 0.45, p90: 0.75 }, true),
    { ...val("tv_multiple", "Terminal-value run-rate multiple", { p10: 1.5, p50: 2.5, p90: 4 }), hidden: true },
  ],
  revNote: "Example: free sign-ups × paid-conversion become a monthly paying-acquisition rate spread over the "
    + "model horizon, retained under a churn-derived survival curve, each payer earning the monthly ARPU net of "
    + "app-store realisation. Revenue is gated on the launch milestone. Fictional data.",
};

// ── Project 2: a B2B "teams" line (workplace-wellness seats) ─────────────────────────────────────
export const habit_teams: Project = {
  id: "habit-teams", name: "Habit Teams", type: "B2B seats (example)",
  one: "Fictional workplace-wellness version sold per seat to employers. Example data only.",
  model: {
    template: "subscription-cohort",
    gate: "first_customer",
    customers: ["teams_signed", "seats_per_team"],   // paid seats won over the window
    price: ["price_per_seat_mo"],
    retention: { churn: "annual_churn", factors: [1.1, 1.15, 1.2, 1.2] },
    annualShare: 1,                                   // annual contracts
    channel: "usB2B",
    lines: { subscription: "Seats" },
    cogs: [{ label: "Payment & invoicing fees", channelFee: 0.05 }],
    tvMultiple: "tv_multiple",
  },
  nodes: [
    gate("first_customer", "Lands a first paying employer", { p10: 0.35, p50: 0.6, p90: 0.85 }),
    val("teams_signed", "Employers signed over 5 years", { p10: 3, p50: 15, p90: 60 }),
    val("seats_per_team", "Paid seats per employer", { p10: 10, p50: 40, p90: 150 }),
    val("price_per_seat_mo", "Price per seat ($/mo)", { p10: 2, p50: 4, p90: 8 }),
    val("annual_churn", "Seats lost per year", { p10: 0.1, p50: 0.2, p90: 0.4 }, true),
    { ...val("tv_multiple", "Terminal-value run-rate multiple", { p10: 2, p50: 3.5, p90: 6 }), hidden: true },
  ],
  revNote: "Example: employers × seats-per-employer become paid seats, acquired over the window and retained "
    + "under a churn-derived survival curve at the monthly seat price net of B2B realisation. Gated on the first "
    + "paying customer. Fictional data.",
};

// ── The example portfolio, attached to the engine ───────────────────────────────────────────────
export const EXAMPLE_PROJECTS: Project[] = [habit_tracker, habit_teams];

// Scalar execution-luck loadings (each on the project's own execution factor): a good/lucky run lifts reach
// and conversion.
export const EXAMPLE_RHO: Correlations = {
  "habit-tracker": { signups: 0.4, free_to_paid: 0.3, public_launch: 0.2 },
  "habit-teams": { teams_signed: 0.4, first_customer: 0.3 },
};

configurePortfolio({
  projects: EXAMPLE_PROJECTS,
  rho: EXAMPLE_RHO,
  pairwiseIds: ["habit-tracker", "habit-teams"],
  title: "Habit Tracker — Monte-Carlo (example)",
});
