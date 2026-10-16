# forecast-renderer

The results UI for [`montecarlo-engine`](../montecarlo-engine): it renders a simulated portfolio as an
interactive page and serves it. Zero dependencies; TypeScript run directly via Node's type stripping.

> **Doing this as a step?** Read its step doc first: [`render-forecast.md`](render-forecast.md) (step `render-forecast`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## Ways to show the results

| command (in a workspace) | what it makes |
|---|---|
| `npx startup-forecaster serve` | the interactive model at http://localhost:8137 (`PORT` overrides): simulation and rendering run in Node; the browser gets HTML fragments through the thin `client.mjs` and the shared DOM layer `src/dom-shared.mjs` (tabs, sorting, hover, pinning, re-simulation) |
| `npx startup-forecaster precompute` | the server's startup cache, so `serve` and the static pages boot instantly. `npx startup-forecaster simulate` already writes it; this recomputes it only when it is stale (`--force` always) |
| `npx startup-forecaster build` | `dist/montecarlo.html`: one self-contained page (engine + renderers + the portfolio's data, bundled) that starts from the precomputed results and re-simulates in the browser when you edit a venture; it refreshes a stale snapshot first |
| `npx startup-forecaster artifact-full` | `dist/montecarlo-full-artifact.html`: every panel pre-rendered from the cache, with `dom-shared.mjs` + `client.mjs` in a static mode (no simulation) |
| `MC_PROJECTS=a,b MC_OUT=x.html npx startup-forecaster artifact-full` | the same, for chosen ventures only |

The precompute cache lives beside the config (`<workspace>/.cache/`, or `MC_CACHE_DIR`); static pages land
next to the live page (`dirname(out)`). The cache key hashes everything that can move the numbers: the
engine's sources, this renderer's app core, and the portfolio's bootstrap directory, `dataRoot`,
`generated.*` modules, manifest and `portfolio.config.mjs` (`.ts`, `.mjs` and `.json` files). The HTML layer
(`src/render/`, `src/dom-shared.mjs`) is left out, so a UI change keeps the cache warm.

## Money

Each venture's own views (its panel, its rows in a table) are in the venture's currency. Views that put
ventures on one scale are in the portfolio's reporting currency: the Overview's spread axis, colour scale,
sort order and year-over-year chart, and the whole Pairwise panel. One place does the conversion: a render
opens a scope per venture with `withCur(project, fn)` (portfolio-context.ts), which sets both its symbol for
`fmt` and its rate into the reporting currency, so `heatVars`, the spread strip and the sort keys
(`sortKeys`) convert inside it; every ranking goes through `rankByReporting` (units.ts). Input prices on the
price curve carry the symbol of the venture's `priceCurrency` when it has one, else its own.

## Tabs

Overview and one tab per active venture always show. Pairwise shows when at least two ventures are pairable
(`pairwiseIds`), Grounding when the portfolio has compiled distributions, Archived when a venture is archived.

## Layout

```
src/render/     the panels and charts: overview, project, pairwise, evidence (Grounding), yoy, horizons,
                graph / linechart / bar (SVG)
src/appcore.ts  DOM-free orchestration for the server and static pages: runs the portfolio, holds results,
                assembles panels
src/app.ts      the self-contained page's browser entry point
src/dom-shared.mjs  the shared DOM layer (tab routing, hovers, sorting, card toggles): a plain script every page
                loads once — bundled ahead of app.ts, served before client.mjs, inlined ahead of it in the artifacts
client.mjs      the thin browser client (live and static modes)
server.mjs      zero-dependency local server
build.mjs       zero-dependency bundler: engine + renderer + portfolio data modules → one HTML page
build-full-artifact.mjs · artifact-common.mjs   the static page
precompute.mjs · cache-util.mjs   the startup cache
template.html · styles.css        the page frame and styles
test/           node:test suites over the engine's example portfolio
```

Every entrypoint reads the workspace's `portfolio.config.mjs` through the engine's `config.mjs` (`out` names
the live page).
