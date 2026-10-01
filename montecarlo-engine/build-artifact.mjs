// Build a SLIM, STATIC, READ-ONLY artifact of the Monte-Carlo model: the topline views — the Overview
// ranking, the Year-over-year card (chart + year-by-year table, pre-baked per series×statistic), and the
// Pairwise matrix (pre-baked per statistic) — so the toggles are pure client-side innerHTML swaps.
// Deliberately OMITS the heavy content (per-project drill-down panels, histograms, and the ~1.9 MB
// grounding/evidence text) so the page stays small. No model runs, no fetch/XHR, no re-simulation. The
// YoY project checkboxes are inert here (static snapshot). Output is the INNER page content for the
// Artifact skeleton. Run: npm run artifact.
import { PORTFOLIO_TITLE } from "./src/portfolio-context.ts";
import { prepareStatic, bakeStatViews, inlineJson, engineFile, writeArtifact } from "./artifact-common.mjs";

const { ac, SEL, showPw } = await prepareStatic();
// The toggles are pure client-side innerHTML swaps over these pre-baked views.
const MV = bakeStatViews(ac, showPw);
const mvJson = inlineJson(MV);

const css = engineFile("styles.css");

const tabChips =
  `<div class="tab active" data-t="ov">Overview</div>` +
  (showPw ? `<div class="tab" data-t="pw">Pairwise</div>` : "");

const panels =
  `<div class="panel active" id="panel-ov">${ac.overviewHTML()}</div>` +
  (showPw ? `<div class="panel" id="panel-pw">${ac.pairwiseHTML()}</div>` : "");

// Read-only client: tab nav, table sort, the statistic selector (swaps the precomputed Pairwise matrix),
// and the YoY series/statistic toggles (swap the precomputed Year-over-year card = chart + year table).
// Nothing else — no per-project pages, no re-simulation; the YoY project checkboxes are inert.
const script = `
(function(){
  var MV=${mvJson};
  var yoySel={series:'net',stat:'p50'};
  var ovSel='net';
  var tabbar=document.getElementById('tabbar'), panels=document.getElementById('panels');
  function syncH(){ try{ document.documentElement.style.setProperty('--tabbar-h','8px'); }catch(e){} }
  function show(t){
    document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x.dataset.t===t);});
    document.querySelectorAll('.panel').forEach(function(x){x.classList.toggle('active',x.id==='panel-'+t);});
    window.scrollTo(0,0); syncH();
  }
  // Global P20/P50/Mean/P80 selector → Pairwise matrix (innerHTML swap).
  function setMetric(m){
    if(!MV.pw[m]) return;
    var pw=document.getElementById('panel-pw'); if(pw) pw.innerHTML=MV.pw[m];
  }
  // YoY series/stat toggles → swap the whole Year-over-year card (its baked variant carries the active
  // toggle states + the matching year table).
  function swapYoy(){
    var c=document.getElementById('yoycard'); if(!c||!MV.yoy) return;
    var h=MV.yoy[yoySel.series+'|'+yoySel.stat]; if(h!=null) c.innerHTML=h;
  }
  // Overview ranking table revenue/net toggle → swap the baked #ovranktable region.
  function swapOvRank(){
    var c=document.getElementById('ovranktable'); if(!c||!MV.ovrank) return;
    var h=MV.ovrank[ovSel]; if(h!=null) c.innerHTML=h;
  }
  tabbar.addEventListener('click',function(e){ var t=e.target.closest('.tab'); if(t) show(t.dataset.t); });
  function sortTable(th){
    var table=th.closest('table'); var tb=table&&table.querySelector('tbody'); if(!tb) return;
    var key=th.dataset.key; var asc=th.getAttribute('aria-sort')!=='ascending';
    table.querySelectorAll('th').forEach(function(o){o.removeAttribute('aria-sort');});
    th.setAttribute('aria-sort',asc?'ascending':'descending');
    function val(r){ var d=r.dataset[key]; var n=parseFloat(d); return isNaN(n)?String(d||'').toLowerCase():n; }
    var rows=Array.prototype.slice.call(tb.querySelectorAll('tr'));
    rows.sort(function(a,b){ var va=val(a),vb=val(b); if(va<vb)return asc?-1:1; if(va>vb)return asc?1:-1; return 0; });
    rows.forEach(function(r){tb.appendChild(r);});
  }
  panels.addEventListener('click',function(e){
    var el=e.target;
    var mt=el.closest&&el.closest('[data-metric]'); if(mt){ setMetric(mt.dataset.metric); return; }  // statistic selector
    var ys=el.closest&&el.closest('[data-yoyseries]'); if(ys){ yoySel.series=ys.dataset.yoyseries; swapYoy(); return; } // YoY revenue/net
    var yst=el.closest&&el.closest('[data-yoystat]'); if(yst){ yoySel.stat=yst.dataset.yoystat; swapYoy(); return; }    // YoY statistic
    var os=el.closest&&el.closest('[data-ovseries]'); if(os){ ovSel=os.dataset.ovseries; swapOvRank(); return; }        // Overview revenue/net
    var th=el.closest&&el.closest('th[data-key]'); if(th){ sortTable(th); return; }                   // sortable columns
  });
  syncH(); window.addEventListener('resize',syncH);
})();
`;

const title = SEL.length
  ? `${ac.tabList().map((t) => t.name).join(" · ")} — Monte-Carlo model (topline)`
  : `${PORTFOLIO_TITLE} (topline)`;

const content =
  `<meta charset="utf-8">` + // so the raw file decodes UTF-8 (— · − €) if opened directly, not just via the charset-setting wrapper
  `<title>${title}</title>` +
  `<style>${css}</style>` +
  `<div class="wrap"><div class="tabbar" id="tabbar">${tabChips}</div>` +
  `<div id="panels">${panels}</div></div>` +
  `<script>${script}</script>`;

const out = writeArtifact("montecarlo-artifact.html", content);
console.log(`Wrote ${out} (${(content.length / 1024).toFixed(0)} KB)`);
