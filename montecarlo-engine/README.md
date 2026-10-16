# montecarlo-engine

A percentile-driven **Monte-Carlo portfolio simulator**. You describe each venture/project as a small
graph of researched **nodes** (gates and quantities, each given by a compiled distribution or by
percentiles); the engine draws correlated scenarios through a multi-factor Gaussian copula, evaluates a
per-project revenue model, and reports outcome percentiles (P20/P50/P80…) instead of point estimates.
Rendering and serving the results is [`forecast-renderer`](../forecast-renderer)'s job.

**Bring your own portfolio.** The engine is generic; the data is yours. A fictional example portfolio
lives in [`examples/`](examples/) and is what every script defaults to.

No build toolchain: the source is idiomatic TypeScript run directly via Node's native type-stripping
(Node ≥ 22.13).

> **Doing this as a step?** Read its step docs first: [`build-simulation.md`](build-simulation.md) (step `build-simulation`), [`audit-simulation.md`](audit-simulation.md) (step `audit-simulation`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## Quick start

```sh
npm test          # engine unit tests + the example portfolio's golden test
npm run simulate  # the simulation build over the example (golden; it has no compiled data or pairwise)
```

The tests run from a checkout of the repository: the published package leaves `test/` out.

## Authoring a portfolio

A portfolio is one or more `Project` objects, authored against the public API and **attached to the
engine with `configurePortfolio()`**. See [`examples/habit-tracker.ts`](examples/habit-tracker.ts)
for a complete, commented, fictional two-line business.

A venture is **data**: its nodes, plus a `model` naming a business-model template and which nodes fill
its slots. No code is needed unless the venture's mechanics are genuinely bespoke.

```ts
import type { Project } from "startup-forecaster/montecarlo-engine/src/types.ts";
import { configurePortfolio } from "startup-forecaster/montecarlo-engine/src/portfolio-context.ts";

const myProject: Project = {
  id: "my-app", name: "My App", type: "Consumer subscription",
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

`configurePortfolio` is the engine's one entry point. Data: `projects`, `rho` (scalar execution loadings) /
`loadings` (multi-factor), `pairwiseIds`, `title`, and — for the fully-researched workflow — compiled
`distributions`, an evidence `corpus` + `nodeRefs`, and a precomputed `pairwisePrecomputed` matrix. Nodes with
no compiled distribution fall back to a metalog fit through their authored `pctiles`. The page title also
comes from the build manifest's `TITLE` (for the static `<title>`).

Settings — each has a **neutral default**; nothing about one person's situation is built in. A workspace
sets them from its profile (`profile.json`):

| Setting | Default | What it is |
|---|---|---|
| `reportingCurrency` | `{ code: "USD", symbol: "$" }` | the currency ventures are combined in; also `fmt`'s default symbol |
| `exchangeRates` | `{}` | `rates[code]` = value of 1 `code` in the reporting currency; required for every venture `currency` other than reporting |
| `successThreshold`, `decisionFloor` | 5000, 12000 (placeholders) | revenue per year that counts as meaningful (pSucc) / the go-no-go floor (pFloor), reporting currency |
| `referenceP90`, `referenceNote` | unset | the reference-class p90 for the optimism flag (no flag when unset; a project's `refP90` wins) |
| `discountRate` | 0.10 | NPV discount rate |
| `channels` | — | payment channels merged over the built-ins (`{ realisation, fixedFee }`, fee in the venture's currency); an unknown channel is an error |
| `personalAfterTax`, `businessTax`, `businessAfterTax`, `taxNote` | no tax | the jurisdiction's tax; a unit's own `afterTax` wins for any unit |
| `costsStart` | `"start"` | when operating costs begin: `"start"`, `"readiness"` (after `code_months`), `"launch"`; a cost line may set `from` |
| `pairAttentionOverhead` | 0 | the Pairwise split-attention haircut |
| `globalFactors` | `["macro"]` | factors shared across projects (at most 11) |
| `defaults` | none | `{ margin, tvMultiple }` for business units that set none (no margin and no default is an error) |
| `horizonYears`, `headlineFromYear` | 5, 2 | the model horizon and the headline window |
| `locale`, `moneyBands` | `"en-US"`, `[50000, 100000, 200000]` | number grouping; the money colour scale (reporting currency) |
| `ventures` | — | per venture id, `{ currency, priceCurrency }` (ISO codes) from the profile's venture entries |

**Money.** Each venture reports in its own currency, `currency` (ISO code; default the reporting currency), and
may quote its input prices in another, `priceCurrency` (default its `currency`). A workspace sets both in its
profile (`ventures.<id>.currency` / `.priceCurrency`), never in the project file. `configurePortfolio` derives
the rest once: `cur`, the symbol (`curOf`, via Intl), and `fx`, the price conversion
`toReporting(priceCurrency) / toReporting(currency)` from the exchange rates; a variant takes its project's
currencies. `runCombined`, `supermix` of mixed currencies, and the Pairwise matrix convert into the reporting
currency (`toReporting(project)`); every `RunResult` carries its `currency`, and its `thr` / `floor` are the
thresholds converted into it (`thresholdsFor(project)`). A renderer opens one scope per venture with
`withCur(project, fn)`: `fmt` uses its symbol, and `heatVars` / `inReporting` convert its amounts into the
reporting currency, so colours and sort keys compare across ventures.

**Nodes the UI hides.** A node with `hidden: true` is sampled but left out of the UI's driver lists (e.g. a
terminal-value multiple). The lag nodes `code_months` / `readiness_months` are a convention the engine and the
templates read when a unit has them; the engine never adds them.

## How the model works

- **Nodes.** A **gate** samples a pass-rate then a Bernoulli; a **value** samples a quantity, from its
  compiled distribution, else a metalog through its authored percentiles, so tail fatness comes from the
  data, not an assumed shape.
- **Correlation.** A multi-factor Gaussian copula: each node loads on named factors — the project's own
  execution factor (its `RHO` loading), project-local factors, and the portfolio's `globalFactors`, which are
  drawn once per iteration and shared across projects.
- **Revenue.** Each project's `sim` writes a monthly trajectory over the horizon; the engine summarises
  the run into percentiles, applies the project `fx`, and reports a sustained yearly average over the
  headline window. The PRNG is a seeded `mulberry32`, so runs are reproducible.
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
  distributionData: "distributions",             // optional: a distribution-compiler data project
  groundingSources: "sources",                   // optional: the source archive (documents.json)
};
```

Every entrypoint reads it (from `MC_CONFIG`, else the nearest `portfolio.config.mjs` at or above the current
directory, else an error; `MC_CONFIG=examples` opts into the bundled example). In a workspace, the engine runs through the package's `startup-forecaster` command:

```sh
npx startup-forecaster simulate        # compile → gen → golden → pairwise → precompute
npx startup-forecaster coverage        # grounding per node
```

The **simulation build** (`simulation/`) is the whole data → model chain: it compiles the distribution data project
(if configured), generates the distributions + evidence modules from its `build/` output (only for projects
whose source still exists), re-freezes golden, re-bakes the Pairwise matrix (`src/pairwise.ts`, the same
computation the results UI runs) and writes the renderer's precompute snapshot. golden, pairwise and precompute
share one run of the portfolio (`simulation/results.mjs`), so the snapshot is the very results golden was frozen
from. Stages a portfolio has no data for are skipped; `--from/--to`, `--fast` (skip the pairwise bake and the
snapshot), `--list`. `simulation/golden.mjs` and `simulation/gen-pairwise.mjs` still run on their own, and a
portfolio's golden test can call `checkGolden(PROJECTS, run)` from `simulation/golden.mjs`.

`coverage.mjs` reports, per node, whether the sim samples a compiled distribution or hand-authored
percentiles, and lists compiled keys that match no node (renamed projects/nodes). With `--drivers` it adds each
project's headline and outcome drivers (the tornado), read from the precompute snapshot when it is current, else
by running each project once.

## Layout

```
src/            the engine — types, rng, quantile, metalog, distributions, factors, qmc, cohort,
                accounting, ramp, simulate, apply-distributions, the portfolio-context seam,
                units (projects → run units), pairwise (the Pairwise matrix), format
examples/       the fictional habit-tracker portfolio + its config, manifest and golden
test/           node:test suites — engine math/machinery + the example golden
config.mjs      reads a portfolio's portfolio.config.mjs (every entrypoint uses it)
simulation/     the simulation build (data → model): run.mjs + gen-distributions, gen-evidence, results (golden +
                gen-pairwise + the precompute snapshot, from one portfolio run)
coverage.mjs    per-node grounding report
portfolio-loader.mjs  attaches a portfolio to the engine (the renderer's entrypoints use it too)
```

## The data seam

Engine modules never import portfolio data directly. `src/portfolio-context.ts` declares the data
bindings once (`DISTRIBUTIONS`, `RHO`, `LOADINGS`, `PROJECTS`, `PAIRWISE_IDS`, …) and
`configurePortfolio()` populates them; the engine reads them from there. This is a configure-once,
single-session context — which is also why the flatten-bundler works (one scope, each canonical name
declared once).
