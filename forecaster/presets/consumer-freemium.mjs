// A consumer app with a free tier: free sign-ups × paid conversion become paying subscribers.
import { lagNodes, retentionNodes, hostingNode } from "./common.mjs";

export const name = "consumer-freemium";
export const description = "Consumer app or tool with a free tier; sign-ups convert to a paid subscription (app store or web).";
export const defaults = { channel: "appStoreSBP", cur: "$", fx: 1 };

export function build({ channel }) {
  const nodes = [
    ...lagNodes(),
    { id: "launch", label: "Ships and reaches its acquisition channel", kind: "gate", unit: "probability", bound: "bounded",
      placeholder: { p10: 0.55, p50: 0.8, p90: 0.95 },
      research: "Probability the product ships and clears its gate to users (store review, platform policy, a working acquisition channel). Base rates for solo launches of this kind." },
    { id: "signups", label: "Free sign-ups over 5 years (count)", kind: "value", unit: "count (cumulative, 5 years)", loading: 0.6,
      placeholder: { p10: 300, p50: 5000, p90: 80000 },
      research: "THE crux. Reachable audience × realistic capture for a solo launch: comparable apps' download/sign-up counts, community sizes, channel reach (search volume, subreddit sizes). Heavy right skew; the low tail is 'never finds its audience'." },
    { id: "free_to_paid", label: "Share of free users who pay", kind: "value", unit: "fraction 0-1", bound: "bounded", loading: 0.4,
      placeholder: { p10: 0.005, p50: 0.025, p90: 0.07 },
      research: "Freemium conversion benchmarks for the category (RevenueCat State of Subscription Apps, ChartMogul), adjusted for how much value sits behind the paywall." },
    { id: "price_mo", label: "Revenue per paying user ($/mo, list)", kind: "value", unit: "currency per month", loading: 0.2,
      placeholder: { p10: 3, p50: 7, p90: 15 },
      research: "Comparables' pricing pages (blend monthly/annual to an effective monthly price); willingness-to-pay evidence from user reviews and forums." },
    ...retentionNodes("Paying subscribers"),
    hostingNode(),
  ];
  const model = {
    template: "subscription-cohort",
    gate: "launch",
    customers: ["signups", "free_to_paid"],
    acquisition: { ramp: 0.3 },
    price: ["price_mo"],
    retention: { churn: "annual_churn", ramp: "retention_ramp" },
    annualShare: "annual_share",
    channel,
    lines: { subscription: "Subscriptions" },
    cogs: [
      { label: "Platform & payment fees", channelFee: 0.15 },
      { label: "Hosting & infrastructure", node: "cogs_hosting_rate" },
    ],
  };
  const revNote = "Free sign-ups × paid conversion become paying subscribers, acquired on a cold-start ramp after the build + readiness lag, retained under a tenure-ramped churn curve (plan-mix blended), each paying the monthly price; gated on the launch. Platform/payment fees and hosting are cost of revenue.";
  return { nodes, model, revNote, type: "Consumer subscription (freemium)" };
}
