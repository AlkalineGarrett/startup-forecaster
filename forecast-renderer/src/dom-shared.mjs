// The renderer's shared DOM layer: the pure-DOM interactions every page has, server or not — tab routing, the
// line-chart spotlight, the histogram tooltip, table sorting and the card toggles. Every page loads ONE copy:
//   - the self-contained page: build.mjs bundles it ahead of app.ts;
//   - the server's page: a classic <script src="/dom-shared.mjs"> ahead of the client.mjs module;
//   - the static artifacts: inlined ahead of client.mjs in the same <script>.
// It is a plain script of declarations (no import/export), so each page gets the same global functions. Keep
// it that way: no top-level side effects, and no references to anything defined outside this file. It never
// feeds the simulation, so cache-util leaves it out of the precompute cache key.

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
    const hit = !!key && g.dataset.mlkey === key;
    g.style.opacity = !key || hit ? "1" : "0.22";
    const stroke = g.querySelector(".mlstroke"); if (stroke) stroke.style.strokeWidth = hit ? "3.5" : "2";
    g.querySelectorAll(".mlvl").forEach((t) => { t.style.opacity = hit ? "1" : "0"; });
  });
}
/** The key of the visible line nearest the pointer, measured vertically at the pointer's x. */
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
    let y = pts[0][1];
    if (p.x <= pts[0][0]) y = pts[0][1];
    else if (p.x >= pts[pts.length - 1][0]) y = pts[pts.length - 1][1];
    else for (let i = 0; i < pts.length - 1; i++) if (p.x >= pts[i][0] && p.x <= pts[i + 1][0]) {
      const t = (p.x - pts[i][0]) / ((pts[i + 1][0] - pts[i][0]) || 1);
      y = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      break;
    }
    const d = Math.abs(p.y - y);
    if (d < bestD) { bestD = d; best = g.dataset.mlkey || null; }
  });
  return best;
}
// Co-highlight one option across the Project overview's three views: spotlight its chart line (+ labels)
// and tint its stats-table + year-table + legend rows. `cont` is .cohl (compare) or a bare .yoybody.
function coHighlight(cont, key) {
  const body = cont.querySelector(".yoybody") || cont;
  mlSpotlight(body, key);
  cont.querySelectorAll(".cohlrow, .yoyrow").forEach((r) => r.classList.toggle("cohot", !!key && r.dataset.mlkey === key));
}

// Compare-all card: show the single overlay SVG (and year table) matching the active (series, stat) toggles.
function cmpShow(card) {
  const m = card.querySelector("[data-cmpmetric].active")?.dataset.cmpmetric || "p50";
  const s = card.querySelector("[data-cmpseries].active")?.dataset.cmpseries || "net";
  card.querySelectorAll("[data-cmpm][data-cmps]").forEach((d) => { d.style.display = (d.dataset.cmpm === m && d.dataset.cmps === s) ? "" : "none"; }); // chart (.cmpsvg) + year table (.cmpyt)
}
/** A Compare-all series or statistic toggle: make it the active one of its group, then show the matching overlay. */
function cmpSelect(btn) {
  const card = btn.closest(".comparecard");
  if (!card) return;
  const attr = btn.dataset.cmpmetric != null ? "data-cmpmetric" : "data-cmpseries";
  card.querySelectorAll("[" + attr + "]").forEach((b) => b.classList.toggle("active", b === btn));
  cmpShow(card);
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
// A variant project's overview row: expand/collapse its variant sub-rows.
function subRowsToggle(row) {
  const pid = row.dataset.expand, tb = row.parentElement;
  if (!tb) return;
  const subs = tb.querySelectorAll('tr[data-subof="' + pid + '"]');
  const showSub = subs.length > 0 && subs[0].hidden;
  subs.forEach((s) => { s.hidden = !showSub; });
  row.classList.toggle("expanded", showSub);
}

// Table sorting: a first click sorts numbers descending and names ascending, later clicks flip it. Sorts the
// PROJECT rows only; each variant project's hidden sub-rows travel with their parent.
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
  const parents = [...tb.querySelectorAll("tr")].filter((r) => !r.classList.contains("ovsub"));
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

function syncTabbarHeight() {
  // The nav is a LEFT pane, not a top bar — sticky elements only need a small top gap.
  const de = document.documentElement;
  if (de && de.style && typeof de.style.setProperty === "function") de.style.setProperty("--tabbar-h", "8px");
}
// Publish the active panel's sub-tab-bar height so the pinned stats block can sit below the (sticky)
// variant sub-tabs.
function syncVtabsHeight() {
  const de = document.documentElement;
  if (!de || !de.style || typeof de.style.setProperty !== "function") return;
  const vt = document.querySelector(".panel.active .vtabs");
  if (vt && vt.offsetHeight) de.style.setProperty("--vtabs-h", vt.offsetHeight + "px");
}

/** Tab navigation over the page's .tab chips and .panel divs. `ensureRendered(t)` fills a panel before it
 *  shows (it may return a promise); `selectUnit(pid, unitId)` opens a variant project's sub-tab. URL-hash
 *  routing, so browser Back/Forward navigate between tabs and tabs are deep-linkable: the hash is the source
 *  of truth — goTab() sets it (pushing a history entry), hashchange renders the matching tab. */
function tabNav(ensureRendered, selectUnit) {
  let pendingUnit = null; // a variant sub-tab to open once its project's tab shows
  function activate(t) {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.t === t));
    document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("active", x.id === "panel-" + t));
    if (pendingUnit && pendingUnit.pid === t) { const u = pendingUnit; pendingUnit = null; selectUnit(u.pid, u.unitId); } // deep-link to a variant sub-tab
    syncVtabsHeight();
    window.scrollTo(0, 0); // land at the top of the freshly-opened tab, not wherever the last one was scrolled
  }
  function show(t) {
    const r = ensureRendered(t);
    return r && typeof r.then === "function" ? r.then(() => activate(t)) : activate(t);
  }
  function tabFromHash() {
    const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    return h && document.getElementById("panel-" + h) ? h : "ov";
  }
  function goTab(t) {
    if (!document.getElementById("panel-" + t)) return; // no such panel on this page (e.g. a project in the topline artifact)
    if (tabFromHash() === t) return show(t); // same tab (or an invalid hash resolving to it) → just (re)show
    location.hash = t; // → fires hashchange → show()
  }
  // Open a variant's view from a table row: navigate to the project tab, then select that unit once it shows.
  function goVariant(pid, unitId) {
    if (!document.getElementById("panel-" + pid)) return;
    pendingUnit = { pid, unitId };
    goTab(pid); // → show(pid) consumes pendingUnit (same-tab or via hashchange)
  }
  return { show, goTab, goVariant, tabFromHash };
}

/** The histogram card's collapse toggle; true when `el` was one. */
function histToggle(el) {
  const ht = el.closest("[data-histtoggle]");
  if (!ht) return false;
  const card = ht.closest(".histcard");
  if (card) {
    const collapsed = card.classList.toggle("collapsed");
    ht.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  return true;
}
/** The shared tail of a page's panel-click chain (each page checks its own controls first): the card toggles,
 *  table sorting and the table links. True when the click was one of these. */
function sharedClick(el, nav) {
  const cmp = el.closest("[data-cmpmetric],[data-cmpseries]");
  if (cmp) { cmpSelect(cmp); return true; }
  const ysm = el.closest("[data-ysmetric]");
  if (ysm) { ysSwap(ysm); return true; } // merged year card: one toggle drives both the chart and the table
  const il = el.closest("[data-icline]");
  if (il) { icLineToggle(il); return true; } // income/cost row: expand/collapse its breakdown
  const th = el.closest("th[data-key]");
  if (th) { sortOv(th); return true; }
  const gv = el.closest("[data-govar]");
  if (gv) { const [pid, uid] = gv.dataset.govar.split("|"); nav.goVariant(pid, uid); return true; } // variant name → variant view
  const go = el.closest("[data-go]");
  if (go) { nav.goTab(go.dataset.go); return true; } // open a project from a table's NAME link — via the hash (Back works)
  const exp = el.closest("tr[data-expand]"); // variant project row body → expand/collapse its variant sub-rows
  if (exp) { subRowsToggle(exp); return true; }
  return false;
}
/** A shared line checkbox (.mlchk, data-mlkey) — per-project chart + Compare-all: pure-DOM show/hide of the
 *  matching line across every pre-rendered variant in the card. True when `target` was one. */
function mlCheck(target) {
  const mc = target.closest(".mlchk");
  if (!mc) return false;
  const card = mc.closest(".card");
  if (card) card.querySelectorAll('.mlline[data-mlkey="' + mc.dataset.mlkey + '"]').forEach((g) => { g.style.display = mc.checked ? "" : "none"; });
  return true;
}

/** Wire the listeners every page shares: tab-bar clicks, the line-chart spotlight, the histogram tooltip. */
function wireShared(tabbar, panels, nav) {
  tabbar.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) nav.goTab(t.dataset.t); // route through the URL hash so Back/Forward work
  });
  // Spotlight on hover — ONE handler for EVERY line chart (Overview + per-project + Compare-all). On the
  // Project overview the chart, stats table and year table share one .cohl container, so hovering any of
  // them co-highlights the same option (data-mlkey) in all three; elsewhere .yoybody alone is the container.
  panels.addEventListener("mousemove", (e) => {
    const cont = e.target.closest?.(".cohl") || e.target.closest?.(".yoybody");
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
    const cont = e.target.closest?.(".cohl") || e.target.closest?.(".yoybody");
    if (cont && !e.relatedTarget?.closest?.(".cohl, .yoybody")) coHighlight(cont, null);
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
    if (e.relatedTarget?.closest?.("[data-tip]")) return; // moving to another bar
    const tip = from.closest(".histcard")?.querySelector(".histtip");
    if (tip) tip.hidden = true;
  });
}
/** Start routing, once the page's panels are in place: window resizes, hash changes, and a deep-linked tab
 *  on load (else the rendered default stands). */
function startNav(nav) {
  syncTabbarHeight();
  if (typeof window === "undefined" || !window.addEventListener) return; // a headless boot (the page's test) has no window events
  window.addEventListener("resize", () => { syncTabbarHeight(); syncVtabsHeight(); });
  window.addEventListener("hashchange", () => nav.show(nav.tabFromHash())); // Back/Forward + deep links
  if (location.hash) nav.show(nav.tabFromHash()); // honor a deep-linked tab on load
}
