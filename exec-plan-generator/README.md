# Execution-plan generator

Interactive execution-plan pages are **generated from structured data**, not hand-edited: a
dependency-aware calendar of tasks by phase with a linked detail pane, rendered to a self-contained
HTML document. One template renders any plan; edit the data, run the build. A fictional example ships in
`data-example.mjs`.

> **Doing this as a step?** Read its step doc first: [`plan-execution.md`](plan-execution.md) (step `plan-execution`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## Files

| File | Role | Edit it? |
|---|---|---|
| `data-<plan>.mjs` | A plan's content — meta, scale, calendar rows (weeks + gates), tasks, and detail panels. Optional `themeCSS` for a per-plan palette. | **Yes — this is the source of truth.** |
| `render.mjs` | Template. Turns a data object into the HTML page (exports `render(data, { fragment })`). | Only to change structure/markup. |
| `assets.mjs` | The static template: the CSS and the interactive JS (dependency overlay, downward relayout, click-to-detail). | Rarely — for styling or interaction changes. |
| `build.mjs` | CLI (`npx startup-forecaster exec-plan`). Renders a data module to HTML. | Rarely. |
| `test/` | Render tests (`npm test`). | When the template changes. |

## Render

```
npx startup-forecaster exec-plan data-myplan.mjs              # -> execution-plan-myplan.html next to the data
npx startup-forecaster exec-plan data-myplan.mjs out.html     # explicit output path
npx startup-forecaster exec-plan data-myplan.mjs --fragment   # bare fragment instead of a full document
npx startup-forecaster exec-plan data-myplan.mjs --check      # dry run: prints size, writes nothing
```

The output is a full HTML document (doctype, charset, inline CSS and JS), ready to open in a browser,
publish or share. `--fragment` (or `render(data, { fragment: true })`) emits only `<title>` + `<style>`
+ the page content, for a host that supplies its own `<html>/<head>/<body>`.

To render from your own code (e.g. plans kept in a different data format), import the template from the
package — `import { render } from 'startup-forecaster/exec-plan-generator/render.mjs'` — and write
`render(data)` for each plan.

## Add a new plan

1. Copy `data-example.mjs` to `data-<name>.mjs`; keep the data shape below.
2. `npx startup-forecaster exec-plan data-<name>.mjs`.

Set `themeCSS` in the data to a `:root{ --build/--ops/--pole (+ their -soft) }` override to give the
plan its own accent triad (the tinted columns, in that order); omit it to inherit the default teal.

## Data shape

```js
{
  titleTag, eyebrow, h1, footer, tailHtml, defaultHint,   // page chrome (raw HTML allowed)
  meta:    [ [label, text], ... ],                        // masthead key/value line
  scale:   [ { lv:"5", label }, ... ],                    // 1–5 priority legend ("0" = the · glyph)
  columns: [ { key:"build", head:"Build", sub }, ... ],   // at most 3; keys are free-form, tinted by
                                                          // position (1st --build, 2nd --ops, 3rd --pole)
  rows: [
    { type:"week", label:"Wk 1", dates, cells: { build:[task], ops:[task] } },  // cells keyed by column key
    { type:"gate", id:"g0", label:"Gate 0 — ..." },       // full-width decision bar
  ],
  details: [ { id, column:"ops", meta, title, body:[block] }, ... ],  // one per task + gate;
                                                          // a gate's detail has gate:true instead of column
}

// task  = { id, lv:"5", label, deps:["w1p1", ...], status? }   deps = 1-level-deep prerequisite ids
// block = { p } | { term, text } | { ul:[...] } | { ol:[...] }
//
// Optional progress (e.g. from a task store): task.status in_progress | done | blocked | dropped,
// gate row status "decided", and detail.status (a one-line status shown under the meta line).
// todo / open / absent render with no status styling; the status CSS is appended only when used.
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
