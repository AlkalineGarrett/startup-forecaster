# Execution-plan artifact generator

Interactive execution-plan artifacts are **generated from structured data**, not hand-edited: a
dependency-aware calendar of tasks by phase with a linked detail pane, rendered to a self-contained
HTML page. One template renders any plan; edit the data, run the build. A fictional example ships in
`data-example.mjs`.

## Files

| File | Role | Edit it? |
|---|---|---|
| `data-<plan>.mjs` | A plan's content — meta, scale, calendar rows (weeks + gates), tasks, and detail panels. Optional `themeCSS` for a per-plan palette. | **Yes — this is the source of truth.** |
| `render.mjs` | Template. Turns a data object into the full HTML page (exports `render(data)`). | Only to change structure/markup. |
| `assets.mjs` | The static template: the CSS and the interactive JS (dependency overlay, downward relayout, click-to-detail). | Rarely — for styling or interaction changes. |
| `build.mjs` | CLI. Renders a data module to HTML. | Rarely. |

## Rebuild

```
node build.mjs                          # render the example -> execution-plan-example.html
node build.mjs data-example.mjs         # explicit data file
node build.mjs data-myplan.mjs out.html # explicit output path
node build.mjs data-myplan.mjs --check  # dry run: prints size, writes nothing
```

Consuming it from another repo (your real plans stay private): add `exec-plan-generator` as a
dependency and `import { render } from 'exec-plan-generator/render.mjs'`, then write the HTML for each
of your own `data-*.mjs` modules.

## Add a new plan

1. Copy `data-example.mjs` to `data-<name>.mjs`; keep the data shape below.
2. `node build.mjs data-<name>.mjs`.

Set `themeCSS` in the data to a `:root{ --build/--ops/--pole (+ their -soft) }` override to give the
plan its own accent triad (the tinted columns); omit it to inherit the default teal.

## Data shape

```js
{
  titleTag, eyebrow, h1, footer, tailHtml, defaultHint,   // page chrome (raw HTML allowed)
  meta:    [ [label, text], ... ],                        // masthead key/value line
  scale:   [ { lv:"5", label }, ... ],                    // 1–5 work-desirability legend ("0" = the · glyph)
  columns: [ { key:"b", head:"Product", sub }, ... ],     // b / o / g -> the c-b / c-o / c-g tinted columns
  rows: [
    { type:"week", label:"Wk 1", dates, cells: { b:[task], o:[task], g:[task] } },
    { type:"gate", id:"g0", label:"Gate 0 — ..." },       // full-width decision bar
  ],
  details: [ { id, cls:"det edge-o", meta, title, body:[block] }, ... ],  // one per task + gate
}

// task  = { id, lv:"5", label, deps:["w1p1", ...] }   deps = 1-level-deep prerequisite ids
// block = { p } | { term, text } | { ul:[...] } | { ol:[...] }
```

## Rules baked into the template / JS (not the data)

- **Dependencies** are the `deps` arrays. Hover a task → dark curved arrows to its
  prerequisites; click → they persist faint. Lines leaving a task fan to a minimum
  angle and curve to land (arrow-first) on each target's border.
- **Decision gates are implicit** — never list a gate id in any `deps` array, and
  gates carry no deps of their own. The JS ignores gates as edge endpoints.
- **Dependencies sit above their dependers** — the relayout pass nudges any depender
  down until every prerequisite clears it, so arrows always point upward. This is
  automatic; you don't encode positions.
