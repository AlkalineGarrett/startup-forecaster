// The Pairwise panel: a triangular half-matrix of project pairs, each run as one
// correlated simulation. Row labels down the left, column headers across the top,
// the filled triangle flush against top & left with the hypotenuse running
// lower-left → upper-right (so columns are in reverse project order). A leading
// "(none)" column gives each project's solo (un-paired) value. Each cell shows
// P20 / P50 / P80; a toggle picks which is the large number and drives the colour.
import type { RunResult } from "../types.ts";
import { fmt, esc, heatVars } from "../format.ts";
import { horizonsTable, metricToggle, type HzRow, type Metric } from "./horizons.ts";

export type PairMetric = Metric;

/** The computed matrix: names per project, solo results, and res[a][b] for b < a (lower triangle). */
export interface PairMatrix {
  labels: string[];
  solo: RunResult[];
  res: (RunResult | null)[][];
}

// The matrix shows NET INCOME (after-tax), matching the overview / project-page default. Map the selected
// percentile metric to its after-tax field (the lite cells carry both revenue and after-tax percentiles).
const NET_FIELD: Record<PairMetric, keyof RunResult> = { p20: "afterTax20", p50: "afterTax50", mean: "afterTaxMean", p80: "afterTax80" };

/** A single value cell — the selected metric's NET income (the toggle switches which percentile), coloured
 *  by it. The N×N matrix is too dense to fit all four numbers per cell, so we show one and let the toggle pick. */
function pwCell(r: RunResult, metric: PairMetric, title: string, extra: string): string {
  const v = (r[NET_FIELD[metric]] as number | undefined) ?? r.afterTax50 ?? r.p50;
  return `<td class="pwcell heatc${extra}" style="${heatVars(v)}" title="${esc(title)}"><span class="pwval">${fmt(v)}</span></td>`;
}

/** The full inner HTML of the Pairwise panel, for a given selected metric. */
export function renderPairwise(m: PairMatrix, metric: PairMetric): string {
  const n = m.labels.length;

  // Header row: corner, the (none)/solo column, then pair columns in reverse project order.
  let head = '<tr><th class="pwcorner"></th><th class="pwcolh pwnonecol">(none)</th>';
  for (let k = 0; k < n - 1; k++) {
    const c = n - 1 - k;
    head += `<th class="pwcolh" title="${esc(m.labels[c])}"><span>${esc(m.labels[c])}</span></th>`;
  }
  head += "</tr>";

  // One row per project (all n): label, its solo value, then its pair cells.
  let body = "";
  for (let i = 0; i < n; i++) {
    let cells = `<th class="pwrowh" title="${esc(m.labels[i])}">${esc(m.labels[i])}</th>`;
    cells += pwCell(m.solo[i], metric, `${m.labels[i]} · on its own (not paired)`, " pwnonecol");
    for (let k = 0; k < n - 1; k++) {
      const c = n - 1 - k;
      if (c > i) cells += pwCell(m.res[c][i] as RunResult, metric, `${m.labels[i]} + ${m.labels[c]}`, "");
      else cells += '<td class="pwempty"></td>';
    }
    body += `<tr>${cells}</tr>`;
  }

  // Revenue-by-horizon rows: every solo and every pair, ranked by P50.
  const hz: HzRow[] = [];
  for (let i = 0; i < n; i++) hz.push({ name: `${m.labels[i]} (none)`, r: m.solo[i] });
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) hz.push({ name: `${m.labels[i]} + ${m.labels[j]}`, r: m.res[i][j] as RunResult });
  hz.sort((a, b) => b.r.p50 - a.r.p50);

  return (
    '<p class="eyebrow">Pairwise combinations · net income</p><h2 style="margin:0">Two projects, pursued together (correlated) — net income</h2>' +
    metricToggle(metric) +
    `<div class="tablecard"><div class="scroller"><table class="pwmatrix metric-${metric}"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>` +
    horizonsTable(hz, "Revenue by horizon · every solo and pair (ranked by P50) — gross revenue timing, not net", metric, true)
  );
}
