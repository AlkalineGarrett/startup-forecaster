// Revenue-ramp helpers a hand-written `sim` may use.
import { HORIZON_YEARS } from "./types.ts";

/**
 * Cumulative steady-state years of revenue earned across the model horizon (HORIZON_YEARS),
 * given a linear ramp that reaches full run-rate after `rampYears` years.
 * Each year contributes min(year / rampYears, 1).
 */
export function cumF(rampYears: number): number {
  let s = 0;
  for (let y = 1; y <= HORIZON_YEARS; y++) s += Math.min(y / rampYears, 1);
  return s;
}
