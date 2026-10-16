// DOM-free view state derived from the run results — the ONE copy shared by the self-contained page (app.ts)
// and the server core (appcore.ts). Every helper takes the results map `R` (keyed by project id, or
// `project::unit` for variant projects) and whatever selection state it reads, so each caller keeps its own.
import type { Project, RunResult } from "../../montecarlo-engine/src/types.ts";
import { PAIRWISE_IDS, DISTRIBUTIONS, RHO } from "../../montecarlo-engine/src/portfolio-context.ts";
import type { Scale } from "./render/graph.ts";
import type { VariantCtx, VariantUnit } from "./render/project.ts";
import { isVar, uKey, realUnitIds, variantById, ovResult, rankByReporting } from "../../montecarlo-engine/src/units.ts";

/** Each variant project's opening sub-tab (its defaultUnit, else the Project overview), written into `selected`. */
export function defaultSelection(projects: Project[], selected: Record<string, string>): void {
  for (const p of projects) if (isVar(p)) selected[p.id] = p.defaultUnit || "compare";
}

/** The baseline P95 per unit key, which fixes each histogram's x-axis (comparable across override re-runs);
 *  written into `histCap`. */
export function fillHistCaps(R: Record<string, RunResult>, histCap: Record<string, number>): void {
  for (const key in R) {
    const b = R[key];
    histCap[key] = b.p95 > 0 ? b.p95 : Math.max(1, b.mean * 3);
  }
}

/** Projects ranked by overview P50 in the reporting currency, so ventures in different currencies compare. */
export function rankOrder(projects: Project[], R: Record<string, RunResult>): Project[] {
  return rankByReporting(projects, (p) => ovResult(R, p).p50);
}

/** Each project's overview headline result, keyed by project id. */
export function ovResultsOf(projects: Project[], R: Record<string, RunResult>): Record<string, RunResult> {
  const res: Record<string, RunResult> = {};
  for (const p of projects) res[p.id] = ovResult(R, p);
  return res;
}

/** Per-project variant list for the overview/year tables' expandable sub-rows: each real unit (base +
 *  variants) with its display name and result. Only projects that actually have variants get an entry. */
export function ovVariantsOf(projects: Project[], R: Record<string, RunResult>): Record<string, { id: string; name: string; r: RunResult }[]> {
  const res: Record<string, { id: string; name: string; r: RunResult }[]> = {};
  for (const p of projects) {
    const ids = realUnitIds(p);
    if (ids.length <= 1) continue; // no variants → not expandable
    res[p.id] = ids.map((id) => ({ id, name: id === "generic" ? (p.baseName || p.name) : (variantById(p, id)?.name || id), r: R[uKey(p.id, id)] }));
  }
  return res;
}

/** The render context of a variant project's panel: its units (base + variants), the selected sub-tab, and
 *  lookups into the results and histogram caps. */
export function variantCtx(p: Project, R: Record<string, RunResult>, selected: Record<string, string>, histCap: Record<string, number>, scale: Scale): VariantCtx {
  const units: VariantUnit[] = [
    { id: "generic", name: p.baseName || "Base", nodes: p.nodes, rho: RHO[p.id] || {}, revNote: p.revNote, brief: p.brief, personal: p.personal, afterTax: p.afterTax },
    ...(p.variants || []).map((v) => ({ id: v.id, name: v.name, nodes: v.nodes, rho: v.rho, revNote: v.revNote, brief: v.brief, personal: v.personal ?? p.personal, afterTax: v.afterTax ?? p.afterTax })),
  ];
  return {
    selectedId: selected[p.id] || "compare",
    units,
    resultOf: (id) => R[uKey(p.id, id)],
    histCapOf: (id) => histCap[uKey(p.id, id)],
    scale,
  };
}

/** How many of `projects` are eligible for the Pairwise view. */
export const pairwiseCount = (projects: Project[]): number => projects.filter((p) => PAIRWISE_IDS.includes(p.id)).length;

/** Which of the optional tabs have anything to show: Pairwise needs two pairable ventures, Grounding compiled
 *  distributions, Archived an archived venture. A page leaves out a tab that would be empty. */
export function optionalTabsOf(projects: Project[]): { pw: boolean; gr: boolean; arch: boolean } {
  return { pw: pairwiseCount(projects) >= 2, gr: Object.keys(DISTRIBUTIONS).length > 0, arch: projects.some((p) => p.archived) };
}
