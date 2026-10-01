// Shared multi-line year chart (Year 1 → Year 5), used by BOTH the Overview "year over year · all
// projects" overlay and the per-project "Compare all" pivot overlay — so they look and behave identically
// (same dimensions, label sizing, colours-by-caller, and hover spotlight). Each line is a
// `<g class="mlline" data-mlkey>` containing a polyline, per-year dots, and per-year value labels that are
// hidden (opacity 0) until the line is spotlighted on hover. All styling lives in `svg.mlchart` CSS; the
// client's mlSpotlight/mlNearest (client.mjs + app.ts) drive the hover on the shared markup.
import { fmt, esc } from "../format.ts";
import { HORIZON_YEARS } from "../types.ts";

export interface MLLine {
  key: string; // stable id (project id or variant/unit id) — the data-mlkey the hover + checkboxes target
  color: string; // caller-supplied hue
  cur?: string; // per-line currency for the value labels (Overview is mixed-currency); omit → ambient
  values: number[]; // one value per model year (length 5)
}

/** The SHARED chart-card shell used by EVERY line chart (Overview YoY, per-project year chart, and the
 *  Compare-all overlay) so their layout can't drift: a caption, one controls row, then a flex body with the
 *  checkbox legend on the LEFT and the chart(s) on the right, and an optional table beneath. Callers supply
 *  already-built HTML for each slot; the interaction (hover spotlight + line checkboxes) is wired once in
 *  client.mjs/app.ts against the shared `.yoybody` / `.yoyrow` / `.mlchk` markup. */
export function chartBox(o: { cap: string; controls: string; legend: string; chart: string; cardClass?: string; table?: string }): string {
  return (
    `<div class="card yearcard mlbox${o.cardClass ? " " + o.cardClass : ""}">` +
    `<div class="cap">${o.cap}</div>` +
    (o.controls ? `<div class="yoytoggles">${o.controls}</div>` : "") +
    `<div class="yoybody"><div class="yoylegend">${o.legend}</div><div class="mlchartwrap">${o.chart}</div></div>` +
    (o.table || "") +
    `</div>`
  );
}

/** A single legend row for the shared chart box: a checkbox that toggles the line (`.mlchk` → pure-DOM
 *  show/hide of the matching `.mlline`), a colour swatch, and the label. `key` is the line's data-mlkey. */
export function mlLegendRow(key: string, color: string, label: string, checked = true): string {
  return (
    `<label class="yoyrow" data-mlkey="${esc(key)}"><input type="checkbox" class="mlchk" data-mlkey="${esc(key)}"${checked ? " checked" : ""}>` +
    `<span class="yoysw" style="background:${color}"></span><span class="yoyname">${esc(label)}</span></label>`
  );
}

/** Render the overlay SVG. `extra` appends an extra svg class (e.g. "yoychart") for caller-specific layout. */
export function multiLineChartSVG(lines: MLLine[], extra = ""): string {
  const W = 900, H = 300, ml = 72, mr = 18, mt = 20, mb = 34;
  let vMax = 0, vMin = 0;
  for (const l of lines) for (const v of l.values) { if (v > vMax) vMax = v; if (v < vMin) vMin = v; }
  if (vMax === vMin) vMax = vMin + 1;
  const span = vMax - vMin || 1;
  const X = (y: number): number => ml + (y / 4) * (W - ml - mr);
  const Y = (v: number): number => H - mb - ((v - vMin) / span) * (H - mt - mb);
  let svg = `<svg class="mlchart${extra ? " " + extra : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  // Light-red wash + dashed zero line over the negative region, behind the lines.
  if (vMin < 0) svg += `<rect class="negband" x="${ml}" y="${Y(0).toFixed(1)}" width="${(W - mr - ml).toFixed(1)}" height="${(H - mb - Y(0)).toFixed(1)}" fill="rgba(191,74,62,0.12)"/>`;
  if (vMin < 0) svg += `<line class="zero" x1="${ml}" y1="${Y(0).toFixed(1)}" x2="${W - mr}" y2="${Y(0).toFixed(1)}"/>`;
  svg += `<line class="ax" x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}"/>`;
  svg += `<line class="ax" x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}"/>`;
  const yt = (v: number): string => `<text class="axl" x="${ml - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;
  svg += yt(vMax) + yt(vMin) + (vMin < 0 ? yt(0) : "");
  for (let y = 0; y < HORIZON_YEARS; y++) svg += `<text class="axl" x="${X(y).toFixed(1)}" y="${H - mb + 15}" text-anchor="middle">Year ${y + 1}</text>`;
  for (const l of lines) {
    const pts = l.values.map((v, y) => `${X(y).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    svg += `<g class="mlline" data-mlkey="${esc(l.key)}">`;
    svg += `<polyline class="mlstroke" style="fill:none;stroke:${l.color}" points="${pts}"/>`;
    l.values.forEach((v, y) => { svg += `<circle class="mldot" style="fill:${l.color}" cx="${X(y).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2"/>`; });
    l.values.forEach((v, y) => { svg += `<text class="mlvl" x="${X(y).toFixed(1)}" y="${(Y(v) - 8).toFixed(1)}" text-anchor="middle" style="fill:${l.color}">${fmt(v, l.cur)}</text>`; });
    svg += `</g>`;
  }
  return svg + "</svg>";
}
