// Revenue-ramp helper used by the project `rev` functions.

/**
 * Cumulative fraction of steady-state revenue earned across a 5-year window,
 * given a linear ramp that reaches full run-rate after `rampYears` years.
 * Each year contributes min(year / rampYears, 1).
 */
export function cumF(rampYears: number): number {
  let s = 0;
  for (let y = 1; y <= 5; y++) s += Math.min(y / rampYears, 1);
  return s;
}

/** Default post-launch ramp (years) for the horizon time-model when a project has no ramp_years node. */
export const RAMP_DEFAULT = 3;

/**
 * Cumulative revenue over `months` of OPERATION since launch, expressed in
 * years-of-steady-revenue, ramping linearly from 0 to the steady annual over
 * `rampYears`, then holding. Used by the build-lag horizon model: a project builds
 * for its code_months + readiness_months (earning nothing), then operates within the
 * remaining window.
 */
export function opCum(months: number, rampYears: number): number {
  if (months <= 0) return 0;
  const rampM = Math.max(0.5, rampYears * 12); // months to reach steady run-rate
  let years = 0;
  let m = 1;
  for (; m <= Math.floor(months); m++) years += Math.min(m / rampM, 1);
  const frac = months - Math.floor(months);
  if (frac > 0) years += Math.min(m / rampM, 1) * frac;
  return years / 12;
}
