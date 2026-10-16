// A supplementary "revenue by horizon" table: per-scenario revenue at three horizons —
// first 3 months once live (a quarter-year total), first year once live (annual), and the
// headline annual run-rate (the average year over the headline window, headlineSpan()). Same cell format as the
// pairwise matrix: each cell shows P20 · P50 · P80 with the toggle-selected one large, and
// is heat-coloured by the selected percentile. The first-3-months figure is a quarter of a
// year, so it is coloured by value×4 to sit on the same annualised scale as the others while
// still displaying the true 3-month number. The engine computes these per sample (h3/h12/h25).
import type { RunResult, Horizon } from "../../../montecarlo-engine/src/types.ts";
import { fmt, esc, heatVars } from "../../../montecarlo-engine/src/format.ts";
import { headlineSpan } from "../../../montecarlo-engine/src/types.ts";

/** The single metric type shared by every switcher in the app (horizon tables + the per-project
 *  year charts). `mean` is the expected value; the other three are percentiles. */
export type Metric = "p20" | "p50" | "mean" | "p80";

/** The ordered options + their button labels — the ONE source of truth for every metric switcher. */
export const METRICS: { k: Metric; label: string }[] = [
  { k: "p20", label: "P20" },
  { k: "p50", label: "P50" },
  { k: "mean", label: "Mean" },
  { k: "p80", label: "P80" },
];

export interface HzRow {
  name: string;
  r: RunResult; // in the ambient currency, like every row of the table
}

/** The P20·P50·Mean·P80 number row shared by the horizon cells; the emphasised one is set by the
 *  table's `metric-<k>` class (see styles.css). `mean` may be absent (pre-baked pairwise cells carry only P20/P50/P80) → shown as "—". */
export function pctTriple(p20: number, p50: number, p80: number, mean?: number): string {
  const meanCell = mean != null ? fmt(mean) : "—";
  return `<div class="pwnums"><span class="m m20">${fmt(p20)}</span><span class="m m50">${fmt(p50)}</span><span class="m mmean">${meanCell}</span><span class="m m80">${fmt(p80)}</span></div>`;
}

/** The metric emphasis toggle (drives setMetric); `metric` marks the active button. One component,
 *  used by the horizon tables and each year chart, so every switcher stays identical. */
export function metricToggle(metric: Metric): string {
  return (
    '<div class="pwtoggle" role="group" aria-label="which statistic to emphasise">Show: ' +
    METRICS.map(({ k, label }) => `<button class="pwtog${metric === k ? " active" : ""}" data-metric="${k}">${label}</button>`).join("") +
    "</div>"
  );
}

/**
 * One horizon cell: the P20·P50·Mean·P80 row, heat-coloured by the selected metric.
 * `colorMul` scales the value used for colour only (not the displayed number) — the
 * first-3-months column passes 4 so its quarter-year total is shaded on the annualised scale.
 */
function hzCell(h: Horizon, metric: Metric, colorMul: number): string {
  return `<td class="hzc heatc" style="${heatVars((h[metric] ?? h.p50) * colorMul)}">${pctTriple(h.p20, h.p50, h.p80, h.mean)}</td>`;
}

function hzRowHTML(row: HzRow, metric: Metric): string {
  const { h3, h12, h25 } = row.r;
  return `<tr><td class="l"><span class="oname">${esc(row.name)}</span></td>${hzCell(h3, metric, 4)}${hzCell(h12, metric, 1)}${hzCell(h25, metric, 1)}</tr>`;
}

/**
 * The "revenue by horizon" section. `metric` picks which percentile is emphasised (and
 * drives the cell colour); `showToggle` renders the P20/P50/P80 selector.
 */
export function horizonsTable(rows: HzRow[], caption: string, metric: Metric, showToggle: boolean): string {
  const toggle = showToggle ? metricToggle(metric) : "";
  const body = rows.map((row) => hzRowHTML(row, metric)).join("");
  return (
    `<p class="eyebrow" style="margin-top:28px">${esc(caption)}</p>` +
    toggle +
    `<div class="tablecard"><div class="scroller"><table class="ov hz metric-${metric}"><thead>` +
    '<tr><th class="l">Scenario</th><th class="hzgrp">First 3 months (from start)</th><th class="hzgrp">First year (from start)</th><th class="hzgrp">' + headlineSpan().replace(/^years?/, "Year") + ' (annual)</th></tr>' +
    `</thead><tbody>${body}</tbody></table></div></div>`
  );
}
