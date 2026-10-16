// Template renderer for the interactive execution-plan page.
// Static template = CSS + interactive JS (in assets.mjs); everything else is
// generated from the structured plan data. Edit the data file, not the output.
import { CSS, JS } from './assets.mjs';

// The template has three tinted column styles (palette slots), assigned to the data's columns in
// order: slot b = --build, o = --ops, g = --pole. Column keys are free-form.
const SLOTS = ['b', 'o', 'g'];

const lvGlyph = (lv) => (lv === '0' ? '·' : lv);

const STATUS_CSS = `.item.st-done,.item.st-dropped{opacity:.5}
.item.st-done{text-decoration:line-through;text-decoration-thickness:1px}
.item.st-dropped{text-decoration:line-through dotted}
.item.st-in_progress{box-shadow:inset 3px 0 0 currentColor}
.item.st-blocked{outline:1.5px dashed #B3443A;outline-offset:-1.5px}
.gitem.st-decided{opacity:.6}
.det .status{font-family:var(--mono);font-size:.72rem;margin:.15rem 0 .35rem;color:var(--ink,#222)}`;

// The dependency-line SVG overlay + its arrowhead markers are structural, not data.
const SVG_DEFS = `<svg class="deplines" aria-hidden="true"><defs>
            <marker id="ah-hover" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1E8A80" fill-opacity="0.92"></path></marker>
            <marker id="ah-pin" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1E8A80" fill-opacity="0.28"></path></marker>
          </defs></svg>`;

// Optional progress status (from a task store): todo/open render exactly as before; anything else adds a
// st-<status> class (styled by STATUS_CSS, appended only when some status is in use).
const stCls = (s) => (s && s !== 'todo' && s !== 'open' ? ` st-${s}` : '');

function task(t) {
  return `<button class="item${stCls(t.status)}" data-d="${t.id}" data-deps="${(t.deps || []).join(' ')}"><span class="lv lv${t.lv}">${lvGlyph(t.lv)}</span>${t.label}</button>`;
}

function cell(slot, tasks) {
  if (!tasks || !tasks.length) return '<td class="c-empty"><span class="none">—</span></td>';
  const inner = tasks.map(task).join('\n                  ');
  return `<td class="c-${slot}">\n                  ${inner}\n                </td>`;
}

function row(r, columns) {
  if (r.type === 'gate') {
    return `<tr class="gaterow"><td></td><td colspan="${columns.length}"><button class="gitem${stCls(r.status)}" data-d="${r.id}" data-deps=""><span class="glab">Decision</span>${r.label}</button></td></tr>`;
  }
  const cells = columns.map((c) => cell(c.slot, r.cells[c.key])).join('\n                ');
  return `<tr>\n                <td class="wk"><b>${r.label}</b>${r.dates}</td>\n                ${cells}\n              </tr>`;
}

function block(b) {
  if (b.p !== undefined) return `<p>${b.p}</p>`;
  if (b.term !== undefined) return `<p><span class="term">${b.term}</span>${b.text ? ' ' + b.text : ''}</p>`;
  if (b.ul) return `<ul>${b.ul.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  if (b.ol) return `<ol>${b.ol.map((i) => `<li>${i}</li>`).join('')}</ol>`;
  return '';
}

function detail(d, slotOf) {
  if (!d.gate && d.column !== undefined && !slotOf[d.column]) throw new Error(`detail ${d.id}: unknown column "${d.column}"`);
  const cls = d.gate ? 'det gate edge-d' : d.column !== undefined ? `det edge-${slotOf[d.column]}` : 'det';
  const status = d.status ? `<div class="status">${d.status}</div>` : '';
  return `<div class="${cls}" id="d-${d.id}" hidden><div class="meta">${d.meta}</div>${status}<h4>${d.title}</h4>${d.body.map(block).join('')}</div>`;
}

/** Render a plan to HTML: a full document by default, or with `{ fragment: true }` only
 *  <title> + <style> + the page content, for a host that supplies its own <html>/<head>/<body>. */
export function render(data, { fragment = false } = {}) {
  if (data.columns.length > SLOTS.length) throw new Error(`at most ${SLOTS.length} columns (got ${data.columns.length})`);
  const columns = data.columns.map((c, i) => ({ ...c, slot: SLOTS[i] }));
  const slotOf = Object.fromEntries(columns.map((c) => [c.key, c.slot]));
  const metaSpans = data.meta.map(([l, t]) => `<span><b>${l}</b> ${t}</span>`).join('\n      ');
  const scaleSpans = data.scale.map((s) => `<span class="s"><span class="lv lv${s.lv}">${lvGlyph(s.lv)}</span> ${s.label}</span>`).join('\n    ');
  const heads = columns.map((c) => `<th class="h-${c.slot}">${c.head} <span class="sub">${c.sub}</span></th>`).join('\n                ');
  const rowsHtml = data.rows.map((r) => row(r, columns)).join('\n              ');
  const detailsHtml = data.details.map((d) => detail(d, slotOf)).join('\n\n        ');

  // Optional per-plan palette override (e.g. a blue plan beside a teal one).
  // Appended after the base CSS so its :root vars win. Absent -> the default theme.
  const theme = data.themeCSS ? `\n${data.themeCSS}` : '';
  const usesStatus = data.rows.some((r) => (r.type === 'gate' ? stCls(r.status) : Object.values(r.cells).flat().some((t) => stCls(t.status))))
    || data.details.some((d) => d.status);
  const statusCss = usesStatus ? `\n${STATUS_CSS}` : '';

  const head = `<title>${data.titleTag}</title>
<style>${CSS}${theme}${statusCss}</style>
`;
  const body = `<div class="wrap">

  <header class="masthead">
    ${data.eyebrow ? `<div class="eyebrow">${data.eyebrow}</div>\n    ` : ''}<h1>${data.h1}</h1>
    <div class="meta">
      ${metaSpans}
    </div>
  </header>

  <div class="scale">
    ${scaleSpans}
  </div>

  <div class="planlayout">
    <div class="cal-col">
      <div class="cal-scroll">
        <div class="cal-inner">
          ${SVG_DEFS}
          <table class="cal">
            <thead>
              <tr>
                <th class="h-w">Week</th>
                ${heads}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
      ${data.tailHtml}
    </div>

    <aside class="detail-col">
      <div class="detail-inner" id="detail-box">
        <div class="det" id="det-default">${data.defaultHint ? `<p class="det-hint">${data.defaultHint}</p>` : ''}</div>

        ${detailsHtml}
      </div>
    </aside>
  </div>

  ${data.footer ? `<footer>\n    ${data.footer}\n  </footer>\n` : ''}
</div>

<script>${JS}</script>
`;
  if (fragment) return `${head}\n${body}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}</head>
<body>
${body}</body>
</html>
`;
}
