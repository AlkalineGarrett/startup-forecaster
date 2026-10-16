// The data seam between the (generic, publishable) engine and a concrete portfolio.
//
// This module declares the portfolio-data bindings ONCE, as mutable module state, and exposes
// `configurePortfolio()` to populate them. Engine modules import these bindings from here; a
// portfolio (in the user's workspace) calls `configurePortfolio(...)` at init to attach its data. This is a
// configure-once, single-session context — matching the app's existing single-user design, and
// required by the bundler (build.mjs concatenates modules into one scope, so each canonical name
// must be declared exactly once and cannot be aliased).
//
// Load order: the data bootstrap (the config's `bootstrap`, e.g. src/projects.ts) transitively imports the data
// modules, whose top-level configurePortfolio() calls run at init — before any run().
//
// Every setting that depends on the person or the business (currency, tax, thresholds, team shape, shared
// factors) lives here with a NEUTRAL default; a workspace sets its own (from its profile) in configurePortfolio.

import type { DistSpec } from "./distributions.ts";
import type { Correlations, Loadings, Project, RunResult } from "./types.ts";
import { applyModel } from "./templates.ts";
import { setHorizon, HORIZON_YEARS, HEADLINE_FROM_YEAR } from "./types.ts";
import { setCurrency, setMoneyBands, setNumberLocale, withMoneyScope } from "./format.ts";
import { symbolOf, describeTax } from "./settings.mjs";

/** A compiled node distribution: the sampling spec + derived percentiles + provenance for the UI. */
export interface NodeDist {
  d: DistSpec;
  trunc?: { lower?: number; upper?: number };
  pctiles: { p05: number | null; p10: number | null; p50: number | null; p90: number | null; p95: number | null };
  support?: number;   // grounding strength 0–100 (support_score)
  basis?: string;     // node-level reasoning
  klabel?: string;    // readable distribution structure (kind + params)
  def?: string;       // model_definition — what the number IS
  unit?: string;
  proc?: string[];    // how each parameter was derived (process lines)
  checks?: string[];  // cross-checks (✓ corroboration / ✗ tension)
  recon?: string;     // reconciliation process, when multiple sources were combined
}

/** Compiled distributions, keyed `project::node` (or `project::variant::node`). */
export let DISTRIBUTIONS: Record<string, NodeDist> = {};

/** Per-project scalar execution loadings (F_EXEC). A workspace may add to it in place before configuring. */
export let RHO: Correlations = {};

/** Per-unit multi-factor loadings table (supersedes the scalar RHO where present). */
export let LOADINGS: Record<string, Record<string, Loadings>> = {};

/** The portfolio's projects, as the workspace attached them (templates resolved). */
export let PROJECTS: Project[] = [];

/** Allow-list of project ids shown in the pairwise-combination view. */
export let PAIRWISE_IDS: string[] = [];

/** The pairwise-combination matrix, precomputed at build time (only p20/p50/p80 + h3/h12/h25 baked). */
export interface PairwiseLite {
  labels: string[];
  solo: RunResult[];
  res: (RunResult | null)[][];
}
export let PAIRWISE_PRECOMPUTED: PairwiseLite = { labels: [], solo: [], res: [] };

/** One evidence-corpus item (sourced observation / general-knowledge prior / speculation). */
export interface EvItem {
  kind: string;            // 'obs' (sourced) | 'gk' (general knowledge) | 'spec' (speculation)
  statement: string;
  quote?: string;          // verbatim source excerpt (obs only)
  reasoning?: string;      // why this prior (gk/spec)
  measure?: { unit?: string; value?: number; interval?: { low: number; high: number }; quantiles?: Record<string, number> };
  verification?: string;
  url?: string;            // source URL (obs, when the doc has one)
  title?: string;
  citedBy?: string[];      // node keys that cite this item
}

/** The evidence corpus, keyed by item id. */
export let CORPUS: Record<string, EvItem> = {};

/** Node key → the corpus item ids it cites. */
export let NODE_REFS: Record<string, string[]> = {};

// ── Money: currencies ───────────────────────────────────────────────────────────────────────────────
// Each venture reports in its OWN currency (Project.currency, ISO code) and may quote its input prices in another
// (Project.priceCurrency). Both come from the workspace profile (configurePortfolio({ ventures })); the symbol
// (Project.cur) and the price conversion (Project.fx) are derived from them here, once. Anything that combines
// ventures (pairwise, a portfolio total) converts into the portfolio's ONE reporting currency.

/** A currency: ISO code + display symbol. */
export interface Currency { code: string; symbol: string }

/** The portfolio's reporting currency (default USD / "$"). */
export let REPORTING_CURRENCY: Currency = { code: "USD", symbol: "$" };
/** exchangeRates[code] = the value of 1 unit of `code` in the reporting currency. Default: none. */
export let EXCHANGE_RATES: Record<string, number> = {};

/** The reporting currency { code, symbol }. */
export function reportingCurrency(): Currency { return REPORTING_CURRENCY; }

/** A venture's (or unit's / result's) currency code; a bare string is taken as the code. Defaults to reporting. */
export function currencyOf(x: { currency?: string } | string | undefined): string {
  const c = typeof x === "string" ? x : x?.currency;
  return c || REPORTING_CURRENCY.code;
}

/** Value of 1 unit of the venture's currency in the reporting currency (1 when they are the same). */
export function toReporting(x: { currency?: string } | string | undefined): number {
  const c = currencyOf(x);
  if (c === REPORTING_CURRENCY.code) return 1;
  const r = EXCHANGE_RATES[c];
  if (!(r > 0)) throw new Error(`no exchange rate for ${c} → ${REPORTING_CURRENCY.code}: set configurePortfolio({ exchangeRates: { ${c}: <value of 1 ${c} in ${REPORTING_CURRENCY.code}> } })`);
  return r;
}

/** Run `fn` with money in the currency of `x` (a venture, unit or result, or an ISO code; default the reporting
 *  currency): `fmt` uses its symbol, and `heatVars` / `inReporting` convert its amounts into the reporting
 *  currency. The one place a render scope picks its currency. */
export function withCur<T>(x: { currency?: string } | string | undefined, fn: () => T): T {
  return withMoneyScope(curOf(x), toReporting(x), fn);
}

/** The display symbol of a venture's (unit's / result's) currency, or of an ISO code: the reporting currency's
 *  configured symbol, else Intl's (settings.mjs symbolOf). */
export function curOf(x: { currency?: string } | string | undefined): string {
  const code = currencyOf(x);
  return code === REPORTING_CURRENCY.code ? REPORTING_CURRENCY.symbol : symbolOf(code);
}

// ── Money: thresholds (reporting currency; converted into each venture's currency where applied) ────────
/** "Meaningful" revenue per year (pSucc / condP50), in the reporting currency. 5000 is a PLACEHOLDER: a
 *  workspace sets the amount its person considers worth it (profile `meaningfulRevenuePerYear`). */
export let SUCCESS_THRESHOLD = 5000;
/** Decision floor per year (pFloor: P(revenue < floor)), in the reporting currency. 12000 is a PLACEHOLDER
 *  (profile `decisionFloorPerYear`). */
export let DECISION_FLOOR = 12000;
/** Optional reference-class p90 (reporting currency) for the "inputs look optimistic" flag; unset → no flag
 *  unless a project sets its own `refP90`. `REFERENCE_NOTE` is the flag's text for that reference class. */
export let REFERENCE_P90: number | undefined = undefined;
export let REFERENCE_NOTE: string | undefined = undefined;

/** The thresholds in a venture's own currency (each reporting-currency setting ÷ toReporting). A project's own
 *  `refP90` (already in its currency) wins over the portfolio's. */
export function thresholdsFor(x: { currency?: string; refP90?: number } | string | undefined): { successThreshold: number; decisionFloor: number; referenceP90?: number } {
  const rate = toReporting(x);
  const own = typeof x === "object" && x ? x.refP90 : undefined;
  const ref = own ?? (REFERENCE_P90 != null ? REFERENCE_P90 / rate : undefined);
  return { successThreshold: SUCCESS_THRESHOLD / rate, decisionFloor: DECISION_FLOOR / rate, ...(ref != null ? { referenceP90: ref } : {}) };
}

/** Annual discount rate for NPV (default 0.10). */
export let DISCOUNT_RATE = 0.1;

/** Payment channels a workspace adds or overrides: name → collected fraction of list price + fixed fee per
 *  charge (in the venture's own currency). Merged over the built-in table in accounting.ts. */
export interface ChannelSpec { realisation: number; fixedFee: number }
export let CHANNEL_OVERRIDES: Record<string, ChannelSpec> = {};

// ── Tax (jurisdiction-specific — supplied by the portfolio) ─────────────────────────────────────────────
// Portfolio-wide tax functions take and return REPORTING-currency amounts (the engine converts a venture's
// figures in and out). A unit's own `afterTax` works in the unit's own currency and wins over all of these.
/** Personal-track tax: gross annual profit → after-tax cash. Default: NO tax (identity). */
export let PERSONAL_AFTER_TAX: (grossAnnual: number) => number = (g) => Math.max(0, g);
/** Effective tax rate on positive business pre-tax profit. Default: 0 (no tax). */
export let BUSINESS_TAX = 0;
/** Optional business tax schedule: pre-tax profit (may be < 0) → after-tax; wins over BUSINESS_TAX. */
export let BUSINESS_AFTER_TAX: ((pretax: number, s: import("./types.ts").ScenarioState) => number) | undefined = undefined;
/** A short description of the tax model for the UI (e.g. "PT company: IRC 21% + derrama"). */
export let TAX_NOTE: string | undefined = undefined;
let _personalTaxSet = false;

/** What the UI says about tax: the configured note, else the flat business rate, else "no tax configured". */
export function taxDescription(): string {
  return describeTax({ note: TAX_NOTE, businessTax: BUSINESS_TAX, businessSchedule: !!BUSINESS_AFTER_TAX, personalSchedule: _personalTaxSet });
}

// ── Team and founder ─────────────────────────────────────────────────────────────────────────────────
/** When operating costs begin: "start" (month 0 — a team with salaries), "readiness" (at `code_months`,
 *  i.e. after an unpaid founder's build), or "launch" (at `code_months + readiness_months`). */
export type CostStart = "start" | "readiness" | "launch";
export let COSTS_START: CostStart = "start";
/** Pairwise split-attention haircut on a pair's combined revenue (0 = each product has its own people;
 *  a solo founder running two products might set ~0.15). */
export let PAIR_ATTENTION_OVERHEAD = 0;
/** The pairwise haircut currently configured. */
export function pairAttentionOverhead(): number { return PAIR_ATTENTION_OVERHEAD; }
/** Max shared factors: the QMC driver has one Halton prime per factor (qmc.ts PRIMES). */
export const MAX_GLOBAL_FACTORS = 11;
/** Factors drawn once per iteration and SHARED across projects (common random numbers). A node loading on
 *  any other factor name gets a project-local factor. Default: just "macro". */
export let GLOBAL_FACTORS: string[] = ["macro"];
/** Fallbacks for a business unit that sets no margin (and no cost-of-revenue lines) or no terminal multiple. */
export let UNIT_DEFAULTS: { margin?: number; tvMultiple?: number } = {};

/** The page title shown in the results UI (browser tab + artifact). A portfolio may override it. */
export let PORTFOLIO_TITLE = "Monte-Carlo Portfolio";

/** Every venture's currency (and price currency) has a rate into the reporting currency; throws naming the venture
 *  otherwise. Then derives each project's and variant's symbol (`cur`) and price conversion (`fx`) from them. */
function deriveCurrencies(): void {
  for (const p of PROJECTS) {
    const units = [{ who: p.id, u: p, currency: p.currency, price: p.priceCurrency },
      ...(p.variants || []).map((v) => ({ who: `${p.id}::${v.id}`, u: v, currency: v.currency ?? p.currency, price: v.priceCurrency ?? p.priceCurrency }))];
    for (const { who, currency, price } of units)
      for (const [what, c] of [["is in", currency], ["prices in", price]] as const) {
        const code = currencyOf(c);
        if (code !== REPORTING_CURRENCY.code && !(EXCHANGE_RATES[code] > 0))
          throw new Error(`venture "${who}" ${what} ${code} but the reporting currency is ${REPORTING_CURRENCY.code} and exchangeRates has no ${code} rate — add configurePortfolio({ exchangeRates: { ${code}: <value of 1 ${code} in ${REPORTING_CURRENCY.code}> } })`);
      }
    for (const { u, currency, price } of units) u.fx = toReporting(price ?? currency) / toReporting(currency);
    p.cur = curOf(p);
  }
}

/** Attach a portfolio's data and settings to the engine. Each slice is optional; call once at init (several
 *  calls compose — later slices replace earlier ones). Settings are applied before projects. */
export function configurePortfolio(p: {
  distributions?: Record<string, NodeDist>;
  rho?: Correlations;
  loadings?: Record<string, Record<string, Loadings>>;
  projects?: Project[];
  pairwiseIds?: string[];
  pairwisePrecomputed?: PairwiseLite;
  corpus?: Record<string, EvItem>;
  nodeRefs?: Record<string, string[]>;
  title?: string;
  /** Model horizon in years (default 5) and the first year of the sustained headline average (default 2). */
  horizonYears?: number;
  headlineFromYear?: number;
  /** The reporting currency (default { code: "USD", symbol: "$" }); also the default `fmt` symbol. */
  reportingCurrency?: Currency;
  /** Value of 1 unit of each venture currency in the reporting currency, e.g. { USD: 0.863 } for EUR reporting. */
  exchangeRates?: Record<string, number>;
  /** Thresholds in the reporting currency (defaults 5000 / 12000 are placeholders; set your own). */
  successThreshold?: number;
  decisionFloor?: number;
  referenceP90?: number;
  referenceNote?: string;
  /** NPV discount rate (default 0.10). */
  discountRate?: number;
  /** Payment channels added to / overriding the built-ins (fixedFee in the venture's currency). */
  channels?: Record<string, ChannelSpec>;
  /** Tax: personal schedule, flat business rate (default 0), or a business schedule (wins over the rate). */
  personalAfterTax?: (grossAnnual: number) => number;
  businessTax?: number;
  businessAfterTax?: (pretax: number, s: import("./types.ts").ScenarioState) => number;
  taxNote?: string;
  /** When operating costs begin (default "start"). */
  costsStart?: CostStart;
  /** Pairwise split-attention haircut (default 0). */
  pairAttentionOverhead?: number;
  /** Shared factor names (default ["macro"]); at most MAX_GLOBAL_FACTORS. */
  globalFactors?: string[];
  /** Business-unit fallbacks: margin when a unit sets none, tvMultiple when a unit sets none (default: none —
   *  a business unit with no margin is an error; no multiple → no terminal value). */
  defaults?: { margin?: number; tvMultiple?: number };
  /** Number-grouping locale for money formatting (default "en-US"). */
  locale?: string;
  /** Money colour-scale anchors [orange, green, blue] (default [50000, 100000, 200000]). */
  moneyBands?: [number, number, number];
  /** Per-venture currency settings (from the workspace profile), applied over each project: the ISO code it reports
   *  in and the ISO code its input prices are quoted in (when they differ). Its symbol and fx derive from them. */
  ventures?: Record<string, { currency?: string; priceCurrency?: string }>;
}): void {
  // Horizon first: templates resolved below size their buffers from it.
  if (p.horizonYears != null || p.headlineFromYear != null) setHorizon(p.horizonYears ?? HORIZON_YEARS, p.headlineFromYear ?? HEADLINE_FROM_YEAR);
  if (p.reportingCurrency) {
    const c = p.reportingCurrency;
    if (!c.code || !c.symbol) throw new Error(`reportingCurrency needs { code, symbol } (got ${JSON.stringify(c)})`);
    REPORTING_CURRENCY = { code: c.code, symbol: c.symbol };
    setCurrency(c.symbol);
  }
  if (p.exchangeRates) {
    for (const [k, v] of Object.entries(p.exchangeRates)) if (!(typeof v === "number" && v > 0)) throw new Error(`exchangeRates.${k} must be a positive number (got ${v})`);
    EXCHANGE_RATES = { ...p.exchangeRates };
  }
  for (const [k, v] of [["successThreshold", p.successThreshold], ["decisionFloor", p.decisionFloor], ["referenceP90", p.referenceP90]] as const)
    if (v != null && !(typeof v === "number" && v >= 0)) throw new Error(`${k} must be a non-negative number (got ${v})`);
  if (p.successThreshold != null) SUCCESS_THRESHOLD = p.successThreshold;
  if (p.decisionFloor != null) DECISION_FLOOR = p.decisionFloor;
  if (p.referenceP90 != null) REFERENCE_P90 = p.referenceP90;
  if (p.referenceNote != null) REFERENCE_NOTE = p.referenceNote;
  if (p.discountRate != null) {
    if (!(p.discountRate > -1)) throw new Error(`discountRate must be > -1 (got ${p.discountRate})`);
    DISCOUNT_RATE = p.discountRate;
  }
  if (p.channels) {
    for (const [k, c] of Object.entries(p.channels))
      if (!(c && c.realisation >= 0 && c.realisation <= 1 && c.fixedFee >= 0)) throw new Error(`channels.${k} needs { realisation in [0,1], fixedFee >= 0 } (got ${JSON.stringify(c)})`);
    CHANNEL_OVERRIDES = { ...CHANNEL_OVERRIDES, ...p.channels };
  }
  if (p.personalAfterTax) { PERSONAL_AFTER_TAX = p.personalAfterTax; _personalTaxSet = true; }
  if (p.businessTax != null) BUSINESS_TAX = p.businessTax;
  if (p.businessAfterTax) BUSINESS_AFTER_TAX = p.businessAfterTax;
  if (p.taxNote != null) TAX_NOTE = p.taxNote;
  if (p.costsStart != null) {
    if (!["start", "readiness", "launch"].includes(p.costsStart)) throw new Error(`costsStart must be "start", "readiness" or "launch" (got ${p.costsStart})`);
    COSTS_START = p.costsStart;
  }
  if (p.pairAttentionOverhead != null) {
    if (!(p.pairAttentionOverhead >= 0 && p.pairAttentionOverhead < 1)) throw new Error(`pairAttentionOverhead must be in [0, 1) (got ${p.pairAttentionOverhead})`);
    PAIR_ATTENTION_OVERHEAD = p.pairAttentionOverhead;
  }
  if (p.globalFactors) {
    const g = p.globalFactors;
    if (!g.length || g.length > MAX_GLOBAL_FACTORS) throw new Error(`globalFactors must list 1..${MAX_GLOBAL_FACTORS} factor names (got ${g.length})`);
    if (new Set(g).size !== g.length || g.some((x) => typeof x !== "string" || !x)) throw new Error(`globalFactors must be distinct non-empty names (got ${JSON.stringify(g)})`);
    GLOBAL_FACTORS = [...g];
  }
  if (p.defaults) {
    const d = p.defaults;
    if (d.margin != null && !(d.margin >= 0 && d.margin <= 1)) throw new Error(`defaults.margin must be in [0, 1] (got ${d.margin})`);
    if (d.tvMultiple != null && !(d.tvMultiple >= 0)) throw new Error(`defaults.tvMultiple must be >= 0 (got ${d.tvMultiple})`);
    UNIT_DEFAULTS = { ...UNIT_DEFAULTS, ...d };
  }
  if (p.locale) setNumberLocale(p.locale);
  if (p.moneyBands) setMoneyBands(p.moneyBands);
  if (p.distributions) DISTRIBUTIONS = p.distributions;
  if (p.rho) RHO = p.rho;
  if (p.loadings) LOADINGS = p.loadings;
  if (p.projects) {
    // A unit that declares a `model` (a business-model template, templates.ts) gets its sim + revenue/cost
    // lines + margin + opex + terminal multiple from it; fields it sets itself win.
    for (const proj of p.projects) {
      const v = p.ventures?.[proj.id];
      if (!v) continue;
      if (v.currency != null) proj.currency = v.currency;
      if (v.priceCurrency != null) proj.priceCurrency = v.priceCurrency;
    }
    for (const proj of p.projects) { applyModel(proj); for (const v of proj.variants || []) applyModel(v); }
    PROJECTS = p.projects;
  }
  if (p.projects || p.reportingCurrency || p.exchangeRates) deriveCurrencies();
  if (p.pairwiseIds) PAIRWISE_IDS = p.pairwiseIds;
  if (p.pairwisePrecomputed) PAIRWISE_PRECOMPUTED = p.pairwisePrecomputed;
  if (p.corpus) CORPUS = p.corpus;
  if (p.nodeRefs) NODE_REFS = p.nodeRefs;
  if (p.title) PORTFOLIO_TITLE = p.title;
}
