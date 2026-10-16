// The Monte-Carlo engine. Per iteration it draws one correlated parameter vector (a multi-factor
// Gaussian copula over the nodes' marginals) and runs each unit's deterministic monthly trajectory over the
// horizon, then summarises the distribution of average-yearly revenue plus the decision-relevant outputs
// (terminal value, NPV, after-tax cash, P(< floor), lag split). The portfolio's shared factors are
// QMC-driven and reused across projects (common random numbers), so the ranking isn't noise.
import type { Project, ProjectNode, RunResult, RunUnit, ScenarioState, Rng, Horizon, YearStat, MonthTraj, Loadings, TornadoBar, PricePoint, CostLine } from "./types.ts";
import { HORIZON_MONTHS, HORIZON_YEARS, HEADLINE_FROM_YEAR } from "./types.ts";
import { mulberry32, rnorm } from "./rng.ts";
import { frac, nodeAxis, OVERRIDE_SD, ptsOf, type NodeAxis } from "./quantile.ts";
import { buildMarginal, qAt, type MetaBound } from "./metalog.ts";
import { construct, truncate } from "./distributions.ts";
import { DISTRIBUTIONS } from "./portfolio-context.ts";
import { idioCoef, latentU, localFactorNames, rhoToLoadings } from "./factors.ts";
import { globalFactors } from "./qmc.ts";
import { RHO, LOADINGS, PERSONAL_AFTER_TAX, BUSINESS_TAX, BUSINESS_AFTER_TAX, COSTS_START, UNIT_DEFAULTS, SUCCESS_THRESHOLD, DECISION_FLOOR, REPORTING_CURRENCY, currencyOf, toReporting, type CostStart } from "./portfolio-context.ts";
import { npvOf, runRateAtHorizon } from "./accounting.ts";
import { SUPPORT_MID } from "./apply-distributions.ts";

/** Draws per project. 20k in production. Tests override it to run ~50× faster: MC_N env for the
 *  direct-import suites, globalThis.__MC_N for the built-bundle DOM stub (which has no `process`). They
 *  check shapes/relationships/no-throw, not statistical precision — so a small N is fine. golden.test
 *  (the exact-reproduction guard) runs with neither set → 20k, so published numbers are unaffected. */
const _nOverride =
  (typeof process !== "undefined" && process.env && process.env.MC_N) ||
  (typeof globalThis !== "undefined" && (globalThis as { __MC_N?: number }).__MC_N) ||
  0;
export const N: number = _nOverride ? Number(_nOverride) : 20000;
/** mulberry32 (bit-identical to rng.ts's stream for the same seed) that also exposes its state, so a
 *  stream can be resumed later with mulberry32(state). */
function statefulMulberry(seed: number): Rng & { state(): number } {
  let a = seed | 0;
  const f = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(f, { state: () => a });
}
/** Fixed seed so every run is reproducible. */
export const SEED = 987654321;
// The thresholds (successThreshold, decisionFloor, referenceP90) are portfolio settings in the reporting
// currency: portfolio-context.ts. finalize() applies them in each result's currency.

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
    // (distribution kept in the data project) whose compiled entry is missing is a simulation-build gap.
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
function drawScenario(plan: UnitPlan, r: Rng, z: Record<string, number>, only?: Set<string>): ScenarioState {
  for (const name of plan.localNames) z[name] = rnorm(r);
  const s: ScenarioState = {};
  for (const pl of plan.order) {
    const eps = rnorm(r);
    // `only`: evaluate just these nodes, but consume the RNG exactly as a full draw does (same stream after).
    if (only && !only.has(pl.node.id)) { if (pl.gate) r(); continue; }
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

const qOf = (sorted: Float64Array, f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
/** P20/P50/P80 + mean of a horizon array (sorts a copy). */
function hz(arr: Float64Array): Horizon {
  const a = Float64Array.prototype.slice.call(arr).sort();
  let s = 0; for (let k = 0; k < a.length; k++) s += a[k];
  return { p20: qOf(a, 0.2), p50: qOf(a, 0.5), p80: qOf(a, 0.8), mean: a.length ? s / a.length : 0 };
}
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
 *  guess band (< SUPPORT_MID); for a hand-authored one, no cited source. (Compiled nodes always clear `urls`,
 *  so reading urls alone flagged every compiled node.) */
function isUnidentified(n: ProjectNode): boolean {
  return n._support != null ? n._support < SUPPORT_MID : !(n.urls && n.urls.length);
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

/** Per-draw scratch + accumulators for one unit's simulation. Amounts are in the result's currency. */
interface Draws {
  out: Float64Array; // average-yearly gross revenue over the headline window
  h3: Float64Array;
  h12: Float64Array;
  /** The headline-window samples in draw order. Only supermix sets it (pooled from its inputs); otherwise it
   *  is `out` itself, copied by finalize before `out` is sorted. */
  h25?: Float64Array;
  aft: Float64Array; // after-tax average-yearly
  tv: Float64Array; // terminal value
  npv: Float64Array; // NPV of the horizon's stream
  margin: Float64Array;
  lagB: number; // Σ build-lag months
  lagI: number; // Σ institutional-lag months
  yearRevAll: Float64Array[]; // per-year revenue — one bucket per model year, one value per draw (for quantiles)
  yearNetAll: Float64Array[]; // per-year net income
  yearCogsAll: Float64Array[]; // per-year cost of revenue
  yearTaxAll: Float64Array[]; // per-year tax (residual so rev − cogs − tax − cost = net)
  yearCostAll: Float64Array[]; // per-year operating cost, from its start (costsStart / a line's `from`)
  // Itemized income-statement sub-lines (only allocated when the unit declares them). Each is an
  // INDEPENDENT per-draw quantity, all per-year [lineIdx][year][draw]. lineMeta carries the labels so
  // finalize can build statementLines.
  revLineAll?: Float64Array[][];
  cogsLineAll?: Float64Array[][];
  opcostLineAll?: Float64Array[][];
  lineMeta?: { rev: string[]; cogs: string[]; opcost: string[] };
}

/** A business unit needs a gross margin: its own, cost-of-revenue lines, or the portfolio default. */
function checkMoney(unit: RunUnit): void {
  if (!unit.personal && !unit.margin && !unit.cogsLines && UNIT_DEFAULTS.margin == null)
    throw new Error(`unit "${unit.id}": no gross margin — give it \`margin\` or \`cogsLines\` (a template model: \`cogs\`), or set configurePortfolio({ defaults: { margin } })`);
}

/** The month a cost that begins at `start` starts in this draw (lag-node convention: code_months, readiness_months). */
function costStartMonth(start: CostStart, s: ScenarioState): number {
  return start === "start" ? 0 : start === "readiness" ? s.code_months || 0 : (s.code_months || 0) + (s.readiness_months || 0);
}
/** The share of model year `y` (0-based) at or after month `from` (1 once past it, 0 before it). */
function yearShareFrom(from: number, y: number): number {
  const start = 12 * y, end = start + 12;
  if (from <= start) return 1;
  if (from >= end) return 0;
  return (end - from) / 12;
}

/** One draw's money policy for a unit, in the unit's own currency (fx applied). */
interface UnitMoney {
  margin: number;
  cogsRate: number; // cost of revenue as a fraction of billed gross revenue
  costAnnual: number; // steady-state annual operating cost
  costIn: (y: number) => number; // operating cost in model year y, from its start
  lineCostIn: (k: number, y: number) => number; // cost line k in model year y
  net: (gross: number, opcost: number) => number; // after-tax cash, net of operating cost
  tv: number; // terminal-value multiple
}

/** Resolve a unit's money policy for one draw. `rate` = toReporting(unit), for the portfolio's tax functions. */
function moneyOf(unit: RunUnit, s: ScenarioState, fx: number, rate: number): UnitMoney {
  // Cost of revenue as a FRACTION of (gross, billed) revenue. When the unit itemizes cost-of-revenue lines, sum
  // their rates so the bridge reconciles to the parts (each line = rate × revenue); otherwise derive it from the
  // margin. An income track with neither carries zero — its revenue is already taxable income. Revenue is BILLED
  // gross; the platform/payment take is a cost-of-revenue line (a rate the sim stashes), not netted into revenue.
  const cogsRate = unit.cogsLines
    ? unit.cogsLines.reduce((acc, c) => acc + c.rate(s), 0)
    : unit.margin ? 1 - unit.margin(s) : unit.personal ? 0 : 1 - (UNIT_DEFAULTS.margin as number);
  const margin = unit.margin ? unit.margin(s) : unit.cogsLines ? 1 - cogsRate : unit.personal ? UNIT_DEFAULTS.margin ?? 1 : (UNIT_DEFAULTS.margin as number);
  // Operating cost reduces the contribution line, NOT reported revenue (gross stays ≥ 0). It begins at the
  // portfolio's `costsStart` (or a cost line's own `from`).
  const costAnnual = unit.cost ? unit.cost(s) * fx : 0;
  const lines = unit.costLines;
  const lineFrom = lines ? lines.map((l) => costStartMonth(l.from ?? COSTS_START, s)) : [];
  const from = costStartMonth(COSTS_START, s);
  const lineCostIn = (k: number, y: number): number => (lines as CostLine[])[k].amount(s) * fx * yearShareFrom(lineFrom[k], y);
  const costIn = lines && lines.some((l) => l.from)
    ? (y: number): number => { let c = 0; for (let k = 0; k < lines.length; k++) c += lineCostIn(k, y); return c; }
    : (y: number): number => costAnnual * yearShareFrom(from, y);
  // Net of tax for a gross-revenue figure at a given operating cost, shared by the average-yearly after-tax line
  // and the per-year net series so they stay consistent. Operating cost is DEDUCTIBLE: business tax hits only
  // positive pre-tax profit (gross profit − operating cost); a pre-tax loss is untaxed. The portfolio's tax
  // functions take reporting-currency amounts; a unit's own afterTax takes its own currency.
  const net = (gross: number, opcost: number): number => {
    const grossProfit = Math.max(0, gross) * (1 - cogsRate);
    if (unit.personal && s.net_tax_multiplier != null) return grossProfit * s.net_tax_multiplier - opcost;
    if (unit.afterTax) return unit.afterTax(Math.max(0, gross), grossProfit, s, opcost);
    if (unit.personal) return (rate === 1 ? PERSONAL_AFTER_TAX(grossProfit) : PERSONAL_AFTER_TAX(grossProfit * rate) / rate) - opcost;
    const pretax = grossProfit - opcost;
    if (BUSINESS_AFTER_TAX) return rate === 1 ? BUSINESS_AFTER_TAX(pretax, s) : BUSINESS_AFTER_TAX(pretax * rate, s) / rate;
    return pretax > 0 ? pretax * (1 - BUSINESS_TAX) : pretax;
  };
  const tv = unit.tvMultiple ? unit.tvMultiple(s) : unit.personal ? 0 : UNIT_DEFAULTS.tvMultiple ?? 0;
  return { margin, cogsRate, costAnnual, costIn, lineCostIn, net, tv };
}

/** Σ arr[t]·scale over months [from, to), in month order. (scale 1 is exact: x·1 === x.) */
function sumMonths(arr: MonthTraj, from: number, to: number, scale = 1): number {
  let s = 0;
  for (let t = from; t < to; t++) s += arr[t] * scale;
  return s;
}
/** Σ arr·scale over model year `y` (0-based). */
const yearSum = (arr: MonthTraj, y: number, scale = 1): number => sumMonths(arr, 12 * y, Math.min(12 * y + 12, HORIZON_MONTHS), scale);
/** HEADLINE = the SUSTAINED annual average of arr·scale over the headline window (default years 2–5), excluding
 *  the year-1 ramp, so P20/P50/Mean/P80 reflect a steady-state level rather than the build-up. */
const headlineAvg = (arr: MonthTraj, scale = 1): number =>
  sumMonths(arr, 12 * (HEADLINE_FROM_YEAR - 1), HORIZON_MONTHS, scale) / (HORIZON_YEARS - HEADLINE_FROM_YEAR + 1);

/** The revenue-side outputs of one draw from its trajectory (pre-fx; `fx` applied here). */
function recordRevenue(d: Draws, i: number, traj: MonthTraj, fx: number): void {
  d.out[i] = headlineAvg(traj) * fx;
  d.h3[i] = sumMonths(traj, 0, Math.min(3, HORIZON_MONTHS)) * fx;
  d.h12[i] = sumMonths(traj, 0, Math.min(12, HORIZON_MONTHS)) * fx;
  for (let y = 0; y < HORIZON_YEARS; y++) d.yearRevAll[y][i] = yearSum(traj, y) * fx;
  d.npv[i] = npvOf(traj) * fx;
}

/** Turn one draw's trajectory + scenario into the per-iteration outputs. */
function recordDraw(d: Draws, i: number, traj: MonthTraj, fx: number, unit: RunUnit, s: ScenarioState, rate: number, parts?: Record<string, MonthTraj>): void {
  recordRevenue(d, i, traj, fx);
  const m = moneyOf(unit, s, fx, rate);
  d.margin[i] = m.margin;
  // Headline after-tax average is a STEADY-STATE (headline-window, live) figure → full annual operating cost.
  d.aft[i] = m.net(d.out[i], m.costAnnual);
  for (let y = 0; y < HORIZON_YEARS; y++) {
    const yrRev = d.yearRevAll[y][i];
    const opcostY = m.costIn(y);
    d.yearCostAll[y][i] = opcostY;
    const netY = m.net(yrRev, opcostY);
    d.yearNetAll[y][i] = netY;
    // Revenue→net bridge: cost of revenue = rev × cogsRate; tax is the residual so rev − cogs − opcost − tax = net.
    const cogsY = yrRev * m.cogsRate;
    d.yearCogsAll[y][i] = cogsY;
    d.yearTaxAll[y][i] = yrRev - netY - cogsY - opcostY;
    // Itemized sub-lines (independent quantities), all per-year. Revenue: this year's slice of each parts
    // buffer. Cost of revenue: each component's rate × this year's gross revenue. Operating cost: each fixed
    // component × the share of the year after its start.
    if (d.revLineAll && parts) {
      for (let k = 0; k < d.lineMeta!.rev.length; k++) {
        const buf = parts[d.lineMeta!.rev[k]];
        d.revLineAll[k][y][i] = (buf ? yearSum(buf, y) : 0) * fx;
      }
    }
    if (d.cogsLineAll && unit.cogsLines) {
      for (let k = 0; k < unit.cogsLines.length; k++) d.cogsLineAll[k][y][i] = yrRev * unit.cogsLines[k].rate(s);
    }
    if (d.opcostLineAll && unit.costLines) {
      for (let k = 0; k < unit.costLines.length; k++) d.opcostLineAll[k][y][i] = m.lineCostIn(k, y);
    }
  }
  d.tv[i] = runRateAtHorizon(traj) * fx * m.tv;
  d.lagB += s.code_months || 0;
  d.lagI += s.readiness_months || 0;
}

/** Over a SORTED sample: Σ values, the count at or above `thr`, and the median of that success tail. The tail
 *  is contiguous in the sorted array, so it is already sorted → its median is its midpoint. */
function tailOf(sorted: Float64Array, thr: number): { sum: number; succ: number; condP50: number } {
  let sum = 0;
  const succArr: number[] = [];
  for (let k = 0; k < sorted.length; k++) {
    sum += sorted[k];
    if (sorted[k] >= thr) succArr.push(sorted[k]);
  }
  return { sum, succ: succArr.length, condP50: succArr.length ? succArr[Math.floor(succArr.length * 0.5)] : 0 };
}

function finalize(d: Draws, currency: string): RunResult {
  // The thresholds are portfolio settings in the reporting currency; apply them in this result's currency.
  const rate = toReporting(currency);
  const THR = SUCCESS_THRESHOLD / rate, FLOOR = DECISION_FLOOR / rate;
  const nDraws = d.out.length;
  const h25 = d.h25 ?? Float64Array.prototype.slice.call(d.out); // draw order, before `out` is sorted
  d.out.sort();
  const aftSorted = Float64Array.prototype.slice.call(d.aft).sort();
  const rev = tailOf(d.out, THR);
  let floor = 0;
  for (let k = 0; k < d.out.length; k++) if (d.out[k] < FLOOR) floor++;
  // Net-income ("after-tax") summary, parallel to the revenue one, for the Overview net view.
  const aft = tailOf(aftSorted, THR);
  return {
    currency,
    samples: d.out,
    p20: qOf(d.out, 0.2), p50: qOf(d.out, 0.5), p80: qOf(d.out, 0.8), p95: qOf(d.out, 0.95),
    mean: rev.sum / d.out.length,
    pSucc: rev.succ / d.out.length,
    condP50: rev.condP50,
    thr: THR,
    h3: hz(d.h3), h12: hz(d.h12), h25: hz(h25),
    sH3: d.h3, sH12: d.h12, sH25: h25,
    terminalValue: median(d.tv),
    npv: median(d.npv),
    afterTax20: qOf(aftSorted, 0.2), afterTax50: qOf(aftSorted, 0.5), afterTax80: qOf(aftSorted, 0.8),
    afterTaxMean: aft.sum / (aftSorted.length || 1), afterTaxPSucc: aft.succ / (aftSorted.length || 1),
    afterTaxCondP50: aft.condP50,
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

/** Reduce the per-year sample columns to the four switcher metrics (p20/p50/mean/p80) each. */
function yearStats(cols: Float64Array[]): YearStat[] {
  return cols.map((col) => {
    const h = hz(col);
    return { p20: h.p20, p50: h.p50, mean: h.mean, p80: h.p80 }; // this key order is the serialized one
  });
}

function newDraws(): Draws {
  return {
    out: new Float64Array(N), h3: new Float64Array(N), h12: new Float64Array(N),
    aft: new Float64Array(N), tv: new Float64Array(N), npv: new Float64Array(N), margin: new Float64Array(N),
    lagB: 0, lagI: 0,
    yearRevAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearNetAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearCogsAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearTaxAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
    yearCostAll: Array.from({ length: HORIZON_YEARS }, () => new Float64Array(N)),
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
// optimum).
const OPTIMA = new Map<object, number>();
/** The memoized optimal price for a unit (computing+caching it via one sweep if not seen yet). */
function optimalFor(unit: RunUnit): number | undefined {
  if (!unit.priceSweep) return undefined;
  const hit = OPTIMA.get(unit.priceSweep);
  return hit != null ? hit : (sweepOptimalPrice(unit).optimalPrice as number | undefined);
}

/** A priced unit with its sweep-only nodes (priceSweep.extraNodes) spliced into its graph; others unchanged. */
const withSweepNodes = (u: RunUnit): RunUnit =>
  u.priceSweep ? { ...u, nodes: [...u.nodes, ...(u.priceSweep.extraNodes || [])] } : u;

export function runUnit(unit: RunUnit, seed: number = SEED): RunResult {
  checkMoney(unit);
  const rate = toReporting(unit);
  // Price as OUTPUT: for a priced unit we (1) sweep to find the revenue-optimal price (bounded by the
  // substitution ceiling), then (2) run the HEADLINE draws at that price so the reported P20/P50/P80 is
  // "revenue when priced optimally", not at an arbitrary planned price. The demand nodes
  // (competitor/WTP/elasticity, and any capacity nodes) live in priceSweep.extraNodes, so they must
  // be spliced into the headline plan too — otherwise the overlay reads undefined refs and stays inert.
  // Non-priced units keep the plain planned-price headline.
  const sw = unit.priceSweep ? sweepOptimalPrice(unit, seed) : undefined;
  const decisionPrice = sw ? sw.optimalPrice : undefined;
  const r = mulberry32(seed);
  const shift = qmcShift(seed);
  const plan = planUnit(withSweepNodes(unit));
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
    recordDraw(d, i, traj, unit.fx ?? 1, unit, s, rate, parts);
    for (let j = 0; j < plan.order.length; j++) nodeVals[j][i] = s[plan.order[j].node.id];
  }
  const tornado = computeTornado(plan.order, nodeVals, d.out); // before finalize sorts d.out
  const res = finalize(d, currencyOf(unit));
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
  const plan = planUnit(withSweepNodes(unit));
  const shift = qmcShift(seed);
  // The sweep only needs enough resolution to LOCATE the revenue-optimal price on a log grid; the
  // headline then runs the full N draws at that price, so a coarse subsample here is fine and keeps the
  // sweep (which now runs for every priced unit, in golden/pairwise/tests/boot) ~3× cheaper.
  const NS = Math.min(N, 2000);
  const priceNode = unit.priceSweep!.priceNode;
  const wtpNode = unit.priceSweep!.wtpNode;
  // Pre-pass (no sim): median sampled price ("planned") + median WTP ceiling, to size the grid to
  // this unit's price scale (a low consumer price vs a high per-seat one) rather than a fixed range.
  // (An empirical median over this stream, not the node's ppf(0.5); only the two nodes are evaluated.)
  const p0s: number[] = [], wtps: number[] = [];
  {
    const r = mulberry32(seed);
    const want = new Set([priceNode, wtpNode].filter(Boolean) as string[]);
    for (let i = 0; i < NS; i++) {
      const z = globalFactors(i, shift);
      const s = drawScenario(plan, r, z, want);
      p0s.push(s[priceNode]);
      if (wtpNode) wtps.push(s[wtpNode]);
    }
  }
  p0s.sort((a, b) => a - b); wtps.sort((a, b) => a - b);
  const plannedPrice = p0s[Math.floor(0.5 * NS)] || 1;
  const medWtp = wtps.length ? wtps[Math.floor(0.5 * wtps.length)] : plannedPrice * 2.5;
  const minPrice = unit.priceSweep!.minPrice;
  const GMIN = minPrice != null ? Math.max(minPrice, plannedPrice * 0.3) : plannedPrice * 0.3, GMAX = Math.max(plannedPrice * 2.5, medWtp * 1.35), K = 11;
  const grid = Array.from({ length: K }, (_, i) => GMIN * Math.pow(GMAX / GMIN, i / (K - 1)));
  const curve: PricePoint[] = [];
  const traj = new Float64Array(HORIZON_MONTHS);
  // The scenarios don't depend on the price, so they are drawn ONCE (on the first grid price's stream) and
  // reused across the grid: draw i keeps its scenario and the RNG state the sim starts from. Where a sim's own
  // RNG use doesn't depend on the price (the usual case) this is bit-identical to redrawing the stream per price.
  const scen: ScenarioState[] = new Array(NS);
  const simState = new Int32Array(NS);
  for (let g = 0; g < grid.length; g++) {
    const price = grid[g];
    const first = g === 0;
    const r0 = first ? statefulMulberry(seed) : null;
    const rev = new Float64Array(NS);
    let utilSum = 0;
    for (let i = 0; i < NS; i++) {
      let s: ScenarioState, r: Rng;
      if (r0) {
        s = drawScenario(plan, r0, globalFactors(i, shift));
        scen[i] = { ...s };
        simState[i] = r0.state();
        r = r0;
      } else {
        s = { ...scen[i] };
        r = mulberry32(simState[i]);
      }
      (s as any).__decisionPrice = price;
      const rep = { util: 0 }; (s as any).__capReport = rep;
      traj.fill(0);
      unit.sim(s, r, traj);
      rev[i] = headlineAvg(traj) * (unit.fx ?? 1); // the headline window, matching the headline
      utilSum += rep.util;
    }
    // EXPECTED (mean) revenue — the right objective for a price decision, and robust to zero-inflation
    // (many products have a zero median, which would make a p50 curve flat).
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
export function run(p: Project, seed: number = SEED): RunResult {
  return runUnit(baseUnit(p), seed);
}

/** The project's own graph as a unit (correlations from the global RHO table). */
export const baseUnit = (p: Project): RunUnit => ({ id: p.id, fx: p.fx, currency: p.currency, priceCurrency: p.priceCurrency, nodes: p.nodes, sim: p.sim!, rho: RHO[p.id] || {}, margin: p.margin, tvMultiple: p.tvMultiple, cost: p.cost, personal: p.personal, afterTax: p.afterTax, market: p.market, priceSweep: p.priceSweep, revenueLines: p.revenueLines, cogsLines: p.cogsLines, costLines: p.costLines });

/**
 * Run several units as one simulation: each draw shares the global factors, so the units are correlated; the
 * outcome is the SUM of every unit's trajectory. Used for a pair of projects and for "all-fronts" (all variants
 * pursued at once). The result is in `opts.currency`, else the units' common currency, else (mixed currencies)
 * the reporting currency; each unit is converted into it. Each unit keeps its OWN money policy — margin,
 * operating cost and its start, tax (its own afterTax, or the portfolio's schedule for its kind) and terminal
 * multiple — and the combined net is the sum of the units' nets.
 */
export function runCombined(units: RunUnit[], opts: { overheadFrac?: number; currency?: string } = {}): RunResult {
  for (const u of units) checkMoney(u);
  const codes = units.map((u) => currencyOf(u));
  const target = opts.currency ?? (codes.length && codes.every((c) => c === codes[0]) ? codes[0] : REPORTING_CURRENCY.code);
  const tRate = toReporting(target);
  const uRate = units.map((u) => toReporting(u));
  const conv = uRate.map((r) => r / tRate); // a unit's currency → the result's (1 when the same)
  const fxs = units.map((u) => u.fx ?? 1); // each unit's price currency → its own
  const r = mulberry32(SEED);
  const shift = qmcShift();
  // Price as OUTPUT here too: each priced unit is run at its (memoized) optimal price, and its demand
  // nodes (competitor/WTP/elasticity) are spliced into the plan so the overlay engages — otherwise the
  // combined sum (pairwise, additive-variant) would silently revert to planned pricing and
  // disagree with the per-project headlines. The optimum is memoized per priceSweep, so this adds no
  // per-cell sweep cost once the units have been run once.
  const unitOpt = units.map((u) => optimalFor(u));
  const plans = units.map((u) => planUnit(withSweepNodes(u)));
  const d = newDraws();
  const summed = new Float64Array(HORIZON_MONTHS);
  const bufs = units.map(() => new Float64Array(HORIZON_MONTHS)); // per-unit fx-applied trajectory (unit's currency), reused
  const cum = new Float64Array(units.length);
  const yNet = new Float64Array(HORIZON_YEARS), yCost = new Float64Array(HORIZON_YEARS), yCogs = new Float64Array(HORIZON_YEARS);
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
      sList[k] = s; // keep each unit's scenario so its own money policy can be applied below
      const b = bufs[k];
      b.fill(0);
      units[k].sim(s, r, b);
      let c = 0;
      for (let t = 0; t < HORIZON_MONTHS; t++) { b[t] *= fxs[k]; c += b[t]; }
      cum[k] = c * conv[k];
      const u = units[k];
      marginW += u.margin ? u.margin(s) : u.cogsLines ? 1 - u.cogsLines.reduce((acc, x) => acc + x.rate(s), 0) : UNIT_DEFAULTS.margin ?? 1;
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
    const keep = 1 - (opts.overheadFrac || 0);
    // Sum the active units' trajectories (converted, scaled by the overhead `keep`) for the revenue
    // outputs; apply each unit's own money policy to ITS revenue and sum the results for the net outputs.
    let aft = 0, tvSum = 0;
    yNet.fill(0); yCost.fill(0); yCogs.fill(0);
    for (const k of active) {
      const u = units[k], sk = sList[k], ck = conv[k], b = bufs[k];
      for (let t = 0; t < HORIZON_MONTHS; t++) summed[t] += b[t] * ck * keep;
      const m = moneyOf(u, sk, fxs[k], uRate[k]);
      aft += m.net(headlineAvg(b, keep), m.costAnnual * keep) * ck;
      for (let y = 0; y < HORIZON_YEARS; y++) {
        const yr = yearSum(b, y, keep);
        const oc = m.costIn(y) * keep;
        yNet[y] += m.net(yr, oc) * ck;
        yCost[y] += oc * ck;
        yCogs[y] += yr * m.cogsRate * ck;
      }
      tvSum += runRateAtHorizon(b) * keep * m.tv * ck;
    }
    recordRevenue(d, i, summed, 1);
    d.margin[i] = marginW / units.length;
    d.aft[i] = aft;
    for (let y = 0; y < HORIZON_YEARS; y++) {
      const rev = d.yearRevAll[y][i];
      d.yearNetAll[y][i] = yNet[y];
      d.yearCostAll[y][i] = yCost[y];
      d.yearCogsAll[y][i] = yCogs[y];
      d.yearTaxAll[y][i] = rev - yNet[y] - yCogs[y] - yCost[y];
    }
    d.tv[i] = tvSum;
    d.lagB += sMerged.code_months || 0;
    d.lagI += sMerged.readiness_months || 0;
  }
  progressTick(`runCombined ${units.map((u) => u.id).join("+")}`);
  return finalize(d, target);
}

/** Equal-weight supermix: pool every unit's draws and summarise; scalar outputs count-weighted. Results in
 *  different currencies are converted into the reporting currency first. */
export function supermix(results: RunResult[]): RunResult {
  const codes = results.map((r) => currencyOf(r));
  const target = codes.length && codes.every((c) => c === codes[0]) ? codes[0] : REPORTING_CURRENCY.code;
  const tRate = toReporting(target);
  let total = 0;
  for (const r of results) total += r.samples.length;
  const d = newDraws();
  d.out = new Float64Array(total); d.h3 = new Float64Array(total); d.h12 = new Float64Array(total);
  const h25 = (d.h25 = new Float64Array(total)); d.aft = new Float64Array(total);
  d.tv = new Float64Array(total); d.npv = new Float64Array(total); d.margin = new Float64Array(total);
  // Pool the per-year samples too (one bucket per model year), so the supermix reports real pooled per-year stats.
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
    const f = toReporting(r) / tRate;
    const put = (dst: Float64Array, src: Float64Array): void => {
      if (f === 1) dst.set(src, off);
      else for (let k = 0; k < src.length; k++) dst[off + k] = src[k] * f;
    };
    put(d.out, r.samples); put(d.h3, r.sH3); put(d.h12, r.sH12); put(h25, r.sH25); put(d.aft, r.sAfter);
    d.tv.fill(r.terminalValue * f, off, off + n); d.npv.fill(r.npv * f, off, off + n); d.margin.fill(r.grossMargin, off, off + n);
    for (let y = 0; y < HORIZON_YEARS; y++) {
      if (r.sYearRev) put(d.yearRevAll[y], r.sYearRev[y]);
      if (r.sYearNet) put(d.yearNetAll[y], r.sYearNet[y]);
    }
    wLagB += r.lagBuild * n; wLagI += r.lagInstitutional * n;
    off += n;
  }
  d.lagB = wLagB; d.lagI = wLagI;
  return finalize(d, target);
}

/** Run every project, keyed by id. */
export function runAll(projects: Project[]): Record<string, RunResult> {
  const R: Record<string, RunResult> = {};
  for (const p of projects) R[p.id] = run(p);
  return R;
}
