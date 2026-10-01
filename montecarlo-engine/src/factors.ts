// Multi-factor Gaussian copula. Instead of one global "luck" factor, each node loads on a
// small set of NAMED latent factors, so dependence is elicitable one node at a time and is
// positive-semi-definite by construction. Globals (macro, ai_demand) are drawn once per
// iteration and SHARED across every project (common random numbers); project-local factors
// (execution quality, per-funnel channel quality, per-project demand-curve) are drawn fresh
// per project. w_i = Σ_k λ_ik·z_k + √(1−Σλ²)·ε_i ; u_i = Φ(w_i) — marginal preserved exactly.
import { phi } from "./rng.ts";
import type { Loadings } from "./types.ts";

/** Macroeconomic / hiring-cycle factor, shared across all projects. */
export const F_MACRO = "macro";
/** AI-market demand & capability curve, shared across the AI-exposed projects. */
export const F_AI = "ai_demand";
/** Latent candidate quality (same CV, same interview performance), shared across the job tracks. */
export const F_CANDIDATE = "candidate_quality";
/** The one professional network, drawn down once — couples warm consulting to job referrals. */
export const F_NETWORK = "network";
/** Factors drawn once per iteration and shared across projects (common random numbers). Coupling
 * only happens where a node loads on one, so a "global" factor can still couple just two projects. */
export const GLOBAL_FACTORS: string[] = [F_MACRO, F_AI, F_CANDIDATE, F_NETWORK];
/** Per-project execution quality (the old scalar "luck", now one named factor). */
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
