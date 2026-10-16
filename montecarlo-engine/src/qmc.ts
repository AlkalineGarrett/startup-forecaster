// Quasi-Monte-Carlo driver for the shared factors. QMC (low-discrepancy) points converge much
// faster than pseudo-random on the smooth, low-dimensional integrals that decide the ranking, so
// the shared global factors (configurePortfolio({ globalFactors })) are driven from a scrambled Halton sequence and
// reused across every project in an iteration (common random numbers). Everything else — node
// idiosyncratic ε, cohort-internal randomness — stays pseudo-random. A scrambled Halton in a few
// dimensions is simpler than Sobol and more than adequate here.
import { probit } from "./rng.ts";
import { GLOBAL_FACTORS } from "./portfolio-context.ts";

/** One Halton base per shared factor; configurePortfolio caps globalFactors at MAX_GLOBAL_FACTORS (= this length). */
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
const QEPS = 1e-7;

/** Van der Corput radical inverse of i in the given base. */
function radicalInverse(i: number, base: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** A `dim`-dimensional scrambled-Halton point for sequence index `i`, rotated by `shift`
 * (a Cranley–Patterson rotation for reproducible scrambling). Uniforms in [0,1). */
export function haltonPoint(i: number, dim: number, shift: number[]): number[] {
  const out = new Array<number>(dim);
  for (let d = 0; d < dim; d++) {
    const u = radicalInverse(i + 1, PRIMES[d]) + (shift[d] || 0);
    out[d] = u - Math.floor(u);
  }
  return out;
}

/** The shared global factors for iteration `i`, as standard normals (QMC-driven, CRN across projects). */
export function globalFactors(i: number, shift: number[]): Record<string, number> {
  const u = haltonPoint(i, GLOBAL_FACTORS.length, shift);
  const z: Record<string, number> = {};
  for (let k = 0; k < GLOBAL_FACTORS.length; k++) {
    z[GLOBAL_FACTORS[k]] = probit(QEPS + u[k] * (1 - 2 * QEPS));
  }
  return z;
}
