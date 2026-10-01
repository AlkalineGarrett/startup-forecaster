// GENERATED once from the hand-built artifact — the static template (CSS + interactive JS).
export const CSS = `
  * { box-sizing: border-box; }
  :root {
    --ground: #F3F6F6; --paper: #FFFFFF; --ink: #17211F; --muted: #566460; --faint: #869089;
    --line: #E2E8E6; --line-strong: #C7D2CF;
    --build: #1E8A80; --build-soft: #E0F0EE;
    --ops:   #46597A; --ops-soft:   #E9ECF3;
    --gate:  #BC3B2E; --gate-soft:  #F8E9E6;
    --pole:  #A83E6E; --pole-soft:  #F7E6EE;
    --lv5: #1A8A45; --lv4: #9CCB5B; --lv3: #F2C31D; --lv2: #F08E3C; --lv1: #D63A2A;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
  }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); line-height: 1.55; font-size: 16px; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1260px; margin: 0 auto; padding: clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 4vw, 2.5rem) 4rem; }
  .eyebrow { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); }

  header.masthead { border-bottom: 2px solid var(--ink); padding-bottom: 1.1rem; margin-bottom: 1.4rem; }
  h1 { font-size: clamp(1.7rem, 4vw, 2.4rem); font-weight: 760; letter-spacing: -0.025em; line-height: 1.08; margin: 0.35rem 0 0.6rem; }
  h1 .ff { color: var(--build); }
  .masthead .meta { display: flex; flex-wrap: wrap; gap: 0.4rem 1.1rem; align-items: baseline; font-family: var(--mono); font-size: 0.8rem; color: var(--muted); }
  .masthead .meta b { color: var(--ink); font-weight: 600; }

  .scale { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; margin: 0 0 0.9rem; font-size: 0.78rem; color: var(--muted); }
  .scale .s { display: inline-flex; align-items: center; gap: 0.35rem; }
  .lv { display: inline-flex; align-items: center; justify-content: center; width: 1.4em; height: 1.4em; border-radius: 4px; font-family: var(--mono); font-size: 0.72em; font-weight: 700; color: #fff; margin-right: 0.4em; vertical-align: -0.18em; flex: none; }
  .lv5 { background: var(--lv5); } .lv4 { background: var(--lv4); color: #22400F; } .lv3 { background: var(--lv3); color: #3A2E05; }
  .lv2 { background: var(--lv2); color: #4A2606; } .lv1 { background: var(--lv1); } .lv0 { background: #CDCFD4; color: #6B6E76; }

  .planlayout { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 1.1rem; align-items: start; }
  .detail-col { position: sticky; top: 1rem; }
  @media (max-width: 1040px) { .planlayout { grid-template-columns: 1fr; } .detail-col { position: static; } }

  /* calendar */
  .cal-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
  .cal-inner { position: relative; width: 100%; }
  svg.deplines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: visible; }
  svg.deplines > path { stroke: var(--build); fill: none; stroke-linecap: round; }
  svg.deplines > path.pinned { stroke-opacity: 0.20; stroke-width: 1.4; }
  svg.deplines > path.hover  { stroke-opacity: 0.92; stroke-width: 2.3; }
  .item.deptarget, .gitem.deptarget { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--build) 45%, transparent); }
  .item.deptarget-hover, .gitem.deptarget-hover { box-shadow: inset 0 0 0 2px var(--build); }
  table.cal { border-collapse: collapse; width: 100%; min-width: 470px; position: relative; }
  table.cal th, table.cal td { text-align: left; vertical-align: top; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--line); font-size: 0.82rem; }
  table.cal thead th { position: sticky; top: 0; background: var(--paper); font-size: 0.72rem; z-index: 3; }
  table.cal thead th.h-b { color: var(--build); border-bottom: 2px solid var(--build); }
  table.cal thead th.h-o { color: var(--ops); border-bottom: 2px solid var(--ops); }
  table.cal thead th.h-g { color: var(--pole); border-bottom: 2px solid var(--pole); }
  table.cal thead th.h-w { color: var(--faint); border-bottom: 2px solid var(--line-strong); }
  table.cal th .sub { display: block; font-family: var(--mono); font-size: 0.6rem; font-weight: 400; color: var(--faint); }
  table.cal td.wk { font-family: var(--mono); font-size: 0.76rem; color: var(--muted); white-space: nowrap; }
  table.cal td.wk b { display: block; color: var(--ink); font-size: 0.88rem; }
  table.cal td.c-b { background: color-mix(in srgb, var(--build-soft) 40%, transparent); }
  table.cal td.c-o { background: color-mix(in srgb, var(--ops-soft) 45%, transparent); }
  table.cal td.c-g { background: color-mix(in srgb, var(--pole-soft) 40%, transparent); }
  table.cal td.c-empty { background: #ECEEEF; }
  table.cal td .none { color: var(--faint); padding-left: 0.3rem; }

  .item { position: relative; display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 6px; font: inherit; font-size: 0.82rem; line-height: 1.3; color: var(--ink); cursor: pointer; padding: 0.3rem 0.35rem; margin: 0.1rem 0; }
  .item:hover { background: rgba(23,33,31,0.06); }
  .item.active { background: #fff; box-shadow: inset 3px 0 0 var(--build), 0 0 0 1px var(--line-strong); }
  .item .lv { margin-right: 0.4em; }

  tr.gaterow td { background: var(--ink); padding: 0; }
  .gitem { position: relative; display: block; width: 100%; text-align: left; background: none; border: 0; color: #fff; font: inherit; font-size: 0.8rem; cursor: pointer; padding: 0.5rem 0.7rem; }
  .gitem:hover { background: rgba(255,255,255,0.08); }
  .gitem.active { background: rgba(242,201,218,0.16); box-shadow: inset 3px 0 0 var(--pole); }
  .gitem .glab { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.09em; text-transform: uppercase; color: #F2C9DA; margin-right: 0.5em; font-weight: 700; }

  .detail-inner { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem 1.25rem; min-height: 220px; }
  .det .meta { font-family: var(--mono); font-size: 0.64rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); margin: 0 0 0.4rem; }
  .det h4 { margin: 0 0 0.55rem; font-size: 1.05rem; font-weight: 720; line-height: 1.2; }
  .det p { margin: 0.55rem 0 0; font-size: 0.9rem; color: var(--muted); }
  .det p:first-of-type { margin-top: 0; }
  .det p b { color: var(--ink); font-weight: 640; }
  .det ul, .det ol { margin: 0.4rem 0 0; padding-left: 1.15rem; }
  .det li { font-size: 0.88rem; color: var(--muted); margin: 0.22rem 0; }
  .det li b { color: var(--ink); font-weight: 640; }
  .det .term { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--build); font-weight: 700; }
  .det.gate h4 { color: var(--gate); } .det.gate .term { color: var(--gate); }
  .det-hint { color: var(--faint); font-style: italic; }
  .edge-b { border-left: 3px solid var(--build); padding-left: 0.7rem; } .edge-o { border-left: 3px solid var(--ops); padding-left: 0.7rem; }
  .edge-g { border-left: 3px solid var(--pole); padding-left: 0.7rem; } .edge-d { border-left: 3px solid var(--gate); padding-left: 0.7rem; }

  footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 0.72rem; color: var(--faint); line-height: 1.6; }
  b { font-weight: 640; }
  :focus-visible { outline: 2px solid var(--build); outline-offset: 1px; }
`;

export const JS = `
  (function () {
    var SVGNS = 'http://www.w3.org/2000/svg';
    var svg = document.querySelector('svg.deplines');
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-d]'));
    var dets = Array.prototype.slice.call(document.querySelectorAll('.det'));
    var byId = {};
    items.forEach(function (el) { byId[el.dataset.d] = el; });
    var narrow = window.matchMedia('(max-width: 900px)');
    var pinned = null, hover = null;

    function depsOf(id) {
      var el = byId[id]; if (!el) return [];
      var d = (el.dataset.deps || '').trim();
      return d ? d.split(/\\s+/) : [];
    }
    function centre(el) {
      var r = el.getBoundingClientRect(), s = svg.getBoundingClientRect();
      return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
    }
    function edgePoint(from, toEl) {
      var r = toEl.getBoundingClientRect(), s = svg.getBoundingClientRect();
      var T = { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
      var Dx = from.x - T.x, Dy = from.y - T.y;
      var ux = Dx !== 0 ? (r.width / 2) / Math.abs(Dx) : Infinity;
      var uy = Dy !== 0 ? (r.height / 2) / Math.abs(Dy) : Infinity;
      var u = Math.min(ux, uy, 1);
      return { x: T.x + Dx * u, y: T.y + Dy * u };
    }
    var MIN_ANGLE = 0.38; // ~22° minimum separation between lines leaving one task
    function drawEdge(S, toEl, phi, theta, cls) {
      // phi = fanned departure angle at the source; theta = true bearing to the target.
      var B = edgePoint(S, toEl);                 // arrow lands on the target's border
      var d = Math.hypot(B.x - S.x, B.y - S.y);
      var h = Math.max(22, d * 0.42);
      var c1x = S.x + Math.cos(phi) * h,   c1y = S.y + Math.sin(phi) * h;      // leave at the fanned angle
      var c2x = B.x - Math.cos(theta) * h * 0.6, c2y = B.y - Math.sin(theta) * h * 0.6; // arrive pointing into the target
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', 'M ' + S.x + ' ' + S.y + ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + B.x + ' ' + B.y);
      p.setAttribute('class', cls);
      p.setAttribute('marker-end', cls === 'hover' ? 'url(#ah-hover)' : 'url(#ah-pin)');
      svg.appendChild(p);
    }
    function drawFrom(srcId, cls, tcls) {
      var src = byId[srcId]; if (!src) return;
      var els = depsOf(srcId).map(function (t) { return byId[t]; }).filter(Boolean);
      if (!els.length) return;
      var S = centre(src);
      var arr = els.map(function (el) { var C = centre(el); return { el: el, theta: Math.atan2(C.y - S.y, C.x - S.x) }; });
      arr.sort(function (a, b) { return a.theta - b.theta; });
      // enforce a minimum angular gap between consecutive outgoing directions...
      var phi = arr.map(function (a) { return a.theta; });
      for (var i = 1; i < phi.length; i++) { if (phi[i] < phi[i - 1] + MIN_ANGLE) phi[i] = phi[i - 1] + MIN_ANGLE; }
      // ...then recenter the fan on the bundle's natural mean (so it spreads symmetrically).
      var mt = 0, mp = 0; for (var k = 0; k < arr.length; k++) { mt += arr[k].theta; mp += phi[k]; }
      var shift = (mt - mp) / arr.length;
      for (var j = 0; j < phi.length; j++) phi[j] += shift;
      arr.forEach(function (a, idx) { drawEdge(S, a.el, phi[idx], a.theta, cls); a.el.classList.add(tcls); });
    }
    function render() {
      Array.prototype.slice.call(svg.children).forEach(function (c) { if (c.tagName === 'path' || c.tagName === 'line') svg.removeChild(c); });
      items.forEach(function (el) { el.classList.remove('deptarget', 'deptarget-hover'); });
      if (pinned) drawFrom(pinned, 'pinned', 'deptarget');
      if (hover) drawFrom(hover, 'hover', 'deptarget-hover');
    }
    var GAP = 7; // px: a dependency's bottom must clear the depender's top by this much
    function relayout() {
      items.forEach(function (el) { if (!el.classList.contains('gitem')) el.style.marginTop = ''; });
      for (var pass = 0; pass < 8; pass++) {
        var moved = false;
        items.forEach(function (x) {
          if (x.classList.contains('gitem')) return;
          var ds = depsOf(x.dataset.d);
          if (!ds.length) return;
          var xr = x.getBoundingClientRect();
          var need = 0;
          ds.forEach(function (id) {
            var y = byId[id]; if (!y || y.classList.contains('gitem')) return;
            var yr = y.getBoundingClientRect();
            var deficit = (yr.bottom + GAP) - xr.top; // require the dependency fully above the depender
            if (deficit > need) need = deficit;
          });
          if (need > 0.5) {
            var cur = parseFloat(x.style.marginTop) || 0;
            x.style.marginTop = (cur + need) + 'px';
            moved = true;
          }
        });
        if (!moved) break;
      }
      render();
    }
    function showDetail(id) {
      var target = 'd-' + id;
      dets.forEach(function (d) { d.hidden = (d.id !== target); });
      items.forEach(function (i) { i.classList.toggle('active', i.dataset.d === id); });
      if (narrow.matches) { document.getElementById('detail-box').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
    items.forEach(function (el) {
      el.addEventListener('mouseenter', function () { hover = el.dataset.d; render(); });
      el.addEventListener('mouseleave', function () { hover = null; render(); });
      el.addEventListener('focus', function () { hover = el.dataset.d; render(); });
      el.addEventListener('blur', function () { hover = null; render(); });
      el.addEventListener('click', function () { pinned = el.dataset.d; showDetail(pinned); render(); });
    });
    var raf = 0;
    function scheduleRender() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; render(); }); }
    var rlf = 0;
    function scheduleRelayout() { if (rlf) return; rlf = requestAnimationFrame(function () { rlf = 0; relayout(); }); }
    window.addEventListener('resize', scheduleRelayout);
    var scroller = document.querySelector('.cal-scroll');
    if (scroller) scroller.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('load', relayout);
    relayout();
  })();
`;
