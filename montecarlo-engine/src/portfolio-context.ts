// The data seam between the (generic, publishable) engine and a concrete portfolio.
//
// This module declares the portfolio-data bindings ONCE, as mutable module state, and exposes
// `configurePortfolio()` to populate them. Engine modules import these bindings from here; a
// portfolio (in the user's workspace) calls `configurePortfolio(...)` at init to attach its data. This is a
// configure-once, single-session context — matching the app's existing single-user design, and
// required by the bundler (build.mjs concatenates modules into one scope, so each canonical name
// must be declared exactly once and cannot be aliased).
//
// Load order: the data bootstrap (projects.ts) transitively imports the data modules, whose
// top-level configurePortfolio() calls run at init — before any run(). See DECOMPOSITION-PLAN.md.

import type { DistSpec } from "./distributions.ts";
import type { Correlations, Loadings, Project, RunResult } from "./types.ts";
import { applyModel } from "./templates.ts";
import { setHorizon, HORIZON_YEARS, HEADLINE_FROM_YEAR } from "./types.ts";
import { setCurrency, setMoneyBands } from "./format.ts";

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

/** Per-project scalar execution loadings (F_EXEC); mutated in place by initProjects (build lags). */
export let RHO: Correlations = {};

/** Per-unit multi-factor loadings table (supersedes the scalar RHO where present). */
export let LOADINGS: Record<string, Record<string, Loadings>> = {};

/** The portfolio's projects, fully initialised (build-lag nodes injected, distributions overlaid). */
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

// ── Tax model (jurisdiction-specific — supplied by the portfolio) ───────────────────────────────
/** Personal-track tax: gross annual profit (display currency, pre-fx-normalised) → after-tax cash.
 * Default: NO tax (identity) — the engine assumes no jurisdiction. A portfolio supplies its schedule. */
export let PERSONAL_AFTER_TAX: (grossAnnual: number) => number = (g) => Math.max(0, g);
/** Effective tax rate on positive business pre-tax profit. Default: 0 (no tax). Portfolio supplies it. */
export let BUSINESS_TAX = 0;

/** The page title shown in the results UI (browser tab + artifact). A portfolio may override it. */
export let PORTFOLIO_TITLE = "Monte-Carlo Portfolio";

/** Attach a portfolio's data to the engine. Each slice is optional; call once at init. */
export function configurePortfolio(p: {
  distributions?: Record<string, NodeDist>;
  rho?: Correlations;
  loadings?: Record<string, Record<string, Loadings>>;
  projects?: Project[];
  pairwiseIds?: string[];
  pairwisePrecomputed?: PairwiseLite;
  corpus?: Record<string, EvItem>;
  nodeRefs?: Record<string, string[]>;
  personalAfterTax?: (grossAnnual: number) => number;
  businessTax?: number;
  title?: string;
  /** Model horizon in years (default 5) and the first year of the sustained headline average (default 2). */
  horizonYears?: number;
  headlineFromYear?: number;
  /** The portfolio's display currency (default "$"; a project's own `cur` still wins in its scope). */
  currency?: string;
  /** Money colour-scale anchors [orange, green, blue] (default [50000, 100000, 200000]). */
  moneyBands?: [number, number, number];
}): void {
  // Horizon first: templates resolved below size their buffers from it.
  if (p.horizonYears != null || p.headlineFromYear != null) setHorizon(p.horizonYears ?? HORIZON_YEARS, p.headlineFromYear ?? HEADLINE_FROM_YEAR);
  if (p.currency) setCurrency(p.currency);
  if (p.moneyBands) setMoneyBands(p.moneyBands);
  if (p.distributions) DISTRIBUTIONS = p.distributions;
  if (p.rho) RHO = p.rho;
  if (p.loadings) LOADINGS = p.loadings;
  if (p.projects) {
    // A unit that declares a `model` (a business-model template, templates.ts) gets its sim + revenue/cost
    // lines + margin + opex + terminal multiple from it; fields it sets itself win.
    for (const proj of p.projects) { applyModel(proj); for (const v of proj.variants || []) applyModel(v); }
    PROJECTS = p.projects;
  }
  if (p.pairwiseIds) PAIRWISE_IDS = p.pairwiseIds;
  if (p.pairwisePrecomputed) PAIRWISE_PRECOMPUTED = p.pairwisePrecomputed;
  if (p.corpus) CORPUS = p.corpus;
  if (p.nodeRefs) NODE_REFS = p.nodeRefs;
  if (p.personalAfterTax) PERSONAL_AFTER_TAX = p.personalAfterTax;
  if (p.businessTax != null) BUSINESS_TAX = p.businessTax;
  if (p.title) PORTFOLIO_TITLE = p.title;
}
