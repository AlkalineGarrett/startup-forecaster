// Cohort-simulation primitives. A unit builds its revenue trajectory by composing these, so the
// dynamics are structural rather than fudged: revenue is an integral
// of an acquisition rate under a declining retention hazard (not a year-5 stock × 12 × 5), ceilings
// are min(demand, cap) per period, and arriving risks are time-to-event, not static multipliers.
import type { MonthTraj } from "./types.ts";
import { HORIZON_MONTHS } from "./types.ts";
import type { Rng } from "./types.ts";

/**
 * Monthly survival curve S[age] (age 0..59) from an ANNUAL renewal schedule that DECLINES with
 * tenure. `annualRenew[y]` is the fraction of a cohort surviving its (y+1)-th
 * year; the last entry is held for later years. Within a year the annual rate is spread
 * geometrically over its twelve months. S[0] = 1 (just acquired).
 */
export function survival(annualRenew: number[]): Float64Array {
  const S = new Float64Array(HORIZON_MONTHS);
  S[0] = 1;
  let s = 1;
  // `r` is constant within a year, so its monthly root (Math.pow — expensive, and this runs per draw)
  // only needs recomputing when the year rolls over: ~5 pows/call instead of 59. Same values, same
  // multiply order → bit-identical to the per-month form.
  let curYr = -1, mr = 1;
  for (let m = 1; m < HORIZON_MONTHS; m++) {
    const yr = ((m - 1) / 12) | 0;
    if (yr !== curYr) {
      curYr = yr;
      const r = Math.max(1e-4, Math.min(0.999, annualRenew[Math.min(yr, annualRenew.length - 1)]));
      mr = Math.pow(r, 1 / 12);
    }
    s *= mr;
    S[m] = s;
  }
  return S;
}

/**
 * Integrate a subscription cohort into `out`: acquisitions each month (a constant rate or a
 * per-month array), delayed by `lag` months, retained under survival curve `S`, earning
 * `priceMo` per active customer per month. The active base is capped at `ceiling` each period
 * (min(demand, cap)); `expansionAnnual` (≥1) grows per-customer revenue for B2B expansion.
 */
export function integrateSubscription(
  out: MonthTraj,
  acq: number | Float64Array,
  lag: number,
  priceMo: number,
  S: Float64Array,
  ceiling = Infinity,
  expansionAnnual = 1,
): void {
  const lm = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(lag)));
  const expMo = Math.pow(expansionAnnual, 1 / 12);
  for (let t = 0; t < HORIZON_MONTHS; t++) {
    if (t < lm) { out[t] = 0; continue; }
    let active = 0;
    for (let tau = lm; tau <= t; tau++) {
      const a = typeof acq === "number" ? acq : acq[tau] || 0;
      active += a * S[t - tau];
    }
    active = Math.min(active, ceiling);
    out[t] = active * priceMo * Math.pow(expMo, t - lm);
  }
}

/**
 * Ramped monthly acquisition (§ trust cold-start). Distributes `total` new adds over the post-lag
 * window as a LINEAR ramp instead of a flat rate: near-zero in the first months (no reference logos
 * yet, trust unearned, long demo-heavy sales cycles), accelerating as proof accumulates. `rampStart`
 * ∈ [0,1] is the first post-lag month's rate as a fraction of the flat average — 1 = flat (byte-
 * identical to passing the scalar acq), 0.25 = the first month runs at a quarter of the eventual
 * average. CRUCIALLY it preserves the window total (∑ = `total`): it reshapes WHEN adds land, not HOW
 * MANY, so it composes cleanly with a `penetration_5y`-style level (which stays a 5-yr cumulative
 * quantity). Returns a per-month array for integrateSubscription (which already accepts Float64Array).
 * Because the headline averages sustained yrs 2–5, a ramp shifts weight out of yr 1 into yrs 3–5.
 */
export function rampedAcq(total: number, lag: number, rampStart = 1): Float64Array {
  const lm = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(lag)));
  const acq = new Float64Array(HORIZON_MONTHS);
  const n = HORIZON_MONTHS - lm;
  if (n <= 0 || total <= 0) return acq;
  if (n === 1) { acq[lm] = total; return acq; }
  const avg = total / n;
  const start = Math.max(0, Math.min(1, rampStart));
  const slope = (2 - 2 * start) / (n - 1); // per-month weight runs start → (2−start), mean 1 → ∑ = total
  for (let i = 0; i < n; i++) acq[lm + i] = avg * (start + slope * i);
  return acq;
}

/**
 * Plan-mix retention. Blends an annual-plan survival curve with a monthly-plan one that
 * churns harder in the first year (annual plans retain ~2.6× better at 12 months). `annualShare`
 * is the fraction on annual plans. A calibration slot: at annualShare=1 it is the pure annual
 * curve. Default `monthlyPenalty` scales the monthly plan's first-year renewal.
 */
export function planMixSurvival(annualRenew: number[], annualShare: number, monthlyPenalty = 0.6): Float64Array {
  const sA = survival(annualRenew);
  if (annualShare >= 0.999) return sA;
  const monthlyRenew = annualRenew.map((r, i) => (i === 0 ? Math.max(0.05, r * monthlyPenalty) : r));
  const sM = survival(monthlyRenew);
  const out = new Float64Array(HORIZON_MONTHS);
  const w = Math.max(0, Math.min(1, annualShare));
  for (let m = 0; m < HORIZON_MONTHS; m++) out[m] = w * sA[m] + (1 - w) * sM[m];
  return out;
}

/**
 * Split churn into voluntary and involuntary. `involFrac` of the annual attrition is failed
 * payments; `dunning` recovers a fraction of that back into the renewal rate. Both default to a
 * no-op (involFrac=0 or dunning=0 → the input schedule unchanged) — the slot matters, the value is
 * a calibration input. Returns the dunning-adjusted annual renewal schedule.
 */
export function dunningAdjust(annualRenew: number[], involFrac: number, dunning: number): number[] {
  if (involFrac <= 0 || dunning <= 0) return annualRenew;
  return annualRenew.map((r) => Math.min(0.97, r + involFrac * (1 - r) * dunning));
}

/**
 * Rigid-hours capacity feedback. Computes the REALISED monthly acquisition when acquisition
 * is throttled by the operator's remaining elastic hours: each month, rigid hours are consumed by the
 * current installed base (support/compliance/delivery — which may track the FREE population, not just
 * payers) and by externally-scheduled work; the elastic remainder drives that month's acquisition,
 * so the self-limiting behaviour emerges rather than being imposed. Inert by default
 * (rigidPerActive=rigidPerFree=0 and elasticBudget=∞ → returns `acqDesired` unchanged); the per-project
 * hour figures are calibration inputs left empty for now. `freePerPayer` scales the free population
 * that support tracks (freemium). One-directional ratchet: rigid hours fall slowly by carrying the
 * peak base for `ratchetMonths`.
 */
export function capacityAcq(
  acqDesired: number | Float64Array,
  S: Float64Array,
  lag: number,
  o: { rigidPerActive?: number; rigidPerFree?: number; freePerPayer?: number; externalHours?: number; elasticBudget?: number; acqPerHour?: number; ratchetMonths?: number } = {},
  report?: { util: number },   // optional: receives peak hours-utilisation (rigid/budget) ∈ [0, ∞)
): Float64Array {
  const lm = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(lag)));
  const rigidA = o.rigidPerActive || 0, rigidF = o.rigidPerFree || 0, freeMul = o.freePerPayer || 0;
  const ext = o.externalHours || 0, budget = o.elasticBudget ?? Infinity, perHour = o.acqPerHour ?? Infinity;
  const ratchet = o.ratchetMonths ?? 3;
  const acq = new Float64Array(HORIZON_MONTHS);
  const inert = rigidA === 0 && rigidF === 0 && ext === 0 && budget === Infinity;
  const recentActive: number[] = [];
  let peakUtil = 0;
  for (let t = 0; t < HORIZON_MONTHS; t++) {
    if (t < lm) { acq[t] = 0; continue; }
    const desired = typeof acqDesired === "number" ? acqDesired : acqDesired[t] || 0;
    if (inert) { acq[t] = desired; continue; }
    let active = 0;
    for (let tau = lm; tau < t; tau++) active += acq[tau] * S[t - tau];
    recentActive.push(active);
    const peak = Math.max(active, ...recentActive.slice(-Math.max(1, ratchet))); // ratchet: fall slowly
    const rigid = rigidA * peak + rigidF * peak * freeMul + ext;
    const elastic = Math.max(0, budget - rigid);
    if (budget !== Infinity && budget > 0) peakUtil = Math.max(peakUtil, rigid / budget);
    acq[t] = Math.min(desired, elastic * perHour);
  }
  if (report) report.util = peakUtil;
  return acq;
}

/** Fill `out` with a flat monthly revenue that starts after `lag` months (jobs, retainers). */
export function flatAfterLag(out: MonthTraj, lag: number, monthly: number): void {
  const lm = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(lag)));
  for (let t = 0; t < HORIZON_MONTHS; t++) out[t] = t < lm ? 0 : monthly;
}

/**
 * Sample a discrete entity's LIFETIME in months from a front-loaded (declining) annual-renewal
 * hazard — the same shape as the subscription survival curve, but for a cohort of size one (a job,
 * a signed retainer, an engagement). Walks months and ends the entity the first month it "churns".
 * Returns a lifetime in [1, M].
 */
export function sampleLifetime(annualRenew: number[], r: Rng): number {
  for (let m = 0; m < HORIZON_MONTHS; m++) {
    const yr = Math.floor(m / 12);
    const monthly = Math.pow(Math.max(1e-4, Math.min(0.999, annualRenew[Math.min(yr, annualRenew.length - 1)])), 1 / 12);
    if (r() > monthly) return m + 1;
  }
  return HORIZON_MONTHS;
}

/** Fill `out` with a flat monthly revenue for a discrete entity that STARTS at `start` and lives
 * `life` months, truncated at the window edge — contribution is min(life, M − start). */
export function flatForLife(out: MonthTraj, start: number, monthly: number, life: number): void {
  const s = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(start)));
  const end = Math.min(HORIZON_MONTHS, s + Math.max(0, Math.round(life)));
  for (let t = 0; t < HORIZON_MONTHS; t++) out[t] = t >= s && t < end ? monthly : 0;
}

/** Fill `out` with a per-month flow revenue (per-dossier, per-audit, per-play) that ramps in
 * linearly over `rampMonths` after `lag`, toward `monthlySteady`. Non-subscription businesses. */
export function flowAfterLag(out: MonthTraj, lag: number, monthlySteady: number, rampMonths = 12): void {
  const lm = Math.max(0, Math.min(HORIZON_MONTHS, Math.round(lag)));
  for (let t = 0; t < HORIZON_MONTHS; t++) {
    if (t < lm) { out[t] = 0; continue; }
    const ramp = rampMonths > 0 ? Math.min(1, (t - lm + 1) / rampMonths) : 1;
    out[t] = monthlySteady * ramp;
  }
}

/** Logistic value transfer: map a continuous capability x∈[0,1] to a value fraction, so
 * sub-threshold capability is worth ~nothing and the near-bimodal OUTPUT emerges honestly. */
export function logistic(x: number, mid: number, steep: number): number {
  return 1 / (1 + Math.exp(-steep * (x - mid)));
}

/**
 * Price-as-output demand overlay (§ price-curve spike). Returns the CONVERSION multiplier at a
 * counterfactual price `p` relative to the draw's operating point `p0` (the sampled price). Two
 * effects compose: a constant-elasticity body `(p/p0)^(−eps)` and an upper logistic collapse as `p`
 * passes the willingness-to-pay ceiling `wtp` (steepness set by the competitor→wtp gap). Both are
 * renormalised so `demandMultiplier(p0, p0, …) === 1` EXACTLY — the overlay is identity at the
 * operating point, so applying it in a sweep leaves the headline (which runs at p0) unchanged.
 */
export function demandMultiplier(price: number, ref: number, eps: number, wtp: number): number {
  if (!(price > 0) || !(ref > 0)) return 1;
  let m = Math.pow(price / ref, -Math.max(0, eps || 0));
  if (wtp && wtp > 0) {
    const gap = Math.max(1, wtp - ref);
    const steep = 6 / gap;                                   // ~half of buyers gone at price = wtp
    const collapse = (x: number) => 1 / (1 + Math.exp(steep * (x - wtp)));
    const c0 = collapse(ref);                                // renormalise so the factor is 1 at ref
    // The WTP term is a COLLAPSE (demand destruction above the ceiling), never an amplifier: clamp the
    // ratio to ≤1 so it only bites for price>ref. Without this, a draw with wtp<ref (possible when the
    // competitor/WTP lognormals overlap) makes c0≈0 and price<ref blows the multiplier up to ~1e40.
    if (c0 > 0) m *= Math.min(1, collapse(price) / c0);
  }
  return Math.max(0, m);
}

/**
 * Ordered-categorical pick: `u`∈[0,1] selects one of several ORDERED states by cumulative `weights`
 * (normalised; need not sum to 1) and returns that state's `effects` entry. States are genuinely
 * distinct regimes, not midpoints (endorsement none/passive/active, a filing control regime, an
 * absorption level) — so an intermediate state has its OWN effect rather than an interpolated one.
 */
export function orderedEffect(u: number, weights: number[], effects: number[]): number {
  let tot = 0;
  for (const w of weights) tot += Math.max(0, w);
  if (tot <= 0) return effects[0];
  const target = Math.max(0, Math.min(1, u)) * tot;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]);
    if (target <= acc) return effects[Math.min(i, effects.length - 1)];
  }
  return effects[effects.length - 1];
}

/** Month (0..59) an arriving risk lands, sampled from a constant annual hazard, or M (never in
 * window). Severity is applied from that month forward by the caller. */
export function timeToEvent(annualHazard: number, r: Rng): number {
  const h = Math.max(0, Math.min(0.999, annualHazard));
  if (h <= 0) return HORIZON_MONTHS;
  const monthly = 1 - Math.pow(1 - h, 1 / 12);
  for (let t = 0; t < HORIZON_MONTHS; t++) if (r() < monthly) return t;
  return HORIZON_MONTHS;
}

/** Multiply `out[t] *= severity` for t ≥ month (apply an arrived event's damage forward). */
export function applyEventFrom(out: MonthTraj, month: number, severity: number): void {
  for (let t = Math.max(0, month); t < HORIZON_MONTHS; t++) out[t] *= severity;
}
