// Browser entry point: builds the tab bar, the Overview and per-project panels, and wires per-node
// overrides (re-run), reset and — for variant projects — sub-tab select. This is the only module that
// touches the DOM. The pure-DOM interactions (tab routing, sorting, the hovers, the card toggles —
// tabNav, wireShared, sharedClick, …) live in dom-shared.mjs, which build.mjs bundles ahead of this
// module; the derived view state comes from view-model.ts, shared with appcore.ts.
import type { Project, ProjectNode, RunResult } from "../../montecarlo-engine/src/types.ts";
import { PROJECTS, PORTFOLIO_TITLE, withCur } from "../../montecarlo-engine/src/portfolio-context.ts";
import { run } from "../../montecarlo-engine/src/simulate.ts";
import { fmt, esc, heatVars, pct } from "../../montecarlo-engine/src/format.ts";
import { makeScale, histSVG, stripSVG } from "./render/graph.ts";
import { renderOverview, renderArchived, ovVals, ovRankTable, sortKeys, type OvSeries } from "./render/overview.ts";
import { overviewYoy } from "./render/yoy.ts";
import { renderPairwise, type PairMatrix, type PairMetric } from "./render/pairwise.ts";
import { PAIRWISE_PRECOMPUTED } from "../../montecarlo-engine/src/portfolio-context.ts";
import { computePairwise, runPortfolio } from "../../montecarlo-engine/src/pairwise.ts";
import { renderProject, renderBarBlock, renderVariantPanel, renderVariantSub, type VariantCtx } from "./render/project.ts";
import { BAR_GEO } from "./render/bar.ts";
import { renderEvidence, wireEvidenceFilter } from "./render/evidence.ts";
import { isVar, uKey, project, realUnitIds, nodesOf, runUnitById, ovResult } from "../../montecarlo-engine/src/units.ts";
import { defaultSelection, fillHistCaps, rankOrder, ovResultsOf, ovVariantsOf, variantCtx, optionalTabsOf } from "./view-model.ts";

// ---- State -------------------------------------------------------------
const R: Record<string, RunResult> = {};
const selected: Record<string, string> = {}; // variant projects: active sub-tab
const histCap: Record<string, number> = {};
const rendered: Record<string, boolean> = {};

// Start from the precomputed results the build embedded (the same snapshot the server and the static pages
// start from), so the page renders instantly; simulate here only when the page was built without one.
const SNAPSHOT = (globalThis as { MC_SNAPSHOT?: { R: Record<string, RunResult>; selected: Record<string, string>; pw: PairMatrix | null } }).MC_SNAPSHOT;
if (SNAPSHOT) {
  Object.assign(R, SNAPSHOT.R);
  Object.assign(selected, SNAPSHOT.selected);
} else {
  Object.assign(R, runPortfolio());
  defaultSelection(PROJECTS, selected); // opens on the Project overview by default
}

fillHistCaps(R, histCap);
const ovResults = ovResultsOf(PROJECTS, R);
const scale = makeScale(ovResults); // fixed once from the initial run
const order = rankOrder(PROJECTS, R);
/** Per-project variant list for the overview/year tables' expandable sub-rows; computed fresh so it tracks re-sims. */
const ovVariantsAll = (): Record<string, { id: string; name: string; r: RunResult }[]> => ovVariantsOf(order, R);
const ctxFor = (p: Project): VariantCtx => variantCtx(p, R, selected, histCap, scale);
// The optional tabs, each left out when it would be empty (matches appcore.optionalTabs).
const HAS = optionalTabsOf(PROJECTS);

const tabbar = document.getElementById("tabbar") as HTMLElement;
const panels = document.getElementById("panels") as HTMLElement;
document.title = PORTFOLIO_TITLE; // the portfolio's title (overrides the static shell default)

let metric: PairMetric = "p50"; // shared P20/P50/P80 selector for the pairwise matrix + all horizon tables
let ovSeries: OvSeries = "net"; // Overview ranking table lens (revenue vs net income); defaults to net
let pwData: PairMatrix | null = null;

function renderPairwiseInto(): void {
  const el = document.getElementById("panel-pw");
  if (pwData && el && HAS.pw) el.innerHTML = renderPairwise(pwData, metric);
}

/** Re-render the Overview Year-over-year card (chart + year table) after a project's numbers change. */
function renderOvYoy(): void {
  const el = document.getElementById("yoycard");
  if (el) el.innerHTML = overviewYoy(order.filter((p) => !p.archived), ovResultsOf(order, R), undefined, ovVariantsAll());
}

function setMetric(m: PairMetric): void {
  metric = m; // one selector drives the pairwise matrix and every project's year chart
  renderPairwiseInto(); // re-render only (results are cached) — no re-simulation
}

// ---- Build tabs + panels ----------------------------------------------
function buildTabs(): void {
  const ovTab = document.createElement("div");
  ovTab.className = "tab active";
  ovTab.textContent = "Overview";
  ovTab.dataset.t = "ov";
  tabbar.appendChild(ovTab);
  if (HAS.pw) {
    const pwTab = document.createElement("div");
    pwTab.className = "tab";
    pwTab.dataset.t = "pw";
    pwTab.textContent = "Pairwise";
    tabbar.appendChild(pwTab);
  }
  for (const p of order.filter((p) => !p.archived)) {
    const t = document.createElement("div");
    t.className = "tab";
    t.dataset.t = p.id;
    t.innerHTML = `${esc(p.name)} <span class="ev">${fmt(ovResult(R, p).afterTax50, p.cur)}</span>`; // tab cites NET income
    tabbar.appendChild(t);
  }
  // Grounding + Archived trail the active projects — a reference/utility group, opened rarely.
  if (HAS.gr) {
    const grTab = document.createElement("div");
    grTab.className = "tab tab-tail";
    grTab.dataset.t = "gr";
    grTab.textContent = "Grounding";
    tabbar.appendChild(grTab);
  }
  if (HAS.arch) {
    const archTab = document.createElement("div");
    archTab.className = "tab tab-arch";
    archTab.dataset.t = "arch";
    archTab.textContent = "Archived";
    tabbar.appendChild(archTab);
  }
}

function buildPanels(): void {
  panels.innerHTML = ""; // drop the shell's "Simulating…" line
  const ov = document.createElement("div");
  ov.className = "panel active";
  ov.id = "panel-ov";
  ov.innerHTML = renderOverview(order.filter((p) => !p.archived), ovResults, scale, undefined, undefined, ovVariantsAll());
  panels.appendChild(ov);
  if (HAS.pw) {
    const pw = document.createElement("div");
    pw.className = "panel";
    pw.id = "panel-pw";
    panels.appendChild(pw);
  }
  if (HAS.gr) {
    const gr = document.createElement("div");
    gr.className = "panel";
    gr.id = "panel-gr";
    panels.appendChild(gr); // rendered lazily on first open (it can be large) — see ensureRendered
  }
  if (HAS.arch) {
    const arch = document.createElement("div");
    arch.className = "panel";
    arch.id = "panel-arch";
    arch.innerHTML = renderArchived(order.filter((p) => p.archived), ovResults, scale, ovVariantsAll());
    panels.appendChild(arch);
  }
  for (const p of PROJECTS) {
    const panel = document.createElement("div");
    panel.className = isVar(p) ? "panel varpanel" : "panel";
    panel.id = "panel-" + p.id;
    panels.appendChild(panel);
  }
}

function renderPanel(p: Project): void {
  (document.getElementById("panel-" + p.id) as HTMLElement).innerHTML = withCur(p, () => isVar(p)
    ? renderVariantPanel(p, ctxFor(p))
    : renderProject(p, R[p.id], histCap[p.id]));
}

function ensureRendered(t: string): void {
  if (t === "ov" || rendered[t]) return;
  if (t === "gr") {
    const gr = document.getElementById("panel-gr");
    if (!gr) return;
    gr.innerHTML = renderEvidence();
    wireEvidenceFilter();
    rendered.gr = true;
    return;
  }
  if (t === "pw") {
    if (!HAS.pw) return;
    rendered.pw = true;
    // lazy: the engine's pair simulations on first open / after a change (the same computation the server runs)
    computePairwise(R).then((m) => { pwData = m; renderPairwiseInto(); });
    return;
  }
  const p = project(t);
  if (p) {
    renderPanel(p);
    rendered[t] = true;
  }
}

const nav = tabNav(ensureRendered, selectVariant);

// ---- Re-run / refresh --------------------------------------------------
function refreshOverviewRow(p: Project): void {
  const r = ovResult(R, p);
  const v = ovVals(r, ovSeries); // patch the row in whichever lens (revenue / net income) is showing
  const tr = document.querySelector(`#ovb tr[data-pid="${p.id}"]`) as HTMLElement | null;
  if (!tr) return;
  withCur(p, () => { // sort keys, colour and the spread strip convert into the reporting currency
    Object.assign(tr.dataset, sortKeys(v));
    const tds = tr.querySelectorAll("td");
    const set = (td: Element, val: number): void => {
      td.className = "heatc";
      td.setAttribute("style", heatVars(val));
      (td.querySelector(".n") as HTMLElement).textContent = fmt(val);
    };
    set(tds[1], v.p20);
    set(tds[2], v.p50);
    set(tds[3], v.mean);
    set(tds[4], v.p80);
    (tr.querySelector(".psucc") as HTMLElement).textContent = pct(v.pSucc);
    (tr.querySelector(".succbar>i") as HTMLElement).style.width = pct(v.pSucc);
    set(tds[6], v.condP50);
    (tds[7] as HTMLElement).innerHTML = stripSVG(v, scale);
  });
  const tab = document.querySelector(`.tab[data-t="${p.id}"] .ev`) as HTMLElement | null;
  if (tab) tab.textContent = fmt(r.afterTax50, p.cur); // tab cites NET income
  rendered.pw = false; // any change to a project invalidates the cached pairwise view
  renderOvYoy();
}

/** Re-render the Overview ranking table region (revenue/net toggle + table) in the current lens. */
function renderOvRank(): void {
  const el = document.getElementById("ovranktable");
  if (el) el.innerHTML = ovRankTable(order.filter((p) => !p.archived), ovResultsOf(order, R), scale, ovSeries, ovVariantsAll());
}

/** Non-variant project: patch stats + histogram in place, then the overview row. */
function rerun(p: Project): void {
  R[p.id] = run(p);
  const r = R[p.id];
  const vs = (document.getElementById("panel-" + p.id) as HTMLElement).querySelectorAll(".stat .v");
  if (vs.length >= 6) { // the stat cards' order (render/project.ts statCards): net P20 · P50 · Mean · P80, P(meaningful), cond. P50
    vs[0].textContent = fmt(r.afterTax20, p.cur);
    vs[1].textContent = fmt(r.afterTax50, p.cur);
    vs[2].textContent = fmt(r.afterTaxMean, p.cur);
    vs[3].textContent = fmt(r.afterTax80, p.cur);
    vs[4].textContent = pct(r.afterTaxPSucc);
    vs[5].textContent = fmt(r.afterTaxCondP50, p.cur);
  }
  const h = document.getElementById("hist-" + p.id);
  if (h) h.innerHTML = histSVG(r, histCap[p.id], true); // net-income distribution (matches the server render)
  refreshOverviewRow(p);
}

/** Variant project: recompute the edited unit, re-render the sub-body, refresh overview. */
function rerunVariant(p: Project, unitId: string): void {
  R[uKey(p.id, unitId)] = runUnitById(p, unitId);
  const sub = document.getElementById("sub-" + p.id);
  if (sub) sub.innerHTML = withCur(p, () => renderVariantSub(p, selected[p.id] || "compare", ctxFor(p)));
  refreshOverviewRow(p);
}

function resetProject(pid: string): void {
  const p = project(pid);
  if (!p) return;
  for (const n of p.nodes) n._override = undefined;
  for (const v of p.variants || []) for (const n of v.nodes) n._override = undefined;
  if (isVar(p)) {
    for (const id of realUnitIds(p)) R[uKey(pid, id)] = runUnitById(p, id);
  } else {
    R[pid] = run(p);
  }
  renderPanel(p);
  refreshOverviewRow(p);
}

function redrawBar(p: Project, n: ProjectNode): void {
  const el = document.getElementById(`bar-${p.id}-${n.id}`);
  if (el) el.innerHTML = withCur(p, () => renderBarBlock(p, n));
}

/** A click on a node's bar pins a narrow test distribution at that position and re-runs its unit. */
function setOverride(svg: Element, clientX: number): void {
  const el = svg as SVGElement;
  const pid = el.dataset.pid as string;
  const nid = el.dataset.nid as string;
  const unitId = el.dataset.unit; // undefined for non-variant projects
  const p = project(pid);
  if (!p) return;
  const n = (unitId ? nodesOf(p, unitId) : p.nodes).find((x) => x.id === nid);
  if (!n) return;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  const vbX = ((clientX - rect.left) / rect.width) * BAR_GEO.W;
  n._override = Math.max(0, Math.min(1, (vbX - BAR_GEO.X0) / (BAR_GEO.X1 - BAR_GEO.X0)));
  if (unitId) rerunVariant(p, unitId);
  else {
    redrawBar(p, n);
    rerun(p);
  }
}

function clearOverride(key: string): void {
  const parts = key.split("|");
  const p = project(parts[0]);
  if (!p) return;
  if (parts.length === 3) {
    const n = nodesOf(p, parts[1]).find((x) => x.id === parts[2]);
    if (!n) return;
    n._override = undefined;
    rerunVariant(p, parts[1]);
  } else {
    const n = p.nodes.find((x) => x.id === parts[1]);
    if (!n) return;
    n._override = undefined;
    redrawBar(p, n);
    rerun(p);
  }
}

function selectVariant(pid: string, unitId: string): void {
  const p = project(pid);
  if (!p) return;
  selected[pid] = unitId;
  renderPanel(p);
}

// ---- Events ------------------------------------------------------------
function wireEvents(): void {
  panels.addEventListener("change", (e) => { mlCheck(e.target as HTMLElement); });
  panels.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (histToggle(el)) return;
    const bar = el.closest("svg.pbar");
    if (bar) return setOverride(bar, e.clientX);
    const clr = el.closest("[data-clear]") as HTMLElement | null;
    if (clr) return clearOverride(clr.dataset.clear as string);
    const vt = el.closest("[data-vtab]") as HTMLElement | null;
    if (vt) { const [pid, unitId] = (vt.dataset.vtab as string).split("|"); return selectVariant(pid, unitId); }
    const mt = el.closest("[data-metric]") as HTMLElement | null;
    if (mt) return setMetric(mt.dataset.metric as PairMetric);
    const os = el.closest("[data-ovseries]") as HTMLElement | null;
    if (os) { ovSeries = os.dataset.ovseries as OvSeries; return renderOvRank(); }
    if (sharedClick(el, nav)) return;
    const rb = el.closest("[data-reset]") as HTMLElement | null;
    if (rb) resetProject(rb.dataset.reset as string);
  });
  wireShared(tabbar, panels, nav);
}

buildTabs();
buildPanels();
wireEvents();

// Seed the Pairwise panel from the precomputed matrix (the snapshot's, else the portfolio's pairwise data)
// so the default view renders with ZERO in-browser simulation — the solo and pair sims already ran at
// build time (deterministic, same SEED). A project edit invalidates this (rendered.pw=false), after
// which ensureRendered() recomputes the matrix live with the engine's computePairwise() on the next open.
pwData = (SNAPSHOT && SNAPSHOT.pw) || PAIRWISE_PRECOMPUTED;
renderPairwiseInto();
rendered.pw = true;
startNav(nav);
