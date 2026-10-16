// The Pairwise matrix: every pair of pairable projects run as one correlated simulation, plus each
// project's solo run. Simulation work, so it lives here; the results UI (forecast-renderer) renders it and
// the simulation build bakes it (simulation/gen-pairwise.mjs). Deterministic (each run is seeded).
import type { RunResult } from "./types.ts";
import type { Project, Horizon } from "./types.ts";
import { PROJECTS, PAIR_ATTENTION_OVERHEAD, REPORTING_CURRENCY, currencyOf, toReporting } from "./portfolio-context.ts";
import { run, runCombined } from "./simulate.ts";
import { isVar, uKey, realUnitIds, runUnitById, pairable, sideUnits, pairLabel, bestUnitId } from "./units.ts";

/** The computed matrix: names per project, solo results, and res[a][b] for b < a (lower triangle). */
export interface PairMatrix {
  labels: string[];
  solo: RunResult[];
  res: (RunResult | null)[][];
}

/** Every project's results, keyed by unit (`project` or `project::variant`), run in portfolio order. */
export function runPortfolio(): Record<string, RunResult> {
  const R: Record<string, RunResult> = {};
  for (const p of PROJECTS) {
    if (isVar(p)) for (const id of realUnitIds(p)) R[uKey(p.id, id)] = runUnitById(p, id);
    else R[p.id] = run(p); // sweeps to find the optimal price, runs the headline at it, attaches the curve
  }
  return R;
}

// Only the fields the pairwise/horizon renderers read — so a computed cell drops its 20k-draw arrays
// (the matrix keeps only ~tens of numbers per cell, not tens of MB), and mean is carried for the switch.
const liteCell = (r: RunResult): RunResult =>
  ({ currency: r.currency, p20: r.p20, p50: r.p50, p80: r.p80, mean: r.mean, h3: r.h3, h12: r.h12, h25: r.h25,
     afterTax20: r.afterTax20, afterTax50: r.afterTax50, afterTax80: r.afterTax80, afterTaxMean: r.afterTaxMean } as unknown as RunResult);

/** A project's solo cell. A side is always ONE unit, and runCombined on a single unit is the same simulation as
 *  that unit's own run (same seed, same optimal price, no overhead) — so the cell is read off the unit's result
 *  in `R` (the result sideUnits would re-run), converted into `currency`, rather than re-simulated. */
function soloCell(R: Record<string, RunResult>, p: Project, currency: string): RunResult {
  const key = !isVar(p) ? p.id : p.additiveVariants ? uKey(p.id, "generic") : uKey(p.id, bestUnitId(R, p));
  const r = R[key];
  const f = toReporting(currencyOf(r)) / toReporting(currency);
  const lite = liteCell(r) as unknown as Record<string, unknown>;
  lite.currency = currency;
  if (f === 1) return lite as unknown as RunResult;
  const hzx = (h: Horizon): Horizon => ({ p20: h.p20 * f, p50: h.p50 * f, p80: h.p80 * f, mean: h.mean * f });
  for (const k of ["p20", "p50", "p80", "mean", "afterTax20", "afterTax50", "afterTax80", "afterTaxMean"]) lite[k] = (lite[k] as number) * f;
  for (const k of ["h3", "h12", "h25"]) lite[k] = hzx(lite[k] as Horizon);
  return lite as unknown as RunResult;
}

// Attention haircut (configurePortfolio({ pairAttentionOverhead }), default 0): people pursuing TWO products at
// once may split focus between two codebases, support queues and sales motions, so the combined revenue is
// haircut vs the naive sum — real for a solo founder, ~0 when each product has its own team. Applied only to the
// pair cell (not the solo). Same-market SUBSTITUTION is separately the per-draw max in runCombined.

/** Compute the matrix (lite cells) from the portfolio's results `R`, every cell in the reporting currency.
 *  `between` is awaited after each cell, so a server can yield to its event loop during the run. */
export async function computePairwise(R: Record<string, RunResult>, between: () => Promise<void> = async () => {}): Promise<PairMatrix> {
  const solos: [string, RunResult][] = [];
  const currency = REPORTING_CURRENCY.code;
  for (const p of pairable()) solos.push([p.id, soloCell(R, p, currency)]);
  const soloOf = new Map(solos);
  const ps = pairable().sort((a, b) => (soloOf.get(b.id) as RunResult).p50 - (soloOf.get(a.id) as RunResult).p50);
  const res: (RunResult | null)[][] = ps.map(() => new Array(ps.length).fill(null));
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < i; j++) { res[i][j] = liteCell(runCombined([...sideUnits(R, ps[i]), ...sideUnits(R, ps[j])], { overheadFrac: PAIR_ATTENTION_OVERHEAD, currency })); await between(); }
  }
  return { labels: ps.map((p) => pairLabel(R, p)), solo: ps.map((p) => soloOf.get(p.id) as RunResult), res };
}
