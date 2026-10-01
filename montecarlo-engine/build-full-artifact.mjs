// Build a FULL but STATIC artifact: every tab + panel the interactive app has (Overview, Pairwise, each
// project's drill-down with histograms + hover tooltips, Archived) — pre-rendered from the precompute cache —
// wired with ONLY the pure-client interactions that work without a server (tab nav, table sort, the P20/P50/
// Mean/P80 selector for the overview+pairwise, and the histogram hover CDF-readout). DELIBERATELY OMITS the
// client-side simulation engine + the node distribution/model data (so no re-simulation, no node-pinning) and
// the heavy Grounding/evidence corpus. This is the "everything, minus the simulation data" view.
// Run: node --experimental-strip-types build-full-artifact.mjs
import { PORTFOLIO_TITLE } from "./src/portfolio-context.ts";
import { fmt } from "./src/format.ts";
import { prepareStatic, bakeStatViews, inlineJson, engineFile, writeArtifact } from "./artifact-common.mjs";

const { ac, SEL, showPw } = await prepareStatic();
// Pre-bake the toggle-switchable views (Pairwise per statistic, YoY per series × statistic, ranking per lens).
const { pw, yoy, ovrank } = bakeStatViews(ac, showPw);

const tabs = ac.panelTabList();                         // [{id,name,p50,archived}]
const active = tabs.filter((t) => !t.archived);

// Pre-bake every variant project's sub-tab bodies (supermix + base + each pivot) so the sub-tabs are
// EXPLORABLE in the static artifact (client-side swap; no server). Reset each to the default ("generic")
// afterwards so the initial panel render below is the canonical base.
const variant = {};
for (const t of active) {
  if (!ac.isVariant(t.id)) continue;
  const restore = ac.currentUnit(t.id); // the default sub-tab (e.g. "compare") — restore after baking
  variant[t.id] = {};
  for (const uid of ac.variantUnitIds(t.id)) variant[t.id][uid] = ac.selectVariant(t.id, uid).panelHTML;
  ac.selectVariant(t.id, restore);
}
const archived = tabs.filter((t) => t.archived);

const tabChips =
  `<div class="tab active" data-t="ov">Overview</div>` +
  (showPw ? `<div class="tab" data-t="pw">Pairwise</div>` : "") +
  active.map((t) => `<div class="tab" data-t="${t.id}">${t.name} <span class="ev">${fmt(t.p50, t.cur)}</span></div>`).join("") +
  (archived.length ? `<div class="tab tab-arch" data-t="arch">Archived</div>` : "");

const panels =
  `<div class="panel active" id="panel-ov">${ac.overviewHTML()}</div>` +
  (showPw ? `<div class="panel" id="panel-pw">${ac.pairwiseHTML()}</div>` : "") +
  active.map((t) => `<div class="panel${ac.isVariant(t.id) ? " varpanel" : ""}" id="panel-${t.id}">${ac.panelHTML(t.id)}</div>`).join("") +
  (archived.length ? `<div class="panel" id="panel-arch">${ac.archivedHTML()}</div>` : "");

// Inject the pre-baked variants as window.MC_STATIC, then bundle the REAL client.mjs (which reads MC_STATIC and
// runs in static mode). One client, two builds — adding an interaction to client.mjs benefits both automatically.
const staticJson = inlineJson({ pw, yoy, ovrank, variant });
const clientJs = engineFile("client.mjs");
const css = engineFile("styles.css");

const title = SEL.length ? `${active.map((t) => t.name).join(" · ")} — Monte-Carlo model` : PORTFOLIO_TITLE;

const content =
  `<meta charset="utf-8">` + // so the raw file decodes UTF-8 (— · − €) if opened directly, not just via the charset-setting wrapper
  `<title>${title}</title>` +
  `<style>${css}</style>` +
  `<div class="wrap"><div class="tabbar" id="tabbar">${tabChips}</div>` +
  `<div id="panels">${panels}</div></div>` +
  `<script>window.MC_STATIC=${staticJson};</script>` +
  `<script>${clientJs}</script>`;

const out = writeArtifact("montecarlo-full-artifact.html", content);
console.log(`Wrote ${out} (${(content.length / 1024).toFixed(0)} KB) — ${active.length} panel(s)${showPw ? " + pairwise" : ""} · client.mjs static mode`);
