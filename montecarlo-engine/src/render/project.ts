// A single project's panel: headline stats, charts, and the per-node cards.
import type { Project, ProjectNode, RunResult, YearStat, UnitBrief } from "../types.ts";
import { fmt, esc, confClass, confLabel, pct, fmtShort, curSym, heatVars } from "../format.ts";
import { nodeAxis } from "../quantile.ts";
import { RHO } from "../portfolio-context.ts";
import { REFERENCE_P90 } from "../simulate.ts";
import { renderBar, PROV_LEGEND } from "./bar.ts";
import { histSVG, graphSVG, axhdr, type Scale } from "./graph.ts";
import { METRICS, type Metric } from "./horizons.ts";
import { multiLineChartSVG, chartBox, mlLegendRow, type MLLine } from "./linechart.ts";
import { ovVals, ovCells } from "./overview.ts";

// Line colours for the per-project year chart (Revenue vs Net income) — shared by the SVG and its legend.
const REV_COLOR = "var(--accent)", NET_COLOR = "var(--good)";
// Nodes hidden from the UI entirely. Terminal value was never asked for: drop its node card + graph node
// (the tv_multiple node is still sampled internally but never surfaced anywhere in the UI).
const HIDDEN_NODE_IDS = new Set(["tv_multiple"]);
const visibleNodes = (ns: ProjectNode[]): ProjectNode[] => ns.filter((n) => !HIDDEN_NODE_IDS.has(n.id));
import { DISTRIBUTIONS, type NodeDist } from "../portfolio-context.ts";
import { modelYears, headlineSpan, HEADLINE_FROM_YEAR } from "../types.ts";

// The metric the year charts render at. It is the app's single global metric (also driving the horizon
// tables); appcore sets it before rendering a panel via setRenderMetric. Module-level rather than
// threaded through every render fn because a render pass is synchronous and single-metric.
let RMETRIC: Metric = "p50";
export function setRenderMetric(m: Metric): void { RMETRIC = m; }
// Whether the panel being rendered has un-simulated overrides — set by appcore before each render so
// statCards can surface a Resimulate button (edits are deferred; the re-sim runs on click).
let RDIRTY = false;
export function setRenderDirty(d: boolean): void { RDIRTY = d; }

/** The variance-decomposition tornado: which inputs drive the outcome most (rank correlation),
 * so calibration effort goes where the variance is. Green = moves with revenue, red = against. */
function tornadoCard(r: RunResult): string {
  if (!r.tornado || !r.tornado.length) return "";
  const bars = r.tornado.filter((b) => !/terminal.?value/i.test(b.label)); // terminal value removed from the UI
  if (!bars.length) return "";
  const max = Math.max(0.01, ...bars.map((b) => Math.abs(b.corr)));
  const rows = bars
    .map((b) => {
      const w = Math.round((Math.abs(b.corr) / max) * 100);
      const col = b.corr >= 0 ? "#1C7A46" : "#B0362B";
      const mark = b.unidentified ? ` <span title="No published realised series — a result leaning on this node is unvalidated (§ unidentified)" style="color:#B26E00;cursor:help">◇</span>` : "";
      return (
        `<div style="display:flex;align-items:center;gap:10px;margin:4px 0;font-size:.76rem">` +
        `<span style="flex:0 0 44%;text-align:right;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.label)}${mark}</span>` +
        `<span style="flex:1;background:var(--line-soft);border-radius:3px;overflow:hidden"><span style="display:block;height:9px;width:${w}%;background:${col}"></span></span>` +
        `<span style="flex:0 0 38px;font-family:var(--font-mono);color:${col}">${b.corr >= 0 ? "+" : "−"}${Math.abs(b.corr).toFixed(2)}</span></div>`
      );
    })
    .join("");
  return `<div class="card" style="margin-top:14px"><div class="cap">What drives the outcome · rank-correlation of each input with revenue · ◇ = unidentified (no published series)</div>${rows}</div>`;
}

/** Reference-class sanity flag: a median above the p90 of solo-software outcomes means the inputs
 * are likely optimistic no matter how reasonable each node looked. Skipped for salary tracks. */
function refFlag(p: Project, r: RunResult): string {
  const ref = p.refP90 ?? REFERENCE_P90;
  if (p.personal || r.p50 <= ref) return "";
  const body = p.refNote
    ? `⚠ <b>Reference-class check:</b> ${p.refNote}`
    : `⚠ <b>Reference-class check:</b> this median (${fmt(r.p50)}/yr) sits <b>above the ~p90 of solo-software outcomes</b> ` +
      `(~${fmt(ref)}/yr — only ~5% of new subscription products reach $10k MRR). Treat the inputs as optimistic ` +
      `until validated; the binding constraint is the base rate, not any single node.`;
  return (
    `<div class="revnote" style="background:var(--low-bg,#f3e5e2);border-left:3px solid #B0362B;padding:9px 13px;font-size:.8rem;margin-top:12px">` +
    body + `</div>`
  );
}

/** Default text for the reactive histogram label (shown when not hovering a bar). */

/** The sources row for a node: external links if any, else a provenance note matching the audit's
 * classification (the audit's sources are archived files, not live URLs — see the basis for them). */
function sourcesRow(n: ProjectNode): string {
  if (n.urls && n.urls.length) {
    const links = n.urls
      .map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">source ${i + 1} ↗</a>`)
      .join("");
    return `<div class="srcs">${links}</div>`;
  }
  const pv = n.prov ? (n.prov.p50 ?? n.prov.p10 ?? n.prov.p90) : undefined;
  const note =
    pv === "sourced" ? '<span style="color:#1C7A46">■ sourced — see basis (archived source)</span>'
    : pv === "inferred" ? '<span style="color:#B26E00">■ inferred — reasoned from sources (see basis)</span>'
    : 'no external base rate — subjective prior';
  return `<div class="srcs"><span style="font-size:.72rem;color:var(--ink-faint);font-family:var(--font-mono)">${note}</span></div>`;
}

/** A chip showing the node's loading on the shared luck factor (rho map overridable for variants). */
export function corrLabel(p: Project, n: ProjectNode, rho?: Record<string, number>): string {
  const val = (rho || RHO[p.id] || {})[n.id] || 0;
  if (!val) return "";
  const sign = val > 0 ? "+" : "−";
  return (
    `<span class="corrchip" title="How strongly this node moves with the project&#39;s overall luck ` +
    `(+ rises in good scenarios, − falls, e.g. churn)">corr ${sign}${Math.abs(val).toFixed(1)}</span>`
  );
}

/** The distribution bar plus its click hint (or the active-override readout + reset). `unitId` scopes it to a variant. */
export function renderBarBlock(p: Project, n: ProjectNode, unitId?: string): string {
  const clearKey = unitId ? `${p.id}|${unitId}|${n.id}` : `${p.id}|${n.id}`;
  let hint: string;
  if (n._override != null) {
    const cv = nodeAxis(n).toValue(n._override);
    const cvLabel = n.kind === "gate" ? Math.round(cv * 100) + "%" : fmtShort(cv);
    hint = `<div class="barhint ovon">testing a value near <b>${cvLabel}</b> · <button class="ovreset" data-clear="${clearKey}">reset</button></div>`;
  } else {
    hint = "";
  }
  return renderBar(p, n, unitId) + hint;
}

/** The compiled distribution record backing a node (structure + derivation + support), keyed by the
 * unit-scoped node id. The generic base shares the base project's keys. */
function nodeInfo(p: Project, n: ProjectNode, unitId?: string): NodeDist | undefined {
  const key = unitId && unitId !== "generic" ? `${p.id}::${unitId}::${n.id}` : `${p.id}::${n.id}`;
  return DISTRIBUTIONS[key];
}

/** The grounding-strength badge (support_score 0–100), banded by the same thresholds as the bar colour. */
function supportBadge(support: number): string {
  const band = support >= 60 ? "hi" : support >= 40 ? "mid" : "lo";
  return (
    `<span class="support ${band}" title="Grounding strength (0–100): how well-sourced this node's distribution is. ` +
    `≥60 sourced · 40–59 inferred · &lt;40 subjective.">${support}<span class="slab">grounding</span></span>`
  );
}

/** The collapsible derivation panel: distribution structure, what the number is, how each parameter was
 * set (process), corroborations/tensions (cross-checks), and any multi-source reconciliation. */
function derivation(info: NodeDist): string {
  const rows: string[] = [];
  if (info.def) rows.push(`<div class="drow"><span class="dk">Is</span><span>${esc(info.def)}${info.unit ? ` <span class="dunit">${esc(info.unit)}</span>` : ""}</span></div>`);
  if (info.klabel) rows.push(`<div class="drow"><span class="dk">Shape</span><span class="dmono">${esc(info.klabel)}</span></div>`);
  if (info.proc?.length) rows.push(`<div class="drow"><span class="dk">Process</span><ul class="dlist">${info.proc.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`);
  if (info.checks?.length) rows.push(`<div class="drow"><span class="dk">Checks</span><ul class="dlist">${info.checks.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`);
  if (info.recon) rows.push(`<div class="drow"><span class="dk">Reconciled</span><span>${esc(info.recon)}</span></div>`);
  if (!rows.length) return "";
  return `<details class="deriv"><summary>Derivation &amp; cross-checks</summary><div class="derivbody">${rows.join("")}</div></details>`;
}

/** One node's card. `unitId`/`rho` scope it to a variant (unique DOM ids + variant correlations). */
export function nodeCard(p: Project, n: ProjectNode, unitId?: string, rho?: Record<string, number>): string {
  const barId = unitId ? `bar-${p.id}-${unitId}-${n.id}` : `bar-${p.id}-${n.id}`;
  const info = nodeInfo(p, n, unitId);
  const badge = info && info.support != null ? supportBadge(info.support) : `<span class="conf ${confClass(n.conf)}">${confLabel(n.conf)}</span>`;
  return (
    `<div class="node"><div class="top"><span class="kind ${n.kind}">${n.kind}</span>` +
    `<span class="nlabel">${esc(n.label)}</span>${corrLabel(p, n, rho)}${badge}</div>` +
    `<div id="${barId}">${renderBarBlock(p, n, unitId)}</div>` +
    `<p class="basis">${esc(n.basis ?? "")}</p>${sourcesRow(n)}${info ? derivation(info) : ""}</div>`
  );
}

/** The headline P20/P50/P80/P(meaningful)/cond-P50 stat cards, with the Reset-overrides control on
 * top (it rides the fixed left-gutter column with the stat boxes). */
function statCards(r: RunResult, pid: string): string {
  // When the project has pending (un-simulated) overrides, the numbers below are STALE: show a
  // Resimulate button and mark the card so the user knows to click it (edits don't auto-run).
  const resim = RDIRTY
    ? `<button class="resimbtn" data-resim="${pid}">↻ Resimulate</button><span class="stalenote">pending edits — numbers are stale</span>`
    : "";
  // All summary boxes in one column (the headline percentiles + the decision boxes). Labels
  // only (no explanatory sub-line under each).
  return (
    `<div class="rowcards${RDIRTY ? " stale" : ""}">` +
    `<button class="resetbtn railreset" data-reset="${pid}">Reset overrides</button>` +
    resim +
    `<div class="stat p20"><div class="k">P20 · net</div><div class="v">${fmt(r.afterTax20)}</div></div>` +
    `<div class="stat p50"><div class="k">P50 · net income (median)</div><div class="v">${fmt(r.afterTax50)}</div></div>` +
    `<div class="stat mean"><div class="k">Mean · net</div><div class="v">${fmt(r.afterTaxMean)}</div></div>` +
    `<div class="stat p80"><div class="k">P80 · net</div><div class="v">${fmt(r.afterTax80)}</div></div>` +
    `<div class="stat"><div class="k">P(meaningful)</div><div class="v">${pct(r.afterTaxPSucc)}</div></div>` +
    `<div class="stat"><div class="k">cond. P50 net · "if it works"</div><div class="v">${fmt(r.afterTaxCondP50)}</div></div>` +
    `<div class="stat"><div class="k">Revenue P50 (gross)</div><div class="v">${fmt(r.p50)}</div></div>` +
    `<div class="stat"><div class="k">P(&lt; ${fmtShort(r.floor)}/yr)</div><div class="v">${pct(r.pFloor)}</div></div>` +
    `<div class="stat"><div class="k">NPV</div><div class="v">${fmt(r.npv)}</div></div>` +
    `<div class="stat"><div class="k">Launch lag (mo)</div><div class="v">${r.lagBuild.toFixed(1)}+${r.lagInstitutional.toFixed(1)}</div></div>` +
    `</div>`
  );
}

/** The revenue-distribution histogram card, shared by the project panel and each variant body. */
function histCard(histId: string, caption: string, r: RunResult, histCap: number, net = false): string {
  return `<div class="card histcard"><button class="histtoggle" data-histtoggle aria-expanded="true" aria-label="collapse graph" title="collapse / expand">▾</button><div class="cap">${caption}</div><div class="histbody"><div id="${histId}">${histSVG(r, histCap, net)}</div></div><div class="histtip" hidden></div></div>`;
}

/**
 * Price-as-output card: the revenue(price) curve under the demand overlay + capacity cap, with
 * the sampled ("planned") price and the revenue-optimal price marked, and a capacity-utilisation
 * trace. Renders only when the result carries a priceCurve (the base unit of a priceSweep project).
 */
function priceCurveCard(r: RunResult): string {
  const pts = r.priceCurve;
  if (!pts || !pts.length) return "";
  const W = 900, H = 230, ml = 52, mr = 16, mt = 14, mb = 34;
  const prices = pts.map((p) => p.price), revs = pts.map((p) => p.revenue);
  const pMin = Math.min(...prices), pMax = Math.max(...prices), rMax = Math.max(...revs, 1);
  const X = (p: number) => ml + ((p - pMin) / (pMax - pMin)) * (W - ml - mr);
  const Y = (v: number) => H - mb - (v / rMax) * (H - mt - mb);
  const YU = (u: number) => H - mb - Math.min(1.1, u) * (H - mt - mb); // utilisation on a 0..1 axis
  const poly = pts.map((p) => `${X(p.price).toFixed(1)},${Y(p.revenue).toFixed(1)}`).join(" ");
  const upoly = pts.map((p) => `${X(p.price).toFixed(1)},${YU(p.hoursUtil).toFixed(1)}`).join(" ");
  let svg = `<svg class="pricecurve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  // axes
  svg += `<line class="ax" x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}"/>`;
  svg += `<line class="ax" x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}"/>`;
  // capacity cap (util = 1) reference + utilisation trace
  svg += `<line class="cap" x1="${ml}" y1="${YU(1).toFixed(1)}" x2="${W - mr}" y2="${YU(1).toFixed(1)}"/>`;
  svg += `<text class="ax" x="${W - mr}" y="${(YU(1) - 4).toFixed(1)}" text-anchor="end">capacity cap</text>`;
  svg += `<polyline class="util" points="${upoly}"/>`;
  // revenue curve
  svg += `<polyline class="rev" points="${poly}"/>`;
  for (const p of pts) svg += `<circle class="pt" cx="${X(p.price).toFixed(1)}" cy="${Y(p.revenue).toFixed(1)}" r="2.5"/>`;
  // optimal marker (price is an OUTPUT — no "planned" reference line: it confused a decision price
  // with the model's input-price assumption)
  if (r.optimalPrice != null) {
    const x = X(r.optimalPrice), y = Y(r.optimalRevenue || 0);
    svg += `<line class="opt" x1="${x.toFixed(1)}" y1="${mt}" x2="${x.toFixed(1)}" y2="${H - mb}"/>`;
    svg += `<polygon class="optdot" points="${x},${(y - 6).toFixed(1)} ${(x + 6).toFixed(1)},${y.toFixed(1)} ${x},${(y + 6).toFixed(1)} ${(x - 6).toFixed(1)},${y.toFixed(1)}"/>`;
    svg += `<text class="mk opt" x="${x.toFixed(1)}" y="${mt + 10}" text-anchor="middle">optimal ${curSym()}${r.optimalPrice.toFixed(1)}</text>`;
  }
  // x ticks (a few prices) + y ticks (0 / max revenue)
  for (const p of [pMin, r.optimalPrice, pMax].filter((v): v is number => v != null)) {
    svg += `<text class="ax" x="${X(p).toFixed(1)}" y="${H - mb + 14}" text-anchor="middle">${curSym()}${p.toFixed(0)}</text>`;
  }
  svg += `<text class="ax" x="${ml - 6}" y="${(H - mb).toFixed(1)}" text-anchor="end">${curSym()}0</text>`;
  svg += `<text class="ax" x="${ml - 6}" y="${(mt + 8).toFixed(1)}" text-anchor="end">${fmtShort(rMax)}</text>`;
  svg += `</svg>`;
  const info =
    `<div class="pricecurveinfo">` +
    `<span>revenue-optimal price <b>${curSym()}${(r.optimalPrice || 0).toFixed(2)}</b></span>` +
    `<span>expected <b>(mean)</b> revenue at optimum <b>${fmt(r.optimalRevenue || 0)}</b></span>` +
    `<span>capacity use at optimum <b>${Math.round((r.optimalHoursUtil || 0) * 100)}%</b></span>` +
    `</div>`;
  return `<div class="card pricecard"><div class="cap">Price → expected (mean) revenue (price-as-output)</div>${svg}${info}</div>`;
}

const revDistCap = (): string => `Sustained average-yearly-revenue distribution · ${headlineSpan()}${HEADLINE_FROM_YEAR > 1 ? ", excl. the year-1 ramp" : ""} (~20k sims, ${curSym()}/yr)`;
const netDistCap = (): string => `Sustained average-yearly NET-INCOME distribution · ${headlineSpan()} (after cost of revenue, operating cost &amp; tax; ~20k sims, ${curSym()}/yr)`;

/**
 * Revenue & net income by model year (Year 1 → Year 5) — two lines on one axis, expected (mean) €/yr.
 * Revenue is gross collected; net income runs each year's revenue through the same after-tax transform
 * as the headline after-tax line (business margin × (1 − tax), or the portfolio's personal-tax schedule for personal tracks)
 * minus the annual operating cost, so it can dip below €0 before the product ships or scales — hence
 * the axis always includes zero. Renders only when the result carries a per-year series (skips the
 * pooled supermix, whose year buckets are empty).
 */
// The year-chart SVG for ONE statistic. Called four times so the P20/P50/Mean/P80 selector is a pure
// client-side show/hide of pre-rendered variants (works in the static artifact, no re-fetch).
// One metric's revenue+net lines as the SHARED hover-sensitive multi-line SVG (same renderer + look + hover
// as the Overview and Compare-all charts). Value labels reveal on hover; the two lines toggle via checkboxes.
function yearChartSVG(revS: YearStat[], netS: YearStat[], metric: "p20" | "p50" | "mean" | "p80"): string {
  return multiLineChartSVG([
    { key: "rev", color: REV_COLOR, values: revS.map((s) => s[metric]) },
    { key: "net", color: NET_COLOR, values: netS.map((s) => s[metric]) },
  ]);
}

// The pre-rendered chart variants (one per metric; a client swap shows one) + the checkbox legend rows for
// the shared box. Returns the two slots separately so the caller can drop them into chartBox's legend/chart.
function yearGraphInner(r: RunResult): { variants: string; legend: string } | null {
  const revS = r.yearRevenue, netS = r.yearNet;
  if (!revS || !netS || revS.length !== 5 || netS.length !== 5) return null;
  if (revS.reduce((a, s) => a + s.mean, 0) <= 0) return null; // pooled supermix carries no year series
  const variants = METRICS.map(({ k }) => `<div class="ycsvg" data-ycm="${k}"${k === "p50" ? "" : ' style="display:none"'}>${yearChartSVG(revS, netS, k)}</div>`).join("");
  const legend = mlLegendRow("rev", REV_COLOR, "Revenue (gross)") + mlLegendRow("net", NET_COLOR, "Net income");
  return { variants, legend };
}

// Standalone year chart (its own stat toggle) — used on the variant/supermix sub-pages, which have no
// income table. The base project panel uses the MERGED card below instead.
function yearGraphCard(r: RunResult): string {
  const inner = yearGraphInner(r);
  if (inner == null) return "";
  const toggle =
    '<div class="pwtoggle" role="group" aria-label="which statistic">Show: ' +
    METRICS.map(({ k, label }) => `<button class="pwtog${k === "p50" ? " active" : ""}" data-ycmetric="${k}">${esc(label)}</button>`).join("") +
    "</div>";
  return chartBox({ cap: "Revenue &amp; net income by year", controls: toggle, legend: inner.legend, chart: inner.variants });
}

/** Year-by-year income statement TABLE (thead + tbody only — no card/caption/toggle): revenue, its cost
 *  components (cost of revenue, operating cost, tax) split out, and net — each a row × 5 years. Every cell
 *  carries all four metric values so one client swap can rewrite them. Click a line to expand its
 *  independently-sampled sub-components. Rows that are ~zero everywhere (e.g. on a salary track) are dropped.
 *  Returns "" if there's no year series. */
function statementTableInner(p: Project, r: RunResult): string {
  const rev = r.yearRevenue, net = r.yearNet, cogs = r.yearCogs, tax = r.yearTax, cost = r.costStat;
  if (!rev || !net || rev.length !== 5) return "";
  const f = (x: number, neg: boolean): string => fmt(neg ? -x : x);
  const cell = (v: YearStat, neg = false, color = ""): string => {
    const style = `text-align:right;font-variant-numeric:tabular-nums${color ? `;color:${color}` : ""}`;
    return `<td style="${style}"><span class="icv" data-p20="${esc(f(v.p20, neg))}" data-p50="${esc(f(v.p50, neg))}" data-mean="${esc(f(v.mean, neg))}" data-p80="${esc(f(v.p80, neg))}">${esc(f(v.p50, neg))}</span></td>`;
  };
  const hasYr = (arr?: YearStat[]): boolean => !!arr && arr.some((s) => Math.abs(s.p50) > 1 || Math.abs(s.mean) > 1);
  const sl = r.statementLines || {};
  const COST = "#B0362B";
  const parentRow = (key: string, label: string): string =>
    `<tr class="icrow" data-icline="${key}"><td class="l"><span class="icchev">▸</span><span class="oname">${label}</span></td>`;
  // A component SUB-ROW built from the line's OWN sampled per-year stat (real, independent — not a share).
  const subRowYr = (key: string, label: string, arr: YearStat[], neg: boolean): string =>
    `<tr class="icexp icsub" data-icexp="${key}" hidden><td class="l"><span class="icsublabel">${esc(label)}</span></td>${arr.map((s) => cell(s, neg, neg ? COST : "")).join("")}</tr>`;
  // A one-line text note (NOT bullets) for lines with no sub-components (tax, net).
  const noteRow = (key: string, text: string): string =>
    `<tr class="icexp" data-icexp="${key}" hidden><td colspan="6"><div class="icnote">${text}</div></td></tr>`;
  const line = (key: string, label: string, total: YearStat[] | YearStat, neg: boolean, detail: string): string => {
    const cells = Array.isArray(total) ? total.map((s) => cell(s, neg, neg ? COST : "")).join("") : [0, 1, 2, 3, 4].map(() => cell(total, neg, neg ? COST : "")).join("");
    return parentRow(key, label) + cells + "</tr>" + detail;
  };
  const body =
    line("revenue", "Revenue (income)", rev, false,
      (sl.revenue || []).map((l) => subRowYr("revenue", l.label, l.stat, false)).join("")) +
    (hasYr(cogs) ? line("cogs", "Cost of revenue", cogs as YearStat[], true,
      (sl.cogs || []).map((l) => subRowYr("cogs", l.label, l.stat, true)).join("")) : "") +
    (hasYr(cost) ? line("opcost", "Operating cost", cost as YearStat[], true,
      (sl.opcost || []).map((l) => subRowYr("opcost", l.label, l.stat, true)).join("")) : "") +
    (hasYr(tax) ? line("tax", "Tax", tax as YearStat[], true,
      noteRow("tax", `Business tax at ≈ 25% of <b>pre-tax profit</b> (revenue − cost of revenue − operating cost). Operating cost is deductible, so in a loss year the tax is zero. Not itemized — a single rate.`)) : "") +
    line("net", "Net income", net, false,
      noteRow("net", `What's left: revenue − cost of revenue − operating cost − tax.`));
  return (
    `<div class="tablecard"><div class="scroller"><table class="ov"><thead><tr>` +
    `<th class="l">Line</th>` +
    modelYears().map((y) => `<th style="text-align:right">Year ${y}</th>`).join("") +
    `</tr></thead><tbody>${body}</tbody></table></div></div>`
  );
}

/** MERGED card for the base project panel: the by-year chart AND the income-statement table in one box,
 *  driven by a SINGLE stat toggle (data-ysmetric) that swaps both the chart variant and the table cells —
 *  the same one-control pattern as the cross-project overview. No caption/explanation text on either. */
function yearStatementCard(p: Project, r: RunResult): string {
  const graph = yearGraphInner(r);
  const table = statementTableInner(p, r);
  if (graph == null && table === "") return "";
  const toggle =
    '<div class="pwtoggle" role="group" aria-label="which statistic">Show: ' +
    METRICS.map(({ k, label }) => `<button class="pwtog${k === "p50" ? " active" : ""}" data-ysmetric="${k}">${esc(label)}</button>`).join("") +
    "</div>";
  // No year series (e.g. a salary track) → table-only card, no chart box.
  if (graph == null) return `<div class="card yearcard ictable"><div class="cap">Revenue &amp; net income by year</div>${toggle}${table}</div>`;
  return chartBox({ cap: "Revenue &amp; net income by year", controls: toggle, legend: graph.legend, chart: graph.variants, cardClass: "ictable", table });
}

export function renderProject(p: Project, r: RunResult, histCap: number): string {
  const nodes = visibleNodes(p.nodes).map((n) => nodeCard(p, n)).join("");
  // Two-pane layout: a sticky left COLUMN of all the summary stat boxes, and the scrolling content pane
  // (histogram → year chart → income/cost table → price curve → nodes → dependency graph). The project
  // selector is a further-left pinned nav (see the shell + styles.css); together: [nav][stats][content].
  return (
    `<div class="projlayout">` +
    `<div class="statcol">${statCards(r, p.id)}</div>` +
    `<div class="pcontent">` +
    histCard(`hist-${p.id}`, netDistCap(), r, histCap, true) +
    yearStatementCard(p, r) +
    priceCurveCard(r) +
    refFlag(p, r) +
    tornadoCard(r) +
    `<p class="eyebrow" style="margin-top:26px">Nodes · grounded percentiles &amp; sources${PROV_LEGEND}</p>` +
    `<div class="nodes">${nodes}</div>` +
    `<div class="card graphcard"><div class="cap">Dependency graph</div>${graphSVG({ nodes: visibleNodes(p.nodes) })}</div>` +
    `</div></div>`
  );
}

// ---- Product-variant rendering --------------------------------------------

/** One selectable unit (the "generic" base graph, or a variant) — not the supermix. */
export interface VariantUnit {
  id: string;
  name: string;
  nodes: ProjectNode[];
  rho: Record<string, number>;
  revNote: string;
  brief?: UnitBrief;
}

/** The expandable topline brief at the top of a unit page: a one-sentence summary (always visible) that
 *  expands (native <details>, no JS) to structured detail sections. */
function renderBrief(b: UnitBrief): string {
  const li = (it: string | { text: string; sub?: string[] }): string =>
    typeof it === "string"
      ? `<li>${esc(it)}</li>`
      : `<li>${esc(it.text)}${it.sub && it.sub.length ? `<ul class="briefsub">${it.sub.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</li>`;
  const secs = b.sections
    .map((s) => `<div class="briefsec"><div class="briefh">${esc(s.h)}</div><ul class="brieful">${s.items.map(li).join("")}</ul></div>`)
    .join("");
  return `<details class="brief"><summary class="briefone">${esc(b.one)}</summary><div class="briefdetail">${secs}</div></details>`;
}

/** Everything the variant panel needs, supplied by the app. `resultOf`/`histCapOf` accept any unit id
 *  (the base "generic" or a variant). `scale` is the shared spread axis, for the project-overview table. */
export interface VariantCtx {
  selectedId: string;
  units: VariantUnit[];
  resultOf: (unitId: string) => RunResult;
  histCapOf: (unitId: string) => number;
  scale: Scale;
}

/** The variant sub-tab bar: the "Project overview" tab first, then one tab per unit (base + variants).
 *  No include checkboxes and no supermix — clicking a tab just opens that sub-body. */
export function variantTabsHTML(p: Project, ctx: VariantCtx): string {
  const tab = (id: string, name: string): string =>
    `<button class="vtab${ctx.selectedId === id ? " active" : ""}" data-vtab="${p.id}|${id}">${esc(name)}</button>`;
  const compareTab = `<button class="vtab${ctx.selectedId === "compare" ? " active" : ""}" data-vtab="${p.id}|compare">Project overview</button>`;
  return `<div class="vtabs">${[compareTab, ...ctx.units.map((u) => tab(u.id, u.name))].join("")}</div>`;
}

/** Body for one unit (generic or a variant): pinned stats + charts, then node cards. The unit name +
 * include control now live in the tab bar above, so no in-body header is repeated here. */
export function renderUnitBody(p: Project, u: VariantUnit, r: RunResult, histCap: number): string {
  const nodes = visibleNodes(u.nodes).map((n) => nodeCard(p, n, u.id, u.rho)).join("");
  // Same two-pane layout as the base project panel: a sticky left COLUMN of stat boxes + the scrolling
  // content (histogram → merged year chart/income statement → price curve → nodes → dependency graph),
  // with the expandable topline brief spanning the full width above it.
  return (
    (u.brief ? renderBrief(u.brief) : "") +
    `<div class="projlayout">` +
    `<div class="statcol">${statCards(r, p.id)}</div>` +
    `<div class="pcontent">` +
    histCard(`hist-${p.id}-${u.id}`, netDistCap(), r, histCap, true) +
    yearStatementCard(p, r) +
    priceCurveCard(r) +
    refFlag(p, r) +
    tornadoCard(r) +
    `<p class="eyebrow" style="margin-top:26px">Nodes · grounded percentiles &amp; sources${PROV_LEGEND}</p>` +
    `<div class="nodes">${nodes}</div>` +
    `<div class="card graphcard"><div class="cap">Dependency graph</div>${graphSVG({ nodes: visibleNodes(u.nodes) })}</div>` +
    `</div></div>`
  );
}

// ── Compare-all overlay: every unit's income-by-year on ONE chart, lines toggleable ─────────────────
const CMP_COLORS = ["#1E5F84", "#A8483A", "#2F7D57", "#7a5aa8", "#A9762A", "#0F766E", "#B0362B", "#3B6FA0"];

/** Overlaid multi-unit line chart via the SHARED renderer (identical look + hover to the Overview YoY
 *  chart): one line per unit (net income OR gross revenue by model year) at a given statistic. */
function compareChartSVG(units: VariantUnit[], resultOf: (id: string) => RunResult, series: "net" | "rev", metric: Metric): string {
  const lines: MLLine[] = units
    .map((u, i) => {
      const r = resultOf(u.id);
      const ys = series === "net" ? r.yearNet : r.yearRevenue;
      return ys && ys.length === 5 ? { key: u.id, color: CMP_COLORS[i % CMP_COLORS.length], values: ys.map((s) => s[metric]) } : null;
    })
    .filter((l): l is MLLine => !!l);
  return multiLineChartSVG(lines);
}

/** Per-unit year-over-year table (one row per option, cols = model years) at a given series+stat — the
 *  scoped-to-variants twin of the Overview's year table. Pre-rendered per series×stat and swapped by the
 *  same toggle that drives the chart. */
function compareYearTable(p: Project, units: VariantUnit[], resultOf: (id: string) => RunResult, series: "net" | "rev", metric: Metric): string {
  const rows = units.map((u, i) => {
    const r = resultOf(u.id);
    const ys = (series === "net" ? r.yearNet : r.yearRevenue) || [];
    const color = CMP_COLORS[i % CMP_COLORS.length];
    const cells = ys.length === 5
      ? ys.map((s) => `<td class="heatc" style="${heatVars(s[metric])}"><span class="n">${fmt(s[metric])}</span></td>`).join("")
      : [0, 1, 2, 3, 4].map(() => `<td class="heatc"><span class="n">—</span></td>`).join("");
    return `<tr class="cohlrow" data-mlkey="${esc(u.id)}"><td class="l"><span class="oname namego" data-govar="${p.id}|${u.id}"><span class="yoysw" style="background:${color};display:inline-block;vertical-align:middle;margin-right:6px"></span>${esc(u.name)}</span></td>${cells}</tr>`;
  }).join("");
  return `<div class="tablecard"><div class="scroller"><table class="ov hz"><thead><tr><th class="l">Option</th>${modelYears().map((y) => `<th>Year ${y}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The "Project overview" sub-body — the main Overview's structure scoped to ONE project's options:
 *  a project-stats table (net lens), then the income-by-year line graph (shared hover chart, options
 *  toggleable), then a year-over-year table. The chart's net/revenue + stat toggle drives both the chart
 *  and the year table (pre-rendered variants, client-swapped). All interactions are pure-client. */
function renderCompareBody(p: Project, ctx: VariantCtx): string {
  const units = ctx.units; // base ("generic") + each variant
  const SERIES: ("net" | "rev")[] = ["net", "rev"];
  // Project-stats table (net lens) — same columns as the main Overview, one row per option.
  const statsRows = units.map((u, i) => {
    const v = ovVals(ctx.resultOf(u.id), "net");
    const color = CMP_COLORS[i % CMP_COLORS.length];
    return `<tr class="cohlrow" data-mlkey="${esc(u.id)}" data-name="${esc(u.name)}" data-p20="${v.p20}" data-p50="${v.p50}" data-mean="${v.mean}" data-p80="${v.p80}" data-psucc="${v.pSucc}" data-cond="${v.condP50}"><td class="l"><span class="oname namego" data-govar="${p.id}|${u.id}"><span class="yoysw" style="background:${color};display:inline-block;vertical-align:middle;margin-right:6px"></span>${esc(u.name)}</span></td>${ovCells(v, ctx.scale)}</tr>`;
  }).join("");
  const statsTable =
    `<p class="eyebrow">Project stats</p>` +
    `<div class="tablecard"><div class="scroller"><table class="ov"><thead><tr>` +
    `<th class="l" data-key="name">Option <span class="arr">↕</span></th>` +
    `<th data-key="p20">P20 <span class="arr">↕</span></th><th data-key="p50">P50 <span class="arr">↕</span></th><th data-key="mean">Mean <span class="arr">↕</span></th><th data-key="p80">P80 <span class="arr">↕</span></th>` +
    `<th data-key="psucc">P(meaningful) <span class="arr">↕</span></th><th data-key="cond">cond. P50 <span class="arr">↕</span></th>` +
    `<th class="l spreadh">Spread — shared √ scale${axhdr(ctx.scale)}</th></tr></thead><tbody>${statsRows}</tbody></table></div></div>`;
  // Line graph (income by model year) — pre-rendered per series×stat, swapped by the toggle.
  const svgs = SERIES.flatMap((sr) => METRICS.map(({ k }) =>
    `<div class="cmpsvg" data-cmps="${sr}" data-cmpm="${k}"${sr === "net" && k === "p50" ? "" : ' style="display:none"'}>${compareChartSVG(units, ctx.resultOf, sr, k)}</div>`,
  )).join("");
  // Year-over-year table — same series×stat variants, swapped by the same toggle (cmpShow toggles both).
  const yts = SERIES.flatMap((sr) => METRICS.map(({ k }) =>
    `<div class="cmpyt" data-cmps="${sr}" data-cmpm="${k}"${sr === "net" && k === "p50" ? "" : ' style="display:none"'}>${compareYearTable(p, units, ctx.resultOf, sr, k)}</div>`,
  )).join("");
  const seriesToggle =
    '<div class="pwtoggle" role="group" aria-label="which series">Series: ' +
    '<button class="pwtog active" data-cmpseries="net">Net income</button>' +
    '<button class="pwtog" data-cmpseries="rev">Revenue</button></div>';
  const statToggle =
    '<div class="pwtoggle" role="group" aria-label="which statistic">Show: ' +
    METRICS.map(({ k, label }) => `<button class="pwtog${k === "p50" ? " active" : ""}" data-cmpmetric="${k}">${esc(label)}</button>`).join("") +
    "</div>";
  // Legend uses the SHARED chart-box row markup (.yoyrow / .mlchk / data-mlkey) so the same hover + checkbox
  // handlers drive it as the Overview and per-project charts — plus each option's net-P50 value.
  const legend =
    units.map((u, i) => {
      const color = CMP_COLORS[i % CMP_COLORS.length];
      return `<label class="yoyrow" data-mlkey="${esc(u.id)}"><input type="checkbox" class="mlchk" data-mlkey="${esc(u.id)}" checked><span class="yoysw" style="background:${color}"></span><span class="yoyname">${esc(u.name)}</span></label>`;
    }).join("");
  const chart = chartBox({ cap: "Income by model year", controls: seriesToggle + statToggle, legend, chart: svgs, cardClass: "comparecard", table: `<p class="eyebrow" style="margin-top:18px">Year over year</p>${yts}` });
  // The base/flagship brief at the top of the Project overview so a description is visible on landing
  // (each option's own brief still sits atop its own sub-tab).
  const baseBrief = ctx.units.find((u) => u.id === "generic")?.brief;
  // Wrap the three views (stats table · chart · year table) in one .cohl container so a hover on any one
  // co-highlights the same option in all three (client.mjs coHighlight, keyed on data-mlkey = unit id).
  return (baseBrief ? renderBrief(baseBrief) : "") + `<div class="cohl">${statsTable}${chart}</div>`;
}

/** The selected sub-body (project overview, or a unit). */
export function renderVariantSub(p: Project, unitId: string, ctx: VariantCtx): string {
  if (unitId === "compare") return renderCompareBody(p, ctx);
  const u = ctx.units.find((x) => x.id === unitId) || ctx.units[0];
  return renderUnitBody(p, u, ctx.resultOf(u.id), ctx.histCapOf(u.id));
}

/** The full variant project panel: header + sub-tab bar + selected sub-body. */
export function renderVariantPanel(p: Project, ctx: VariantCtx): string {
  return (
    variantTabsHTML(p, ctx) +
    `<div id="sub-${p.id}">${renderVariantSub(p, ctx.selectedId, ctx)}</div>`
  );
}
