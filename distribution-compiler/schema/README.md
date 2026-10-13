# Project-distributions schema — grounded · constructed · derived

The spec for how each project-distribution node holds its distribution. A node states a
distribution that is **constructed** from grounded evidence; percentiles are a
**derived** readout, never authored.

The **normative spec is [`SCHEMA.md`](SCHEMA.md)** — a single greppable, diffable file; where
it and the HTML differ, the spec wins. **[`schema-grounded.html`](schema-grounded.html)** is its
illustrated companion — a self-contained page with a worked example + density graph for every
kind. The scripts under `generators/` produce the computed numbers and graphs.

Both cover: a heavy tail as a `splice` with a
`generalized_pareto` family, time-series measures (`measure.series`), a closed formula-function
vocabulary (`min`/`max`/`extrapolate_cagr`/`extrapolate_linear`), richer
`observation.verification` states (`verified`/`unchecked`/`not_in_doc`/`unverifiable`), null-quote
observations with `capture_note`, and a `basis` metric-comparability marker + lint
(invariants I20–I22).

## The construction model, in one screen

A node holds its distribution and the grounding around it as **direct fields** (there is
no wrapper object):

```
node: {
  unit, model_definition, inputs?,
  truncation?,                      // clips, when present
  distribution: { kind, … },         // the build — kind IS the family
  reconciliation?, cross_checks?,    // how sources combined; corroborations/refutations
  support_score, reasoning,          // 0–100 groundedness + its rationale
  debug_computed_percentiles         // throwaway readout, recomputed, never authored
}
```

- `kind` **is** the family. Three kinds are structural (`point_mass`, `weighted_combination`, `splice`), one is
  quantile-parameterized (`metalog`), the rest are parametric families (`lognormal`, `beta`,
  `normal`, `gamma`, `uniform`, `generalized_pareto`, …), each stating
  its named params directly. Every param is a `value` carrying a
  `{ value_type, reference|formula, measure, process, reasoning, confidence }` trail.
- Documents / observations / general_knowledge / speculations live in a **shared corpus at
  the root**, referenced by id. One fact used by many nodes is one observation; the shared id is
  the correlation record. Which nodes use it is derived on demand from `projects/*.json`
  (`agentic-fetcher/citations.mjs`), not stored on the observation.
- Full field-by-field reference, invariants (I1–I19), and worked examples are in the HTML.

## Worked examples — one illustrative node per kind

Every kind is worked against an illustrative leaf for one of two fictional products — `habit-app` (a consumer
habit-tracking app) and `field-crew` (scheduling software for small field-service crews). Their sources,
vendors and figures are invented for illustration. (`metalog` and `generalized_pareto` appear as `splice`
segments, in the last two rows.) The
`debug_computed_percentiles` in each are **computed from the stated params** (by the
scripts below), not authored — so they can drift from the file's old hand-authored
quantiles, which is the point.

| kind | example node | params | derived p10 / p50 / p90 |
|---|---|---|---|
| `point_mass` | `field-crew::platform_bundling_severity` | 4 atoms (×0.15…×1.30) + allocation | 0.15 / 1.00 / 1.30 (mean ×0.81) |
| `lognormal` | `field-crew::n_crews_reachable` | median 3400, σ 0.5, clipped at 14260 | 1790 / 3396 / 6419 |
| `weighted_combination` | `field-crew::adoption_rate` | 20% uniform band + 80% Beta(2,24) | 0.7% / 5.2% / 13.7% |
| `beta` | `field-crew::share_of_jobs_scheduled` | Beta(4.5, 2.4) | 42% / 67% / 86% |
| `normal` | `habit-app::active_days_per_year` | mean 110, sd 41 | 57 / 110 / 163 |
| `gamma` | `habit-app::referrals_per_user` | Gamma(1.25, 2.0) | 0.10 / 0.47 / 1.36 |
| `uniform` | the `adoption_rate` structural band | flat [0.003, 0.012] | 0.0039 / 0.0075 / 0.0111 |
| `splice` (mass → metalog) | `field-crew::addon::arpu_usd_mo` | point_mass $0 (13%) + lower-semi-bounded metalog (6 anchors) | $0 / $24 / $83 |
| `splice` (body → GPD) | `habit-app::daily_installs` | lognormal(20, σ2.34) → generalized_pareto(ξ0.927, slope-matched) | 20 / 400 / 4,685 … p99.99 ≈ 347k, mean 815 |
| `measure.series` + `extrapolate_cagr` | `field-crew::n_crews_reachable` firm-count input | business-register series 2019→2023, 2.1%/yr | → 15,180 firms (2026) |

The `arpu` case is a **two-part (hurdle) model over semicontinuous data**, expressed as a `splice`: the observed
price list is an ordered sample (percentile = rank `i/(n+1)`), fit to a lower-semi-bounded metalog (a
quantile-parameterized distribution); the $0 free tier is a `point_mass` segment spliced below it, which is
why its `p05 = p10 = $0`.

## generators/

Reusable scripts that compute every number and graph in the doc. All are dependency-free
(plain Node, no packages) and read/write only under `generators/data/` — except `gen_mix_viz.mjs`,
which writes its standalone page next to this README.

| script | produces |
|---|---|
| `compute_params.mjs` | beta / normal / gamma / uniform params → derived percentiles (prints) |
| `metalog_fit.mjs` | lower-semi-bounded metalog OLS fit → curve + two-part percentiles → `data/metalog_curve.json` |
| `gen_graphs.mjs` | the per-example density-graph SVGs → `data/graphs.json` |
| `build_metalog_example.mjs` | the metalog two-part figure (reads `data/metalog_curve.json`) → `data/metalog_figure.html` |
| `gen_mix_viz.mjs` | the standalone `field-crew-adoption-mixture.html` (density + CDF) |
| `gpd_fit.mjs` | the GPD tail splice — body + slope-matched Generalized Pareto → percentiles + curve → `data/gpd_curve.json` |
| `series_extrapolate.mjs` | the CAGR extrapolation of a `measure.series` → `data/ts_curve.json` |
| `build_tail_series_figures.mjs` | the GPD log-density and time-series figures (reads the two `data/*_curve.json`) → `data/gpd_fig.html`, `data/ts_fig.html` |
| `verify.mjs` | quick `<pre>`-block span-balance check on an HTML file |

Note: the graphs are already embedded in `schema-grounded.html`. The generators are kept as
provenance for the computed content — re-run them to audit or regenerate the numbers.
`gen_mix_viz.mjs` regenerates the standalone viz wholesale; `gen_graphs.mjs`,
`build_metalog_example.mjs` and `build_tail_series_figures.mjs` emit the figure blocks spliced into the doc.
Run order: `gen_graphs.mjs`, `metalog_fit.mjs` → `build_metalog_example.mjs`, `gpd_fit.mjs` + `series_extrapolate.mjs`
→ `build_tail_series_figures.mjs`, `gen_mix_viz.mjs`.

## Verifying the HTML

```sh
# <pre> span balance
node generators/verify.mjs schema-grounded.html
```
