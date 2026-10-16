// Push the compiled distributions onto the model nodes for DISPLAY: percentiles (for the
// bars), a provenance colour (from support_score), and the basis text (the node's reasoning). The
// SAMPLING itself reads the compiled distribution directly in simulate.ts — this only feeds the UI.
// A workspace calls it once its projects' node lists are final.
import type { Project, ProjectNode, Prov, ProvMap } from "./types.ts";
import { DISTRIBUTIONS, type NodeDist } from "./portfolio-context.ts";

/** support_score (grounding strength, 0–100) bands: ≥ SUPPORT_HIGH sourced · ≥ SUPPORT_MID inferred · else guess. */
export const SUPPORT_HIGH = 60;
export const SUPPORT_MID = 40;

/** support_score → the bar's provenance colour band. */
function provOf(support: number | undefined): Prov {
  if (support == null) return "guess";
  if (support >= SUPPORT_HIGH) return "sourced";
  if (support >= SUPPORT_MID) return "inferred";
  return "guess";
}

/** Derived percentiles → the model's Pctiles slots (p05→p01, p95→p99); the bar reads whatever is set. */
function applyToNode(n: ProjectNode, nd: NodeDist): void {
  const q = nd.pctiles;
  const pc: Record<string, number> = {};
  if (q.p05 != null) pc.p01 = q.p05;
  if (q.p10 != null) pc.p10 = q.p10;
  if (q.p50 != null) pc.p50 = q.p50;
  if (q.p90 != null) pc.p90 = q.p90;
  if (q.p95 != null) pc.p99 = q.p95;
  n.pctiles = pc;
  const level = provOf(nd.support);
  const prov: ProvMap = {};
  for (const k of Object.keys(pc) as (keyof ProvMap)[]) prov[k] = level;
  n.prov = prov;
  n.basis = nd.basis ?? n.basis ?? "";
  n._support = nd.support;
  // sampling is grounded in the compiled kind, not archived URLs; the sources row falls back to the
  // provenance note when urls is empty (see render/project.ts sourcesRow).
  n.urls = [];
  // fractions in [0,1] vs magnitudes — re-derive from the new percentiles so the bar axis + override
  // clamp match what is actually sampled.
  const vs = Object.values(pc);
  // A duration (months/years/weeks/days, per the compiled unit) is never a fraction, even when short.
  const timeNode = /^(months?|years?|weeks?|days?)\b/i.test(nd.unit ?? "");
  // A fraction never exceeds 1. (The old `<= 1.5` cut also caught multipliers/ratios around 1 — NRR
  // expansion, demand tailwind, repeat-engagement counts — and clamped their samples to 0.995.)
  n._frac = vs.length > 0 && Math.max(...vs) <= 1 && n.kind === "value" && !timeNode;
}

/** Overlay the compiled distributions' derived percentiles + provenance onto every model node. */
export function applyDistributions(projects: Project[]): void {
  for (const p of projects) {
    for (const n of p.nodes) {
      const nd = DISTRIBUTIONS[`${p.id}::${n.id}`];
      if (nd) applyToNode(n, nd);
    }
    for (const v of p.variants || []) {
      for (const n of v.nodes) {
        const nd = DISTRIBUTIONS[`${p.id}::${v.id}::${n.id}`];
        if (nd) applyToNode(n, nd);
      }
    }
  }
}
