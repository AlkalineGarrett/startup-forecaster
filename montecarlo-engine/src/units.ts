// How a project becomes simulation units — the ONE copy shared by the browser app (app.ts) and the
// server core (appcore.ts). Each used to carry its own copy; they drifted (the browser's dropped the
// itemized revenue/cost lines, and ran variants under the wrong key). Helpers that read run results
// take the results map `R` (keyed by project id, or `project::unit` for variant projects).
import type { Project, ProjectNode, RunUnit, Variant, RunResult } from "./types.ts";
import { PROJECTS, PAIRWISE_IDS, toReporting } from "./portfolio-context.ts";
import { runUnit, baseUnit } from "./simulate.ts";

export { baseUnit };

export const isVar = (p: Project): boolean => !!(p.variants && p.variants.length);
export const uKey = (pid: string, unitId: string): string => `${pid}::${unitId}`;
export const project = (id: string): Project | undefined => PROJECTS.find((x) => x.id === id);
export const realUnitIds = (p: Project): string[] => ["generic", ...(p.variants || []).map((v) => v.id)];
export const variantById = (p: Project, id: string): Variant | undefined => (p.variants || []).find((v) => v.id === id);
export const nodesOf = (p: Project, unitId: string): ProjectNode[] =>
  unitId === "generic" ? p.nodes : variantById(p, unitId)?.nodes || [];

/** A variant as a unit — keyed `project::variant` (the key its compiled distributions live under). It is in its
 *  project's currency (and price currency) unless it sets its own; its fx is derived by configurePortfolio. */
export const variantUnit = (p: Project, v: Variant): RunUnit => ({ id: uKey(p.id, v.id), fx: v.fx, currency: v.currency ?? p.currency, priceCurrency: v.priceCurrency ?? p.priceCurrency, nodes: v.nodes, sim: v.sim, rho: v.rho, margin: v.margin ?? p.margin, tvMultiple: v.tvMultiple ?? p.tvMultiple, cost: v.cost, personal: p.personal, afterTax: p.afterTax, market: v.market, priceSweep: v.priceSweep, revenueLines: v.revenueLines ?? p.revenueLines, cogsLines: v.cogsLines ?? p.cogsLines, costLines: v.costLines ?? p.costLines });
/** A unit id ("generic" = the project's own graph, else a variant id) → RunUnit. */
const unitById = (p: Project, unitId: string): RunUnit =>
  unitId === "generic" ? baseUnit(p) : variantUnit(p, variantById(p, unitId) as Variant);
export const runUnitById = (p: Project, unitId: string): RunResult => runUnit(unitById(p, unitId));

/** A project's overview headline: its own result, or (variant project) its base unit's. */
export const ovResult = (R: Record<string, RunResult>, p: Project): RunResult => (isVar(p) ? R[uKey(p.id, "generic")] : R[p.id]);
/** `items` ranked highest first by `amount` (in each item's own currency), compared in the reporting currency so
 *  ventures in different currencies rank together. The one ranking every view uses. */
export function rankByReporting<T extends { currency?: string }>(items: T[], amount: (x: T) => number): T[] {
  const key = (x: T): number => amount(x) * toReporting(x);
  return items.slice().sort((a, b) => key(b) - key(a));
}
/** The highest-P50 unit (generic or a variant) of a variant project. */
export const bestUnitId = (R: Record<string, RunResult>, p: Project): string =>
  realUnitIds(p).reduce((a, b) => (R[uKey(p.id, b)].p50 > R[uKey(p.id, a)].p50 ? b : a));

// ---- Pairwise: what each project contributes to a pair ----
export const pairable = (): Project[] => PROJECTS.filter((p) => PAIRWISE_IDS.includes(p.id));
/** A variant project's representative unit in a pair: its best unit. */
export const repUnit = (R: Record<string, RunResult>, p: Project): RunUnit => unitById(p, bestUnitId(R, p));
/** The representative unit's short name ("(descriptor)" dropped so pair labels stay compact). */
export const repName = (R: Record<string, RunResult>, p: Project): string => {
  const id = bestUnitId(R, p);
  const full = id === "generic" ? p.baseName || "generic" : variantById(p, id)?.name || id;
  return full.replace(/\s*\(.*$/, "");
};
/** A project's side of a pair: itself; additive variants → the base (channels on one calendar); alternatives → the best unit. */
export const sideUnits = (R: Record<string, RunResult>, p: Project): RunUnit[] =>
  (!isVar(p) ? [baseUnit(p)] : p.additiveVariants ? [baseUnit(p)] : [repUnit(R, p)]);
export const pairLabel = (R: Record<string, RunResult>, p: Project): string =>
  (!isVar(p) ? p.name : p.additiveVariants ? p.name : `${p.name} (${repName(R, p)})`);
