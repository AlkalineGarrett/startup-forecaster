# forecaster

The entry point of [startup-forecaster](..): it scaffolds a venture into a portfolio from a business-model
preset (`forecaster new`) and reports what is grounded and what to research next (`forecaster status`). The
agent playbook that drives the whole loop is the repo's [`SKILL.md`](../SKILL.md).

| step | tool |
|---|---|
| scaffold a venture from a business-model preset | **here** (`forecaster new`) |
| find, archive and quote sources | [`agentic-fetcher`](../agentic-fetcher) |
| build each node's distribution from the evidence | [`distribution-compiler`](../distribution-compiler) |
| simulate, report, publish | [`montecarlo-engine`](../montecarlo-engine) (`pipeline/`, artifacts) |
| see what is grounded and what to research next | **here** (`forecaster status`) |
| build / execution plans | [`build-plan-generator`](../build-plan-generator), [`exec-plan-generator`](../exec-plan-generator) |

## Commands

Run inside a portfolio repo (one with `portfolio.config.mjs` — the montecarlo-engine convention):

```sh
node ../startup-forecaster/forecaster/bin/forecaster.mjs presets
node ../startup-forecaster/forecaster/bin/forecaster.mjs new <id> --preset <preset> --name "<Name>" [--cur $] [--fx 1] [--channel …]
node ../startup-forecaster/forecaster/bin/forecaster.mjs status [<id> ...] [--json]
```

**`new`** writes the venture's structure-only project file (nodes + a `subscription-cohort` model), registers
it at the portfolio's `// forecaster:imports`, `// forecaster:register <ARRAY>` and `// forecaster:modules`
markers, seeds a **placeholder** distribution per node in the distribution-data project (a wide preset
prior, support 5, backed by a `…_placeholder` speculation — never presented as a finding), and writes a
research brief (`<dossiers>/<id>/research-brief.md`). Then `npm run pipeline` makes it runnable.

**`status`** classifies every node — `placeholder` · `judgement` (speculation / prior only) · `sourced` (has a
sourced observation) · `missing` — shows tracked evidence gaps and the venture's open fetch requests, and
ranks the nodes by how strongly each drives the outcome (the engine's rank correlation with revenue), so
research goes where it changes the answer.

## Presets

| preset | shape |
|---|---|
| `consumer-freemium` | free sign-ups × paid conversion → subscribers (app store or web) |
| `b2b-per-seat` | reachable customers × penetration; seats × price per seat; setup fee; support ceiling; a competitive shock |
| `b2b-per-org` | as above with a flat price per organisation |

A preset is a parameterisation of an engine template plus, per node, its unit, a placeholder prior and a
note on what evidence would ground it. Add one by dropping a module in `presets/` (see `common.mjs`).

## Test

```sh
npm test               # end to end in a throwaway portfolio (uses the engine + compiler beside it)
```
