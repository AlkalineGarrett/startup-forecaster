# Step `render-forecast`: render the forecast as pages people can explore and share

> **Required reading before this step's first action:** this whole file, and the layout in
> [`README.md`](README.md). They are part of the step, not background: pages made without them may show
> wrong or stale numbers.

**Input:** a simulation that has passed `audit-simulation`.

**Done when:** the person has the pages or views they asked for, built from the current simulation; every
venture whose forecast changed has a current brief; and the checks in the procedure hold.

**Next:** none: the forecast is complete. `plan-build` or `plan-execution` can follow if the person wants a
plan.

## Principles (binding)

1. **Numbers come from the simulation.** A page, chart, table or summary shows the simulation's output
   (`golden.json`, `npx forecaster status --json`, `npx forecaster coverage --json`); nothing is typed by hand.
2. **Never show a stale page.** Every page starts from the precomputed results. `build` and the static pages
   recompute them when they are stale; `serve` does not. `npx forecaster simulate` writes them, and
   `npx forecaster precompute` refreshes them when they are stale (after an edit outside the simulation build), so
   run it before starting `serve`. A built page is a copy; rebuild it after the simulation changes.
3. **Check the page itself.** The tests cover the simulation, not the page. After a change to the page,
   open it and check the browser console: one script error takes the whole page down and no test reports it.
   A real click on each control must change what it claims to.
4. **Currency is per venture in every render path.** Never hard-code a symbol; a mixed-currency portfolio
   formats each venture in its own currency in the server page, the self-contained page and the static
   pages alike: render each venture inside `withCur(project, …)`, never by passing a symbol or a rate down.
   Views that combine ventures (the Overview's shared axis and chart, Pairwise) use the reporting currency.
5. **Publishing is outward-facing.** Build pages freely, but confirm with the person before uploading or
   sharing anything outside their machine.
6. **The brief says what the numbers can't, in words only.** Each venture's brief (shown at the top of its
   page) explains what the forecast means, what would change it, and the cheapest next steps that would
   retire its biggest uncertainty; distribution, demand and pricing tests usually teach more than more
   building. It names any top driver that is still a placeholder or rests on judgement. It never retypes a
   number: the page shows the live numbers beside it, and a typed number goes stale. Plain words, no hype.

## Procedure

1. Pick the view the person asked for:

| to see… | run | output |
|---|---|---|
| each venture's headline and node grounding, ranked by influence | `npx forecaster status [<id>…] [--json]` | terminal |
| which nodes are compiled vs hand-authored, plus orphaned data | `npx forecaster coverage [<id>] [--json]` | terminal |
| the full interactive model (re-simulates live) | `npx forecaster precompute`, then `npx forecaster serve` | http://localhost:8137 (`PORT` overrides) |
| the same, as one self-contained file | `npx forecaster build` | `dist/montecarlo.html` |
| a static page of every panel (no live simulation) | `npx forecaster artifact-full` | `dist/montecarlo-full-artifact.html` |
| a static page for chosen ventures only | `MC_PROJECTS=<id>,<id> MC_OUT=<file>.html npx forecaster artifact-full` | `dist/<file>.html` |

2. Write or refresh the brief of every venture whose forecast changed: `brief` in `src/projects/<id>.ts`
   (for a variant, on the variant), as `{ one, sections }`. `one` is the one-line takeaway; use the sections
   **What it means**, **What would change it** and **Cheapest next steps**, each a list of short bullets.
   Read the venture's drivers (`npx forecaster status <id>`) and grounding before writing it. Then rebuild the
   page (`npx forecaster build`).
3. Before sharing, check: no console exceptions on the page, every control changes what it claims to, and
   each venture shows its own currency.
