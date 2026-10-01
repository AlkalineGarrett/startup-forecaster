// DOM-free application core: the orchestration (state R, selected units, the init run loop) for the
// server; the project → unit helpers are shared with the browser app (units.ts). Every query returns an HTML
// fragment (the render/* functions are pure string builders) or a small JSON patch; no DOM is touched.
// The server (server.mjs) holds ONE session's state here and serves these fragments; the thin client
// only does DOM plumbing (tab switching, innerHTML swaps, forwarding pins). It renders the same results
// as the self-contained page (app.ts).
import type { Project, ProjectNode, RunUnit, Variant, RunResult } from "./types.ts";
import { PROJECTS, PAIRWISE_IDS } from "./portfolio-context.ts";
import { run, runUnit, runCombined } from "./simulate.ts";
import { RHO } from "./portfolio-context.ts";
import { fmt, esc, withCur } from "./format.ts";
import { makeScale, histProfile, type Scale } from "./render/graph.ts";
import { renderOverview, renderArchived, ovRow, ovRankTable, type OvSeries } from "./render/overview.ts";
import { overviewYoy, type YoyState } from "./render/yoy.ts";
import { renderPairwise, type PairMatrix } from "./render/pairwise.ts";
import { PAIRWISE_PRECOMPUTED } from "./portfolio-context.ts";
import { type Metric } from "./render/horizons.ts";
import { renderProject, renderVariantPanel, setRenderMetric, setRenderDirty, type VariantCtx, type VariantUnit } from "./render/project.ts";
import { renderEvidence, wireEvidenceFilter } from "./render/evidence.ts";
import { isVar, uKey, project, realUnitIds, variantById, nodesOf, runUnitById, ovResult, pairable, sideUnits, pairLabel } from "./units.ts";

// ---- State -------------------------------------------------------------
const R: Record<string, RunResult> = {};
const selected: Record<string, string> = {};
const histCap: Record<string, number> = {};
let scale: Scale;
let order: Project[] = [];
let metric: Metric = "p50";
let pwData: PairMatrix | null = null;
let pwValid = false;
// Projects with un-simulated overrides: a pin/clear/reset only records the override + marks the project
// dirty; the (expensive) re-sim waits for an explicit Resimulate click. Cleared when resimulate() runs.
const dirty = new Set<string>();
// Overview year-over-year overlay state (server-rendered; the browser only toggles hover opacity).
const yoy: YoyState = { checked: new Set<string>(), series: "net", stat: "p50" };
// The Overview ranking table's lens (gross revenue vs net income). Defaults to net income.
let ovSeries: OvSeries = "net";

function ctxFor(p: Project): VariantCtx {
  const units: VariantUnit[] = [
    { id: "generic", name: p.baseName || "Generic (no sharp wedge)", nodes: p.nodes, rho: RHO[p.id] || {}, revNote: p.revNote, brief: p.brief },
    ...(p.variants || []).map((v) => ({ id: v.id, name: v.name, nodes: v.nodes, rho: v.rho, revNote: v.revNote, brief: v.brief })),
  ];
  return {
    selectedId: selected[p.id] || "compare",
    units,
    resultOf: (id) => R[uKey(p.id, id)],
    histCapOf: (id) => histCap[uKey(p.id, id)],
    scale,
  };
}

// Only the fields the pairwise/horizon renderers read — so a computed cell drops its 20k-draw arrays
// (the matrix keeps only ~tens of numbers per cell, not tens of MB), and mean is carried for the switch.
const liteCell = (r: RunResult): RunResult =>
  ({ p20: r.p20, p50: r.p50, p80: r.p80, mean: r.mean, h3: r.h3, h12: r.h12, h25: r.h25,
     afterTax20: r.afterTax20, afterTax50: r.afterTax50, afterTax80: r.afterTax80, afterTaxMean: r.afterTaxMean } as unknown as RunResult);
/** Yield to the event loop so long computes stay cooperative (the server keeps serving other requests
 *  — tab switches, job polls — instead of freezing). No-op-ish; ~one macrotask tick. */
const yieldTick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Compute the pairwise matrix (28 pair sims + 8 solos) ASYNCHRONOUSLY: yield to the event loop after
 *  each cell so the server keeps serving other requests (tab switches, polls) and the page never freezes
 *  during the ~15s run. Stores only the lite cells. */
// Attention haircut: an operator pursuing TWO products at once splits focus/context between two
// codebases, two support queues, two sales motions — so the combined revenue is haircut vs the naive
// sum. Applied only to the pair cell (not the solo). Shared-BUILD is separately de-duped in runCombined
// (code_months = max, not sum) and same-market SUBSTITUTION is the per-draw max; this term is the
// ongoing split-attention cost of running both, distinct from the one-time shared build.
const PAIR_ATTENTION_OVERHEAD = 0.15;
export async function computePairwiseAsync(): Promise<void> {
  const solos: [string, RunResult][] = [];
  for (const p of pairable()) { solos.push([p.id, liteCell(runCombined(sideUnits(R, p)))]); await yieldTick(); }
  const soloOf = new Map(solos);
  const ps = pairable().sort((a, b) => (soloOf.get(b.id) as RunResult).p50 - (soloOf.get(a.id) as RunResult).p50);
  const res: (RunResult | null)[][] = ps.map(() => new Array(ps.length).fill(null));
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < i; j++) { res[i][j] = liteCell(runCombined([...sideUnits(R, ps[i]), ...sideUnits(R, ps[j])], { overheadFrac: PAIR_ATTENTION_OVERHEAD })); await yieldTick(); }
  }
  pwData = { labels: ps.map((p) => pairLabel(R, p)), solo: ps.map((p) => soloOf.get(p.id) as RunResult), res };
  pwValid = true;
}

/** The computed pairwise matrix (lite cells), or null before computePairwiseAsync — read by the
 *  pipeline's build-time bake (pipeline/gen-pairwise.mjs). */
export function pairwiseMatrix(): PairMatrix | null {
  return pwValid ? pwData : null;
}

// ---- Init --------------------------------------------------------------
export function initAppcore(): void {
  for (const p of PROJECTS) {
    if (isVar(p)) {
      for (const id of realUnitIds(p)) R[uKey(p.id, id)] = runUnitById(p, id);
      selected[p.id] = p.defaultUnit || "compare"; // opens on the Project overview by default
    } else {
      R[p.id] = run(p); // sweeps to find the optimal price, runs the headline at it, attaches the curve
    }
  }
  deriveViews();
}

/** The cheap, sim-free tail of init: histogram caps, the overview scale, ranked order, and the baked
 *  pairwise seed — all derived from R. Shared by initAppcore (after the sim loop) and hydrateState
 *  (after loading a precomputed snapshot). */
function deriveViews(): void {
  for (const key in R) {
    const b = R[key];
    histCap[key] = b.p95 > 0 ? b.p95 : Math.max(1, b.mean * 3);
  }
  const ovResults: Record<string, RunResult> = {};
  for (const p of PROJECTS) ovResults[p.id] = ovResult(R, p);
  scale = makeScale(ovResults);
  order = PROJECTS.slice().sort((a, b) => ovResult(R, b).p50 - ovResult(R, a).p50);
  // YoY overlay starts with every project checked.
  yoy.checked = new Set(order.map((p) => p.id));
  // Pairwise is computed lazily on first tab open (async, so it never blocks) — no stale baked seed.
  pwData = null;
  pwValid = false;
}

/** The version of the snapshot shape — bump on any change to what snapshotState captures. */
export const SNAPSHOT_VERSION = 4;

// The big per-unit fields (20k-draw arrays) that the UI never reads at page-load time — only the lazy
// histogram (→ replaced by the precomputed `hist` profile) and supermix re-pooling (→ regenerated by a
// deterministic re-run) need raw draws. Stripping them shrinks the snapshot from ~48MB to ~tens of KB.
const SAMPLE_FIELDS = ["samples", "sH3", "sH12", "sH25", "sAfter", "sYearRev", "sYearNet"] as const;

/** A slim copy of a result: the precomputed histogram profile in place of, and without, the raw draws. */
function slimResult(r: RunResult, cap: number): RunResult {
  const out: Record<string, unknown> = {};
  for (const k in r) if (!(SAMPLE_FIELDS as readonly string[]).includes(k)) out[k] = (r as Record<string, unknown>)[k];
  out.hist = r.hist || (r.samples && r.samples.length ? histProfile(r.samples, cap > 0 ? cap : Math.max(1, r.mean * 3, 1), r.thr) : { loss: 0, zero: 0, bins: new Array(48).fill(0), total: 1 });
  // NET-income (after-tax) histogram + its own x-axis cap (p95 of net, else a mean-based fallback), so the
  // project panel can plot the net distribution from the cache once the raw `sAfter` draws are stripped.
  if (r.histAfter) { out.histAfter = r.histAfter; out.histAfterCap = r.histAfterCap; }
  else if (r.sAfter && r.sAfter.length) {
    const aft = Float64Array.prototype.slice.call(r.sAfter).sort((a, b) => a - b);
    const p95 = aft[Math.min(aft.length - 1, Math.floor(aft.length * 0.95))];
    const netCap = p95 > 0 ? p95 : Math.max(1, r.afterTaxMean * 3, 1);
    out.histAfter = histProfile(r.sAfter, netCap, r.thr);
    out.histAfterCap = netCap;
  }
  return out as unknown as RunResult;
}

/** Capture the sim-derived state so it can be persisted and reloaded, letting the server skip the ~20s
 *  startup pass. Only the compact per-unit summaries + histogram profiles are kept (no 20k-draw arrays)
 *  — that's everything the initial render and every panel need; supermix re-pooling regenerates draws
 *  on demand via a deterministic re-run. */
export function snapshotState(): { v: number; R: Record<string, RunResult>; selected: Record<string, string>; pw: PairMatrix | null } {
  const slimR: Record<string, RunResult> = {};
  for (const key in R) slimR[key] = slimResult(R[key], histCap[key] ?? R[key].p95);
  // Include the pairwise matrix so it's ready instantly on tab open (cells are already lite scalars —
  // tiny). Present only if computePairwiseAsync ran before the snapshot (precompute / server fallback).
  return { v: SNAPSHOT_VERSION, R: slimR, selected, pw: pwValid ? pwData : null };
}

/** Load a snapshot produced by snapshotState (instead of running initAppcore's sims), then rebuild the
 *  derived views. Throws on a version mismatch so a stale cache is recomputed rather than mis-rendered. */
export function hydrateState(snap: { v: number; R: Record<string, RunResult>; selected: Record<string, string>; pw?: PairMatrix | null }): void {
  if (!snap || snap.v !== SNAPSHOT_VERSION) throw new Error(`snapshot version ${snap && snap.v} != ${SNAPSHOT_VERSION}`);
  Object.assign(R, snap.R);
  Object.assign(selected, snap.selected);
  deriveViews(); // resets pwData/pwValid — restore the cached matrix after it if present
  if (snap.pw) { pwData = snap.pw; pwValid = true; }
}

// ---- Query fragments ---------------------------------------------------
// The overview row is rendered server-side (ovRow, identical to renderOverview) so the client needs no
// formatters — it just replaces the <tr>'s outerHTML and updates the tab chip's formatted P50.
export interface RowData { pid: string; rowHTML: string; tabP50: string; }
export function rowData(pid: string): RowData {
  const p = project(pid) as Project;
  const r = ovResult(R, p);
  return { pid, rowHTML: ovRow(p, r, scale, ovSeries, ovVariantsAll()), tabP50: fmt(r.afterTax50, p.cur) };
}

/** Active (non-archived) tab chips (id/name/p50) in overview order — the main tab bar. */
// The tab chip cites NET income (afterTax50), not revenue — the `p50` field carries that net value.
export function tabList(): { id: string; name: string; p50: number; cur: string }[] {
  return order.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, p50: ovResult(R, p).afterTax50, cur: p.cur }));
}

/** Every project (active + archived) — used to create the panel divs, so an archived project's full
 * panel stays drill-through accessible from the Archived view even though it has no main tab chip.
 * `p50` carries the NET-income chip value (afterTax50). */
export function panelTabList(): { id: string; name: string; p50: number; archived: boolean; cur: string }[] {
  return order.map((p) => ({ id: p.id, name: p.name, p50: ovResult(R, p).afterTax50, archived: !!p.archived, cur: p.cur }));
}

function ovResultsAll(): Record<string, RunResult> {
  const res: Record<string, RunResult> = {};
  for (const p of order) res[p.id] = ovResult(R, p);
  return res;
}

/** Per-project variant list for the overview/year tables' expandable sub-rows: each real unit (base +
 *  variants) with its display name and result. Only projects that actually have variants get an entry. */
function ovVariantsAll(): Record<string, { id: string; name: string; r: RunResult }[]> {
  const res: Record<string, { id: string; name: string; r: RunResult }[]> = {};
  for (const p of order) {
    const ids = realUnitIds(p);
    if (ids.length <= 1) continue; // no variants → not expandable
    res[p.id] = ids.map((id) => ({ id, name: id === "generic" ? (p.baseName || p.name) : (variantById(p, id)?.name || id), r: R[uKey(p.id, id)] }));
  }
  return res;
}

/** Restrict the whole UI to a chosen subset of projects (by id), for a focused static artifact.
 *  Filters the ranked `order` (every view iterates it) and rescales the shared spread axis to the
 *  subset. All results stay computed; this only narrows what is shown. Order is preserved (still ranked).
 *  Unknown ids are ignored; throws if nothing matches. */
export function selectProjects(ids: string[]): void {
  const set = new Set(ids);
  order = order.filter((p) => set.has(p.id));
  if (!order.length) throw new Error(`selectProjects: no modeled project matches [${ids.join(", ")}]`);
  scale = makeScale(ovResultsAll());
}

/** How many of the currently-shown projects are eligible for the Pairwise view — a builder uses this to
 *  drop the Pairwise tab when a subset can't form a pair (e.g. a single-project artifact). */
export function pairwiseEligibleCount(): number {
  return order.filter((p) => PAIRWISE_IDS.includes(p.id)).length;
}

export function overviewHTML(): string {
  return renderOverview(order.filter((p) => !p.archived), ovResultsAll(), scale, yoy, ovSeries, ovVariantsAll());
}
/** The Overview ranking-table region (revenue/net toggle + table), swapped on a lens change. */
export function ovRankHTML(): string {
  return ovRankTable(order.filter((p) => !p.archived), ovResultsAll(), scale, ovSeries, ovVariantsAll());
}
export function ovSetSeries(s: OvSeries): { ovRankHTML: string } {
  ovSeries = s === "rev" ? "rev" : "net";
  return { ovRankHTML: ovRankHTML() };
}

/** The "Archived" tab: an outcome table of the no-longer-pursued projects (model preserved). Each row
 * is drill-through (data-go) to that project's full panel. */
export function archivedHTML(): string {
  return renderArchived(order.filter((p) => p.archived), ovResultsAll(), scale, ovVariantsAll());
}

/** The "Grounding" tab: the full node → distribution → evidence explorer (static content). */
export function evidenceHTML(): string {
  return renderEvidence();
}
export { wireEvidenceFilter };

/** The year-over-year overlay fragment (server-rendered), swapped in on a checkbox/series/stat change. */
export function yoyHTML(): string {
  return overviewYoy(order.filter((p) => !p.archived), ovResultsAll(), yoy, ovVariantsAll());
}
export function yoyToggle(pid: string): { yoyHTML: string } {
  if (yoy.checked.has(pid)) yoy.checked.delete(pid); else yoy.checked.add(pid);
  return { yoyHTML: yoyHTML() };
}
export function yoyAll(on: boolean): { yoyHTML: string } {
  yoy.checked.clear();
  if (on) for (const p of order) yoy.checked.add(p.id);
  return { yoyHTML: yoyHTML() };
}
export function yoySetSeries(s: "rev" | "net"): { yoyHTML: string } { yoy.series = s; return { yoyHTML: yoyHTML() }; }
export function yoySetStat(k: Metric): { yoyHTML: string } { yoy.stat = k; return { yoyHTML: yoyHTML() }; }

export function panelHTML(pid: string): string {
  const p = project(pid);
  if (!p) return "";
  setRenderMetric(metric); // the year charts render at the app's current global metric
  setRenderDirty(dirty.has(pid)); // show the Resimulate button when there are un-simulated overrides
  return withCur(p.cur, () => isVar(p) ? renderVariantPanel(p, ctxFor(p)) : renderProject(p, R[p.id], histCap[p.id]));
}

/** Whether the pairwise matrix is computed and current (else the /api/pairwise path kicks off an async
 *  compute job — the tab shows a spinner and never blocks). */
export function pairwiseReady(): boolean {
  return pwValid && !!pwData;
}

/** Render the CURRENT (cached) matrix. Assumes pairwiseReady(); computePairwiseAsync fills it lazily. */
export function pairwiseHTML(): string {
  return pwData ? renderPairwise(pwData, metric) : "";
}

export function isVariant(pid: string): boolean {
  const p = project(pid);
  return !!p && isVar(p);
}

/** The selectable sub-unit ids for a variant project (the Project overview + the base "generic" + each
 *  variant), so a static build can pre-bake every sub-body's panelHTML for client-side switching. */
export function variantUnitIds(pid: string): string[] {
  const p = project(pid);
  if (!p || !isVar(p)) return [];
  return ["compare", "generic", ...(p.variants || []).map((v) => v.id)];
}

/** The currently-selected sub-tab of a variant project (so the static builder can save/restore it around
 *  the pre-bake loop, which mutates `selected`). */
export function currentUnit(pid: string): string {
  return selected[pid] || "compare";
}

// ---- Mutations (each returns the fragments to patch) -------------------
export interface Patch { panelHTML?: string; row?: RowData; yoyHTML?: string; pairwiseInvalid?: boolean; }
/** The standard patch after a project's result changed: its panel, its overview row, the (re-rendered)
 *  overview Year-over-year card (chart + year table), and a pairwise-stale flag so the client re-fetches
 *  Pairwise on next open. */
function editPatch(pid: string): Patch {
  return { panelHTML: panelHTML(pid), row: rowData(pid), yoyHTML: yoyHTML(), pairwiseInvalid: true };
}

/** Pin a narrow test distribution at `pos` on a node's bar and re-run its unit. */
// pin/clear/reset are now DEFERRED: they only record the override and mark the project dirty, then
// re-render the panel (the node bar shows the pin; the headline holds, with a Resimulate button). The
// actual re-sim happens in resimulate() when the user clicks — so a pin never blocks or freezes.
export function pin(pid: string, unitId: string | undefined, nodeId: string, pos: number): Patch {
  const p = project(pid);
  if (!p) return {};
  const n = (unitId ? nodesOf(p, unitId) : p.nodes).find((x) => x.id === nodeId);
  if (!n) return {};
  n._override = Math.max(0, Math.min(1, pos));
  dirty.add(pid);
  return { panelHTML: panelHTML(pid) };
}

export function clearOverride(key: string): Patch {
  const parts = key.split("|");
  const p = project(parts[0]);
  if (!p) return {};
  const n = (parts.length === 3 ? nodesOf(p, parts[1]) : p.nodes).find((x) => x.id === parts[parts.length - 1]);
  if (!n) return {};
  n._override = undefined;
  dirty.add(p.id);
  return { panelHTML: panelHTML(p.id) };
}

export function resetProject(pid: string): Patch {
  const p = project(pid);
  if (!p) return {};
  for (const n of p.nodes) n._override = undefined;
  for (const v of p.variants || []) for (const n of v.nodes) n._override = undefined;
  dirty.add(pid);
  return { panelHTML: panelHTML(pid) };
}

/** Run the deferred re-sim for a dirty project under its current overrides, then slim the fresh draws
 *  back out of RAM. Async + yields between units so the event loop keeps serving other requests while a
 *  variant project's fronts re-run. Invoked from a server job → the page never freezes on a re-sim. */
export async function resimulate(pid: string): Promise<Patch> {
  const p = project(pid);
  if (!p) return {};
  if (isVar(p)) {
    for (const id of realUnitIds(p)) { R[uKey(pid, id)] = runUnitById(p, id); await yieldTick(); }
  } else {
    R[pid] = run(p);
  }
  dirty.delete(pid);
  pwValid = false; // the portfolio pairwise depends on this project — recompute on its next open
  slimAll();
  return editPatch(pid);
}

/** Keep RAM tiny: replace any result still holding its 20k-draw arrays with the slim form (histogram
 *  profile + summaries). Called after every re-sim so edited projects don't accumulate raw draws. */
function slimAll(): void {
  for (const key in R) {
    const r = R[key];
    if (r.samples && r.samples.length) R[key] = slimResult(r, histCap[key] ?? r.p95);
  }
}

/** Switch a variant project's active sub-tab (no re-simulation). */
export function selectVariant(pid: string, unitId: string): Patch {
  const p = project(pid);
  if (!p) return {};
  selected[pid] = unitId;
  return { panelHTML: panelHTML(pid) };
}

/** The shared P20/P50/P80 selector. Sets the render metric for the project panels + Pairwise (the
 *  Overview ranking is metric-independent, and the Year-over-year card has its own stat toggle), so the
 *  client just re-fetches whichever project panel is open. */
export function setMetric(m: Metric): void {
  metric = m;
  setRenderMetric(m);
}

export { fmt, esc };
