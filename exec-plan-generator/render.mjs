// Template renderer for the interactive execution-plan artifact.
// Static template = CSS + interactive JS (in assets.mjs); everything else is
// generated from the structured plan data. Edit the data file, not the output.
import { CSS, JS } from './assets.mjs';

const lvGlyph = (lv) => (lv === '0' ? '·' : lv);

// The dependency-line SVG overlay + its arrowhead markers are structural, not data.
const SVG_DEFS = `<svg class="deplines" aria-hidden="true"><defs>
            <marker id="ah-hover" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1E8A80" fill-opacity="0.92"></path></marker>
            <marker id="ah-pin" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#1E8A80" fill-opacity="0.28"></path></marker>
          </defs></svg>`;

function task(t) {
  return `<button class="item" data-d="${t.id}" data-deps="${(t.deps || []).join(' ')}"><span class="lv lv${t.lv}">${lvGlyph(t.lv)}</span>${t.label}</button>`;
}

function cell(key, tasks) {
  if (!tasks || !tasks.length) return '<td class="c-empty"><span class="none">—</span></td>';
  const inner = tasks.map(task).join('\n                  ');
  return `<td class="c-${key}">\n                  ${inner}\n                </td>`;
}

function row(r, columns) {
  if (r.type === 'gate') {
    return `<tr class="gaterow"><td></td><td colspan="3"><button class="gitem" data-d="${r.id}" data-deps=""><span class="glab">Decision</span>${r.label}</button></td></tr>`;
  }
  const cells = columns.map((c) => cell(c.key, r.cells[c.key])).join('\n                ');
  return `<tr>\n                <td class="wk"><b>${r.label}</b>${r.dates}</td>\n                ${cells}\n              </tr>`;
}

function block(b) {
  if (b.p !== undefined) return `<p>${b.p}</p>`;
  if (b.term !== undefined) return `<p><span class="term">${b.term}</span>${b.text ? ' ' + b.text : ''}</p>`;
  if (b.ul) return `<ul>${b.ul.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  if (b.ol) return `<ol>${b.ol.map((i) => `<li>${i}</li>`).join('')}</ol>`;
  return '';
}

function detail(d) {
  return `<div class="${d.cls}" id="d-${d.id}" hidden><div class="meta">${d.meta}</div><h4>${d.title}</h4>${d.body.map(block).join('')}</div>`;
}

export function render(data) {
  const metaSpans = data.meta.map(([l, t]) => `<span><b>${l}</b> ${t}</span>`).join('\n      ');
  const scaleSpans = data.scale.map((s) => `<span class="s"><span class="lv lv${s.lv}">${lvGlyph(s.lv)}</span> ${s.label}</span>`).join('\n    ');
  const heads = data.columns.map((c) => `<th class="h-${c.key}">${c.head} <span class="sub">${c.sub}</span></th>`).join('\n                ');
  const rowsHtml = data.rows.map((r) => row(r, data.columns)).join('\n              ');
  const detailsHtml = data.details.map(detail).join('\n\n        ');

  // Optional per-plan palette override (e.g. a blue plan beside a teal one).
  // Appended after the base CSS so its :root vars win. Absent -> the default theme.
  const theme = data.themeCSS ? `\n${data.themeCSS}` : '';

  return `<title>${data.titleTag}</title>
<style>${CSS}${theme}</style>

<div class="wrap">

  <header class="masthead">
    <div class="eyebrow">${data.eyebrow}</div>
    <h1>${data.h1}</h1>
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
        <div class="det" id="det-default"><p class="det-hint">${data.defaultHint}</p></div>

        ${detailsHtml}
      </div>
    </aside>
  </div>

  <footer>
    ${data.footer}
  </footer>

</div>

<script>${JS}</script>
`;
}
