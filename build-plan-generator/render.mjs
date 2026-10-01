// Build-plan page renderer (project-neutral).
//
// Usage:  node render.mjs <spec.mjs> [out.html]
//   <spec.mjs>  a data module exporting META, STEPS, SOURCES (see example.mjs)
//   [out.html]  output path (default: <specName>-build-plan.html next to the spec)
//
// Output is an Artifact-ready fragment: <title> + inline <style> + page content
// (no <html>/<head>/<body> — the claude.ai Artifact wrapper adds those). It also
// renders fine opened directly in a browser.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- small helpers ----------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Spec strings intentionally carry inline HTML (<b>, <code>, <i>, badges), so most
// fields are emitted verbatim. esc() is used only for plain-text attribute values.

// ---------- competitive-comparison engine (ported from the original pipeline) ----------
const GRPRANK = { edge: 0, shared: 1, temp: 2, gap: 3 };
const IMPLBL = { 4: 'Definitional', 3: 'High', 2: 'Medium', 1: 'Low' };

function grpLabels(product) {
  return { edge: `${product} edge`, shared: 'Shared', temp: 'Temporary gap', gap: `${product} gap` };
}

// a competitor is an "adjacent substitute" if it lacks any definitional (imp 4) feature
function adjacentSet(features, self) {
  const universe = new Set();
  for (const f of features) for (const p of f.products) if (p !== self) universe.add(p);
  const defsets = features
    .filter((f) => f.importance === 4)
    .map((f) => new Set(f.products.filter((p) => p !== self)));
  const adj = new Set();
  for (const c of universe) if (defsets.some((ds) => !ds.has(c))) adj.add(c);
  return adj;
}

function badge(name, cmap, adj, major, self) {
  if (name === self) return `<span class="pb tb">${name}</span>`;
  const cls = `pb ${cmap.get(name)}${adj.has(name) ? ' adj' : ''}${major.has(name) ? ' maj' : ''}`;
  const tips = [];
  if (major.has(name)) tips.push('dominant player in this market');
  if (adj.has(name)) tips.push('adjacent substitute — lacks a definitional feature of this category');
  const tip = tips.length ? ` title="${esc(tips.join(' · '))}"` : '';
  return `<span class="${cls}"${tip}>${name}</span>`;
}

function impGlyph(n) {
  if (n === 4)
    return '<span class="imp impd" title="Definitional — the product isn’t of this category without it"><i></i><i></i><i></i><i></i></span>';
  return `<span class="imp imp${n}" title="${IMPLBL[n]} importance"><i></i><i></i><i></i></span>`;
}

function buildCompet(c) {
  const chips = c.competitors.map((x) => `<span class="cc">${x}</span>`).join('');
  return (
    `<div class="compet ${c.ratingClass}"><div class="cv-head">Competitive position</div>` +
    `<span class="cv-verdict">${c.verdict}</span>` +
    `<div class="cv-row"><span class="cv-k">vs</span><span class="cv-chips">${chips}</span></div>` +
    `<div class="cv-row"><span class="cv-k">Edge</span><span class="cv-edge">${c.edge}</span></div>` +
    `<div class="cv-row"><span class="cv-k">Read</span><span class="cv-edge cv-read">${c.read}</span></div></div>`
  );
}

function fcmpBlock(c, self) {
  const GRPLBL = grpLabels(self);
  const later = c.gapLater || {};
  const major = new Set(c.major || []);
  const adj = adjacentSet(c.features, self);

  // per-card competitor colors c1..c8 by first appearance
  const cmap = new Map();
  let n = 0;
  for (const f of c.features)
    for (const p of f.products)
      if (p !== self && !cmap.has(p)) cmap.set(p, `c${++n}`);
  if (n > 8) throw new Error(`too many competitors: ${n}`);

  const eg = (f) => (f.group === 'gap' && f.feature in later ? 'temp' : f.group);
  const rows = [...c.features].sort((a, b) => GRPRANK[eg(a)] - GRPRANK[eg(b)] || b.importance - a.importance);

  const out = [
    '        <div class="fcmp">',
    '          <div class="fcmp-h"><span class="fcmp-t">Feature comparison · who ships what</span></div>',
  ];
  let last = null;
  for (const f of rows) {
    const g = eg(f);
    if (g !== last) {
      const cnt = c.features.filter((x) => eg(x) === g).length;
      out.push(`          <div class="fcmp-grp ${g}"><span class="gl">${GRPLBL[g]}</span><span class="gc">${cnt}</span></div>`);
      last = g;
    }
    const ftag = g === 'temp' ? `<span class="gfate">→ step ${later[f.feature]}</span>` : '';
    const deftag = f.importance === 4 ? '<span class="dfx">core</span>' : '';
    const fcls = f.importance === 4 ? 'fcmp-f def' : 'fcmp-f';
    const badges = f.products.map((p) => badge(p, cmap, adj, major, self)).join('');
    out.push(
      `          <div class="fcmp-row ${g}"><div class="${fcls}">${impGlyph(f.importance)}${f.feature}${deftag}${ftag}</div><div class="fcmp-b">${badges}</div></div>`
    );
  }
  out.push('        </div>');
  return '\n' + out.join('\n');
}

// ---------- step + page rendering ----------
function renderDefinition(d) {
  if (!d) return '';
  return (
    `        <p class="step-fit"><b>${d.type}</b> — ${d.summary}` +
    `<br><b>Core:</b> ${d.core}<br><b>Moats:</b> ${d.moats}</p>\n`
  );
}

function renderSize(size) {
  return /^(S|M|L|XL)$/.test(size) ? `<span class="sz ${size}">${size}</span>` : size;
}

function renderItem(it) {
  const tr = it.row ? `<tr class="${it.row}">` : '<tr>';
  const fu = it.chip ? `<span class="fchip ${it.chip}">${it.code}</span>` : '—';
  const bullets = it.bullets.map((b) => `\n            <li>${b}</li>`).join('');
  return (
    `          ${tr}<td class="fu">${fu}</td><td class="fw"><b>${it.name}</b><ul>${bullets}\n          </ul></td>` +
    `<td class="fs">${renderSize(it.size)}</td></tr>`
  );
}

function renderFeatureTable(groups) {
  if (!groups || !groups.length) return '';
  const rows = [];
  for (const g of groups) {
    if (g.label !== null && g.label !== undefined) {
      const cls = g.mod ? `ftg ${g.mod}` : 'ftg';
      rows.push(`          <tr class="${cls}"><td colspan="3">${g.label}</td></tr>`);
    }
    for (const it of g.items) rows.push(renderItem(it));
  }
  return `        <table class="ftab">\n${rows.join('\n')}\n        </table>\n`;
}

function renderStep(step, self) {
  const cls = step.variant ? `step ${step.variant}` : 'step';
  const size = step.size ? `<span class="ssize ${step.size}">${step.size}</span>` : '';
  const unlk = step.unlockersHtml ? `<span class="unlk">${step.unlockersHtml}</span>` : '';
  let s = `      <article class="${cls}">\n`;
  s += `        <div class="step-h"><span class="step-n">${step.n}</span><h3>${step.title}</h3>${unlk}${size}</div>\n`;
  s += renderDefinition(step.definition);
  s += renderFeatureTable(step.featureGroups);
  if (step.noteHtml) s += `        <p class="step-note">${step.noteHtml}</p>\n`;
  if (step.competitive) {
    s += `        ${buildCompet(step.competitive)}`;
    s += fcmpBlock(step.competitive, self);
    s += '\n';
  }
  s += '      </article>';
  return s;
}

function renderSources(sources, intro) {
  if (!sources || !sources.length) return '';
  const details = sources
    .map((m) => {
      const items = m.items.map((i) => `<li><a href="${esc(i.url)}">${i.url}</a> — ${i.label}</li>`).join('');
      return (
        `      <details><summary>${m.market}<span class="n">${m.items.length} sources</span></summary>\n` +
        `        <ul>${items}</ul>\n      </details>\n`
      );
    })
    .join('');
  return (
    '<section>\n  <div class="wrap">\n    <div class="sec-h"><h2>Sources</h2></div>\n' +
    '    <div class="srcs">\n' +
    (intro ? `      <p class="sh">${intro}</p>\n` : '') +
    details +
    '    </div>\n  </div>\n</section>\n'
  );
}

export function renderPage({ META, STEPS, SOURCES }, css) {
  const self = META.productName;
  const steps = STEPS.map((st) => renderStep(st, self)).join('\n\n');
  const header =
    '<header>\n  <div class="wrap">\n' +
    (META.eyebrow ? `    <div class="eyebrow">${META.eyebrow}</div>\n` : '') +
    `    <h1>${META.h1}</h1>\n  </div>\n</header>`;
  const sequence =
    '<section>\n  <div class="wrap">\n' +
    `    <div class="sec-h"><h2>The sequence</h2>${META.sequenceTag ? `<span class="n">${META.sequenceTag}</span>` : ''}</div>\n` +
    '    <div class="steps">\n\n' +
    steps +
    '\n\n    </div>\n  </div>\n</section>';
  const sources = renderSources(SOURCES, META.sourcesIntro);
  const footer = META.footerHtml
    ? `<footer>\n  <div class="wrap">${META.footerHtml}</div>\n</footer>`
    : '';

  return (
    `<title>${META.docTitle}</title>\n` +
    `<style>\n${css}</style>\n\n` +
    header +
    '\n\n' +
    sequence +
    '\n\n' +
    sources +
    '\n' +
    footer +
    '\n'
  );
}

// ---------- CLI ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const specArg = process.argv[2];
  if (!specArg) {
    console.error('usage: node render.mjs <spec.mjs> [out.html]');
    process.exit(1);
  }
  const specPath = resolve(process.cwd(), specArg);
  const spec = await import(pathToFileURL(specPath).href);
  if (!spec.META || !spec.STEPS) {
    console.error('spec must export META and STEPS (and optionally SOURCES)');
    process.exit(1);
  }
  const css = readFileSync(join(HERE, 'build-plan.css'), 'utf8');
  const html = renderPage({ META: spec.META, STEPS: spec.STEPS, SOURCES: spec.SOURCES || [] }, css);
  const out =
    process.argv[3] ||
    join(dirname(specPath), basename(specArg).replace(/\.mjs$/, '') + '-build-plan.html');
  writeFileSync(out, html);
  const withCompet = spec.STEPS.filter((s) => s.competitive).length;
  console.log(`wrote ${out}`);
  console.log(`steps: ${spec.STEPS.length} (${withCompet} with competitive) · sources: ${(spec.SOURCES || []).length}`);
}
