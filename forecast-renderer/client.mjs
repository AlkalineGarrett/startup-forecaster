// Thin browser client for the Monte-Carlo server. All simulation + rendering happens server-side; this
// file only does DOM plumbing: tab switching, lazy panel loading, and forwarding pins/toggles to the
// server then swapping in the returned HTML fragments. The pure-DOM interactions are the shared DOM layer
// (src/dom-shared.mjs: tabNav, wireShared, sharedClick, …), which every page loads before this file and the
// self-contained page (app.ts) bundles too — so the UX is identical, but this client ships no engine and no
// data.

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

// SVG bar geometry — must match render/bar.ts BAR_GEO (a pixel x maps to a 0..1 bar position).
const BAR_GEO = { W: 700, X0: 46, X1: 674 };

const rendered = new Set(["ov", "arch"]); // Overview + Archived are rendered inline in the shell; Grounding loads lazily (it can be large)

// A minimal busy indicator: a fixed pill shown whenever a server round-trip is in flight (pins re-run a
// unit in a second or two; a post-edit Pairwise recompute runs every pair and can take much longer). Ref-counted so
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
      let resp = await rawGet("/api/pairwise"); // {html} if cached, else {jobId} to poll
      if (resp.jobId) {
        document.getElementById("panel-pw").innerHTML = '<p class="pwloading">Computing the pairwise matrix…</p>';
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
const nav = tabNav(ensureRendered, selectUnit);

// ---- Pin (compute the bar position client-side, then re-run on the server) ----
function pinBar(svg, clientX) {
  const pid = svg.dataset.pid, nid = svg.dataset.nid, unitId = svg.dataset.unit;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  const vbX = ((clientX - rect.left) / rect.width) * BAR_GEO.W;
  const pos = Math.max(0, Math.min(1, (vbX - BAR_GEO.X0) / (BAR_GEO.X1 - BAR_GEO.X0)));
  post({ type: "pin", pid, unitId: unitId || "", nodeId: nid, pos }).then((patch) => applyPatch(pid, patch));
}

// ---- Events (delegation; the shared layer handles the pure-DOM controls) ----
function wireEvents() {
  panels.addEventListener("click", (e) => {
    const el = e.target;
    if (histToggle(el)) return;
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
    if (sharedClick(el, nav)) return;
    const rb = el.closest("[data-reset]");
    if (rb) { if (STATIC) return; return post({ type: "reset", pid: rb.dataset.reset }).then((p) => applyPatch(rb.dataset.reset, p)); }
  });
  // control changes → server re-renders the fragment (delegated on #panels, survives the innerHTML swap)
  panels.addEventListener("change", (e) => {
    if (mlCheck(e.target)) return;
    // Overview YoY checkbox re-renders server-side (rescales the axis to the checked set); inert in static.
    const chk = e.target.closest(".yoychk"); if (chk) { if (STATIC) return; post({ type: "yoyToggle", pid: chk.dataset.proj }).then(swapYoy); }
  });
  wireShared(tabbar, panels, nav);
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
startNav(nav);
