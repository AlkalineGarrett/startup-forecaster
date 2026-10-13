// The Monte-Carlo engine. Per iteration it draws one correlated parameter vector (a multi-factor
// Gaussian copula over metalog marginals) and runs each unit's deterministic 60-month trajectory,
// then summarises the distribution of average-yearly revenue plus the decision-relevant outputs
// (terminal value, NPV, after-tax cash, P(< floor), lag split). Shared "macro"/"ai_demand" factors
// are QMC-driven and reused across projects (common random numbers), so the ranking isn't noise.
import type { Project, ProjectNode, RunResult, RunUnit, ScenarioState, Rng, Horizon, YearStat, MonthTraj, Loadings, TornadoBar, PricePoint } from "./types.ts";
import { HORIZON_MONTHS, HORIZON_YEARS, HEADLINE_FROM_YEAR } from "./types.ts";
import { mulberry32, rnorm } from "./rng.ts";
import { frac, nodeAxis, OVERRIDE_SD, ptsOf, type NodeAxis } from "./quantile.ts";
import { buildMarginal, qAt, type MetaBound } from "./metalog.ts";
import { construct, truncate } from "./distributions.ts";
import { DISTRIBUTIONS } from "./portfolio-context.ts";
import { idioCoef, latentU, localFactorNames, rhoToLoadings } from "./factors.ts";
import { globalFactors } from "./qmc.ts";
import { RHO, LOADINGS, PERSONAL_AFTER_TAX, BUSINESS_TAX } from "./portfolio-context.ts";
import { npvOf, runRate60 } from "./accounting.ts";

/** Draws per project. 20k in production. Tests override it to run ~50× faster: MC_N env for the
 *  direct-import suites, globalThis.__MC_N for the built-bundle DOM stub (which has no `process`). They
 *  check shapes/relationships/no-throw, not statistical precision — so a small N is fine. golden.test
 *  (the exact-reproduction guard) runs with neither set → 20k, so published numbers are unaffected. */
const _nOverride =
  (typeof process !== "undefined" && process.env && process.env.MC_N) ||
  (typeof globalThis !== "undefined" && (globalThis as { __MC_N?: number }).__MC_N) ||
  0;
export const N: number = _nOverride ? Number(_nOverride) : 20000;
/** Fixed seed so every run is reproducible. */
export const SEED = 987654321;
/** "Meaningful" revenue threshold, EUR/yr, for pSucc / conditional median. */
export const THR = 5000;
/** Decision floor, EUR/yr, for the P(revenue < floor) go/no-go diagnostic. */
export const FLOOR = 12000;
/** Reference-class p90 (EUR/yr) for solo-software outcomes (~p90 of the brutally-Pareto base
 * rate: 17.3% of new subscription apps reach $1k MRR, 4.6% reach $10k MRR). A product project
 * whose p50 exceeds this is flagged: the inputs are likely optimistic no matter how reasonable
 * each node looked. */
export const REFERENCE_P90 = 45000;


// --- Progress heartbeat (opt-in) -------------------------------------------------------------------
// Every N-draw pass (runUnit / runCombined) is tens of thousands of draws; a full regen, the pairwise
// bake, or a sim-heavy test runs dozens of them back-to-back with NO output, so a slow run is
// indistinguishable from a hung one. When MC_PROGRESS is set in the environment we emit a throttled
// heartbeat to STDERR (never stdout — keeps TAP/golden/pairwise output byte-clean) showing pass count,
// elapsed, rate, and the current unit. Guarded on `typeof process` so it is inert (and tree-shakes to
// a no-op) in the browser artifact; zero cost beyond a counter increment when the flag is unset.
const PROGRESS: boolean = typeof process !== "undefined" && !!process.env && !!process.env.MC_PROGRESS;
let simPasses = 0;
let progStart = 0;
let progLastBeat = 0;
function progressTick(label: string): void {
  simPasses++;
  if (!PROGRESS) return;
  const now = performance.now();
  if (progStart === 0) progStart = now;
  if (simPasses > 1 && now - progLastBeat < 150) return; // throttle to ~7 lines/s max
  progLastBeat = now;
  const secs = (now - progStart) / 1000;
  const rate = secs > 0 ? (simPasses / secs).toFixed(1) : "—";
  const line = `[sim] ${simPasses} passes · ${secs.toFixed(1)}s · ${rate}/s · ${label}`;
  const err = process.stderr;
  err.write(err.isTTY ? `\r\x1b[K${line}` : line + "\n");
}
/** Reset the heartbeat's counters/clock (call at the start of a batch job so its rate is measured
 *  from that job, not process start). No-op when MC_PROGRESS is unset. */
export function resetProgress(): void { simPasses = 0; progStart = 0; progLastBeat = 0; }

function clampRate(x: number): number {
  return Math.max(0.001, Math.min(0.999, x));
}

// Per-node work invariant across all N draws, computed once per run.
interface NodePlan {
  node: ProjectNode;
  gate: boolean;
  /** The node's inverse-CDF Q(u): sample off the copula's uniform. For a value node this is the
   *  final in-support draw; for a gate it is the pass-rate (Bernoulli'd in drawScenario). */
  sample: (u: number) => number;
  loadings: Loadings;
  ic: number; // idiosyncratic coefficient sqrt(1 - sum lambda^2)
  axis: NodeAxis;
  override?: number;
}

const clampU = (u: number): number => Math.max(1e-9, Math.min(1 - 1e-9, u));

/**
 * The node's Q(u). Primary path: the grounded `distribution.kind` from the compiled data
 * (construct + optional truncation) — in-support by construction, so no fraction clamp. Fallback
 * (a node absent from the compiled data): a metalog fit through its authored quantiles.
 */
// The per-node inverse-CDF is a PURE function of static inputs — the DISTRIBUTIONS spec (or the node's
// fixed percentile points) and whether it's a gate. It does NOT depend on the node's _override (that's
// applied separately in drawScenario), so the same (unit, node) always yields the same sampler. Building
// it runs the expensive beta/metalog machinery (construct/buildMarginal → betai/invbetai/gammln), and
// planUnit is called repeatedly (headline + price sweep + runCombined + every edit re-run), so we
// memoize per key: construct() runs once per node for the process, not once per planUnit.
const _samplerCache = new Map<string, (u: number) => number>();
function nodeSampler(unitId: string, node: ProjectNode, gate: boolean): (u: number) => number {
  const key = `${unitId}::${node.id}`;
  const hit = _samplerCache.get(key);
  if (hit) return hit;
  const nd = DISTRIBUTIONS[key];
  let fn: (u: number) => number;
  if (nd) {
    let dist = construct(nd.d);
    if (nd.trunc) dist = truncate(dist, nd.trunc.lower ?? null, nd.trunc.upper ?? null);
    fn = (u) => dist.ppf(clampU(u));
  } else {
    // A node that HAS a compiled distribution (applyDistributions stamped _support) but is looked up under a
    // key that misses it is being run under the wrong unit id (e.g. a raw Variant, id "addon", instead of
    // "project::addon") — it would silently sample the UI readout percentiles instead of the distribution.
    if (node._support != null) throw new Error(`node ${key}: has a compiled distribution but none under this key — run variants as "<project>::<variant>" units (see variantUnit)`);
    const pts = ptsOf(node);
    // A node either has a compiled distribution or authors ≥2 percentiles; a structure-only node
    // (distribution kept in the data project) whose compiled entry is missing is a pipeline gap.
    if (pts.length < 2) throw new Error(`node ${key}: no compiled distribution and no authored percentiles — regenerate the portfolio's distributions (or author pctiles)`);
    const marginal = buildMarginal(pts.map(([y, x]) => ({ y, x })), boundOf(node, gate), 0, 1);
    fn = gate ? (u) => qAt(marginal, clampU(u)) : (u) => frac(node, qAt(marginal, clampU(u)));
  }
  _samplerCache.set(key, fn);
  return fn;
}
interface UnitPlan {
  order: NodePlan[];
  localNames: string[]; // non-global factor names drawn per project per iteration
}

/** Choose the metalog bound for a node from its kind / fraction flag (overridable via node.bound). */
function boundOf(node: ProjectNode, gate: boolean): MetaBound {
  if (node.bound) return node.bound;
  return gate || node._frac ? "bounded" : "semi-lo";
}

/** Precompute each node's marginal, loadings and correlation constants once per run. */
function planUnit(unit: RunUnit): UnitPlan {
  const rmap = unit.rho || {};
  const order: NodePlan[] = [];
  const loadingsList: Loadings[] = [];
  const extra = LOADINGS[unit.id] || {};
  for (const node of unit.nodes) {
    const gate = node.kind === "gate";
    // Merge the scalar execution loading (RHO) with the multi-factor loadings (LOADINGS table)
    // and any node-level override — so a demand-curve pair can add an opposite-sign factor while
    // keeping its execution loading.
    const loadings = { ...rhoToLoadings(rmap[node.id] || 0), ...(extra[node.id] || {}), ...(node.loadings || {}) };
    order.push({ node, gate, sample: nodeSampler(unit.id, node, gate), loadings, ic: idioCoef(loadings), axis: nodeAxis(node), override: node._override });
    loadingsList.push(loadings);
  }
  return { order, localNames: localFactorNames(loadingsList) };
}

/**
 * Draw one correlated scenario. `z` carries this iteration's shared global factors on entry; the
 * unit's local factors are drawn into it here, then each node's uniform is u = Φ(Σλz + ic·ε) and
 * its value is the metalog quantile at u. Gates Bernoulli against a sampled pass-rate.
 */
function drawScenario(plan: UnitPlan, r: Rng, z: Record<string, number>): ScenarioState {
  for (const name of plan.localNames) z[name] = rnorm(r);
  const s: ScenarioState = {};
  for (const pl of plan.order) {
    const eps = rnorm(r);
    if (pl.gate) {
      const rate = pl.override != null ? pl.axis.toValue(pl.override) : clampRate(pl.sample(latentU(pl.loadings, pl.ic, z, eps)));
      s[pl.node.id] = r() < rate ? 1 : 0;
    } else if (pl.override != null) {
      s[pl.node.id] = frac(pl.node, pl.axis.toValue(pl.override + OVERRIDE_SD * eps));
    } else {
      s[pl.node.id] = pl.sample(latentU(pl.loadings, pl.ic, z, eps));
    }
  }
  return s;
}

/** P20/P50/P80 of a horizon array (sorts a copy). */
function hz(arr: Float64Array): Horizon {
  const a = Float64Array.prototype.slice.call(arr).sort();
  const q = (f: number): number => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  let s = 0; for (let k = 0; k < a.length; k++) s += a[k];
  return { p20: q(0.2), p50: q(0.5), p80: q(0.8), mean: a.length ? s / a.length : 0 };
}
const qOf = (sorted: Float64Array, f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
function median(a: Float64Array): number {
  const c = Float64Array.prototype.slice.call(a).sort();
  return qOf(c, 0.5);
}

/** Ordinal ranks of an array (0-based rank by ascending value; ties broken by index). Reuses a
 *  scratch index buffer across calls to avoid re-allocating a fresh sort array every time. */
let _rankIdx = new Uint32Array(0);
function ranks(a: Float64Array): Float64Array {
  const n = a.length;
  if (_rankIdx.length < n) _rankIdx = new Uint32Array(n);
  const idx = _rankIdx;
  for (let i = 0; i < n; i++) idx[i] = i;
  // Sort the FIRST n entries by value. (subarray keeps the comparator sort on exactly n elements.)
  const view = n === idx.length ? idx : idx.subarray(0, n);
  view.sort((x, y) => a[x] - a[y]);
  const rk = new Float64Array(n);
  for (let r = 0; r < n; r++) rk[view[r]] = r;
  return rk;
}

/** Spearman correlation given one series' precomputed ranks `ry` and the other array `x`. The rank
 *  vectors are permutations of 0..n-1, so Σr and Σr² are constants — only the cross term Σ(rx·ry)
 *  varies. Bit-identical to the general Pearson-on-ranks form, but skips four accumulators. */
function spearmanTo(x: Float64Array, ry: Float64Array): number {
  const rx = ranks(x);
  const n = x.length;
  const S = (n * (n - 1)) / 2; // Σ ranks
  const SS = ((n - 1) * n * (2 * n - 1)) / 6; // Σ ranks²
  let sxy = 0;
  for (let i = 0; i < n; i++) sxy += rx[i] * ry[i];
  const cov = sxy - (S * S) / n;
  const varr = SS - (S * S) / n; // vx == vy for permutation ranks
  return varr > 0 ? cov / varr : 0;
}

/** A driver is "unidentified" when nothing published grounds it: for a compiled node, a support score in the
 *  guess band (< 40); for a hand-authored one, no cited source. (Compiled nodes always clear `urls`, so
 *  reading urls alone flagged every compiled node.) */
function isUnidentified(n: ProjectNode): boolean {
  return n._support != null ? n._support < 40 : !(n.urls && n.urls.length);
}

/** Variance decomposition: rank correlation of each node's draw with the outcome, |corr| desc.
 *  `ranks(out)` is computed ONCE here (was recomputed per node — the top sim hotspot). */
function computeTornado(order: NodePlan[], nodeVals: Float64Array[], out: Float64Array): TornadoBar[] {
  const ro = ranks(out);
  return order
    .map((pl, j) => ({ id: pl.node.id, label: pl.node.label, corr: spearmanTo(nodeVals[j], ro), unidentified: isUnidentified(pl.node) }))
    .filter((b) => Math.abs(b.corr) > 0.02)
    .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
    .slice(0, 8);
}

/** Per-draw scratch + accumulators for one unit's simulation. */
interface Draws {
  out: Float64Array; // average-yearly gross revenue, EUR
  h3: Float64Array;
  h12: Float64Array;
  h25: Float64Array;
  aft: Float64Array; // after-tax average-yearly, EUR
  tv: Float64Array; // terminal value, EUR
  npv: Float64Array; // NPV of the 60-month stream, EUR
  margin: Float64Array;
  lagB: number; // Σ build-lag months
  lagI: number; // Σ institutional-lag months
  yearRevAll: Float64Array[]; // per-year revenue, EUR — 5 buckets, one value per draw (for quantiles)
  yearNetAll: Float64Array[]; // per-year net income, EUR — 5 buckets, one value per draw
  yearCogsAll: Float64Array[]; // per-year cost-of-revenue (gross-margin haircut), EUR
  yearTaxAll: Float64Array[]; // per-year tax, EUR (residual so rev − cogs − tax − cost = net)
  yearCostAll: Float64Array[]; // per-year operating cost, EUR — gated by the readiness-phase start
  cost: Float64Array; // steady-state annual operating cost, EUR — one value per draw (used by the after-tax avg)
  // Itemized income-statement sub-lines (only allocated when the unit declares them). Each is an
  // INDEPENDENT per-draw quantity, all per-year [lineIdx][year][draw]. lineMeta carries the labels so
  // finalize can build statementLines.
  revLineAll?: Float64Array[][];
  cogsLineAll?: Float64Array[][];
  opcostLineAll?: Float64Array[][];
  lineMeta?: { rev: string[]; cogs: string[]; opcost: string[] };
}

/** Turn one draw's trajectory + scenario into the per-iteration outputs. */
function recordDraw(d: Draws, i: number, traj: MonthTraj, fx: number, unit: RunUnit, s: ScenarioState, parts?: Record<string, MonthTraj>): void {
  let first3 = 0, first12 = 0, rest = 0;
  const fromMonth = 12 * (HEADLINE_FROM_YEAR - 1), headlineYears = HORIZON_YEARS - HEADLINE_FROM_YEAR + 1;
  for (let t = 0; t < HORIZON_MONTHS; t++) {
    const v = traj[t];
    if (t < 3) first3 += v;
    if (t < 12) first12 += v;
    if (t >= fromMonth) rest += v;
  }
  // HEADLINE = the SUSTAINED annual average over the headline window (default years 2–5, months 13–60),
  // excluding the year-1 ramp, so P20/P50/Mean/P80 reflect a steady-state level rather than the build-up.
  const avgYearly = (rest / headlineYears) * fx;
  d.out[i] = avgYearly;
  d.h3[i] = first3 * fx;
  d.h12[i] = first12 * fx;
  d.h25[i] = (rest / headlineYears) * fx;
  const margin = unit.margin ? unit.margin(s) : 0.8;
  d.margin[i] = margin;
  // Cost of revenue as a FRACTION of (gross, billed) revenue. When the unit itemizes cost-of-revenue
  // lines, sum their rates so the bridge reconciles to the parts (each line = rate × revenue); otherwise
  // derive it from the gross-margin node. Personal tracks with no cost-of-revenue lines (salary) carry
  // zero — their revenue is already taxable income. NOTE: revenue is BILLED gross; platform/payment take
  // (Stripe/App-Store) is now an explicit cost-of-revenue line (a rate the sim stashes), not netted into
  // revenue, so gross profit = revenue × (1 − cogsRate) matches the itemized statement.
  const cogsRate = unit.cogsLines
    ? unit.cogsLines.reduce((acc, c) => acc + c.rate(s), 0)
    : unit.personal ? 0 : 1 - margin;
  // Operating cost-to-serve reduces the contribution line, NOT reported revenue (gross stays ≥ 0).
  // A negative contribution draw is a viability event — the correct object for it.
  const costAnnual = unit.cost ? unit.cost(s) * fx : 0;
  d.cost[i] = costAnnual;
  // Operating cost (compliance: audits, certifications, security, HIPAA) is incurred during the READINESS
  // phase and after — NOT during the pure code build, when there is no product to certify, no PHI and no
  // customers. So it begins when readiness starts, at month = code_months. `costFrac(y)` is the share of
  // year y at/after that start (1 once fully in the readiness/live era, 0 in the pre-readiness build).
  const readyStart = s.code_months || 0;
  const costFrac = (y: number): number => {
    const start = 12 * y, end = start + 12;
    if (readyStart <= start) return 1;
    if (readyStart >= end) return 0;
    return (end - readyStart) / 12;
  };
  // Net-of-tax transform for a gross-revenue figure at a given operating cost, shared by the average-yearly
  // after-tax line and the per-year net series so they stay consistent. Personal → the personal-tax schedule / sampled net
  // multiplier, less operating cost. Business → operating cost is a DEDUCTIBLE expense: pre-tax profit is
  // (gross profit − operating cost), business tax hits only positive pre-tax profit, and a pre-tax loss is
  // untaxed. (Previously tax hit gross profit and opcost was subtracted post-tax, which overstated tax
  // whenever operating cost was material — e.g. tax exceeding net income.)
  const netFrom = (grossEur: number, opcost: number): number => {
    const grossProfit = Math.max(0, grossEur) * (1 - cogsRate); // billed revenue − cost of revenue
    if (unit.personal) {
      if (s.net_tax_multiplier != null) return grossProfit * s.net_tax_multiplier - opcost;
      // A unit-specific schedule (e.g. self-employed vs salaried, or a company route) wins over the portfolio-wide one;
      // it receives the operating cost (it may be tax-deductible there) and returns the final net.
      return unit.afterTax ? unit.afterTax(Math.max(0, grossEur), grossProfit, s, opcost) : PERSONAL_AFTER_TAX(grossProfit) - opcost;
    }
    const pretax = grossProfit - opcost; // less deductible operating cost
    return pretax > 0 ? pretax * (1 - BUSINESS_TAX) : pretax;
  };
  // Headline after-tax average is a STEADY-STATE (years 2–5, live) figure → full annual operating cost.
  d.aft[i] = netFrom(avgYearly, costAnnual);
  // Per-year revenue + net income (EUR): bucket the 60-month trajectory into 5 twelve-month years,
  // storing each draw so finalize can take per-year p20/p50/mean/p80 (not just the mean).
  for (let y = 0; y < HORIZON_YEARS; y++) {
    let yr = 0;
    for (let t = 12 * y; t < 12 * y + 12 && t < HORIZON_MONTHS; t++) yr += traj[t];
    const yrEur = yr * fx;
    d.yearRevAll[y][i] = yrEur;
    const opcostY = costAnnual * costFrac(y); // compliance gated to the readiness phase onward
    d.yearCostAll[y][i] = opcostY;
    const netY = netFrom(yrEur, opcostY);
    d.yearNetAll[y][i] = netY;
    // Revenue→net bridge components. Cost of revenue = rev × cogsRate (the summed itemized rates, or the
    // 1−margin fallback; zero for a personal salary track). Tax is the residual so rev − cogs − opcost −
    // tax = net exactly (business tax on pre-tax profit, or the portfolio's personal-tax schedule for personal tracks).
    const cogsY = yrEur * cogsRate;
    d.yearCogsAll[y][i] = cogsY;
    d.yearTaxAll[y][i] = yrEur - netY - cogsY - opcostY;
    // Itemized sub-lines (independent quantities), all per-year. Revenue: this year's slice of each parts
    // buffer. Cost-of-revenue: each component's rate × this year's gross revenue. Operating cost: each
    // fixed component × this year's readiness-gated cost fraction (so pre-readiness build years show 0).
    if (d.revLineAll && parts) {
      for (let k = 0; k < d.lineMeta!.rev.length; k++) {
        const buf = parts[d.lineMeta!.rev[k]];
        let yr2 = 0;
        if (buf) for (let t = 12 * y; t < 12 * y + 12 && t < HORIZON_MONTHS; t++) yr2 += buf[t];
        d.revLineAll[k][y][i] = yr2 * fx;
      }
    }
    if (d.cogsLineAll && unit.cogsLines) {
      for (let k = 0; k < unit.cogsLines.length; k++) d.cogsLineAll[k][y][i] = yrEur * unit.cogsLines[k].rate(s);
    }
    if (d.opcostLineAll && unit.costLines) {
      for (let k = 0; k < unit.costLines.length; k++) d.opcostLineAll[k][y][i] = unit.costLines[k].amount(s) * fx * costFrac(y);
    }
  }
  const mult = unit.tvMultiple ? unit.tvMultiple(s) : unit.personal ? 0 : 3;
  d.tv[i] = runRate60(traj) * fx * mult;
  d.npv[i] = npvOf(traj) * fx;
  d.lagB += s.code_months || 0;
  d.lagI += s.readiness_months || 0;
}

function finalize(d: Draws, nDraws: number): RunResult {
  d.out.sort();
  const aftSorted = Float64Array.prototype.slice.call(d.aft).sort();
  let succ = 0, floor = 0, mean = 0;
  const succArr: number[] = [];
  for (let k = 0; k < d.out.length; k++) {
    mean += d.out[k];
    if (d.out[k] >= THR) { succ++; succArr.push(d.out[k]); }
    if (d.out[k] < FLOOR) floor++;
  }
  mean /= d.out.length;
  // Net-income ("after-tax") summary, parallel to the revenue one, for the Overview net view.
  let aftSucc = 0, aftMean = 0;
  const aftSuccArr: number[] = [];
  for (let k = 0; k < aftSorted.length; k++) {
    aftMean += aftSorted[k];
    if (aftSorted[k] >= THR) { aftSucc++; aftSuccArr.push(aftSorted[k]); }
  }
  aftMean /= aftSorted.length || 1;
  // aftSuccArr is a contiguous tail of the sorted array, so it is already sorted → median is its midpoint.
  return {
    samples: d.out,
    p20: qOf(d.out, 0.2), p50: qOf(d.out, 0.5), p80: qOf(d.out, 0.8), p95: qOf(d.out, 0.95),
    mean,
    pSucc: succ / d.out.length,
    condP50: succArr.length ? succArr[Math.floor(succArr.length * 0.5)] : 0,
    thr: THR,
    h3: hz(d.h3), h12: hz(d.h12), h25: hz(d.h25),
    sH3: d.h3, sH12: d.h12, sH25: d.h25,
    terminalValue: median(d.tv),
    npv: median(d.npv),
    afterTax20: qOf(aftSorted, 0.2), afterTax50: qOf(aftSorted, 0.5), afterTax80: qOf(aftSorted, 0.8),
    afterTaxMean: aftMean, afterTaxPSucc: aftSucc / (aftSorted.length || 1),
    afterTaxCondP50: aftSuccArr.length ? aftSuccArr[Math.floor(aftSuccArr.length * 0.5)] : 0,
    grossMargin: median(d.margin),
    pFloor: floor / d.out.length,
    floor: FLOOR,
    lagBuild: d.lagB / nDraws,
    lagInstitutional: d.lagI / nDraws,
    sAfter: d.aft,
    tornado: [],
    yearRevenue: yearStats(d.yearRevAll),
    yearNet: yearStats(d.yearNetAll),
    costStat: yearStats(d.yearCostAll),
    yearCogs: yearStats(d.yearCogsAll),
    yearTax: yearStats(d.yearTaxAll),
    statementLines: d.lineMeta
      ? {
          revenue: d.revLineAll ? d.revLineAll.map((cols, k) => ({ label: d.lineMeta!.rev[k], stat: yearStats(cols) })) : undefined,
          cogs: d.cogsLineAll ? d.cogsLineAll.map((cols, k) => ({ label: d.lineMeta!.cogs[k], stat: yearStats(cols) })) : undefined,
          opcost: d.opcostLineAll ? d.opcostLineAll.map((cols, k) => ({ label: d.lineMeta!.opcost[k], stat: yearStats(cols) })) : undefined,
        }
      : undefined,
    sYearRev: d.yearRevAll,
    sYearNet: d.yearNetAll,
  };
}

/** Reduce 5 per-year sample columns to the four switcher metrics (p20/p50/mean/p80) each. */
function yearStats(cols: Float64Array[]): YearStat[] {
  return cols.map((col) => {
    const a = Float64Array.prototype.slice.call(col).sort();
    const q = (f: number): number => a[Math.min(a.length - 1, Math.floor(f * a.length))];
    let s = 0; for (let k = 0; k < a.length; k++) s += a[k];
    return { p20: q(0.2), p50: q(0.5), mean: a.length ? s / a.length : 0, p80: q(0.8) };
  });
}

function newDraws(): Draws {
  return {
    out: new Float64Array(N), h3: new Float64Array(N), h12: new Float64Array(N), h25: new Float64Array(N),
    aft: new Float64Array(N), tv: new Float64Array(N), npv: new Float64Array(N), margin: new Float64Array(N),
    lagB: 0, lagI: 0,
    yearRevAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearNetAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearCogsAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearTaxAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearCostAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    cost: new Float64Array(N),
  };
}

/** The Cranley–Patterson rotation for the QMC shared-factor sequence (deterministic from SEED). */
function qmcShift(seed: number = SEED): number[] {
  const r = mulberry32(seed ^ 0x9e3779b9);
  return Array.from({ length: 11 }, () => r());
}

/** Run the full simulation for one self-contained unit (a project's base graph, or a variant).
 * `seed` defaults to the frozen SEED (golden path); pass a different seed for replication tests. */
// Memoized revenue-optimal price per priced unit, keyed by its (shared, singleton) priceSweep object.
// The headline, runCombined (pairwise / additive-variant sums), and the price card all price at this
// optimum, so it must be computed once per unit rather than swept inside every pairwise cell. Populated
// by sweepOptimalPrice; re-populated whenever a unit is re-run after an override (which changes its
// optimum). clearOptima() drops the cache wholesale (belt-and-braces for a full reset).
const OPTIMA = new Map<object, number>();
export function clearOptima(): void { OPTIMA.clear(); }
/** The memoized optimal price for a unit (computing+caching it via one sweep if not seen yet). */
function optimalFor(unit: RunUnit): number | undefined {
  if (!unit.priceSweep) return undefined;
  const hit = OPTIMA.get(unit.priceSweep);
  return hit != null ? hit : (sweepOptimalPrice(unit).optimalPrice as number | undefined);
}

export function runUnit(unit: RunUnit, seed: number = SEED, opts: { sweep?: boolean; headlineAtOptimal?: boolean } = {}): RunResult {
  // Price as OUTPUT: for a priced unit we (1) sweep to find the revenue-optimal price (bounded by the
  // substitution ceiling), then (2) run the HEADLINE draws at that price so the reported P20/P50/P80 is
  // "revenue when priced optimally", not at an arbitrary planned price. The demand nodes
  // (competitor/WTP/elasticity, and any capacity nodes) live in priceSweep.extraNodes, so they must
  // be spliced into the headline plan too — otherwise the overlay reads undefined refs and stays inert.
  // Non-priced units, or callers passing {headlineAtOptimal:false}, keep the plain planned-price headline.
  const doSweep = !!unit.priceSweep && opts.sweep !== false;
  const sw = doSweep ? sweepOptimalPrice(unit, seed) : undefined;
  const atOptimal = !!sw && opts.headlineAtOptimal !== false;
  const decisionPrice = atOptimal ? sw!.optimalPrice : undefined;
  const nodes = atOptimal ? [...unit.nodes, ...(unit.priceSweep!.extraNodes || [])] : unit.nodes;
  const r = mulberry32(seed);
  const shift = qmcShift(seed);
  const plan = planUnit({ ...unit, nodes });
  const d = newDraws();
  const traj = new Float64Array(HORIZON_MONTHS);
  const nodeVals = plan.order.map(() => new Float64Array(N));
  // Itemized income-statement lines (independent per-draw quantities). Allocate storage + the per-line
  // revenue buffers the sim fills, only when the unit declares them.
  const revLabels = unit.revenueLines || [];
  const cogsN = unit.cogsLines ? unit.cogsLines.length : 0;
  const opcostN = unit.costLines ? unit.costLines.length : 0;
  if (revLabels.length || cogsN || opcostN) {
    d.lineMeta = { rev: revLabels, cogs: (unit.cogsLines || []).map((c) => c.label), opcost: (unit.costLines || []).map((c) => c.label) };
    if (revLabels.length) d.revLineAll = revLabels.map(() => Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)));
    if (cogsN) d.cogsLineAll = Array.from({ length: cogsN }, () => Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)));
    if (opcostN) d.opcostLineAll = Array.from({ length: opcostN }, () => Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)));
  }
  const parts: Record<string, MonthTraj> | undefined = revLabels.length ? Object.fromEntries(revLabels.map((l) => [l, new Float64Array(HORIZON_MONTHS)])) : undefined;
  for (let i = 0; i < N; i++) {
    const z = globalFactors(i, shift);
    const s = drawScenario(plan, r, z);
    if (decisionPrice != null) (s as any).__decisionPrice = decisionPrice;
    traj.fill(0);
    if (parts) for (const l of revLabels) parts[l].fill(0);
    unit.sim(s, r, traj, parts);
    recordDraw(d, i, traj, unit.fx, unit, s, parts);
    for (let j = 0; j < plan.order.length; j++) nodeVals[j][i] = s[plan.order[j].node.id];
  }
  const tornado = computeTornado(plan.order, nodeVals, d.out); // before finalize sorts d.out
  const res = finalize(d, N);
  res.tornado = tornado;
  if (sw) Object.assign(res, sw);
  progressTick(`runUnit ${unit.id}`);
  return res;
}

/**
 * Price-as-output sweep (additive diagnostic). For each price on a grid, rerun the unit's draws with
 * the decision price injected (`__decisionPrice`) so the demand overlay + capacity cap engage,
 * and record p50 average-yearly gross revenue + mean peak hours-utilisation. Returns the curve, the
 * sampled ("planned") price (median of the priceNode), and the revenue-optimal price subject to
 * hours-utilisation ≤ 1 (falling back to the unconstrained max). Common random numbers across grid
 * points (same seed) keep the curve smooth; a subsample keeps it cheap.
 */
export function sweepOptimalPrice(unit: RunUnit, seed: number = SEED): Partial<RunResult> {
  // Draw the base nodes PLUS the sweep-only nodes (competitor/wtp/elasticity/capacity). For the
  // additive variants these are kept out of the headline graph so the headline RNG stream is
  // untouched; the sweep runs its own RNG, so augmenting here is free of the golden.
  const extra = unit.priceSweep!.extraNodes || [];
  const plan = planUnit({ ...unit, nodes: [...unit.nodes, ...extra] });
  const shift = qmcShift(seed);
  // The sweep only needs enough resolution to LOCATE the revenue-optimal price on a log grid; the
  // headline then runs the full N draws at that price, so a coarse subsample here is fine and keeps the
  // sweep (which now runs for every priced unit, in golden/pairwise/tests/boot) ~3× cheaper.
  const NS = Math.min(N, 2000);
  const priceNode = unit.priceSweep!.priceNode;
  const wtpNode = unit.priceSweep!.wtpNode;
  // Pre-pass (no sim): median sampled price ("planned") + median WTP ceiling, to size the grid to
  // this unit's price scale (consumer €2–20 vs seat $30–130) rather than a fixed range.
  const p0s: number[] = [], wtps: number[] = [];
  {
    const r = mulberry32(seed);
    for (let i = 0; i < NS; i++) {
      const z = globalFactors(i, shift);
      const s = drawScenario(plan, r, z);
      p0s.push(s[priceNode]);
      if (wtpNode) wtps.push(s[wtpNode]);
    }
  }
  p0s.sort((a, b) => a - b); wtps.sort((a, b) => a - b);
  const plannedPrice = p0s[Math.floor(0.5 * NS)] || 1;
  const medWtp = wtps.length ? wtps[Math.floor(0.5 * wtps.length)] : plannedPrice * 2.5;
  const GMIN = Math.max(0.5, plannedPrice * 0.3), GMAX = Math.max(plannedPrice * 2.5, medWtp * 1.35), K = 11;
  const grid = Array.from({ length: K }, (_, i) => GMIN * Math.pow(GMAX / GMIN, i / (K - 1)));
  const curve: PricePoint[] = [];
  const traj = new Float64Array(HORIZON_MONTHS);
  for (const price of grid) {
    const r = mulberry32(seed);
    const rev = new Float64Array(NS);
    let utilSum = 0;
    for (let i = 0; i < NS; i++) {
      const z = globalFactors(i, shift);
      const s = drawScenario(plan, r, z);
      (s as any).__decisionPrice = price;
      const rep = { util: 0 }; (s as any).__capReport = rep;
      traj.fill(0);
      unit.sim(s, r, traj);
      let rest = 0; for (let t = 12 * (HEADLINE_FROM_YEAR - 1); t < HORIZON_MONTHS; t++) rest += traj[t]; // the headline window, matching the headline
      rev[i] = (rest / (HORIZON_YEARS - HEADLINE_FROM_YEAR + 1)) * unit.fx;
      utilSum += rep.util;
    }
    // EXPECTED (mean) revenue — the right objective for a price decision, and robust to zero-inflation
    // (many products have a €0 median, which would make a p50 curve flat).
    let sum = 0; for (let i = 0; i < NS; i++) sum += rev[i];
    curve.push({ price, revenue: sum / NS, hoursUtil: utilSum / NS });
  }
  const feasible = curve.filter((c) => c.hoursUtil <= 1);
  const pool = feasible.length ? feasible : curve;
  let best = pool[0];
  for (const c of pool) if (c.revenue > best.revenue) best = c;
  if (unit.priceSweep) OPTIMA.set(unit.priceSweep, best.price); // cache for runCombined + the headline
  return { priceCurve: curve, plannedPrice, optimalPrice: best.price, optimalRevenue: best.revenue, optimalHoursUtil: best.hoursUtil };
}

/** Run a project's base graph (correlations from the global RHO table). */
export function run(p: Project, seed: number = SEED, opts: { sweep?: boolean } = {}): RunResult {
  return runUnit({ id: p.id, fx: p.fx, nodes: p.nodes, sim: p.sim, rho: RHO[p.id] || {}, margin: p.margin, tvMultiple: p.tvMultiple, cost: p.cost, personal: p.personal, afterTax: p.afterTax, priceSweep: p.priceSweep, revenueLines: p.revenueLines, cogsLines: p.cogsLines, costLines: p.costLines }, seed, opts);
}

/**
 * Run several units as one simulation: each draw shares the global factors, so the units are
 * correlated; the outcome is the SUM of every unit's trajectory (each converted to EUR). Used for
 * a pair of projects and for "all-fronts" (all variants pursued at once).
 */
export function runCombined(units: RunUnit[], opts: { concurrency?: number; overheadFrac?: number } = {}): RunResult {
  const r = mulberry32(SEED);
  const shift = qmcShift();
  // Price as OUTPUT here too: each priced unit is run at its (memoized) optimal price, and its demand
  // nodes (competitor/WTP/elasticity) are spliced into the plan so the overlay engages — otherwise the
  // combined sum (pairwise, additive-variant) would silently revert to planned pricing and
  // disagree with the per-project headlines. The optimum is memoized per priceSweep, so this adds no
  // per-cell sweep cost once the units have been run once.
  const unitOpt = units.map((u) => optimalFor(u));
  const plans = units.map((u) => planUnit(u.priceSweep ? { ...u, nodes: [...u.nodes, ...(u.priceSweep.extraNodes || [])] } : u));
  const d = newDraws();
  const summed = new Float64Array(HORIZON_MONTHS);
  const bufs = units.map(() => new Float64Array(HORIZON_MONTHS)); // per-unit fx-applied trajectory, reused
  const cum = new Float64Array(units.length);
  // Units sharing a non-empty market model the SAME buyer pool: within the group we add only the
  // largest member per draw, so the shared market (two units in the same market) is
  // not double-counted in a portfolio sum.
  const groups = new Map<string, number[]>();
  units.forEach((u, k) => {
    if (u.market) { if (!groups.has(u.market)) groups.set(u.market, []); groups.get(u.market)!.push(k); }
  });
  const sList: ScenarioState[] = units.map(() => ({}));
  for (let i = 0; i < N; i++) {
    const z = globalFactors(i, shift);
    let marginW = 0;
    const sMerged: ScenarioState = {};
    for (let k = 0; k < units.length; k++) {
      const s = drawScenario(plans[k], r, { ...z });
      if (unitOpt[k] != null) (s as any).__decisionPrice = unitOpt[k];
      sList[k] = s; // keep each unit's scenario so its own cost()/tvMultiple can be threaded below
      const b = bufs[k];
      b.fill(0);
      units[k].sim(s, r, b);
      let c = 0;
      for (let t = 0; t < HORIZON_MONTHS; t++) { b[t] *= units[k].fx; c += b[t]; }
      cum[k] = c;
      marginW += units[k].margin ? (units[k].margin as (x: ScenarioState) => number)(s) : 0.8;
      if ((s.code_months || 0) > (sMerged.code_months || 0)) sMerged.code_months = s.code_months;
      if ((s.readiness_months || 0) > (sMerged.readiness_months || 0)) sMerged.readiness_months = s.readiness_months;
    }
    // Active units this draw: the best of each shared-market group (overlap de-dup) + every untagged unit.
    summed.fill(0);
    const skip = new Set<number>();
    const active: number[] = [];
    for (const idxs of groups.values()) {
      let best = idxs[0];
      for (const k of idxs) { if (cum[k] > cum[best]) best = k; skip.add(k); }
      active.push(best);
    }
    for (let k = 0; k < units.length; k++) if (!skip.has(k)) active.push(k);
    // additive-variant allocation simplex: a hard concurrency cap — only the top-`concurrency` segments
    // by revenue can be pursued at once (the rest queue out) — plus a fixed per-segment overhead that
    // does not shrink with allocation. Absent → the plain sum (pairwise / non-additive projects).
    // A `base` unit (the generic "no wedge" core each wedge is built on) is always-on and exempt from
    // the cap; the cap governs only the incremental wedges.
    let contributing = active;
    if (opts.concurrency) {
      const baseUnits = active.filter((k) => units[k].base);
      const capped = active.filter((k) => !units[k].base);
      const kept = opts.concurrency < capped.length
        ? capped.slice().sort((a, b) => cum[b] - cum[a]).slice(0, opts.concurrency)
        : capped;
      contributing = baseUnits.concat(kept);
    }
    const keep = 1 - (opts.overheadFrac || 0);
    // Sum only the CONTRIBUTING units' trajectories AND their operating cost + terminal-value policy,
    // each fx-applied and scaled by the same overhead `keep`. runUnit honours per-unit cost(s) via
    // recordDraw's netOf, but the combined line used a synthetic cost-less unit — so the additive
    // aggregate overstated net/after-tax/NPV by omitting each variant's free-tier cost.
    // Thread it through here. tvMultiple is revenue-weighted across contributing units (default 3 for
    // business, 0 for personal, matching recordDraw's per-unit default); personal is set only when
    // EVERY contributing unit is personal, so a personal-only combo (e.g. two job/consulting tracks)
    // is not re-taxed at the 25% business rate. (Pairwise cells keep gross-only fields, so this tax
    // policy is invisible there and only bites the additive aggregate that consumes the full result.)
    let combinedCost = 0, tvNumer = 0, tvDenom = 0, allPersonal = contributing.length > 0;
    for (const k of contributing) {
      for (let t = 0; t < HORIZON_MONTHS; t++) summed[t] += bufs[k][t] * keep;
      const u = units[k], sk = sList[k];
      if (u.cost) combinedCost += u.cost(sk) * u.fx * keep;
      const mult = u.tvMultiple ? u.tvMultiple(sk) : u.personal ? 0 : 3;
      tvNumer += mult * cum[k]; tvDenom += cum[k];
      if (!u.personal) allPersonal = false;
    }
    const blendTv = tvDenom !== 0 ? tvNumer / tvDenom : (allPersonal ? 0 : 3);
    const blendMargin = marginW / units.length;
    recordDraw(d, i, summed, 1, {
      id: "combined", fx: 1, nodes: [], sim: () => {}, rho: {},
      margin: () => blendMargin, cost: () => combinedCost, tvMultiple: () => blendTv, personal: allPersonal,
    }, sMerged);
  }
  progressTick(`runCombined ${units.map((u) => u.id).join("+")}`);
  return finalize(d, N);
}

/** Equal-weight supermix: pool every unit's draws and summarise; scalar outputs count-weighted. */
export function supermix(results: RunResult[]): RunResult {
  let total = 0;
  for (const r of results) total += r.samples.length;
  const d = newDraws();
  d.out = new Float64Array(total); d.h3 = new Float64Array(total); d.h12 = new Float64Array(total);
  d.h25 = new Float64Array(total); d.aft = new Float64Array(total);
  d.tv = new Float64Array(total); d.npv = new Float64Array(total); d.margin = new Float64Array(total); d.cost = new Float64Array(total);
  // Pool the per-year samples too (5 buckets each), so the supermix reports real pooled per-year stats.
  d.yearRevAll = Array.from({ length: HORIZON_YEARS }, () => new Float64Array(total));
  d.yearNetAll = Array.from({ length: HORIZON_YEARS }, () => new Float64Array(total));
  // Component bridge arrays aren't re-pooled (the income/cost table isn't shown on variant supermix
  // panels); size them to `total` so finalize's yearStats reads a consistent (zero) array.
  d.yearCogsAll = Array.from({ length: HORIZON_YEARS }, () => new Float64Array(total));
  d.yearTaxAll = Array.from({ length: HORIZON_YEARS }, () => new Float64Array(total));
  d.yearCostAll = Array.from({ length: HORIZON_YEARS }, () => new Float64Array(total));
  let off = 0, wLagB = 0, wLagI = 0;
  for (const r of results) {
    const n = r.samples.length;
    d.out.set(r.samples, off); d.h3.set(r.sH3, off); d.h12.set(r.sH12, off); d.h25.set(r.sH25, off); d.aft.set(r.sAfter, off);
    d.tv.fill(r.terminalValue, off, off + n); d.npv.fill(r.npv, off, off + n); d.margin.fill(r.grossMargin, off, off + n);
    for (let y = 0; y < HORIZON_YEARS; y++) {
      if (r.sYearRev) d.yearRevAll[y].set(r.sYearRev[y], off);
      if (r.sYearNet) d.yearNetAll[y].set(r.sYearNet[y], off);
    }
    wLagB += r.lagBuild * n; wLagI += r.lagInstitutional * n;
    off += n;
  }
  d.lagB = wLagB; d.lagI = wLagI;
  return finalize(d, total);
}

/** Run every project, keyed by id. */
export function runAll(projects: Project[]): Record<string, RunResult> {
  const R: Record<string, RunResult> = {};
  for (const p of projects) R[p.id] = run(p);
  return R;
}
