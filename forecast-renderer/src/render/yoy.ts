// The Overview "year over year · all projects" overlay — rendered ENTIRELY on the server (like every
// other chart). One line per checked project across the model years. State (which projects are
// checked, revenue vs net income, which statistic) lives in appcore; toggling it re-renders this
// fragment server-side. The ONLY thing the browser does is toggle opacity on hover (spotlight one line,
// gray the rest, reveal that line's per-year numbers) — a pure style toggle on server-rendered elements,
// no data or drawing in the client.
import type { Project, RunResult, YearStat } from "../../../montecarlo-engine/src/types.ts";
import type { OvVariants } from "./overview.ts";
import { fmt, esc, heatVars, inReporting } from "../../../montecarlo-engine/src/format.ts";
import { METRICS, type Metric } from "./horizons.ts";
import { multiLineChartSVG } from "./linechart.ts";
import { modelYears, HORIZON_YEARS } from "../../../montecarlo-engine/src/types.ts";
import { reportingCurrency, withCur } from "../../../montecarlo-engine/src/portfolio-context.ts";

/** A distinct, stable hue per project (golden-angle rotation for good separation). */
const yoyColor = (i: number): string => `hsl(${Math.round((i * 137.508) % 360)},58%,45%)`;
const yoyZeros = (): YearStat[] => modelYears().map(() => ({ p20: 0, p50: 0, mean: 0, p80: 0 }));

export interface YoyState {
  checked: Set<string>;
  series: "rev" | "net";
  stat: Metric;
}

export function overviewYoy(order: Project[], results: Record<string, RunResult>, st: YoyState = { checked: new Set(order.map((p) => p.id)), series: "net", stat: "p50" }, variants?: OvVariants): string {
  const data = order.map((p, i) => {
    const r = results[p.id];
    return { id: p.id, name: p.name, p, color: yoyColor(i), rev: r?.yearRevenue || yoyZeros(), net: r?.yearNet || yoyZeros() };
  });
  const valsOf = (d: (typeof data)[number]): number[] => (st.series === "net" ? d.net : d.rev).map((s) => s[st.stat]);
  const shown = data.filter((d) => st.checked.has(d.id));

  // Shared multi-line chart (same renderer + look as the per-project Compare-all overlay). The y-axis
  // rescales to whichever projects are checked because `shown` is what we pass in. It is one axis across
  // ventures, so every line is converted into the reporting currency. "yoychart" adds the overlay's flex
  // layout; the line/label styling is the shared svg.mlchart CSS.
  const rsym = reportingCurrency().symbol;
  const svg = multiLineChartSVG(shown.map((d) => ({ key: d.id, color: d.color, values: withCur(d.p, () => valsOf(d).map(inReporting)) })), "yoychart", rsym);

  const seriesTog =
    '<div class="pwtoggle" role="group" aria-label="revenue or net income">Series: ' +
    (["rev", "net"] as const).map((k) => `<button class="pwtog${st.series === k ? " active" : ""}" data-yoyseries="${k}">${k === "rev" ? "Revenue" : "Net income"}</button>`).join("") +
    "</div>";
  const statTog =
    '<div class="pwtoggle" role="group" aria-label="which statistic">Show: ' +
    METRICS.map(({ k, label }) => `<button class="pwtog${st.stat === k ? " active" : ""}" data-yoystat="${k}">${label}</button>`).join("") +
    "</div>";
  const bulk =
    '<div class="pwtoggle" role="group" aria-label="select projects">' +
    '<button class="pwtog" data-yoyall="1">Select all</button>' +
    '<button class="pwtog" data-yoyall="0">Select none</button>' +
    "</div>";
  const legend = data
    .map((d) => `<label class="yoyrow" data-proj="${d.id}"><input type="checkbox" class="yoychk" data-proj="${d.id}"${st.checked.has(d.id) ? " checked" : ""}><span class="yoysw" style="background:${d.color}"></span><span class="yoyname">${esc(d.name)}</span></label>`)
    .join("");
  // The same numbers as the chart, as a table (rows = checked projects, cols = Year 1–5), reading the
  // active series+stat. Squashed into this same box and driven by the toggles above — no separate control.
  const seriesLabel = st.series === "net" ? "net income" : "revenue";
  const statLabel = (METRICS.find((m) => m.k === st.stat) as { label: string }).label;
  const yearTable =
    `<p class="eyebrow" style="margin-top:20px">Year-by-year ${seriesLabel} · ${statLabel} · per model year</p>` +
    `<div class="tablecard"><div class="scroller"><table class="ov hz yoytable"><thead><tr>` +
    `<th class="l">Project</th>` +
    modelYears().map((y) => `<th>Year ${y}</th>`).join("") +
    `</tr></thead><tbody>` +
    (shown.length
      ? shown
          .map((d) => withCur(d.p, () => {
            const vals = valsOf(d);
            const cell = (v: number): string => `<td class="heatc" style="${heatVars(v)}"><span class="n">${fmt(v)}</span></td>`;
            const vlist = variants && variants[d.id];
            const hasVars = !!(vlist && vlist.length);
            const subs = hasVars
              ? vlist!.map((u, i) => {
                  const uv = (st.series === "net" ? u.r.yearNet || yoyZeros() : u.r.yearRevenue || yoyZeros()).map((s) => s[st.stat]);
                  return (
                    `<tr class="yoysub${i === vlist!.length - 1 ? " sublast" : ""}" data-subof="${d.id}" hidden><td class="l"><span class="ysubname namego" data-govar="${d.id}|${u.id}">${esc(u.name)}</span></td>` +
                    uv.map(cell).join("") +
                    `</tr>`
                  );
                }).join("")
              : "";
            return (
              `<tr class="yoytr${hasVars ? " hasvars" : ""}"${hasVars ? ` data-expand="${d.id}"` : ""} data-proj="${d.id}"><td class="l"><span class="oname namego" data-go="${d.id}"><span class="yoysw" style="background:${d.color};display:inline-block;vertical-align:middle;margin-right:6px"></span>${esc(d.name)}</span>${hasVars ? '<span class="ovtri" aria-hidden="true"></span>' : ""}</td>` +
              vals.map(cell).join("") +
              `</tr>` +
              subs
            );
          }))
          .join("")
      : `<tr><td class="l" colspan="${HORIZON_YEARS + 1}" style="color:var(--ink-faint)">No projects selected — check one or more in the legend above.</td></tr>`) +
    `</tbody></table></div></div>`;
  return (
    `<div class="yoytoggles">${seriesTog}${statTog}${bulk}</div>` +
    `<div class="yoybody"><div class="yoylegend">${legend}</div><div class="mlchartwrap">${svg}</div></div>` +
    yearTable
  );
}
