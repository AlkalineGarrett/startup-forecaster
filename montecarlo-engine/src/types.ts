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

/** A unit's revenue trajectory: 60 monthly net-collected revenues (pre-fx), written in place. */
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
  /** Display currency symbol. */
  cur: string;
  /** Multiplier applied to the raw revenue to normalise to EUR. */
  fx: number;
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
   *     their sum. */
  revenueLines?: string[];
  cogsLines?: { label: string; rate: (s: ScenarioState) => number }[];
  costLines?: { label: string; amount: (s: ScenarioState) => number }[];
  /** Price-as-output: when set, the engine attaches a revenue(price) curve + optimal price. */
  priceSweep?: { priceNode: string; wtpNode?: string; extraNodes?: ProjectNode[] };
  /** Writes the unit's 60-month net-collected revenue trajectory (pre-fx) into `out`. */
  /** The revenue model. Required unless `model` is given (configurePortfolio fills it from the template). */
  sim?: (s: ScenarioState, r: Rng, out: MonthTraj) => void;
  /** Gross-margin fraction for a draw (cost of revenue). Defaults per project type. */
  margin?: (s: ScenarioState) => number;
  /** Terminal-value multiple on month-60 run-rate (e.g. 2–5× ARR solo SaaS, 0 for jobs). */
  tvMultiple?: (s: ScenarioState) => number;
  /** Annual operating cost (project currency, pre-fx) that reduces the margin/contribution line
   * (after-tax cash), NOT reported revenue. Free-tier cost-to-serve, per-title build spend, etc.
   * Reported revenue (`out`) stays gross ≥ 0; a negative contribution draw is a viability event. */
  cost?: (s: ScenarioState) => number;
  /** Shared-market tag: base units in the same market XOR in a portfolio sum (e.g. the two job
   * tracks — accepting one ends the other search). See RunUnit.market. */
  market?: string;
  /** Per-project reference-class p90 (EUR/yr) for the sanity flag; a single portfolio-wide value
   * can't fit projects of different shapes. Falls back to REFERENCE_P90 when absent. */
  refP90?: number;
  /** Custom reference-class caveat body (HTML). Used when the generic solo-software / $10k-MRR base rate
   * is the WRONG comparator (e.g. a funded-service or B2B-heavy venture). Replaces the default flag text;
   * still gated by the refP90 threshold. */
  refNote?: string;
  /** Additive-variant allocation: the max segments pursuable at once (concurrency
   * cap) and a fixed per-segment overhead fraction — so "all-fronts" is a capped allocation, not a
   * free sum of every segment. */
  segmentConcurrency?: number;
  segmentOverhead?: number;
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
  /** The project carries its OWN single merged pre-revenue lag node (e.g. a project's
   * `research_readiness_months`), so initProjects must NOT inject the shared `code_months` +
   * `readiness_months` build nodes on top of it — that would sample three overlapping lag nodes
   * where the sim reads only one (WO18 B4). */
  mergedLag?: boolean;
  /**
   * A personal-income / service track (a job salary or solo consulting), not a product
   * business. Excluded from the Pairwise combination view — you can't "pursue it alongside"
   * a product the way two products combine.
   */
  personal?: boolean;
  /**
   * Optional per-project after-tax schedule for a PERSONAL track, overriding the portfolio-wide
   * `personalAfterTax` — e.g. a self-employed practice taxed differently from salaried job tracks.
   * Receives the billed gross revenue for the year (EUR, before cost of revenue), the gross profit
   * (after cost of revenue), the draw's scenario state and the year's operating cost (EUR); returns the
   * final after-tax cash NET of operating cost (so a schedule can treat that cost as deductible).
   * Variants inherit it.
   */
  afterTax?: (grossRevenueEur: number, grossProfitEur: number, s: ScenarioState, opcostEur: number) => number;
  /**
   * No longer being pursued. Still fully modeled (golden/pairwise unchanged) but moved out of the
   * main Overview + tab bar into a dedicated "Archived" view; its full model stays drill-through
   * accessible from there. Distinct from `personal` (which only gates the Pairwise view).
   */
  archived?: boolean;
}

/** The minimal shape the simulator runs: a self-contained graph + trajectory fn + correlations. */
export interface RunUnit {
  /** As on Project: a business-model template that supplies the unit's sim and money lines. */
  model?: import("./templates.ts").ModelSpec;
  id: string;
  fx: number;
  nodes: ProjectNode[];
  /** Writes the unit's 60-month net-collected revenue trajectory (pre-fx) into `out`. When `parts` is
   *  supplied (one pre-zeroed buffer per `revenueLines` label), the sim also writes each revenue sub-line
   *  into its buffer so the engine can report per-line revenue; `out` stays the total. */
  sim: (s: ScenarioState, r: Rng, out: MonthTraj, parts?: Record<string, MonthTraj>) => void;
  /** Itemization (see Project): revenue sub-line labels, cost-of-revenue rate components, fixed cost components. */
  revenueLines?: string[];
  cogsLines?: { label: string; rate: (s: ScenarioState) => number }[];
  costLines?: { label: string; amount: (s: ScenarioState) => number }[];
  /** Per-node scalar loading on the execution factor; node.loadings takes precedence when present. */
  rho: Record<string, number>;
  /** Gross-margin fraction for a draw. Defaults to a business default when absent. */
  margin?: (s: ScenarioState) => number;
  /** Terminal-value multiple on month-60 run-rate. */
  tvMultiple?: (s: ScenarioState) => number;
  /** Annual operating cost (project currency, pre-fx) subtracted from the contribution line, not
   * revenue. See Project.cost. */
  cost?: (s: ScenarioState) => number;
  /** A personal-income track (job/consulting): after-tax uses the portfolio's personal-tax schedule, not a business margin. */
  personal?: boolean;
  /** Per-unit personal after-tax schedule (see Project.afterTax); falls back to the portfolio schedule. */
  afterTax?: (grossRevenueEur: number, grossProfitEur: number, s: ScenarioState, opcostEur: number) => number;
  /** Shared-market tag: units with the same non-empty market model the SAME buyer pool, so a
   * portfolio sum takes the max within a market group per draw instead of double-counting them. */
  market?: string;
  /** All-fronts base front: the generic "no wedge" product is the always-present core (each variant
   * is this core plus its special features), so it contributes every draw and is exempt from the
   * `segmentConcurrency` cap — the cap governs only the incremental wedges layered on top. */
  base?: boolean;
  /** Price-as-output: when set, the engine runs a price sweep (demand overlay + active hours cap)
   * and attaches the revenue(price) curve + optimal price to the result. `priceNode` is the node id
   * whose sampled p50 is the "planned" price and whose value the sweep overrides. */
  priceSweep?: { priceNode: string; wtpNode?: string; extraNodes?: ProjectNode[] };
}

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

/** P20/P50/P80 of a cumulative-revenue horizon (EUR). */
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
export interface RunResult {
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
  /** The "meaningful" threshold used, in EUR/yr. */
  thr: number;
  /**
   * Revenue horizons (EUR), build-lag aware: first 3 months once live (a quarter-year total),
   * first year once live (annual), and the years-2–5 annual run-rate ((5-year total − first
   * year) ÷ 4) — the mature annual figure once past the launch year.
   */
  h3: Horizon;
  h12: Horizon;
  h25: Horizon;
  /** Raw per-sample horizon revenue (EUR) — 3-month, first-year, years-2–5-annual — so a supermix can re-pool them. */
  sH3: Float64Array;
  sH12: Float64Array;
  sH25: Float64Array;
  /** Terminal value at month 60 (EUR): annual run-rate × a sampled multiple. p50 reported. */
  terminalValue: number;
  /** NPV of the 60-month net-collected stream (EUR), discounted at DISCOUNT_ANNUAL. p50 reported. */
  npv: number;
  /** After-tax cash to the operator ("net income"), average-yearly: the portfolio's personal-track
   * tax schedule for personal tracks (PERSONAL_AFTER_TAX), gross-margin × effective business tax
   * otherwise, minus annual operating cost (can be < 0). Full set reported so the Overview table can
   * switch to a net-income view. */
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
  /** The decision floor used for pFloor (EUR/yr). */
  floor: number;
  /** Mean months of the launch lag, split into compressible build vs uncompressible institutional. */
  lagBuild: number;
  lagInstitutional: number;
  /** Raw per-sample after-tax average-yearly (EUR), so a supermix can re-pool it. */
  sAfter: Float64Array;
  /** Variance decomposition: the nodes that drive the outcome most, |corr| descending. */
  tornado: TornadoBar[];
  /** Price-as-output diagnostic (additive; populated only for units with priceSweep). The
   * revenue(price) curve under the demand overlay + active capacity cap, the sampled
   * ("planned") price for reference, and the revenue-optimal price. Revenue is p50 average-yearly
   * EUR; hoursUtil is mean peak capacity utilisation (1 = fully booked). */
  priceCurve?: PricePoint[];
  plannedPrice?: number;
  optimalPrice?: number;
  optimalRevenue?: number;
  optimalHoursUtil?: number;
  /** Per-year revenue (EUR), year 1 → year 5, each as {p20,p50,mean,p80}. Built by bucketing every
   *  draw's 60-month trajectory into 12-month years. Additive — does not affect any headline. */
  yearRevenue?: YearStat[];
  /** Per-year net income (EUR), year 1 → year 5, each as {p20,p50,mean,p80}: that year's revenue put
   *  through the same net transform as the after-tax line (business margin × (1 − tax), or the personal-tax schedule
   *  tax for personal tracks) minus the annual operating cost. */
  yearNet?: YearStat[];
  /** Per-year operating cost distribution (EUR), one YearStat per year — the `cost()` outlay, gated to the
   *  readiness phase onward (0 during the pure code build). Lets the project page split income vs cost by year. */
  costStat?: YearStat[];
  /** Per-year cost-of-revenue (gross-margin haircut, EUR) and tax, so the project page can break the
   *  revenue→net bridge into its components. Business: cogs = rev×(1−margin), tax = rev×margin×tax-rate;
   *  personal tracks: cogs = 0, tax = the income tax (rev − net). */
  yearCogs?: YearStat[];
  yearTax?: YearStat[];
  /** Itemized income-statement sub-lines, each an INDEPENDENT per-draw quantity (not a share): revenue,
   *  cost-of-revenue AND operating-cost lines all carry a per-year stat (operating cost is readiness-gated,
   *  so it varies by year). Because each is sampled independently, sub-line percentiles do NOT sum to the
   *  parent's percentile (only the means do). */
  statementLines?: {
    revenue?: { label: string; stat: YearStat[] }[];
    cogs?: { label: string; stat: YearStat[] }[];
    opcost?: { label: string; stat: YearStat[] }[];
  };
  /** Raw per-year samples (EUR), 5 arrays of N — revenue and net — so a supermix can re-pool them
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
  loss: number; // draws below €0
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
