// A consumer app with a free tier: free sign-ups × paid conversion become paying subscribers.
import { lagNodes, retentionNodes, hostingNode, teamCostNode, COLD_START_RAMP } from "./common.mjs";

export const name = "consumer-freemium";
export const description = "Consumer app or tool with a free tier; sign-ups convert to a paid subscription (app store or web).";
/** The channel `new` falls back to when neither --channel nor the venture's profile entry names one. */
export const defaults = { channel: "appStoreSBP" };

export function build({ channel, paidTeam = false }) {
  // A consumer app carries no fixed operating cost by default; a paid team adds its payroll line.
  const team = paidTeam ? teamCostNode() : null;
  const nodes = [
    ...lagNodes(),
    { id: "launch", label: "Ships and reaches its acquisition channel", kind: "gate", unit: "probability", bound: "bounded",
      placeholder: { p10: 0.55, p50: 0.8, p90: 0.95 },
      research: "Probability the product ships and clears its gate to users (store review, platform policy, a working acquisition channel). Base rates for small-team launches of this kind." },
    { id: "signups", label: "Free sign-ups over the horizon (count)", kind: "value", unit: "count (cumulative over the horizon)", loading: 0.6,
      placeholder: { p10: 1000, p50: 5000, p90: 18000 },
      research: "THE crux. Reachable audience × realistic capture for a small launch: comparable apps' download/sign-up counts, community sizes, channel reach (search volume, subreddit sizes). Right-skewed; the low tail is 'never finds its audience'." },
    { id: "free_to_paid", label: "Share of free users who pay", kind: "value", unit: "fraction 0-1", bound: "bounded", loading: 0.4,
      placeholder: { p10: 0.005, p50: 0.025, p90: 0.07 },
      research: "Freemium conversion benchmarks for the category (RevenueCat State of Subscription Apps, ChartMogul), adjusted for how much value sits behind the paywall." },
    { id: "price_mo", label: "Revenue per paying user ({cur}/mo, list)", kind: "value", unit: "currency per month", loading: 0.2,
      placeholder: { p10: 3, p50: 7, p90: 15 },
      research: "Comparables' pricing pages (blend monthly/annual to an effective monthly price); willingness-to-pay evidence from user reviews and forums. A price the person has decided is their answer, not research." },
    ...retentionNodes("Paying subscribers"),
    hostingNode(),
    ...(team ? [team.node] : []),
  ];
  const model = {
    template: "subscription-cohort",
    gate: "launch",
    customers: ["signups", "free_to_paid"],
    acquisition: { ramp: COLD_START_RAMP.consumer },
    price: ["price_mo"],
    retention: { churn: "annual_churn", ramp: "retention_ramp" },
    annualShare: "annual_share",
    channel,
    lines: { subscription: "Subscriptions" },
    cogs: [
      { label: "Platform & payment fees", channelFee: 0.15 },
      { label: "Hosting & infrastructure", node: "cogs_hosting_rate" },
    ],
    ...(team ? { opex: [team.line] } : {}),
  };
  const revNote = "Free sign-ups × paid conversion become paying subscribers, acquired on a cold-start ramp after the build + readiness lag, retained under a tenure-ramped churn curve (plan-mix blended), each paying the monthly price; gated on the launch. Platform/payment fees and hosting are cost of revenue." +
    (team ? " The team's payroll is an operating cost from the start." : "");
  const judgements = [`Acquisition cold-start ramp ${COLD_START_RAMP.consumer} (the first post-lag month's acquisition rate as a fraction of the average): a judgement, set in the model's \`acquisition.ramp\`.`];
  return { nodes, model, revNote, judgements, type: "Consumer subscription (freemium)" };
}
