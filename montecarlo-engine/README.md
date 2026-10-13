# montecarlo-engine

A percentile-driven **Monte-Carlo portfolio simulator**. You describe each venture/project as a small
graph of researched **nodes** (gates and quantities, each given by percentiles rather than an assumed
shape); the engine draws correlated scenarios through a one-factor Gaussian copula, evaluates a
per-project revenue model, and reports outcome percentiles (P20/P50/P80…) instead of point estimates.
It ships a render layer, a zero-dependency local server, and a self-contained-artifact bundler.

**Bring your own portfolio.** The engine is generic; the data is yours. A fictional example portfolio
lives in [`examples/`](examples/) and is what every script defaults to.

No build toolchain: the source is idiomatic TypeScript run directly via Node's native type-stripping
(Node ≥ 22.6).

## Quick start

```sh
npm test          # engine unit tests + the example portfolio's golden test
npm run build     # bundle the example into a self-contained dist/montecarlo.html
npm run serve     # run the example model at http://localhost:8137
npm run pipeline  # the full data → model pipeline over the example (golden → build → precompute)
```

## Authoring a portfolio

A portfolio is one or more `Project` objects, authored against the public API and **attached to the
engine with `configurePortfolio()`**. See [`examples/habit-tracker.ts`](examples/habit-tracker.ts)
for a complete, commented, fictional two-line business.

A venture is **data**: its nodes, plus a `model` naming a business-model template and which nodes fill
its slots. No code is needed unless the venture's mechanics are genuinely bespoke.

```ts
import type { Project } from "montecarlo-engine/src/types.ts";
import { configurePortfolio } from "montecarlo-engine/src/portfolio-context.ts";

const myProject: Project = {
  id: "my-app", name: "My App", cur: "$", fx: 1, type: "Consumer subscription",
  one: "One-line description.",
  nodes: [
    { id: "launch", label: "Ships", kind: "gate", conf: "low", pctiles: { p10: 0.6, p50: 0.8, p90: 0.95 } },
    { id: "signups", label: "Sign-ups over 5y", kind: "value", conf: "low", pctiles: { p10: 2000, p50: 20000, p90: 150000 } },
    // …free_to_paid, arpu_usd_mo, annual_churn, annual_share (fractions carry `bound: "bounded"`)…
  ],
  revNote: "Free sign-ups × conversion become paying subscribers, retained under a churn-derived curve.",
  model: {
    template: "subscription-cohort",
    gate: "launch",
    customers: ["signups", "free_to_paid"],
    price: ["arpu_usd_mo"],
    retention: { churn: "annual_churn", factors: [1.2, 1.35, 1.45, 1.5] },
    annualShare: "annual_share",
    channel: "appStoreSBP",
    lines: { subscription: "Subscription" },
    cogs: [{ label: "App-store & payment fees", channelFee: 0.15 }],
  },
};

configurePortfolio({ projects: [myProject], rho: { "my-app": { signups: 0.4 } } });
```

### Business-model templates

`configurePortfolio` resolves each project's (and variant's) `model` into its `sim`, revenue lines,
cost-of-revenue lines, margin, operating cost and terminal multiple — fields the unit sets itself win.
Templates live in [`src/templates.ts`](src/templates.ts):

- **`subscription-cohort`** — customers won over the window (a product of nodes) acquired after a build lag
  (evenly, or on a cold-start `ramp`), retained under a tenure-ramped survival curve (from `churn` or
  `retention`; plan-mix blended; optional dunning recovery), each paying a monthly `price` (a product of
  nodes); optional launch `gate`, `ceiling`, net `expansion`, one-time `setupFee` line, and arriving risk
  `events` (hazard + severity). Cost of revenue: the channel's fee, rate nodes, or a capped cost÷price
  ratio; `opex` fixed-cost nodes. Covers consumer freemium, per-seat and per-org B2B SaaS.

A unit whose mechanics no template covers (a price-as-output demand overlay, delivery-capacity limits, a
multi-stage funnel with bespoke rules) writes `sim(s, r, out, parts)` by hand with the cohort/accounting
helpers — the fallback, not the default.

`configurePortfolio` accepts: `projects`, `rho` (scalar execution loadings) / `loadings` (multi-factor),
`pairwiseIds`; `title` (the results-UI page title); the **tax model** — `personalAfterTax(grossAnnual)`
and `businessTax` (a rate) — which default to **no tax** (the engine assumes no jurisdiction; a
portfolio supplies its own); and — for the fully-researched workflow — compiled `distributions`, an
evidence `corpus` + `nodeRefs`, and a precomputed `pairwisePrecomputed` matrix. Every slice is
optional; nodes with no compiled distribution fall back to a metalog fit through their authored
`pctiles`. The page title also comes from the build manifest's `TITLE` (for the static `<title>`).

## How the model works

- **Nodes.** A **gate** samples a pass-rate then a Bernoulli; a **value** samples a quantity. Each
  distribution is defined by researched percentiles; sampling interpolates between them, so tail
  fatness comes from the data, not an assumed shape.
- **Correlation.** Each run draws a shared "luck" factor; every node is pulled toward it by its `RHO`
  loading (a one-factor Gaussian copula; multi-factor loadings supported per node).
- **Revenue.** Each project's `sim` writes a 60-month net-collected trajectory; the engine summarises
  the run into percentiles, applies the project `fx`, and reports a sustained yearly average. The PRNG
  is a seeded `mulberry32`, so runs are reproducible.
- **Cohort / accounting helpers** (`src/cohort.ts`, `src/accounting.ts`) — subscription survival,
  ramped acquisition, plan-mix, realisation (payment/tax drag), NPV — are the building blocks `sim`
  functions compose.

## Wiring your own portfolio: `portfolio.config.mjs`

A workspace describes its portfolio in one file at its root, `portfolio.config.mjs` (every field is documented
in [`config.mjs`](config.mjs); the example's is [`examples/portfolio.config.mjs`](examples/portfolio.config.mjs)):

```js
export default {
  bootstrap: "src/projects.ts",        // the module whose import calls configurePortfolio()
  dataRoot: "src", manifest: "portfolio.manifest.mjs", out: "dist/montecarlo.html",   // the bundle
  golden: "golden.json",               // frozen run() outputs
  generated: { distributions: "src/distributions-data.ts", evidence: "src/evidence-data.ts", pairwise: "src/pairwise-data.ts" },
  distributionData: "../my-distribution-data",   // optional: a distribution-compiler data project
  compiler: "../startup-forecaster/distribution-compiler",          // optional: lets the pipeline (re)compile it
  groundingSources: "../my-sources",             // optional: source registry (documents.json)
};
```

Every entrypoint reads it (from `MC_CONFIG`, else `./portfolio.config.mjs`, else the example), so a
portfolio's npm scripts are just paths into the package:

```sh
node node_modules/montecarlo-engine/pipeline/run.mjs        # compile → gen → golden → pairwise → build → precompute
node node_modules/montecarlo-engine/build.mjs               # the self-contained live page
node --experimental-strip-types node_modules/montecarlo-engine/server.mjs          # serve it
node --experimental-strip-types node_modules/montecarlo-engine/build-artifact.mjs  # static artifacts (also build-full-artifact)
node --experimental-strip-types node_modules/montecarlo-engine/coverage.mjs        # grounding per node
```

The **pipeline** (`pipeline/`) is the whole data → model chain: it compiles the distribution data project
(if configured), generates the distributions + evidence modules from its `build/` output (only for projects
whose source still exists), re-freezes golden, re-bakes the Pairwise matrix with appcore's own computation,
builds, and precomputes. Stages a portfolio has no data for are skipped; `--from/--to`, `--fast` (skip the
pairwise bake), `--list`. A portfolio's golden test can call `checkGolden(PROJECTS, run)` from
`pipeline/golden.mjs`.

`coverage.mjs` reports, per node, whether the sim samples a compiled distribution or hand-authored
percentiles, and lists compiled keys that match no node (renamed projects/nodes).

The precompute cache lives beside the config (`<portfolio>/.cache/`, or `MC_CACHE_DIR`); artifacts land
next to the live build (`dirname(out)`). The cache key hashes the engine's sources **and** the portfolio's
(every `.ts` under the bootstrap's directory), so a data change busts it just like an engine change.

## Layout

```
src/            the engine — types, rng, quantile, metalog, distributions, factors, qmc, cohort,
                accounting, ramp, simulate, apply-distributions, the portfolio-context seam,
                appcore (DOM-free orchestration), app (browser entry), render/*
examples/       the fictional habit-tracker portfolio + its config, manifest and golden
test/           node:test suites — engine math/machinery + the example golden
config.mjs      reads a portfolio's portfolio.config.mjs (every entrypoint uses it)
pipeline/       the data → model pipeline: run.mjs + gen-distributions, gen-evidence, golden, gen-pairwise
build.mjs       zero-dependency bundler (engine src + data modules → one self-contained HTML)
server.mjs      zero-dependency local server (renders HTML fragments to a thin client.mjs)
```

## The data seam

Engine modules never import portfolio data directly. `src/portfolio-context.ts` declares the data
bindings once (`DISTRIBUTIONS`, `RHO`, `LOADINGS`, `PROJECTS`, `PAIRWISE_IDS`, …) and
`configurePortfolio()` populates them; the engine reads them from there. This is a configure-once,
single-session context — which is also why the flatten-bundler works (one scope, each canonical name
declared once).
