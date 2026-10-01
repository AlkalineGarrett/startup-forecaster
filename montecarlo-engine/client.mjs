// Thin browser client for the Monte-Carlo server. All simulation + rendering happens server-side; this
// file only does DOM plumbing: tab switching, lazy panel loading, and forwarding pins/toggles to the
// server then swapping in the returned HTML fragments. The event handling matches the self-contained page
// (app.ts) so the UX is identical — but the client ships no engine and no data.

const tabbar = document.getElementById("tabbar");
const panels = document.getElementById("panels");

// STATIC-artifact mode: when the page injects `window.MC_STATIC` (pre-baked metric + YoY variants and
// pre-rendered panels), this SAME client drives a self-contained artifact — it renders nothing live and runs
// NO simulation; it only swaps pre-baked variants and does the pure-DOM interactions (tabs, sort, both hovers).
// Server-only actions (pin / re-sim / include / variant / reset / bulk-YoY) are inert. When MC_STATIC is absent
// the client behaves exactly as before (server-backed) — so one client serves both builds.
const STATIC = (typeof window !== "undefined" && window.MC_STATIC) || null;
const yoySel = { series: "net", stat: "p50" };
let ovSeriesSel = "net"; // Overview ranking table lens (matches appcore's default)
function staticSetMetric(m) {
  if (!STATIC) return;
  const pw = document.getElementById("panel-pw"); if (pw && STATIC.pw && STATIC.pw[m] != null) pw.innerHTML = STATIC.pw[m];
  document.querySelectorAll("[data-metric]").forEach((b) => b.classList.toggle("active", b.dataset.metric === m));
}
function staticSwapYoy() { if (STATIC && STATIC.yoy) swapYoy({ yoyHTML: STATIC.yoy[yoySel.series + "|" + yoySel.stat] }); }
function swapOvRank(res) { if (res && res.ovRankHTML != null) { const c = document.getElementById("ovranktable"); if (c) c.innerHTML = res.ovRankHTML; } }
function staticSwapOvRank() { if (STATIC && STATIC.ovrank) swapOvRank({ ovRankHTML: STATIC.ovrank[ovSeriesSel] }); }
// Income/cost table: each cell carries all four metric values in data-*, so the P20/P50/Mean/P80 toggle
// is a pure client rewrite (no server, works in the static artifact). Scoped to the clicked table's card.
function icSwap(btn) {
  const m = btn.dataset.icmetric, card = btn.closest(".ictable");
  if (!card) return;
  card.querySelectorAll("[data-icmetric]").forEach((b) => b.classList.toggle("active", b.dataset.icmetric === m));
  card.querySelectorAll(".icv").forEach((s) => { const v = s.dataset[m]; if (v != null) s.textContent = v; });
}
// Year chart: 4 metric SVG variants are pre-rendered; show the chosen one (pure client, works statically).
function ycSwap(btn) {
  const m = btn.dataset.ycmetric, card = btn.closest(".yearcard");
  if (!card) return;
  card.querySelectorAll("[data-ycmetric]").forEach((b) => b.classList.toggle("active", b.dataset.ycmetric === m));
  card.querySelectorAll(".ycsvg").forEach((d) => { d.style.display = d.dataset.ycm === m ? "" : "none"; });
}
// Compare-all card: show the single overlay SVG matching the active (series, stat) toggles.
function cmpShow(card) {
  if (!card) return;
  const m = (card.querySelector("[data-cmpmetric].active") || {}).dataset ? card.querySelector("[data-cmpmetric].active").dataset.cmpmetric : "p50";
  const s = (card.querySelector("[data-cmpseries].active") || {}).dataset ? card.querySelector("[data-cmpseries].active").dataset.cmpseries : "net";
  card.querySelectorAll("[data-cmpm][data-cmps]").forEach((d) => { d.style.display = (d.dataset.cmpm === m && d.dataset.cmps === s) ? "" : "none"; }); // chart (.cmpsvg) + year table (.cmpyt)
}
// Shared multi-line hover spotlight (render/linechart.ts markup) — used by BOTH the Overview YoY overlay
// (container .yoybody) and the per-project Compare-all overlay (container .comparecard): dim every line but
// the hovered one, thicken it, and reveal ONLY its per-year value labels. `container` may hold several
// pre-rendered overlays (Compare bakes one per series×stat); operate on the currently-visible one.
function mlVisibleSvg(container) {
  const svgs = [...container.querySelectorAll("svg.mlchart")];
  // A chart may hold several pre-rendered variants (Compare bakes one per series×stat as .cmpsvg; the
  // per-project chart one per stat as .ycsvg) — operate on whichever swap-wrapper is currently shown.
  return svgs.find((s) => { const w = s.closest(".cmpsvg,.ycsvg"); return !w || w.style.display !== "none"; }) || svgs[0] || null;
}
function mlSpotlight(container, key) {
  const svg = mlVisibleSvg(container);
  if (!svg) return;
  svg.querySelectorAll(".mlline").forEach((g) => {
    if (g.style.display === "none") return; // an unchecked (hidden) line stays hidden
    const hit = key && g.dataset.mlkey === key;
    g.style.opacity = !key || hit ? "1" : "0.22";
    const stroke = g.querySelector(".mlstroke"); if (stroke) stroke.style.strokeWidth = hit ? "3.5" : "2";
    g.querySelectorAll(".mlvl").forEach((t) => { t.style.opacity = hit ? "1" : "0"; });
  });
}
function mlNearest(svg, clientX, clientY) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const p = pt.matrixTransform(m.inverse());
  let best = null, bestD = Infinity;
  svg.querySelectorAll(".mlline").forEach((g) => {
    if (g.style.display === "none") return;
    const l = g.querySelector(".mlstroke");
    const pts = l ? (l.getAttribute("points") || "").trim().split(/\s+/).map((s) => s.split(",").map(Number)) : [];
    if (pts.length < 2) return;
    let y;
    if (p.x <= pts[0][0]) y = pts[0][1];
    else if (p.x >= pts[pts.length - 1][0]) y = pts[pts.length - 1][1];
    else for (let i = 0; i < pts.length - 1; i++) if (p.x >= pts[i][0] && p.x <= pts[i + 1][0]) {
      const t = (p.x - pts[i][0]) / ((pts[i + 1][0] - pts[i][0]) || 1);
      y = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      break;
    }
    const d = Math.abs(p.y - y);
    if (d < bestD) { bestD = d; best = g.dataset.mlkey; }
  });
  return best;
}
// Merged year card: ONE toggle drives both the chart variant AND the income-table cells (data-ysmetric).
function ysSwap(btn) {
  const m = btn.dataset.ysmetric, card = btn.closest(".yearcard");
  if (!card) return;
  card.querySelectorAll("[data-ysmetric]").forEach((b) => b.classList.toggle("active", b.dataset.ysmetric === m));
  card.querySelectorAll(".ycsvg").forEach((d) => { d.style.display = d.dataset.ycm === m ? "" : "none"; });
  card.querySelectorAll(".icv").forEach((s) => { const v = s.dataset[m]; if (v != null) s.textContent = v; });
}
// Income/cost table: expand/collapse a line's breakdown (all .icexp rows that follow it — bullet note
// or a set of component sub-rows).
function icLineToggle(row) {
  const key = row.dataset.icline, tb = row.parentElement;
  if (!tb) return;
  const exps = tb.querySelectorAll('[data-icexp="' + key + '"]');
  if (!exps.length) return;
  const show = exps[0].hidden;
  exps.forEach((e) => { e.hidden = !show; });
  row.classList.toggle("icopen", show);
}

// SVG bar geometry — must match render/bar.ts BAR_GEO (a pixel x maps to a 0..1 bar position).
const BAR_GEO = { W: 700, X0: 46, X1: 674 };

const rendered = new Set(["ov", "arch"]); // Overview + Archived are rendered inline in the shell; Grounding loads lazily (~1.8MB)

// A minimal busy indicator: a fixed pill shown whenever a server round-trip is in flight (pins re-run a
// unit ~1–2s; a post-edit Pairwise recompute runs 55 pair sims and can take ~30–60s). Ref-counted so
// overlapping requests keep it visible until the last one settles.
const busy = document.createElement("div");
busy.id = "busy";
busy.textContent = "simulating…";
busy.setAttribute("style", "position:fixed;top:10px;right:12px;z-index:9999;padding:6px 12px;border-radius:999px;background:#1b1b1f;color:#fff;font:600 12px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:0;transition:opacity .12s;pointer-events:none");
document.body.appendChild(busy);
let inflight = 0;
const setBusy = (d) => { inflight = Math.max(0, inflight + d); busy.style.opacity = inflight > 0 ? "1" : "0"; };

async function api(path, opts) {
  setBusy(1);
  try {
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return await r.json();
  } finally {
    setBusy(-1);
  }
}
const post = (action) => api("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });

// ---- Async jobs --------------------------------------------------------
// Heavy server work (a re-sim or the pairwise matrix) returns {jobId}; poll it to completion. The busy
// pill stays lit the whole time (the server yields between chunks, so the rest of the UI keeps working).
const rawGet = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ": " + r.status); return r.json(); });
const rawPost = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => { if (!r.ok) throw new Error(p + ": " + r.status); return r.json(); });
async function awaitJob(id) {
  for (;;) {
    const j = await rawGet("/api/job?id=" + encodeURIComponent(id));
    if (j.status === "done") return j.result;
    if (j.status === "error" || j.status === "missing") throw new Error(j.error || j.status);
    await new Promise((r) => setTimeout(r, 400));
  }
}
async function busyRun(fn) { setBusy(1); try { return await fn(); } finally { setBusy(-1); } }
/** POST an action and return its final result — polling the job if the server answered async. */
const submit = (action) => busyRun(async () => { const resp = await rawPost("/api/action", action); return resp && resp.jobId ? await awaitJob(resp.jobId) : resp; });

// ---- Patch application -------------------------------------------------
function refreshOverviewRow(row) {
  if (!row) return;
  const tr = document.querySelector(`#ovb tr[data-pid="${row.pid}"]`);
  if (tr) {
    // rowHTML re-emits the parent row AND its variant sub-rows, so drop the old sub-rows first.
    let n = tr.nextElementSibling;
    while (n && n.classList.contains("ovsub") && n.dataset.subof === row.pid) { const del = n; n = n.nextElementSibling; del.remove(); }
    tr.outerHTML = row.rowHTML; // server-rendered <tr>(+subs) (identical to renderOverview)
  }
  const ev = document.querySelector(`.tab[data-t="${row.pid}"] .ev`);
  if (ev) ev.textContent = row.tabP50;
}

function applyPatch(pid, patch) {
  if (!patch) return;
  if (patch.panelHTML != null) {
    const panel = document.getElementById("panel-" + pid);
    if (panel) panel.innerHTML = patch.panelHTML;
  }
  refreshOverviewRow(patch.row);
  swapYoy(patch); // the edited project's numbers changed → repaint the YoY chart + year table
  if (patch.pairwiseInvalid) rendered.delete("pw"); // recompute Pairwise on its next open
  syncVtabsHeight();
}

// ---- Tab navigation ----------------------------------------------------
async function ensureRendered(t) {
  if (STATIC) return;                 // every panel is pre-rendered in the static artifact — never fetch
  if (t === "ov" || rendered.has(t)) return;
  if (t === "pw") {
    await busyRun(async () => {
      let resp = await rawGet("/api/pairwise"); // {html} if cached, else {jobId} to poll (~15s compute)
      if (resp.jobId) {
        document.getElementById("panel-pw").innerHTML = '<p class="pwloading">Computing the pairwise matrix (28 correlated pair simulations)… the rest of the app stays responsive.</p>';
        resp = await awaitJob(resp.jobId);
      }
      document.getElementById("panel-pw").innerHTML = resp.html;
      rendered.add("pw");
    });
    return;
  }
  const { html } = await api("/api/panel?id=" + encodeURIComponent(t));
  document.getElementById("panel-" + t).innerHTML = html;
  rendered.add(t);
  if (t === "gr") wireEvidenceFilter(); // the grounding explorer's text filter, once its DOM exists
}

async function show(t) {
  await ensureRendered(t);
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.t === t));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("active", x.id === "panel-" + t));
  if (pendingUnit && pendingUnit.pid === t) { const u = pendingUnit; pendingUnit = null; selectUnit(u.pid, u.unitId); } // deep-link to a variant sub-tab
  syncVtabsHeight();
  window.scrollTo(0, 0);
}

// Select a project's variant/supermix sub-body (shared by the sub-tab click and the table's variant-name
// deep-links): swap the pre-baked body in static mode, else ask the server and apply the patch.
function selectUnit(pid, unitId) {
  if (STATIC) {
    const html = STATIC.variant && STATIC.variant[pid] && STATIC.variant[pid][unitId];
    if (html != null) { const panel = document.getElementById("panel-" + pid); if (panel) panel.innerHTML = html; syncVtabsHeight(); }
    return;
  }
  return post({ type: "select", pid, unitId }).then((p) => applyPatch(pid, p));
}
// Open a variant's view from a table row: navigate to the project tab, then select that unit once it shows.
let pendingUnit = null;
function goVariant(pid, unitId) {
  if (!document.getElementById("panel-" + pid)) return; // no such panel here (e.g. the topline artifact)
  pendingUnit = { pid, unitId };
  goTab(pid); // → show(pid) consumes pendingUnit (same-tab or via hashchange)
}
// URL-hash routing so browser Back/Forward navigate between tabs (and tabs are deep-linkable). The hash is
// the source of truth: goTab() sets it (pushing a history entry), hashchange renders the matching tab.
function tabFromHash() {
  const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  return h && document.getElementById("panel-" + h) ? h : "ov";
}
function goTab(t) {
  if (tabFromHash() === t) return show(t); // same tab (or an invalid hash resolving to it) → just (re)show
  location.hash = t; // → fires hashchange → show()
}

function syncTabbarHeight() {
  // The nav is now a LEFT pane, not a top bar — sticky elements only need a small top gap.
  const de = document.documentElement;
  if (de && de.style) de.style.setProperty("--tabbar-h", "8px");
}
function syncVtabsHeight() {
  const de = document.documentElement;
  if (!de || !de.style) return;
  const vt = document.querySelector(".panel.active .vtabs");
  if (vt && vt.offsetHeight) de.style.setProperty("--vtabs-h", vt.offsetHeight + "px");
}

// ---- Overview sorting (client-only, identical to app.ts) ---------------
function sortOv(th) {
  const table = th.closest("table");
  if (!table) return;
  const key = th.dataset.key;
  const cur = th.getAttribute("aria-sort");
  const dir = cur === "descending" ? "ascending" : cur === "ascending" ? "descending" : key === "name" ? "ascending" : "descending";
  table.querySelectorAll("thead th").forEach((o) => o.removeAttribute("aria-sort"));
  th.setAttribute("aria-sort", dir);
  const m = dir === "ascending" ? 1 : -1;
  const tb = table.querySelector("tbody");
  if (!tb) return;
  // Sort the PROJECT rows only; each variant project's hidden sub-rows travel with their parent.
  const parents = Array.prototype.slice.call(tb.querySelectorAll("tr")).filter((r) => !r.classList.contains("ovsub"));
  parents.sort((a, b) => {
    if (key === "name") {
      const an = a.dataset.name.toLowerCase(), bn = b.dataset.name.toLowerCase();
      return an < bn ? -m : an > bn ? m : 0;
    }
    return (parseFloat(a.dataset[key]) - parseFloat(b.dataset[key])) * m;
  });
  parents.forEach((p) => {
    tb.appendChild(p);
    const pid = p.dataset.expand;
    if (pid) tb.querySelectorAll('tr.ovsub[data-subof="' + pid + '"]').forEach((s) => tb.appendChild(s));
  });
}

// ---- Pin (compute the bar position client-side, then re-run on the server) ----
function pinBar(svg, clientX) {
  const pid = svg.dataset.pid, nid = svg.dataset.nid, unitId = svg.dataset.unit;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  const vbX = ((clientX - rect.left) / rect.width) * BAR_GEO.W;
  const pos = Math.max(0, Math.min(1, (vbX - BAR_GEO.X0) / (BAR_GEO.X1 - BAR_GEO.X0)));
  post({ type: "pin", pid, unitId: unitId || "", nodeId: nid, pos }).then((patch) => applyPatch(pid, patch));
}

// ---- Events (delegation, as in app.ts wireEvents) ---------------------
function wireEvents() {
  tabbar.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) goTab(t.dataset.t); // route through the URL hash so Back/Forward work
  });
  panels.addEventListener("click", (e) => {
    const el = e.target;
    const ht = el.closest("[data-histtoggle]");
    if (ht) {
      const card = ht.closest(".histcard");
      if (card) {
        const collapsed = card.classList.toggle("collapsed");
        ht.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      return;
    }
    const bar = el.closest("svg.pbar");
    if (bar) { if (STATIC) return; return pinBar(bar, e.clientX); }
    const resim = el.closest("[data-resim]");
    if (resim) { if (STATIC) return; const pid = resim.dataset.resim; return submit({ type: "resimulate", pid }).then((p) => applyPatch(pid, p)); }
    const ys = el.closest("[data-yoyseries]");
    if (ys) { yoySel.series = ys.dataset.yoyseries; if (STATIC) return staticSwapYoy(); return post({ type: "yoySeries", s: ys.dataset.yoyseries }).then(swapYoy); }
    const yst = el.closest("[data-yoystat]");
    if (yst) { yoySel.stat = yst.dataset.yoystat; if (STATIC) return staticSwapYoy(); return post({ type: "yoyStat", k: yst.dataset.yoystat }).then(swapYoy); }
    const ya = el.closest("[data-yoyall]");
    if (ya) { if (STATIC) return; return post({ type: "yoyAll", on: ya.dataset.yoyall === "1" }).then(swapYoy); }
    const clr = el.closest("[data-clear]");
    if (clr) { if (STATIC) return; return submit({ type: "clear", key: clr.dataset.clear }).then((p) => applyPatch(clr.dataset.clear.split("|")[0], p)); }
    const vt = el.closest("[data-vtab]");
    if (vt) { const [pid, unitId] = vt.dataset.vtab.split("|"); return selectUnit(pid, unitId); }
    const mt = el.closest("[data-metric]");
    if (mt) { if (STATIC) return staticSetMetric(mt.dataset.metric); return post({ type: "metric", m: mt.dataset.metric }).then((res) => applyMetric(res, mt.dataset.metric)); }
    const os = el.closest("[data-ovseries]");
    if (os) { ovSeriesSel = os.dataset.ovseries; if (STATIC) return staticSwapOvRank(); return post({ type: "ovSeries", s: os.dataset.ovseries }).then(swapOvRank); }
    const cmpM = el.closest("[data-cmpmetric]");
    if (cmpM) { const card = cmpM.closest(".comparecard"); if (card) { card.querySelectorAll("[data-cmpmetric]").forEach((b) => b.classList.toggle("active", b === cmpM)); cmpShow(card); } return; }
    const cmpS = el.closest("[data-cmpseries]");
    if (cmpS) { const card = cmpS.closest(".comparecard"); if (card) { card.querySelectorAll("[data-cmpseries]").forEach((b) => b.classList.toggle("active", b === cmpS)); cmpShow(card); } return; }
    const ysm = el.closest("[data-ysmetric]");
    if (ysm) return ysSwap(ysm); // merged year card: one toggle drives both the chart and the table
    const ic = el.closest("[data-icmetric]");
    if (ic) return icSwap(ic); // income/cost table: pure client-side metric rewrite (works statically too)
    const yc = el.closest("[data-ycmetric]");
    if (yc) return ycSwap(yc); // year chart: show the chosen pre-rendered metric SVG variant
    const il = el.closest("[data-icline]");
    if (il) return icLineToggle(il); // income/cost row: expand/collapse its breakdown
    const th = el.closest("th[data-key]");
    if (th) return sortOv(th);
    const gv = el.closest("[data-govar]");
    if (gv) { const [pid, uid] = gv.dataset.govar.split("|"); return goVariant(pid, uid); } // variant name → variant view
    const go = el.closest("[data-go]");
    if (go) return goTab(go.dataset.go); // open a project from a table's NAME link — via the hash (Back works)
    const exp = el.closest("tr[data-expand]"); // variant project row body → expand/collapse its variant sub-rows
    if (exp) { const pid = exp.dataset.expand, tb = exp.parentElement; if (tb) { const subs = tb.querySelectorAll('tr[data-subof="' + pid + '"]'); const showSub = subs.length && subs[0].hidden; subs.forEach((s) => { s.hidden = !showSub; }); exp.classList.toggle("expanded", showSub); } return; }
    const rb = el.closest("[data-reset]");
    if (rb) return post({ type: "reset", pid: rb.dataset.reset }).then((p) => applyPatch(rb.dataset.reset, p));
  });
  // Floating histogram tooltip: shown just above the hovered bar (a CDF readout), not in a fixed label.
  panels.addEventListener("mousemove", (e) => {
    const hit = e.target.closest?.("[data-tip]");
    if (!hit) return;
    const card = hit.closest(".histcard");
    const tip = card?.querySelector(".histtip");
    if (!card || !tip) return;
    tip.textContent = hit.getAttribute("data-tip");
    tip.hidden = false;
    const cr = card.getBoundingClientRect();
    const hr = hit.getBoundingClientRect(); // position over the BAR, not the cursor
    let left = hr.left + hr.width / 2 - cr.left - tip.offsetWidth / 2; // centered on the bar column
    left = Math.max(4, Math.min(left, cr.width - tip.offsetWidth - 4));
    let top = hr.top - cr.top - tip.offsetHeight - 6; // just above the bars, never covering them
    if (top < 2) top = 2;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  });
  panels.addEventListener("mouseout", (e) => {
    const from = e.target.closest?.("[data-tip]");
    if (!from) return;
    if (e.relatedTarget?.closest?.("[data-tip]")) return;
    const tip = from.closest(".histcard")?.querySelector(".histtip");
    if (tip) tip.hidden = true;
  });
}

// The metric is GLOBAL — it drives every project's year chart and the Pairwise matrix (the Overview
// ranking is metric-independent; the Year-over-year card has its own stat toggle). Any already-loaded
// project panel now shows the old metric, so drop those cached panels and re-fetch whichever one is open
// so its year chart repaints at the new metric (the toggle's active state comes from that re-fetch too).
async function applyMetric(_res, _m) {
  const active = document.querySelector(".tab.active")?.dataset.t;
  for (const t of Array.from(rendered)) if (t !== "ov") rendered.delete(t); // stale under the new metric
  if (active && active !== "ov") await ensureRendered(active);
}

// ---- Overview "year over year · all projects" overlay ------------------
// The SVG is rendered on the SERVER (render/yoy.ts). The browser only: (1) forwards a checkbox/series/
// stat change to the server and swaps in the returned fragment, and (2) on hover, toggles OPACITY on the
// already-rendered lines/labels to spotlight one project — a pure style change, no drawing, no data.
function swapYoy(res) { if (res && res.yoyHTML != null) { const c = document.getElementById("yoycard"); if (c) c.innerHTML = res.yoyHTML; } }
function wireYoy() {
  // control changes → server re-renders the fragment (delegated on #panels, survives the innerHTML swap)
  panels.addEventListener("change", (e) => {
    // Shared line checkbox (.mlchk, data-mlkey) — per-project chart + Compare-all: pure-DOM show/hide of the
    // matching line across every pre-rendered variant in the card (works statically, no server).
    const mc = e.target.closest(".mlchk");
    if (mc) { const card = mc.closest(".card"); if (card) card.querySelectorAll('.mlline[data-mlkey="' + mc.dataset.mlkey + '"]').forEach((g) => { g.style.display = mc.checked ? "" : "none"; }); return; }
    // Overview YoY checkbox re-renders server-side (rescales the axis to the checked set); inert in static.
    const chk = e.target.closest(".yoychk"); if (chk) { if (STATIC) return; post({ type: "yoyToggle", pid: chk.dataset.proj }).then(swapYoy); }
  });
  // Spotlight on hover — ONE handler for EVERY line chart (Overview + per-project + Compare-all). On the
  // Project overview the chart, stats table and year table share one .cohl container, so hovering any of
  // them co-highlights the same option (data-mlkey) in all three; elsewhere .yoybody alone is the container.
  panels.addEventListener("mousemove", (e) => {
    const cont = e.target.closest(".cohl") || e.target.closest(".yoybody");
    if (!cont) return;
    const row = e.target.closest(".yoyrow, .cohlrow"); // legend row OR a co-highlight table row
    let key = null;
    if (row) {
      key = row.dataset.mlkey || row.dataset.proj || null;
      const chk = row.querySelector('input[type="checkbox"]');
      if (chk && !chk.checked) key = null; // don't spotlight a hidden line
    } else {
      const svg = mlVisibleSvg(cont);
      if (svg && svg.contains(e.target)) key = mlNearest(svg, e.clientX, e.clientY);
    }
    coHighlight(cont, key);
  });
  panels.addEventListener("mouseout", (e) => {
    const cont = e.target.closest(".cohl") || e.target.closest(".yoybody");
    if (cont && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".cohl, .yoybody"))) coHighlight(cont, null);
  });
}
// Co-highlight one option across the Project overview's three views: spotlight its chart line (+ labels)
// and tint its stats-table + year-table + legend rows. `cont` is .cohl (compare) or a bare .yoybody.
function coHighlight(cont, key) {
  const body = cont.querySelector(".yoybody") || cont;
  mlSpotlight(body, key);
  cont.querySelectorAll(".cohlrow, .yoyrow").forEach((r) => r.classList.toggle("cohot", !!key && r.dataset.mlkey === key));
}

// Grounding tab: text filter over the pre-rendered evidence explorer (mirrors render/evidence.ts).
function wireEvidenceFilter() {
  const input = document.getElementById("ev-filter");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".ev-node").forEach((n) => {
      const hit = !q || (n.dataset.txt || "").includes(q);
      n.style.display = hit ? "" : "none";
      if (q && hit) n.open = true; else if (!q) n.open = false;
    });
    document.querySelectorAll(".ev-proj").forEach((p) => {
      const any = [...p.querySelectorAll(".ev-node")].some((n) => n.style.display !== "none");
      p.style.display = any ? "" : "none";
      if (q) p.open = any;
    });
  });
}

wireEvents();
wireYoy();
syncTabbarHeight();
window.addEventListener("resize", () => { syncTabbarHeight(); syncVtabsHeight(); });
window.addEventListener("hashchange", () => show(tabFromHash())); // Back/Forward + deep links
if (location.hash) show(tabFromHash()); // honor a deep-linked tab on load (else the server-rendered default stands)
