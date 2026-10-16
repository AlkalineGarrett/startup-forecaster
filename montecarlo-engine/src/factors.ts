// Multi-factor Gaussian copula. Instead of one global "luck" factor, each node loads on a
// small set of NAMED latent factors, so dependence is elicitable one node at a time and is
// positive-semi-definite by construction. The portfolio's global factors (configurePortfolio({ globalFactors }),
// default ["macro"]) are drawn once per iteration and SHARED across every project (common random numbers); any
// other factor a node loads on (execution quality, a per-funnel channel, a demand curve) is project-local,
// drawn fresh per project. w_i = Σ_k λ_ik·z_k + √(1−Σλ²)·ε_i ; u_i = Φ(w_i) — marginal preserved exactly.
import { phi } from "./rng.ts";
import type { Loadings } from "./types.ts";
import { GLOBAL_FACTORS } from "./portfolio-context.ts";

/** Macroeconomic factor, the default shared factor. Coupling only happens where a node loads on a global
 * factor, so a workspace's own global (e.g. a shared market or a shared network) can couple just two projects. */
export const F_MACRO = "macro";
/** Per-project execution quality (the scalar "luck" loading, as one named factor). */
export const F_EXEC = "exec";

/** Idiosyncratic coefficient √(1 − Σλ²). Σλ² > 1 is a data error; clamp to 0 (fully shared). */
export function idioCoef(loadings: Loadings): number {
  let s = 0;
  for (const k in loadings) s += loadings[k] * loadings[k];
  return Math.sqrt(Math.max(0, 1 - s));
}

/** Copula uniform for a node: u = Φ(Σ λ_k·z_k + ic·ε). `z` holds this iteration's factor draws. */
export function latentU(loadings: Loadings, ic: number, z: Record<string, number>, eps: number): number {
  let w = ic * eps;
  for (const k in loadings) w += loadings[k] * (z[k] || 0);
  return phi(w);
}

/** Local (non-global) factor names referenced by a unit's nodes — the ones drawn per project. */
export function localFactorNames(loadingsList: Loadings[]): string[] {
  const set = new Set<string>();
  for (const L of loadingsList) for (const k in L) if (!GLOBAL_FACTORS.includes(k)) set.add(k);
  return [...set];
}

/** Express a scalar luck loading as loadings on the execution factor. */
export function rhoToLoadings(rho: number): Loadings {
  return rho ? { [F_EXEC]: rho } : {};
}
