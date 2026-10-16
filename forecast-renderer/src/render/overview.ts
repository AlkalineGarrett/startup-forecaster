// The Overview panel: the sortable P20/P50/P80 table across all projects.
import type { Project, RunResult } from "../../../montecarlo-engine/src/types.ts";
import { fmt, esc, heatVars, pct, moneyBands, inReporting } from "../../../montecarlo-engine/src/format.ts";
import { REFERENCE_NOTE, SUCCESS_THRESHOLD, reportingCurrency, withCur } from "../../../montecarlo-engine/src/portfolio-context.ts";
import { rankByReporting } from "../../../montecarlo-engine/src/units.ts";
import { refP90For } from "./project.ts";
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
 *  sub-rows so the columns can't drift. `v` is the ovVals quintet for the chosen lens, in the ambient (the
 *  venture's) currency; the colour scale and the spread axis convert it into the reporting currency. */
export function ovCells(v: ReturnType<typeof ovVals>, scale: Scale): string {
  const money = (x: number): string => `<td class="heatc" style="${heatVars(x)}"><span class="n">${fmt(x)}</span></td>`;
  return (
    money(v.p20) + money(v.p50) + money(v.mean) + money(v.p80) +
    `<td><span class="psucc">${pct(v.pSucc)}</span><span class="succbar"><i style="width:${pct(v.pSucc)}"></i></span></td>` +
    money(v.condP50) +
    `<td class="l">${stripSVG(v, scale)}</td>`
  );
}

/** The P(meaningful) / cond. P50 column headers, naming the threshold (`thr`, formatted with `sym`). */
export function succHeaders(thr: number, sym: string): string {
  const t = fmt(thr, sym);
  return (
    `<th data-key="psucc">P(≥ ${t}/yr) <span class="arr">↕</span></th>` +
    `<th data-key="cond">cond. P50 · if ≥ ${t} <span class="arr">↕</span></th>`
  );
}
/** The portfolio-wide headers: the threshold in the reporting currency. */
const ovSuccHeaders = (): string => succHeaders(SUCCESS_THRESHOLD, reportingCurrency().symbol);

/** A row's sort keys (its data-* attributes), in the reporting currency so a mixed-currency table sorts by
 *  comparable values. `v` is in the ambient (the venture's) currency. */
export function sortKeys(v: ReturnType<typeof ovVals>): { p20: string; p50: string; mean: string; p80: string; psucc: string; cond: string } {
  return { p20: String(inReporting(v.p20)), p50: String(inReporting(v.p50)), mean: String(inReporting(v.mean)), p80: String(inReporting(v.p80)), psucc: String(v.pSucc), cond: String(inReporting(v.condP50)) };
}
const sortAttrs = (v: ReturnType<typeof ovVals>): string =>
  Object.entries(sortKeys(v)).map(([k, x]) => `data-${k}="${x}"`).join(" ");

/** A project's variants for the expandable sub-rows: each real unit (base + variants) with a display name
 *  and result. Keyed by project id; only projects with variants appear. Built by the app (appcore/app.ts). */
export type OvVariants = Record<string, { id: string; name: string; r: RunResult }[]>;

/** One project's row, carrying sort keys in data-attributes. `series` picks the revenue or net lens.
 *  If `variants` has an entry for this project, the row is expandable (a chevron + clickable body reveals
 *  one hidden sub-row per variant); the project NAME still navigates to the project, variant names to the
 *  variant view. */
export function ovRow(p: Project, r: RunResult, scale: Scale, series: OvSeries = "rev", variants?: OvVariants): string {
  // The reference-class flag is a property of the (revenue) outcome, so it does not change with the lens.
  const ref = refP90For(p, r);
  const refName = p.refNote ? "this venture's reference-class p90" : REFERENCE_NOTE ? REFERENCE_NOTE.replace(/<[^>]*>/g, "") : "the reference-class p90";
  const flag = !p.personal && ref != null && r.p50 > ref
    ? ` <span title="${esc(`Median above ${refName} — inputs likely optimistic until validated`).replace(/"/g, "&quot;")}" style="color:#B0362B;cursor:help">⚠</span>`
    : "";
  const v = ovVals(r, series);
  const vlist = variants && variants[p.id];
  const hasVars = !!(vlist && vlist.length);
  return withCur(p, () => {
    const subs = hasVars
      ? vlist!.map((u, i) =>
          `<tr class="ovsub${i === vlist!.length - 1 ? " sublast" : ""}" data-subof="${p.id}" hidden><td class="l"><span class="ovsubname namego" data-govar="${p.id}|${u.id}">${esc(u.name)}</span></td>${ovCells(ovVals(u.r, series), scale)}</tr>`,
        ).join("")
      : "";
    return (
      `<tr class="ovtr${hasVars ? " hasvars" : ""}" data-pid="${p.id}"${hasVars ? ` data-expand="${p.id}"` : ""} data-name="${esc(p.name)}" ${sortAttrs(v)}>` +
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
    ovSuccHeaders() +
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
  const ranked = rankByReporting(order, (p) => ovVals(results[p.id], series).p50);
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
    ovSuccHeaders() +
    `<th class="l spreadh">Spread — shared √ scale` +
    axhdr(scale) +
    '</th></tr></thead><tbody id="ovb">' +
    body +
    "</tbody></table></div>" +
    `<div class="striplegend"><span style="color:var(--ink-faint)">showing ${lens}</span><span><span class="lgdot" style="background:var(--c-p20)"></span>P20</span><span><span class="lgdot" style="background:var(--c-p50)"></span>P50</span><span><span class="lgdot" style="background:var(--c-mean);transform:rotate(45deg)"></span>Mean</span><span><span class="lgdot" style="background:var(--c-p80)"></span>P80</span>` +
    (((rs) => [["loss", -1], [fmt(0, rs), 0], [fmt(moneyBands()[0], rs), moneyBands()[0]], [fmt(moneyBands()[1], rs), moneyBands()[1]], [fmt(moneyBands()[2], rs) + "+", moneyBands()[2]]])(reportingCurrency().symbol) as [string, number][])
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
