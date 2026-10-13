// How a project becomes simulation units — the ONE copy shared by the browser app (app.ts) and the
// server core (appcore.ts). Each used to carry its own copy; they drifted (the browser's dropped the
// itemized revenue/cost lines, and ran variants under the wrong key). Helpers that read run results
// take the results map `R` (keyed by project id, or `project::unit` for variant projects).
import type { Project, ProjectNode, RunUnit, Variant, RunResult } from "./types.ts";
import { PROJECTS, PAIRWISE_IDS, RHO } from "./portfolio-context.ts";
import { runUnit } from "./simulate.ts";

export const isVar = (p: Project): boolean => !!(p.variants && p.variants.length);
export const uKey = (pid: string, unitId: string): string => `${pid}::${unitId}`;
export const project = (id: string): Project | undefined => PROJECTS.find((x) => x.id === id);
export const realUnitIds = (p: Project): string[] => ["generic", ...(p.variants || []).map((v) => v.id)];
export const variantById = (p: Project, id: string): Variant | undefined => (p.variants || []).find((v) => v.id === id);
export const nodesOf = (p: Project, unitId: string): ProjectNode[] =>
  unitId === "generic" ? p.nodes : variantById(p, unitId)?.nodes || [];

/** The project's own graph as a unit. */
export const baseUnit = (p: Project): RunUnit => ({ id: p.id, fx: p.fx, nodes: p.nodes, sim: p.sim!, rho: RHO[p.id] || {}, margin: p.margin, tvMultiple: p.tvMultiple, cost: p.cost, personal: p.personal, afterTax: p.afterTax, market: p.market, priceSweep: p.priceSweep, revenueLines: p.revenueLines, cogsLines: p.cogsLines, costLines: p.costLines });
/** A variant as a unit — keyed `project::variant` (the key its compiled distributions live under). */
export const variantUnit = (p: Project, v: Variant): RunUnit => ({ id: uKey(p.id, v.id), fx: v.fx, nodes: v.nodes, sim: v.sim, rho: v.rho, margin: v.margin ?? p.margin, tvMultiple: v.tvMultiple ?? p.tvMultiple, cost: v.cost, personal: p.personal, afterTax: p.afterTax, market: v.market, priceSweep: v.priceSweep, revenueLines: v.revenueLines ?? p.revenueLines, cogsLines: v.cogsLines ?? p.cogsLines, costLines: v.costLines ?? p.costLines });
/** A unit id → RunUnit; the generic base carries the cap-exempt `base` flag unless it is the aggregate (headlineBase). */
export const unitOf = (p: Project, id: string): RunUnit =>
  id === "generic" ? { ...baseUnit(p), base: !p.headlineBase } : variantUnit(p, variantById(p, id) as Variant);
export const runUnitById = (p: Project, unitId: string): RunResult =>
  unitId === "generic" ? runUnit(baseUnit(p)) : runUnit(variantUnit(p, variantById(p, unitId) as Variant));

/** A project's overview headline: its own result, or (variant project) its base unit's. */
export const ovResult = (R: Record<string, RunResult>, p: Project): RunResult => (isVar(p) ? R[uKey(p.id, "generic")] : R[p.id]);
/** The highest-P50 unit (generic or a variant) of a variant project. */
export const bestUnitId = (R: Record<string, RunResult>, p: Project): string =>
  realUnitIds(p).reduce((a, b) => (R[uKey(p.id, b)].p50 > R[uKey(p.id, a)].p50 ? b : a));

// ---- Pairwise: what each project contributes to a pair ----
export const pairable = (): Project[] => PROJECTS.filter((p) => PAIRWISE_IDS.includes(p.id));
export const repUnitId = (R: Record<string, RunResult>, p: Project): string => bestUnitId(R, p);
export const repUnit = (R: Record<string, RunResult>, p: Project): RunUnit => {
  const id = repUnitId(R, p);
  return id === "generic" ? baseUnit(p) : variantUnit(p, variantById(p, id) as Variant);
};
/** The representative unit's short name ("(descriptor)" dropped so pair labels stay compact). */
export const repName = (R: Record<string, RunResult>, p: Project): string => {
  const id = repUnitId(R, p);
  const full = id === "generic" ? p.baseName || "generic" : variantById(p, id)?.name || id;
  return full.replace(/\s*\(.*$/, "");
};
/** A project's side of a pair: itself; additive variants → the base (channels on one calendar); alternatives → the best unit. */
export const sideUnits = (R: Record<string, RunResult>, p: Project): RunUnit[] =>
  (!isVar(p) ? [baseUnit(p)] : p.additiveVariants ? [baseUnit(p)] : [repUnit(R, p)]);
export const pairLabel = (R: Record<string, RunResult>, p: Project): string =>
  (!isVar(p) ? p.name : p.additiveVariants ? p.name : `${p.name} (${repName(R, p)})`);
