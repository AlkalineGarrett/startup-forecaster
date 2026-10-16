// Domain types shared across the model. Pure type declarations — erased at build time.

/** The researched quantiles for one node. Any subset may be present. */
export interface Pctiles {
  p01?: number;
  p10?: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90?: number;
  p99?: number;
}

/** Where a given percentile value came from: a direct read of a cited source,
 * a value derived/scaled/spread from a sourced anchor, or an educated guess. */
export type Prov = "sourced" | "inferred" | "guess";

/** Per-percentile provenance, keyed the same as the node's Pctiles. */
export type ProvMap = { [K in keyof Pctiles]?: Prov };

export type NodeKind = "gate" | "value";

/** A node's loadings on the named latent factors (factor name → λ; may be negative). */
export type Loadings = Record<string, number>;

/** How a node's value is bounded, which sets the metalog transform. Derived from `_frac`
 * when absent (fractions → bounded (0,1); other magnitudes → semi-bounded (0,∞)). */
export type NodeBound = "unbounded" | "semi-lo" | "bounded";

/** A unit's revenue trajectory: one revenue per month over the horizon (HORIZON_MONTHS; pre-fx), written in place. */
export type MonthTraj = Float64Array;
// ── Model horizon (per portfolio; configurePortfolio({ horizonYears, headlineFromYear })) ──────────────────
/** Months in a unit's trajectory. Default 60 (5 years). */
export let HORIZON_MONTHS = 60;
/** Model years (HORIZON_MONTHS / 12). */
export let HORIZON_YEARS = 5;
/** The headline is the sustained annual average from this model year to the horizon (default 2: years 2–5,
 *  excluding the year-1 build-up). */
export let HEADLINE_FROM_YEAR = 2;
/** Set the horizon + headline window. Call before any simulation (configurePortfolio does). */
export function setHorizon(years: number, headlineFromYear: number = HEADLINE_FROM_YEAR): void {
  if (!Number.isInteger(years) || years < 1) throw new Error(`horizonYears must be a positive integer (got ${years})`);
  if (!Number.isInteger(headlineFromYear) || headlineFromYear < 1 || headlineFromYear > years) throw new Error(`headlineFromYear must be within 1..${years} (got ${headlineFromYear})`);
  HORIZON_YEARS = years;
  HORIZON_MONTHS = years * 12;
  HEADLINE_FROM_YEAR = headlineFromYear;
}
/** The model years, 1-based ([1, 2, 3, 4, 5] by default). */
export const modelYears = (): number[] => Array.from({ length: HORIZON_YEARS }, (_, i) => i + 1);
/** The headline window in words ("years 2–5"). */
export const headlineSpan = (): string => (HEADLINE_FROM_YEAR === HORIZON_YEARS ? `year ${HORIZON_YEARS}` : `years ${HEADLINE_FROM_YEAR}–${HORIZON_YEARS}`);

/**
 * One node in a project's dependency graph.
 * - `gate` nodes are yes/no milestones with a pass-rate distribution.
 * - `value` nodes are quantities (users, price, salary, …).
 */
export interface ProjectNode {
  id: string;
  label: string;
  kind: NodeKind;
  conf: string;
  /** Reasoning shown on the node card. Filled from the compiled distribution when one exists. */
  basis?: string;
  /** Source links. Compiled nodes carry their evidence in the corpus instead (urls cleared). */
  urls?: string[];
  /** Hand-authored percentiles — only for a node with no compiled distribution. */
  pctiles?: Pctiles;
  /** Per-percentile provenance for `pctiles` (sourced / inferred / guess). */
  prov?: ProvMap;
  /** Loadings on the named latent factors (multi-factor copula). Defaults to the
   * scalar luck loading on the execution factor when absent (see planUnit). */
  loadings?: Loadings;
  /** Override the metalog bound; derived from `_frac` when absent. */
  bound?: NodeBound;
  /** Runtime: true for value nodes whose values are fractions in [0,1]. */
  _frac?: boolean;
  /** Runtime: the compiled distribution's support score (0–100), when the node has one. */
  _support?: number;
  /** Kept out of the UI's driver lists (node cards, graph, tornado). Still sampled. E.g. a terminal-value
   *  multiple nobody needs to see. */
  hidden?: boolean;
  /**
   * Runtime: a click-override. When set, this node's distribution is replaced by a
   * narrow normal centred on this bar position (0..1); cleared by Reset. Set from the UI.
   */
  _override?: number;
}

/** A drawn scenario: node id → sampled value (gates are 0/1). */
export type ScenarioState = Record<string, number>;

/** A seeded PRNG returning a float in [0, 1). */
export type Rng = () => number;

/** A point on an empirical quantile function: [cumulative probability, value]. */
export type QuantPoint = [number, number];

/** An expandable per-unit brief shown at the top of a project/variant page: a one-sentence topline plus
 *  structured detail sections (e.g. What it is · Demand · Revenue · Cost · Competitors · Outcome). */
export interface UnitBrief {
  one: string;
  /** Each item is a bullet; a bullet that contains a list becomes { text, sub } → nested sub-bullets. */
  sections: { h: string; items: (string | { text: string; sub?: string[] })[] }[];
}

export interface Project {
  /** A business-model template (templates.ts) that supplies sim / lines / margin / cost / tvMultiple —
   *  the data-only alternative to writing `sim` by hand. */
  model?: import("./templates.ts").ModelSpec;
  id: string;
  name: string;
  /** The venture's currency, ISO code (e.g. "USD"): its outputs are in it. Defaults to the portfolio's reporting
   *  currency. A workspace sets it in its profile (ventures.<id>.currency, passed as configurePortfolio({ ventures })),
   *  which wins over a value here. A currency other than the reporting one needs an `exchangeRates` entry. */
  currency?: string;
  /** The ISO code the venture's input prices are quoted in, when it differs from `currency` (e.g. prices researched
   *  in USD for a venture reported in EUR). From the profile (ventures.<id>.priceCurrency) like `currency`. */
  priceCurrency?: string;
  /** DERIVED by configurePortfolio, never set by hand: the display symbol of `currency`. */
  cur?: string;
  /** DERIVED by configurePortfolio, never set by hand: the multiplier from the price currency into the venture's
   *  currency, toReporting(priceCurrency) / toReporting(currency) (1 when they are the same). */
  fx?: number;
  type: string;
  one: string;
  /** Optional expandable topline brief shown at the top of this unit's page. */
  brief?: UnitBrief;
  nodes: ProjectNode[];
  revNote: string;
  /** Optional per-line explainer text (a short note, NOT forced into equal bullets) for lines that have
   *  no structured itemization below (typically Tax and Net income). */
  incomeLines?: { revenue?: string[]; cogs?: string[]; tax?: string[]; opcost?: string[]; net?: string[] };
  /** Itemized income statement (each an INDEPENDENT quantity in the simulation, not a share of a total):
   *  - `revenueLines`: labels of revenue sub-lines the project's `sim` writes into its `parts` buffers.
   *  - `cogsLines`: cost-of-revenue components, each a rate (fraction of that year's gross revenue). The
   *     project's `margin` should equal 1 − Σ rates so the totals reconcile.
   *  - `costLines`: fixed operating-cost components, each an absolute annual amount. `cost` should equal
   *     their sum. A line's `from` overrides the portfolio's `costsStart` for that line. */
  revenueLines?: string[];
  cogsLines?: { label: string; rate: (s: ScenarioState) => number }[];
  costLines?: CostLine[];
  /** Price-as-output: when set, the engine attaches a revenue(price) curve + optimal price. See RunUnit.priceSweep. */
  priceSweep?: PriceSweep;
  /** The revenue model: writes the unit's monthly trajectory over the horizon (pre-fx) into `out`. Required
   *  unless `model` is given (configurePortfolio fills it from the template). */
  sim?: (s: ScenarioState, r: Rng, out: MonthTraj) => void;
  /** Gross-margin fraction for a draw (1 − cost of revenue). A business unit with neither this nor
   *  `cogsLines` takes the portfolio's `defaults.margin`, and is an error when there is none. */
  margin?: (s: ScenarioState) => number;
  /** Terminal-value multiple on the horizon-end annual run-rate (e.g. a few × ARR for software, 0 for an
   *  income track). Absent → the portfolio's `defaults.tvMultiple`, else 0 (no terminal value). */
  tvMultiple?: (s: ScenarioState) => number;
  /** Annual operating cost (venture currency, pre-fx) that reduces the contribution line (after-tax cash),
   * NOT reported revenue: free-tier cost-to-serve, salaries, compliance, etc. Starts per the portfolio's
   * `costsStart`. Reported revenue (`out`) stays gross ≥ 0; a negative contribution draw is a viability event. */
  cost?: (s: ScenarioState) => number;
  /** Shared-market tag: base units in the same market are alternatives for the same buyers, so a portfolio
   * sum keeps only the larger per draw (e.g. two job searches — accepting one ends the other). See RunUnit.market. */
  market?: string;
  /** Per-project reference-class p90 (venture currency, per year) for the optimism flag; a single portfolio-wide
   * value can't fit projects of different shapes. Falls back to the portfolio's `referenceP90` (converted). */
  refP90?: number;
  /** Custom reference-class caveat body (HTML), when the portfolio's reference class is the wrong comparator
   * for this venture. Replaces the default flag text; still gated by the refP90 threshold. */
  refNote?: string;
  /**
   * Optional product variants. When present, the project is simulated as its base
   * graph (the "base unit") plus each variant, and an equal-weight supermix of them all.
   */
  variants?: Variant[];
  /** Display name for the base unit (default "Generic (no sharp wedge)"). */
  baseName?: string;
  /** Which sub-tab a variant project OPENS on (e.g. "compare" for the all-options overlay). Does NOT
   *  change the overview headline (that stays the included/base unit) — only the default sub-body shown. */
  defaultUnit?: string;
  /**
   * Whether the variants are ADDITIVE segments you'd pursue simultaneously (enabling the "all-fronts" sum) vs
   * mutually-exclusive ALTERNATIVES (a single positioning), where summing is meaningless.
   */
  additiveVariants?: boolean;
  /**
   * The BASE graph is already the correct aggregate and the variants are DECOMPOSITIONS of it
   * (e.g. the base sim runs several channels on ONE shared calendar; the per-channel units are
   * drill-downs). The overview headline must then be the base, NOT the all-fronts sum of the
   * variant units — that sum would give each channel its own full calendar and over-count capacity.
   * Keeps the all-fronts view available as a sub-tab but off the default headline.
   */
  headlineBase?: boolean;
  /** Lag-node convention: the engine and the templates read `code_months` (build) and `readiness_months`
   * (real-world readiness) when a unit has them — for the lag split, `costsStart`, and the template's default
   * lag. The engine never adds them. `mergedLag` marks a project that carries ONE merged pre-revenue lag node
   * instead, so a workspace's own init knows not to add the pair. */
  mergedLag?: boolean;
  /**
   * An income track (salary or freelance), not a product business: its revenue is taxable income, so it has
   * no cost of revenue unless it sets `margin` or `cogsLines`, its after-tax uses the personal schedule, and it
   * has no terminal value by default. A personal unit with a `net_tax_multiplier` node uses it directly:
   * net = gross profit × net_tax_multiplier − operating cost. (Which units appear in Pairwise is the
   * `pairwiseIds` allow-list, not this flag.)
   */
  personal?: boolean;
  /**
   * Optional per-unit after-tax schedule, for ANY unit (business or personal), overriding the portfolio's
   * tax settings — e.g. a self-employed practice, or a company route. Works in the venture's own currency:
   * receives the year's billed gross revenue (before cost of revenue), the gross profit (after cost of revenue),
   * the draw's scenario state and the year's operating cost; returns the final after-tax cash NET of operating
   * cost (so a schedule can treat that cost as deductible). Variants inherit it.
   */
  afterTax?: AfterTaxFn;
  /**
   * No longer being pursued. Still fully modeled (golden/pairwise unchanged) but moved out of the
   * main Overview + tab bar into a dedicated "Archived" view; its full model stays drill-through
   * accessible from there.
   */
  archived?: boolean;
}

/** The minimal shape the simulator runs: a self-contained graph + trajectory fn + correlations. */
export interface RunUnit {
  /** As on Project: a business-model template that supplies the unit's sim and money lines. */
  model?: import("./templates.ts").ModelSpec;
  id: string;
  /** Multiplier from the input price currency into the unit's currency (see Project.fx; default 1). Derived by
   *  configurePortfolio for a project's variants; a unit built by hand may set it. */
  fx?: number;
  /** The unit's currency (ISO code; default the reporting currency). Variants take their project's. */
  currency?: string;
  /** The unit's price currency (ISO code; default its currency). Variants take their project's. */
  priceCurrency?: string;
  nodes: ProjectNode[];
  /** Writes the unit's monthly revenue trajectory over the horizon (pre-fx) into `out`. When `parts` is
   *  supplied (one pre-zeroed buffer per `revenueLines` label), the sim also writes each revenue sub-line
   *  into its buffer so the engine can report per-line revenue; `out` stays the total. */
  sim: (s: ScenarioState, r: Rng, out: MonthTraj, parts?: Record<string, MonthTraj>) => void;
  /** Itemization (see Project): revenue sub-line labels, cost-of-revenue rate components, fixed cost components. */
  revenueLines?: string[];
  cogsLines?: { label: string; rate: (s: ScenarioState) => number }[];
  costLines?: CostLine[];
  /** Per-node scalar loading on the execution factor; node.loadings takes precedence when present. */
  rho: Record<string, number>;
  /** Gross-margin fraction for a draw (see Project.margin). */
  margin?: (s: ScenarioState) => number;
  /** Terminal-value multiple on the horizon-end run-rate (see Project.tvMultiple). */
  tvMultiple?: (s: ScenarioState) => number;
  /** Annual operating cost (venture currency, pre-fx) subtracted from the contribution line, not
   * revenue. See Project.cost. */
  cost?: (s: ScenarioState) => number;
  /** An income track (salary/freelance): see Project.personal. */
  personal?: boolean;
  /** Per-unit after-tax schedule (see Project.afterTax); falls back to the portfolio's tax settings. */
  afterTax?: AfterTaxFn;
  /** Shared-market tag: units with the same non-empty market model the SAME buyer pool, so a
   * portfolio sum takes the max within a market group per draw instead of double-counting them. */
  market?: string;
  /** Price-as-output: when set, the engine runs a price sweep (demand overlay + active hours cap)
   * and attaches the revenue(price) curve + optimal price to the result. */
  priceSweep?: PriceSweep;
}

/** A price sweep: `priceNode` is the node whose sampled median is the "planned" price and whose value the sweep
 *  overrides; `wtpNode` sizes the grid's top; `extraNodes` are drawn only when pricing. The grid runs from 0.3×
 *  to ≥2.5× the planned price; `minPrice` (venture currency) optionally floors its bottom. */
export interface PriceSweep { priceNode: string; wtpNode?: string; extraNodes?: ProjectNode[]; minPrice?: number }

/** A fixed operating-cost line: an absolute annual amount; `from` overrides the portfolio's `costsStart`. */
export interface CostLine { label: string; amount: (s: ScenarioState) => number; from?: "start" | "readiness" | "launch" }

/** A unit's own after-tax schedule (see Project.afterTax). All amounts in the unit's currency. */
export type AfterTaxFn = (grossRevenue: number, grossProfit: number, s: ScenarioState, opcost: number) => number;

/** One row of a project's variance decomposition: how strongly a node drives the output. */
export interface TornadoBar {
  id: string;
  label: string;
  /** Spearman rank correlation between this node's draw and the average-yearly outcome. */
  corr: number;
  /** True when the node has no published realised series (empty `urls`) — a result leaning on it
   * is flagged so its sensitivity is visible. */
  unidentified?: boolean;
}

/** A product variant of a project: a run-unit plus display metadata. */
export interface Variant extends RunUnit {
  name: string;
  revNote: string;
  /** Optional expandable topline brief shown at the top of this variant's page. */
  brief?: UnitBrief;
}

/** P20/P50/P80 of a cumulative-revenue horizon (venture currency). */
export interface Horizon {
  p20: number;
  p50: number;
  p80: number;
  /** Expected (mean) value — the 4th switcher option. Optional for back-compat with older baked data. */
  mean?: number;
}

/** A per-year statistic bundle: the four switcher metrics for one model year. */
export interface YearStat {
  p20: number;
  p50: number;
  mean: number;
  p80: number;
}

/** The outcome distribution of one project's simulation. */
/** The outcome distribution of one unit's simulation. Every amount is in `currency` — the venture's own, or for
 *  a combination of ventures in different currencies, the reporting currency. */
export interface RunResult {
  /** The currency of every amount here (ISO code). */
  currency: string;
  samples: Float64Array;
  p20: number;
  p50: number;
  p80: number;
  p95: number;
  mean: number;
  /** Share of runs clearing the "meaningful" threshold. */
  pSucc: number;
  /** Median outcome among the runs that cleared the threshold. */
  condP50: number;
  /** The "meaningful" threshold used, per year, in this result's currency (the portfolio's successThreshold
   *  converted). */
  thr: number;
  /**
   * Revenue horizons: the first 3 months (a quarter-year total), the first year (annual), and the headline
   * window's annual average (`headlineFromYear` to the horizon) — the mature annual figure.
   */
  h3: Horizon;
  h12: Horizon;
  h25: Horizon;
  /** Raw per-sample horizon revenue — 3-month, first-year, headline-window annual — so a supermix can re-pool them. */
  sH3: Float64Array;
  sH12: Float64Array;
  sH25: Float64Array;
  /** Terminal value at the horizon's end: annual run-rate × a sampled multiple. p50 reported. */
  terminalValue: number;
  /** NPV of the revenue stream over the horizon, discounted at the portfolio's discountRate. p50 reported. */
  npv: number;
  /** After-tax cash to the operator ("net income"), average-yearly over the headline window: the unit's own
   * afterTax, else the personal schedule for income tracks, else pre-tax profit after the business tax;
   * operating cost deducted (can be < 0). Full set reported so the Overview table can switch to a net view. */
  afterTax20: number;
  afterTax50: number;
  afterTax80: number;
  afterTaxMean: number;
  /** Share of runs whose NET income clears the "meaningful" threshold, and the median net given that. */
  afterTaxPSucc: number;
  afterTaxCondP50: number;
  /** Median gross-margin fraction applied. */
  grossMargin: number;
  /** P(average-yearly revenue < the decision floor) — the go/no-go diagnostic. */
  pFloor: number;
  /** The decision floor used for pFloor, per year, in this result's currency (decisionFloor converted). */
  floor: number;
  /** Mean months of the launch lag, split into compressible build vs uncompressible institutional. */
  lagBuild: number;
  lagInstitutional: number;
  /** Raw per-sample after-tax average-yearly, so a supermix can re-pool it. */
  sAfter: Float64Array;
  /** Variance decomposition: the nodes that drive the outcome most, |corr| descending. */
  tornado: TornadoBar[];
  /** Price-as-output diagnostic (additive; populated only for units with priceSweep). The
   * revenue(price) curve under the demand overlay + active capacity cap, the sampled
   * ("planned") price for reference, and the revenue-optimal price. Revenue is mean average-yearly
   * revenue; hoursUtil is mean peak capacity utilisation (1 = fully booked). */
  priceCurve?: PricePoint[];
  plannedPrice?: number;
  optimalPrice?: number;
  optimalRevenue?: number;
  optimalHoursUtil?: number;
  /** Per-year revenue, year 1 → the horizon (HORIZON_YEARS entries), each as {p20,p50,mean,p80}. Built by
   *  bucketing every draw's trajectory into 12-month years. Additive — does not affect any headline. */
  yearRevenue?: YearStat[];
  /** Per-year net income, one YearStat per model year: that year's revenue put through the same net transform
   *  as the after-tax line, less that year's operating cost. */
  yearNet?: YearStat[];
  /** Per-year operating cost distribution, one YearStat per year — the `cost()` outlay from its start
   *  (`costsStart`, or a line's `from`). Lets the project page split income vs cost by year. */
  costStat?: YearStat[];
  /** Per-year cost-of-revenue and tax, so the project page can break the revenue→net bridge into its
   *  components. Tax is the residual: rev − cogs − operating cost − net. */
  yearCogs?: YearStat[];
  yearTax?: YearStat[];
  /** Itemized income-statement sub-lines, each an INDEPENDENT per-draw quantity (not a share): revenue,
   *  cost-of-revenue AND operating-cost lines all carry a per-year stat (operating cost starts at its trigger,
   *  so it varies by year). Because each is sampled independently, sub-line percentiles do NOT sum to the
   *  parent's percentile (only the means do). */
  statementLines?: {
    revenue?: { label: string; stat: YearStat[] }[];
    cogs?: { label: string; stat: YearStat[] }[];
    opcost?: { label: string; stat: YearStat[] }[];
  };
  /** Raw per-year samples, one array of N per model year — revenue and net — so a supermix can re-pool them
   *  into pooled per-year stats (mirrors sH3/sH12/sH25). */
  sYearRev?: Float64Array[];
  sYearNet?: Float64Array[];
  /** Precomputed histogram profile (the ~51 counts histSVG renders). Lets the startup cache carry the
   *  histogram without the 20k raw `samples`; histSVG uses `samples` when present (a live re-run), else
   *  this. Binned at the unit's fixed histCap. */
  hist?: HistProfile;
  /** The precomputed NET-income (after-tax) histogram profile + its x-axis cap, so the project panel can
   *  show the net distribution from the cache (the raw `sAfter` draws are stripped like `samples`). */
  histAfter?: HistProfile;
  histAfterCap?: number;
}

/** The binned counts the revenue histogram renders — a tiny stand-in for the raw sample array. */
export interface HistProfile {
  loss: number; // draws below 0
  zero: number; // draws below the ~0 threshold
  bins: number[]; // positive-value bar counts (length 48), binned at the fixed cap
  total: number; // sample count, for the share-of-runs tooltips
}

/** One point on the price-as-output curve. */
export interface PricePoint {
  price: number;
  revenue: number;
  hoursUtil: number;
}

/** Per-project, per-node loading on the shared "luck" factor. */
export type Correlations = Record<string, Record<string, number>>;
