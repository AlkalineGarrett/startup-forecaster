// Business-model TEMPLATES: a venture's revenue model as DATA, not code.
//
// A project (or variant) can declare `model: { template: "…", …node ids… }` instead of writing a `sim()`.
// configurePortfolio() resolves it into the unit's sim + revenue/cost lines + margin + operating cost +
// terminal-value multiple. Every number still comes from the unit's nodes (by id); the template is only the
// mechanics. A unit whose mechanics no template covers keeps a hand-written `sim()` — the fallback.
//
// Templates:
//   "subscription-cohort" — customers won over the horizon (a product of nodes, or a per-selling-year pace ×
//     the post-lag window, capped at a market size) acquired after a build lag
//     (evenly, or on a cold-start ramp), retained under a tenure-ramped survival curve (from churn or
//     retention; plan-mix blended; optional dunning recovery of failed payments), each paying a monthly
//     price (a product of nodes) — optionally capped at a ceiling, grown by net expansion, plus a one-time
//     setup fee per new customer, and severed by arriving risk events. Gated on an optional launch gate.
import type { CostLine, MonthTraj, Rng, ScenarioState } from "./types.ts";
// HORIZON_MONTHS by its own name, not aliased: the flat bundler drops imports, and a module-local alias
// would resolve to a later module's binding (TDZ while the portfolio is being configured).
import { HORIZON_MONTHS } from "./types.ts";
import { integrateSubscription, rampedAcq, planMixSurvival, dunningAdjust, timeToEvent, applyEventFrom } from "./cohort.ts";
import { realiseMix, channelSpec } from "./accounting.ts";

/** A model input: a node id, a constant, or a node with a default when the node is absent. */
export type Factor = string | number | { node: string; default: number };

/** A cost-of-revenue line: the realisation channel's fee, a rate node, or a capped cost÷price ratio. */
export type CogsSpec =
  | { label: string; channelFee: number }                       // rate = the channel's billed→collected take (fallback before the sim runs)
  | { label: string; node: string }                             // rate = a node (share of revenue)
  | { label: string; ratio: { cost: string; per: string; cap: number; fallback: number; stash: string } };

/** Customers as a pace: `perYear` customers won per selling year, over the post-lag window, capped at `cap`. */
export interface CustomerPace { perYear: Factor[]; cap?: Factor }

export interface SubscriptionCohortModel {
  template: "subscription-cohort";
  /** Gate node: when it fails the unit earns nothing. */
  gate?: string;
  /** Lag nodes summed before the first customer (default code_months + readiness_months; absent → 0). */
  lag?: string[];
  /** Customers won over the horizon = the product of these; or, as `{ perYear, cap }`, a pace per
   *  selling year (the product of `perYear`) × the post-lag selling window (horizon − lag, in years), capped
   *  at `cap` (e.g. the market size), so the lag's uncertainty reaches the customer count. */
  customers: Factor[] | CustomerPace;
  /** Acquisition timing: `ramp` = the first post-lag month's rate as a fraction of the average (cold start); omitted = even. */
  acquisition?: { ramp?: number };
  /** Monthly price per customer = the product of these (billed gross). */
  price: Factor[];
  retention: {
    churn?: string;                 // year-1 renewal = 1 − churn …
    retention?: string;             // … or = retention
    ramp?: string;                  // tenure ramp node: year k renewal = min(cap, y1 × (1 + steps[k] × ramp))
    steps?: number[];               // default [1, 2, 2.4, 2.7]
    factors?: number[];             // instead of a ramp node: year k renewal = min(cap, y1 × factors[k])
    cap?: number;                   // default 0.97
    dunning?: { involuntary: string; recovery: string };
  };
  /** Share of customers on annual plans (node or constant). */
  annualShare: Factor;
  /** Payment channel (accounting.ts built-ins, or configurePortfolio({ channels })) — sets the platform-fee rate
   *  the channelFee cost line reports. An unknown channel is an error at configure time. */
  channel: string;
  ceiling?: string;
  expansion?: string;
  /** One-time setup fee per new customer (capped at the ceiling's monthly share), a second revenue line. */
  setupFee?: string;
  /** Arriving risks: each an annual hazard + the share of revenue retained after it lands. */
  events?: { hazard: string; severity: string }[];
  lines: { subscription: string; setup?: string };
  cogs?: CogsSpec[];
  /** Fixed operating costs (annual amounts); `from` overrides the portfolio's costsStart for that line. */
  opex?: { label: string; node: string; from?: "start" | "readiness" | "launch" }[];
  tvMultiple?: Factor;
}

export type ModelSpec = SubscriptionCohortModel;

/** What a template contributes to a unit (the fields a hand-written project would set). */
export interface ModelWiring {
  sim: (s: ScenarioState, r: Rng, out: MonthTraj, parts?: Record<string, MonthTraj>) => void;
  revenueLines: string[];
  cogsLines?: { label: string; rate: (s: ScenarioState) => number }[];
  costLines?: CostLine[];
  margin?: (s: ScenarioState) => number;
  cost?: (s: ScenarioState) => number;
  tvMultiple?: (s: ScenarioState) => number;
}

const tmplValue = (s: ScenarioState, f: Factor): number =>
  typeof f === "number" ? f : typeof f === "string" ? s[f] : (s[f.node] ?? f.default);
const tmplProduct = (s: ScenarioState, fs: Factor[]): number => fs.reduce((acc, f, i) => (i === 0 ? tmplValue(s, f) : acc * tmplValue(s, f)), 0);
/** Customers won: a product of factors, or a per-year pace × the post-lag selling window (years), capped. */
export const tmplCustomers = (s: ScenarioState, c: Factor[] | CustomerPace, lag: number, horizon: number): number => {
  if (Array.isArray(c)) return tmplProduct(s, c);
  const won = tmplProduct(s, c.perYear) * Math.max(0, horizon - lag) / 12;
  return c.cap != null ? Math.min(won, tmplValue(s, c.cap)) : won;
};

function tmplCogsRate(c: CogsSpec): (s: ScenarioState) => number {
  if ("channelFee" in c) return (s) => s._platformRate ?? c.channelFee;
  if ("node" in c) return (s) => s[c.node];
  return (s) => s[c.ratio.stash] ?? c.ratio.fallback;
}

/** The subscription-cohort template (see the header). */
export function subscriptionCohort(m: SubscriptionCohortModel): ModelWiring {
  channelSpec(m.channel); // throws on an unknown channel, listing the valid ones
  const lagNodes = m.lag ?? ["code_months", "readiness_months"];
  const steps = m.retention.steps ?? [1, 2, 2.4, 2.7];
  const cap = m.retention.cap ?? 0.97;
  const ratios = (m.cogs || []).flatMap((c) => ("ratio" in c ? [c.ratio] : []));
  const setupBuf = new Float64Array(HORIZON_MONTHS);

  const sim = (s: ScenarioState, r: Rng, out: MonthTraj, parts?: Record<string, MonthTraj>): void => {
    if (m.gate && !s[m.gate]) {
      out.fill(0);
      if (parts?.[m.lines.subscription]) parts[m.lines.subscription].fill(0);
      if (m.lines.setup && parts?.[m.lines.setup]) parts[m.lines.setup].fill(0);
      return;
    }
    const lag = lagNodes.reduce((a, id) => a + (s[id] || 0), 0);
    const acqMonths = Math.max(1, out.length - lag);
    const customers = tmplCustomers(s, m.customers, lag, out.length);
    const acq: number | Float64Array = m.acquisition?.ramp != null ? rampedAcq(customers, lag, m.acquisition.ramp) : customers / acqMonths;

    const y1 = m.retention.churn ? 1 - s[m.retention.churn] : s[m.retention.retention as string];
    const tenure = m.retention.ramp
      ? steps.map((k) => Math.min(cap, y1 * (1 + k * s[m.retention.ramp as string])))
      : (m.retention.factors ?? []).map((f) => Math.min(cap, y1 * f));
    let renew = [y1, ...tenure];
    if (m.retention.dunning) renew = dunningAdjust(renew, s[m.retention.dunning.involuntary], s[m.retention.dunning.recovery]);
    const share = tmplValue(s, m.annualShare);
    const S = planMixSurvival(renew, share);

    const price = tmplProduct(s, m.price);
    s._platformRate = 1 - realiseMix(m.channel, price, share);
    for (const q of ratios) s[q.stash] = s[q.per] > 0 ? Math.min(q.cap, s[q.cost] / s[q.per]) : 0;
    integrateSubscription(out, acq, lag, price, S, m.ceiling ? s[m.ceiling] : undefined, m.expansion ? s[m.expansion] : undefined);

    const setup = setupBuf;
    setup.fill(0);
    if (m.setupFee && (s[m.setupFee] || 0) > 0) {
      const capMonthly = m.ceiling ? s[m.ceiling] / acqMonths : Infinity;
      for (let t = Math.round(lag); t < out.length; t++) {
        const a = typeof acq === "number" ? acq : acq[t];
        setup[t] = Math.min(a, Math.max(0, capMonthly)) * s[m.setupFee];
      }
    }
    for (const e of m.events || []) {
      const ev = timeToEvent(s[e.hazard], r);
      applyEventFrom(out, ev, s[e.severity]);
      if (m.setupFee) applyEventFrom(setup, ev, s[e.severity]);
    }
    if (parts) {
      if (parts[m.lines.subscription]) parts[m.lines.subscription].set(out);
      if (m.lines.setup && parts[m.lines.setup]) parts[m.lines.setup].set(setup);
    }
    if (m.setupFee) for (let t = 0; t < out.length; t++) out[t] += setup[t];
  };

  const w: ModelWiring = { sim, revenueLines: m.setupFee && m.lines.setup ? [m.lines.subscription, m.lines.setup] : [m.lines.subscription] };
  if (m.cogs) {
    const rates = m.cogs.map(tmplCogsRate);
    w.cogsLines = m.cogs.map((c, i) => ({ label: c.label, rate: rates[i] }));
    w.margin = (s) => 1 - rates.reduce((a, f) => a + f(s), 0);
  }
  if (m.opex) {
    const opex = m.opex;
    w.costLines = opex.map((o) => ({ label: o.label, amount: (s: ScenarioState) => s[o.node], ...(o.from ? { from: o.from } : {}) }));
    w.cost = (s) => opex.reduce((a, o) => a + s[o.node], 0);
  }
  if (m.tvMultiple != null) { const tv = m.tvMultiple; w.tvMultiple = (s) => tmplValue(s, tv); }
  return w;
}

/** Resolve a declared model into its wiring. */
export function resolveModel(m: ModelSpec): ModelWiring {
  switch (m.template) {
    case "subscription-cohort": return subscriptionCohort(m);
    default: throw new Error(`unknown model template: ${(m as { template: string }).template}`);
  }
}

/** Fill a unit's sim/lines/margin/cost/tvMultiple from its `model` (fields the unit sets itself win). */
export function applyModel<T extends { model?: ModelSpec }>(unit: T): T {
  if (!unit.model) return unit;
  const w = resolveModel(unit.model) as unknown as Record<string, unknown>;
  const u = unit as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(w)) if (u[k] === undefined && v !== undefined) u[k] = v;
  return unit;
}
