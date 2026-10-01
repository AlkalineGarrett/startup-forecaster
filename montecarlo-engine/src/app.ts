// Browser entry point: builds the tab bar, the Overview and per-project panels, and wires
// sorting, per-node overrides (re-run), reset, and — for variant projects — sub-tab select,
// pin-for-overview, and the supermix. This is the only module that touches the DOM.
import type { Project, ProjectNode, RunUnit, Variant, RunResult } from "./types.ts";
import { PROJECTS, PAIRWISE_IDS, PORTFOLIO_TITLE } from "./portfolio-context.ts";
import { run, runUnit, runCombined } from "./simulate.ts";
import { RHO } from "./portfolio-context.ts";
import { fmt, esc, heatVars, pct, withCur } from "./format.ts";
import { makeScale, histSVG, stripSVG } from "./render/graph.ts";
import { renderOverview, renderArchived, ovVals, ovRankTable, type OvSeries } from "./render/overview.ts";
import { overviewYoy } from "./render/yoy.ts";
import { renderPairwise, type PairMatrix, type PairMetric } from "./render/pairwise.ts";
import { PAIRWISE_PRECOMPUTED } from "./portfolio-context.ts";
import { renderProject, renderBarBlock, renderVariantPanel, renderVariantSub, type VariantCtx, type VariantUnit } from "./render/project.ts";
import { BAR_GEO } from "./render/bar.ts";
import { renderEvidence, wireEvidenceFilter } from "./render/evidence.ts";
import { isVar, uKey, project, realUnitIds, variantById, nodesOf, runUnitById, ovResult, pairable, sideUnits, pairLabel } from "./units.ts";

// The ids that can be pursued together (the "fronts"): every real unit for a genuine additive project;
// only the decomposition variants (not the aggregate base) for a headlineBase project.
// ---- State -------------------------------------------------------------
const R: Record<string, RunResult> = {};
const selected: Record<string, string> = {}; // variant projects: active sub-tab
const histCap: Record<string, number> = {};
const rendered: Record<string, boolean> = {};

for (const p of PROJECTS) {
  if (isVar(p)) {
    for (const id of realUnitIds(p)) R[uKey(p.id, id)] = runUnitById(p, id);
    selected[p.id] = p.defaultUnit || "compare"; // opens on the Project overview by default
  } else {
    R[p.id] = run(p);
  }
}

// Baseline P95 per unit-key fixes each histogram's x-axis (comparable across override re-runs).
for (const key in R) {
  const b = R[key];
  histCap[key] = b.p95 > 0 ? b.p95 : Math.max(1, b.mean * 3);
}

const ovResults: Record<string, RunResult> = {};
for (const p of PROJECTS) ovResults[p.id] = ovResult(R, p);
const scale = makeScale(ovResults); // fixed once from the initial run

/** Per-project variant list for the overview/year tables' expandable sub-rows (base + variants, with names
 *  and results). Only projects with variants appear. Computed fresh so it tracks re-sims. */
function ovVariantsAll(): Record<string, { id: string; name: string; r: RunResult }[]> {
  const res: Record<string, { id: string; name: string; r: RunResult }[]> = {};
  for (const p of order) {
    const ids = realUnitIds(p);
    if (ids.length <= 1) continue;
    res[p.id] = ids.map((id) => ({ id, name: id === "generic" ? (p.baseName || p.name) : (variantById(p, id)?.name || id), r: R[uKey(p.id, id)] }));
  }
  return res;
}
const order = PROJECTS.slice().sort((a, b) => ovResult(R, b).p50 - ovResult(R, a).p50);

const tabbar = document.getElementById("tabbar") as HTMLElement;
const panels = document.getElementById("panels") as HTMLElement;
document.title = PORTFOLIO_TITLE; // the portfolio's title (overrides the static shell default)
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

let metric: PairMetric = "p50"; // shared P20/P50/P80 selector for the pairwise matrix + all horizon tables
let ovSeries: OvSeries = "net"; // Overview ranking table lens (revenue vs net income); defaults to net
let pwData: PairMatrix | null = null;

function computePairwise(): void {
  // Order both axes by each project's SOLO P50 (the "(none)" value), highest first — a fixed
  // ordering independent of the P20/P50/P80 toggle.
  const soloOf = new Map(pairable().map((p) => [p.id, runCombined(sideUnits(R, p))]));
  const ps = pairable().sort((a, b) => (soloOf.get(b.id) as RunResult).p50 - (soloOf.get(a.id) as RunResult).p50);
  const res: (RunResult | null)[][] = ps.map(() => new Array(ps.length).fill(null));
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < i; j++) res[i][j] = runCombined([...sideUnits(R, ps[i]), ...sideUnits(R, ps[j])]);
  }
  const solo = ps.map((p) => soloOf.get(p.id) as RunResult); // each project on its own (the "(none)" column)
  const names = ps.map((p) => pairLabel(R, p)); // e.g. "Project (positioning)" for an alternative-variant project
  pwData = { labels: names, solo, res };
}

function renderPairwiseInto(): void {
  if (pwData) (document.getElementById("panel-pw") as HTMLElement).innerHTML = renderPairwise(pwData, metric);
}

/** Re-render the Overview Year-over-year card (chart + year table) after a project's numbers change. */
function renderOvYoy(): void {
  const el = document.getElementById("yoycard");
  if (el) el.innerHTML = overviewYoy(order.filter((p) => !p.archived), Object.fromEntries(order.map((p) => [p.id, ovResult(R, p)])), undefined, ovVariantsAll());
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
  const pwTab = document.createElement("div");
  pwTab.className = "tab";
  pwTab.dataset.t = "pw";
  pwTab.textContent = "Pairwise";
  tabbar.appendChild(pwTab);
  for (const p of order.filter((p) => !p.archived)) {
    const t = document.createElement("div");
    t.className = "tab";
    t.dataset.t = p.id;
    t.innerHTML = `${esc(p.name)} <span class="ev">${fmt(ovResult(R, p).afterTax50, p.cur)}</span>`; // tab cites NET income
    tabbar.appendChild(t);
  }
  // Grounding + Archived trail the active projects — a reference/utility group, opened rarely.
  const grTab = document.createElement("div");
  grTab.className = "tab tab-tail";
  grTab.dataset.t = "gr";
  grTab.textContent = "Grounding";
  tabbar.appendChild(grTab);
  const archTab = document.createElement("div");
  archTab.className = "tab tab-arch";
  archTab.dataset.t = "arch";
  archTab.textContent = "Archived";
  tabbar.appendChild(archTab);
}

function buildPanels(): void {
  const ov = document.createElement("div");
  ov.className = "panel active";
  ov.id = "panel-ov";
  ov.innerHTML = renderOverview(order.filter((p) => !p.archived), ovResults, scale, undefined, undefined, ovVariantsAll());
  panels.appendChild(ov);
  const pw = document.createElement("div");
  pw.className = "panel";
  pw.id = "panel-pw";
  panels.appendChild(pw);
  const gr = document.createElement("div");
  gr.className = "panel";
  gr.id = "panel-gr";
  panels.appendChild(gr); // rendered lazily on first open (~1.8MB) — see ensureRendered
  const arch = document.createElement("div");
  arch.className = "panel";
  arch.id = "panel-arch";
  arch.innerHTML = renderArchived(order.filter((p) => p.archived), ovResults, scale, ovVariantsAll());
  panels.appendChild(arch);
  for (const p of PROJECTS) {
    const panel = document.createElement("div");
    panel.className = isVar(p) ? "panel varpanel" : "panel";
    panel.id = "panel-" + p.id;
    panels.appendChild(panel);
  }
}

function renderPanel(p: Project): void {
  (document.getElementById("panel-" + p.id) as HTMLElement).innerHTML = withCur(p.cur, () => isVar(p)
    ? renderVariantPanel(p, ctxFor(p))
    : renderProject(p, R[p.id], histCap[p.id]));
}

function ensureRendered(t: string): void {
  if (t === "ov" || rendered[t]) return;
  if (t === "gr") {
    (document.getElementById("panel-gr") as HTMLElement).innerHTML = renderEvidence();
    wireEvidenceFilter();
    rendered.gr = true;
    return;
  }
  if (t === "pw") {
    computePairwise(); // lazy: all 28 pair simulations on first open / after a change
    renderPairwiseInto();
    rendered.pw = true;
    return;
  }
  const p = project(t);
  if (p) {
    renderPanel(p);
    rendered[t] = true;
  }
}

function show(t: string): void {
  ensureRendered(t);
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", (x as HTMLElement).dataset.t === t));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("active", x.id === "panel-" + t));
  if (pendingUnit && pendingUnit.pid === t) { const u = pendingUnit; pendingUnit = null; selectVariant(u.pid + "|" + u.unitId); } // deep-link to a variant sub-tab
  syncVtabsHeight();
  window.scrollTo(0, 0); // land at the top of the freshly-opened tab, not wherever the last one was scrolled
}
// Open a variant's view from a table row: navigate to the project tab, then select that unit once it shows.
let pendingUnit: { pid: string; unitId: string } | null = null;
function goVariant(pid: string, unitId: string): void {
  if (!document.getElementById("panel-" + pid)) return;
  pendingUnit = { pid, unitId };
  goTab(pid);
}
// URL-hash routing so browser Back/Forward navigate between tabs (and tabs are deep-linkable).
function tabFromHash(): string {
  const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  return h && document.getElementById("panel-" + h) ? h : "ov";
}
function goTab(t: string): void {
  if (tabFromHash() === t) show(t);
  else location.hash = t; // → hashchange → show()
}

// Publish the active panel's sub-tab-bar height so the pinned stats block can sit below
// both the main tab bar and the (sticky) variant sub-tabs.
function syncVtabsHeight(): void {
  const de = document.documentElement;
  if (!de || !de.style || typeof de.style.setProperty !== "function") return;
  const vt = document.querySelector(".panel.active .vtabs") as HTMLElement | null;
  if (vt && vt.offsetHeight) de.style.setProperty("--vtabs-h", vt.offsetHeight + "px");
}

// ---- Overview sorting --------------------------------------------------
function sortOv(th: HTMLElement): void {
  const table = th.closest("table") as HTMLElement | null;
  if (!table) return;
  const key = th.dataset.key as string;
  const cur = th.getAttribute("aria-sort");
  const dir = cur === "descending" ? "ascending" : cur === "ascending" ? "descending" : key === "name" ? "ascending" : "descending";
  table.querySelectorAll("thead th").forEach((o) => o.removeAttribute("aria-sort"));
  th.setAttribute("aria-sort", dir);
  const m = dir === "ascending" ? 1 : -1;
  const tb = table.querySelector("tbody") as HTMLElement | null;
  if (!tb) return;
  // Sort the PROJECT rows only; each variant project's hidden sub-rows travel with their parent.
  const parents = (Array.prototype.slice.call(tb.querySelectorAll("tr")) as HTMLElement[]).filter((r) => !r.classList.contains("ovsub"));
  parents.sort((a, b) => {
    if (key === "name") {
      const an = (a.dataset.name as string).toLowerCase();
      const bn = (b.dataset.name as string).toLowerCase();
      return an < bn ? -m : an > bn ? m : 0;
    }
    return (parseFloat(a.dataset[key] as string) - parseFloat(b.dataset[key] as string)) * m;
  });
  parents.forEach((p) => {
    tb.appendChild(p);
    const pid = p.dataset.expand;
    if (pid) tb.querySelectorAll('tr.ovsub[data-subof="' + pid + '"]').forEach((s) => tb.appendChild(s));
  });
}

// ---- Re-run / refresh --------------------------------------------------
function refreshOverviewRow(p: Project): void {
  const r = ovResult(R, p);
  const v = ovVals(r, ovSeries); // patch the row in whichever lens (revenue / net income) is showing
  const tr = document.querySelector(`#ovb tr[data-pid="${p.id}"]`) as HTMLElement | null;
  if (!tr) return;
  tr.dataset.p20 = String(v.p20);
  tr.dataset.p50 = String(v.p50);
  tr.dataset.p80 = String(v.p80);
  tr.dataset.psucc = String(v.pSucc);
  tr.dataset.cond = String(v.condP50);
  const tds = tr.querySelectorAll("td");
  const set = (td: Element, val: number): void => {
    td.className = "heatc";
    td.setAttribute("style", heatVars(val));
    (td.querySelector(".n") as HTMLElement).textContent = fmt(val, p.cur);
  };
  set(tds[1], v.p20);
  set(tds[2], v.p50);
  set(tds[3], v.mean);
  set(tds[4], v.p80);
  (tr.querySelector(".psucc") as HTMLElement).textContent = pct(v.pSucc);
  (tr.querySelector(".succbar>i") as HTMLElement).style.width = pct(v.pSucc);
  set(tds[6], v.condP50);
  (tds[7] as HTMLElement).innerHTML = stripSVG(v, scale);
  const tab = document.querySelector(`.tab[data-t="${p.id}"] .ev`) as HTMLElement | null;
  if (tab) tab.textContent = fmt(r.afterTax50, p.cur); // tab cites NET income
  rendered.pw = false; // any change to a project invalidates the cached pairwise view
  renderOvYoy();
}

/** Re-render the Overview ranking table region (revenue/net toggle + table) in the current lens. */
function renderOvRank(): void {
  const el = document.getElementById("ovranktable");
  if (el) el.innerHTML = ovRankTable(order.filter((p) => !p.archived), Object.fromEntries(order.map((p) => [p.id, ovResult(R, p)])), scale, ovSeries, ovVariantsAll());
}

/** Non-variant project: patch stats + histogram in place, then the overview row. */
function rerun(p: Project): void {
  R[p.id] = run(p);
  const r = R[p.id];
  const vs = (document.getElementById("panel-" + p.id) as HTMLElement).querySelectorAll(".stat .v");
  if (vs.length >= 5) {
    vs[0].textContent = fmt(r.p20, p.cur);
    vs[1].textContent = fmt(r.p50, p.cur);
    vs[2].textContent = fmt(r.p80, p.cur);
    vs[3].textContent = pct(r.pSucc);
    vs[4].textContent = fmt(r.condP50, p.cur);
  }
  const h = document.getElementById("hist-" + p.id);
  if (h) h.innerHTML = histSVG(r, histCap[p.id], true); // net-income distribution (matches the server render)
  refreshOverviewRow(p);
}

/** Variant project: recompute the edited unit, re-render the sub-body, refresh overview. */
function rerunVariant(p: Project, unitId: string): void {
  R[uKey(p.id, unitId)] = runUnitById(p, unitId);
  const sub = document.getElementById("sub-" + p.id);
  if (sub) sub.innerHTML = renderVariantSub(p, selected[p.id] || "compare", ctxFor(p));
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
  if (el) el.innerHTML = renderBarBlock(p, n);
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

function selectVariant(key: string): void {
  const [pid, unitId] = key.split("|");
  const p = project(pid);
  if (!p) return;
  selected[pid] = unitId;
  renderPanel(p);
}

// ---- Events ------------------------------------------------------------
function wireEvents(): void {
  tabbar.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
    if (t) goTab(t.dataset.t as string); // route through the URL hash so Back/Forward work
  });
  panels.addEventListener("change", (e) => {
    // Shared line checkbox (.mlchk, data-mlkey): pure-DOM show/hide of one line across every pre-rendered
    // variant in the card — per-project chart + Compare-all (matches client.mjs).
    const mc = (e.target as HTMLElement).closest(".mlchk") as HTMLInputElement | null;
    if (mc) { const card = mc.closest(".card"); if (card) card.querySelectorAll('.mlline[data-mlkey="' + mc.dataset.mlkey + '"]').forEach((g) => { (g as HTMLElement).style.display = mc.checked ? "" : "none"; }); }
  });
  panels.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const ht = el.closest("[data-histtoggle]") as HTMLElement | null;
    if (ht) {
      const card = ht.closest(".histcard") as HTMLElement | null;
      if (card) {
        const collapsed = card.classList.toggle("collapsed");
        ht.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      return;
    }
    const bar = el.closest("svg.pbar");
    if (bar) return setOverride(bar, e.clientX);
    const clr = el.closest("[data-clear]") as HTMLElement | null;
    if (clr) return clearOverride(clr.dataset.clear as string);
    const vt = el.closest("[data-vtab]") as HTMLElement | null;
    if (vt) return selectVariant(vt.dataset.vtab as string);
    const mt = el.closest("[data-metric]") as HTMLElement | null;
    if (mt) return setMetric(mt.dataset.metric as PairMetric);
    const os = el.closest("[data-ovseries]") as HTMLElement | null;
    if (os) { ovSeries = os.dataset.ovseries as OvSeries; return renderOvRank(); }
    const cmpTog = el.closest("[data-cmpmetric],[data-cmpseries]") as HTMLElement | null;
    if (cmpTog) { // compare-all: pick which (series, stat) overlay SVG shows
      const card = cmpTog.closest(".comparecard");
      if (card) {
        const attr = cmpTog.dataset.cmpmetric != null ? "cmpmetric" : "cmpseries";
        card.querySelectorAll("[data-" + attr + "]").forEach((b) => b.classList.toggle("active", b === cmpTog));
        const m = (card.querySelector("[data-cmpmetric].active") as HTMLElement | null)?.dataset.cmpmetric || "p50";
        const s = (card.querySelector("[data-cmpseries].active") as HTMLElement | null)?.dataset.cmpseries || "net";
        card.querySelectorAll("[data-cmpm][data-cmps]").forEach((d) => { (d as HTMLElement).style.display = ((d as HTMLElement).dataset.cmpm === m && (d as HTMLElement).dataset.cmps === s) ? "" : "none"; }); // chart (.cmpsvg) + year table (.cmpyt)
      }
      return;
    }
    const ysm = el.closest("[data-ysmetric]") as HTMLElement | null;
    if (ysm) { // merged year card: ONE toggle drives both the chart variant and the income-table cells
      const m = ysm.dataset.ysmetric as string, card = ysm.closest(".yearcard");
      if (card) {
        card.querySelectorAll("[data-ysmetric]").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.ysmetric === m));
        card.querySelectorAll(".ycsvg").forEach((d) => { (d as HTMLElement).style.display = (d as HTMLElement).dataset.ycm === m ? "" : "none"; });
        card.querySelectorAll(".icv").forEach((s) => { const v = (s as HTMLElement).dataset[m]; if (v != null) (s as HTMLElement).textContent = v; });
      }
      return;
    }
    const ic = el.closest("[data-icmetric]") as HTMLElement | null;
    if (ic) { // income/cost table: pure client-side metric rewrite (each cell carries all four values)
      const m = ic.dataset.icmetric as string, card = ic.closest(".ictable");
      if (card) {
        card.querySelectorAll("[data-icmetric]").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.icmetric === m));
        card.querySelectorAll(".icv").forEach((s) => { const v = (s as HTMLElement).dataset[m]; if (v != null) (s as HTMLElement).textContent = v; });
      }
      return;
    }
    const yc = el.closest("[data-ycmetric]") as HTMLElement | null;
    if (yc) { // year chart: show the chosen pre-rendered metric SVG variant
      const m = yc.dataset.ycmetric as string, card = yc.closest(".yearcard");
      if (card) {
        card.querySelectorAll("[data-ycmetric]").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.ycmetric === m));
        card.querySelectorAll(".ycsvg").forEach((d) => { (d as HTMLElement).style.display = (d as HTMLElement).dataset.ycm === m ? "" : "none"; });
      }
      return;
    }
    const il = el.closest("[data-icline]") as HTMLElement | null;
    if (il) { // income/cost row: expand/collapse its breakdown (all following .icexp rows)
      const key = il.dataset.icline as string, tb = il.parentElement;
      const exps = tb ? tb.querySelectorAll('[data-icexp="' + key + '"]') : null;
      if (exps && exps.length) {
        const show = (exps[0] as HTMLElement).hidden;
        exps.forEach((e) => { (e as HTMLElement).hidden = !show; });
        il.classList.toggle("icopen", show);
      }
      return;
    }
    const th = el.closest("th[data-key]") as HTMLElement | null;
    if (th) return sortOv(th);
    const gv = el.closest("[data-govar]") as HTMLElement | null;
    if (gv) { const [pid, uid] = (gv.dataset.govar as string).split("|"); return goVariant(pid, uid); } // variant name → variant view
    const go = el.closest("[data-go]") as HTMLElement | null;
    if (go) return goTab(go.dataset.go as string); // open a project from a table's NAME link — via the hash
    const exp = el.closest("tr[data-expand]") as HTMLElement | null; // variant project row body → expand/collapse
    if (exp) { const pid = exp.dataset.expand as string, tb = exp.parentElement; if (tb) { const subs = tb.querySelectorAll('tr[data-subof="' + pid + '"]'); const showSub = subs.length > 0 && (subs[0] as HTMLElement).hidden; subs.forEach((s) => { (s as HTMLElement).hidden = !showSub; }); exp.classList.toggle("expanded", showSub); } return; }
    const rb = el.closest("[data-reset]") as HTMLElement | null;
    if (rb) resetProject(rb.dataset.reset as string);
  });
  // Shared multi-line spotlight on hover (Compare-all here; same shared .mlchart markup as client.mjs).
  const mlVisibleSvg = (container: Element): SVGSVGElement | null => {
    const svgs = Array.prototype.slice.call(container.querySelectorAll("svg.mlchart")) as SVGSVGElement[];
    return svgs.find((s) => { const w = s.closest(".cmpsvg,.ycsvg") as HTMLElement | null; return !w || w.style.display !== "none"; }) || svgs[0] || null;
  };
  const mlSpotlight = (container: Element, key: string | null): void => {
    const svg = mlVisibleSvg(container);
    if (!svg) return;
    svg.querySelectorAll(".mlline").forEach((g) => {
      const gg = g as SVGGElement;
      if (gg.style.display === "none") return;
      const hit = !!key && gg.dataset.mlkey === key;
      gg.style.opacity = !key || hit ? "1" : "0.22";
      const stroke = gg.querySelector(".mlstroke") as SVGElement | null; if (stroke) stroke.style.strokeWidth = hit ? "3.5" : "2";
      gg.querySelectorAll(".mlvl").forEach((t) => { (t as SVGElement).style.opacity = hit ? "1" : "0"; });
    });
  };
  const mlNearest = (svg: SVGSVGElement, clientX: number, clientY: number): string | null => {
    const m = svg.getScreenCTM(); if (!m) return null;
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(m.inverse());
    let best: string | null = null, bestD = Infinity;
    svg.querySelectorAll(".mlline").forEach((g) => {
      const gg = g as SVGGElement; if (gg.style.display === "none") return;
      const l = gg.querySelector(".mlstroke");
      const pts = l ? (l.getAttribute("points") || "").trim().split(/\s+/).map((s) => s.split(",").map(Number)) : [];
      if (pts.length < 2) return;
      let y = pts[0][1];
      if (p.x <= pts[0][0]) y = pts[0][1];
      else if (p.x >= pts[pts.length - 1][0]) y = pts[pts.length - 1][1];
      else for (let i = 0; i < pts.length - 1; i++) if (p.x >= pts[i][0] && p.x <= pts[i + 1][0]) { const t = (p.x - pts[i][0]) / ((pts[i + 1][0] - pts[i][0]) || 1); y = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]); break; }
      const d = Math.abs(p.y - y);
      if (d < bestD) { bestD = d; best = gg.dataset.mlkey || null; }
    });
    return best;
  };
  // Co-highlight one option across the Project overview's three views (chart · stats table · year table),
  // which share a .cohl container; elsewhere a bare .yoybody is the container.
  const coHighlight = (cont: Element, key: string | null): void => {
    const body = (cont.querySelector(".yoybody") as Element | null) || cont;
    mlSpotlight(body, key);
    cont.querySelectorAll(".cohlrow, .yoyrow").forEach((r) => (r as HTMLElement).classList.toggle("cohot", !!key && (r as HTMLElement).dataset.mlkey === key));
  };
  panels.addEventListener("mousemove", (e) => {
    const cont = (e.target as HTMLElement).closest?.(".cohl") || (e.target as HTMLElement).closest?.(".yoybody");
    if (!cont) return;
    const row = (e.target as HTMLElement).closest?.(".yoyrow, .cohlrow") as HTMLElement | null;
    let key: string | null = null;
    if (row) {
      key = row.dataset.mlkey || row.dataset.proj || null;
      const chk = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (chk && !chk.checked) key = null;
    } else {
      const svg = mlVisibleSvg(cont);
      if (svg && svg.contains(e.target as Node)) key = mlNearest(svg, e.clientX, e.clientY);
    }
    coHighlight(cont, key);
  });
  panels.addEventListener("mouseout", (e) => {
    const cont = (e.target as HTMLElement).closest?.(".cohl") || (e.target as HTMLElement).closest?.(".yoybody");
    const rel = (e as MouseEvent).relatedTarget as HTMLElement | null;
    if (cont && !(rel && rel.closest && rel.closest(".cohl, .yoybody"))) coHighlight(cont, null);
  });
  // Floating histogram tooltip: shown just above the hovered bar (a CDF readout), not in a fixed label.
  panels.addEventListener("mousemove", (e) => {
    const hit = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
    if (!hit) return;
    const card = hit.closest(".histcard") as HTMLElement | null;
    const tip = card?.querySelector(".histtip") as HTMLElement | null;
    if (!card || !tip) return;
    tip.textContent = hit.getAttribute("data-tip");
    tip.hidden = false;
    const cr = card.getBoundingClientRect();
    const hr = hit.getBoundingClientRect(); // position over the BAR, not the cursor
    let left = hr.left + hr.width / 2 - cr.left - tip.offsetWidth / 2; // centered on the bar column
    left = Math.max(4, Math.min(left, cr.width - tip.offsetWidth - 4));
    let top = hr.top - cr.top - tip.offsetHeight - 6; // just above the bars, never covering them
    if (top < 2) top = 2;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  panels.addEventListener("mouseout", (e) => {
    const from = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
    if (!from) return;
    if ((e.relatedTarget as HTMLElement | null)?.closest?.("[data-tip]")) return; // moving to another bar
    const tip = from.closest(".histcard")?.querySelector(".histtip") as HTMLElement | null;
    if (tip) tip.hidden = true;
  });
}

// Publish the tab bar's height so the pinned stats/charts block can sit just below it.
function syncTabbarHeight(): void {
  const de = document.documentElement;
  if (de && de.style && typeof de.style.setProperty === "function") {
    de.style.setProperty("--tabbar-h", "8px"); // nav is a LEFT pane now, not a top bar
  }
}

buildTabs();
buildPanels();
wireEvents();
syncTabbarHeight();

// Seed the Pairwise panel from the build-time precomputed matrix (pairwise-data.ts) so the default
// view renders with ZERO in-browser simulation — the ~11 solo + 28 pair combined sims already ran at
// build time (deterministic, same SEED). A project edit invalidates this (rendered.pw=false), after
// which ensureRendered() recomputes the matrix live via computePairwise() on the next open.
pwData = PAIRWISE_PRECOMPUTED;
renderPairwiseInto();
rendered.pw = true;
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", () => {
    syncTabbarHeight();
    syncVtabsHeight();
  });
  window.addEventListener("hashchange", () => show(tabFromHash())); // Back/Forward + deep links
  if (location.hash) show(tabFromHash()); // honor a deep-linked tab on load
}
