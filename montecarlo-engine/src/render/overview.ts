// The Overview panel: the sortable P20/P50/P80 table across all projects.
import type { Project, RunResult } from "../types.ts";
import { fmt, esc, heatVars, pct, withCur, moneyBands } from "../format.ts";
import { REFERENCE_P90 } from "../simulate.ts";
import { axhdr, stripSVG, type Scale } from "./graph.ts";
import { overviewYoy, type YoyState } from "./yoy.ts";

/** Which lens the Overview ranking table shows: gross revenue, or net income (after-tax cash). */
export type OvSeries = "rev" | "net";

/** The P20/P50/Mean/P80/cond/pSucc quintet for the chosen lens. */
export function ovVals(r: RunResult, series: OvSeries): { p20: number; p50: number; mean: number; p80: number; condP50: number; pSucc: number } {
  return series === "net"
    ? { p20: r.afterTax20, p50: r.afterTax50, mean: r.afterTaxMean, p80: r.afterTax80, condP50: r.afterTaxCondP50, pSucc: r.afterTaxPSucc }
    : { p20: r.p20, p50: r.p50, mean: r.mean, p80: r.p80, condP50: r.condP50, pSucc: r.pSucc };
}

/** One project (or variant) row's numeric + spread cells — shared by the project row and its variant
 *  sub-rows so the columns can't drift. `v` is the ovVals quintet for the chosen lens. */
export function ovCells(v: ReturnType<typeof ovVals>, scale: Scale): string {
  return (
    `<td class="heatc" style="${heatVars(v.p20)}"><span class="n">${fmt(v.p20)}</span></td>` +
    `<td class="heatc" style="${heatVars(v.p50)}"><span class="n">${fmt(v.p50)}</span></td>` +
    `<td class="heatc" style="${heatVars(v.mean)}"><span class="n">${fmt(v.mean)}</span></td>` +
    `<td class="heatc" style="${heatVars(v.p80)}"><span class="n">${fmt(v.p80)}</span></td>` +
    `<td><span class="psucc">${pct(v.pSucc)}</span><span class="succbar"><i style="width:${pct(v.pSucc)}"></i></span></td>` +
    `<td class="heatc" style="${heatVars(v.condP50)}"><span class="n">${fmt(v.condP50)}</span></td>` +
    `<td class="l">${stripSVG(v, scale)}</td>`
  );
}

/** A project's variants for the expandable sub-rows: each real unit (base + variants) with a display name
 *  and result. Keyed by project id; only projects with variants appear. Built by the app (appcore/app.ts). */
export type OvVariants = Record<string, { id: string; name: string; r: RunResult }[]>;

/** One project's row, carrying sort keys in data-attributes. `series` picks the revenue or net lens.
 *  If `variants` has an entry for this project, the row is expandable (a chevron + clickable body reveals
 *  one hidden sub-row per variant); the project NAME still navigates to the project, variant names to the
 *  variant view. */
export function ovRow(p: Project, r: RunResult, scale: Scale, series: OvSeries = "rev", variants?: OvVariants): string {
  // The reference-class flag is a property of the (revenue) outcome, so it does not change with the lens.
  const flag = !p.personal && r.p50 > (p.refP90 ?? REFERENCE_P90)
    ? ` <span title="${p.refNote ? "Median above this venture's reference-class p90 — inputs optimistic until validated (see the reference-class note in the project view)" : "Median above the ~p90 of solo-software outcomes — inputs likely optimistic (§ reference class)"}" style="color:#B0362B;cursor:help">⚠</span>`
    : "";
  const v = ovVals(r, series);
  const vlist = variants && variants[p.id];
  const hasVars = !!(vlist && vlist.length);
  return withCur(p.cur, () => {
    const subs = hasVars
      ? vlist!.map((u, i) =>
          `<tr class="ovsub${i === vlist!.length - 1 ? " sublast" : ""}" data-subof="${p.id}" hidden><td class="l"><span class="ovsubname namego" data-govar="${p.id}|${u.id}">${esc(u.name)}</span></td>${ovCells(ovVals(u.r, series), scale)}</tr>`,
        ).join("")
      : "";
    return (
      `<tr class="ovtr${hasVars ? " hasvars" : ""}" data-pid="${p.id}"${hasVars ? ` data-expand="${p.id}"` : ""} data-name="${esc(p.name)}" data-p20="${v.p20}" data-p50="${v.p50}" data-mean="${v.mean}" data-p80="${v.p80}" data-psucc="${v.pSucc}" data-cond="${v.condP50}">` +
      `<td class="l"><span class="oname namego" data-go="${p.id}">${esc(p.name)}</span>${hasVars ? '<span class="ovtri" aria-hidden="true"></span>' : ""}${flag}</td>` +
      ovCells(v, scale) +
      `</tr>` +
      subs
    );
  });
}

/** The "Archived" panel: an outcome table of projects no longer pursued (model preserved). Same
 * columns as the Overview and the same drill-through rows (click a row → that project's full panel),
 * but no YoY / horizons blocks — this is a reference shelf, not the working view. `order` is ranked. */
export function renderArchived(order: Project[], results: Record<string, RunResult>, scale: Scale, variants?: OvVariants): string {
  const body = order.map((p) => ovRow(p, results[p.id], scale, "rev", variants)).join("");
  return (
    '<p class="eyebrow">Archived</p><h2 style="margin:0">Not being pursued — model preserved for reference</h2>' +
    '<div class="tablecard"><div class="scroller"><table class="ov" id="arct"><thead><tr>' +
    '<th class="l" data-key="name">Opportunity <span class="arr">↕</span></th>' +
    '<th data-key="p20">P20 <span class="arr">↕</span></th><th data-key="p50">P50 <span class="arr">↕</span></th><th data-key="mean">Mean <span class="arr">↕</span></th><th data-key="p80">P80 <span class="arr">↕</span></th>' +
    '<th data-key="psucc">P(meaningful) <span class="arr">↕</span></th><th data-key="cond">cond. P50 <span class="arr">↕</span></th>' +
    '<th class="l spreadh">Spread — shared √ scale' +
    axhdr(scale) +
    '</th></tr></thead><tbody id="arcb">' +
    body +
    "</tbody></table></div></div>"
  );
}

/** The ranking table region (revenue/net toggle + sortable table + legend), swapped in-place by the
 *  toggle. Rows are ordered by the active lens's P50 so the default view is ranked by what it shows. */
export function ovRankTable(order: Project[], results: Record<string, RunResult>, scale: Scale, series: OvSeries, variants?: OvVariants): string {
  const ranked = series === "net"
    ? order.slice().sort((a, b) => ovVals(results[b.id], "net").p50 - ovVals(results[a.id], "net").p50)
    : order;
  const body = ranked.map((p) => ovRow(p, results[p.id], scale, series, variants)).join("");
  const toggle =
    '<div class="pwtoggle" role="group" aria-label="revenue or net income">Show: ' +
    ([["net", "Net income"], ["rev", "Revenue"]] as [OvSeries, string][])
      .map(([k, l]) => `<button class="pwtog${series === k ? " active" : ""}" data-ovseries="${k}">${l}</button>`)
      .join("") +
    "</div>";
  const lens = series === "net" ? "net income (after-tax cash)" : "gross revenue";
  return (
    toggle +
    '<div class="tablecard"><div class="scroller"><table class="ov" id="ovt"><thead><tr>' +
    `<th class="l" data-key="name">Opportunity <span class="arr">↕</span></th>` +
    '<th data-key="p20">P20 <span class="arr">↕</span></th><th data-key="p50">P50 <span class="arr">↕</span></th><th data-key="mean">Mean <span class="arr">↕</span></th><th data-key="p80">P80 <span class="arr">↕</span></th>' +
    '<th data-key="psucc">P(meaningful) <span class="arr">↕</span></th><th data-key="cond">cond. P50 <span class="arr">↕</span></th>' +
    `<th class="l spreadh">Spread — shared √ scale` +
    axhdr(scale) +
    '</th></tr></thead><tbody id="ovb">' +
    body +
    "</tbody></table></div>" +
    `<div class="striplegend"><span style="color:var(--ink-faint)">showing ${lens}</span><span><span class="lgdot" style="background:var(--c-p20)"></span>P20</span><span><span class="lgdot" style="background:var(--c-p50)"></span>P50</span><span><span class="lgdot" style="background:var(--c-mean);transform:rotate(45deg)"></span>Mean</span><span><span class="lgdot" style="background:var(--c-p80)"></span>P80</span>` +
    ([["loss", -1], [fmt(0), 0], [fmt(moneyBands()[0]), moneyBands()[0]], [fmt(moneyBands()[1]), moneyBands()[1]], [fmt(moneyBands()[2]) + "+", moneyBands()[2]]] as [string, number][])
      .map(([lbl, v]) => `<span><span class="lgsw" style="${heatVars(v)};background:var(--hbg)"></span>${lbl}</span>`)
      .join("") +
    "</div></div>"
  );
}

/** The full inner HTML of the Overview panel. `order` is already ranked. `yoyState` is optional — when
 *  omitted (e.g. the fully-client dist build), the Year-over-year card renders at its own defaults.
 *  `series` picks the ranking table's lens (default net income). */
export function renderOverview(order: Project[], results: Record<string, RunResult>, scale: Scale, yoyState?: YoyState, series: OvSeries = "net", variants?: OvVariants): string {
  return (
    '<p class="eyebrow">Project stats</p>' +
    `<div id="ovranktable">${ovRankTable(order, results, scale, series, variants)}</div>` +
    '<p class="eyebrow" style="margin-top:30px">Year over year · all projects</p>' +
    `<div class="card yoycard" id="yoycard">${overviewYoy(order, results, yoyState, variants)}</div>`
  );
}
