# forecaster

The entry point of [startup-forecaster](..): it scaffolds a venture into a portfolio from a business-model
preset (`forecaster new`) and reports what is grounded and what to research next (`forecaster status`). The
agent playbook that drives the whole loop is the repo's [`AGENTS.md`](../AGENTS.md).

| step | tool |
|---|---|
| scaffold a venture from a business-model preset | **here** (`forecaster new`) |
| find, archive and quote sources | [`agentic-fetcher`](../agentic-fetcher) |
| build each node's distribution from the evidence | [`distribution-compiler`](../distribution-compiler) |
| simulate | [`montecarlo-engine`](../montecarlo-engine) (`simulation/`) |
| render, serve, publish the results | [`forecast-renderer`](../forecast-renderer) |
| see what is grounded and what to research next | **here** (`forecaster status`) |
| build / execution plans | [`build-plan-generator`](../build-plan-generator), [`exec-plan-generator`](../exec-plan-generator) |

> **Doing this as a step?** Read its step doc first: [`add-venture.md`](add-venture.md) (step `add-venture`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## Commands

Run anywhere inside a workspace (the folder with `portfolio.config.mjs`):

```sh
npx startup-forecaster init <dir> [--name "<Title>"] [--link]   # outside a workspace
npx forecaster agent-files [--force]
npx forecaster presets
npx forecaster new <id> --preset <preset> --name "<Name>" [--currency <ISO>] [--channel <name>]
npx forecaster profile [--json]
npx forecaster status [<id> ...] [--json]
npx forecaster <tool> [args]          # any tool in the package; `npx forecaster help` lists them
```

**`init`** creates a workspace that depends on this package (installed with `npm install`; `--link` links a
local checkout instead, for working on the tools): `portfolio.config.mjs`, `src/projects.ts` with the
registration markers, `profile.json` (every answer only the person can give left `null`, the guessable
defaults filled in) and `src/profile-data.ts` generated from it, an empty `distributions/` data project and `sources/` archive, `dossiers/` and `plans/`,
and `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, which point any coding agent at the playbook.
**`agent-files`** adds those three files to an existing workspace (it keeps files that exist unless `--force`).

**`profile.json`** holds the person's answers and each venture's (shape and onboarding: [`add-venture.md`](add-venture.md)).
Before every command, `forecaster` regenerates `<dataRoot>/profile-data.ts` from it: `PROFILE_SETTINGS`, the
`configurePortfolio` settings it sets (reporting currency, exchange rates, thresholds, discount rate,
horizon, cost timing, pairwise haircut, business tax and its note, extra payment channels), and
`PROFILE_GAPS`, what is still unanswered. The workspace's `src/projects.ts` passes `PROFILE_SETTINGS` to the
engine; a workspace with its own tax functions passes those beside it. An unanswered field keeps the
engine's neutral default and is reported, never silently assumed. **`profile`** prints the profile's gaps
and declined answers, what is due for re-confirming (answered over 6 months ago) and the settings
it passes; **`status`** starts with the same warnings ("profile incomplete: …", "tax: no tax configured").

**`new`** writes the venture's structure-only project file (nodes + a `subscription-cohort` model), registers
it at the portfolio's `// forecaster:imports`, `// forecaster:register <ARRAY>` and `// forecaster:modules`
markers, seeds a **placeholder** distribution per node in `distributions/` (a wide preset
prior, support 5, backed by a `…_placeholder` speculation — never presented as a finding), and writes a
research brief (`<dossiers>/<id>/research-brief.md`). Then `npx forecaster simulate` makes it runnable.
The venture's currency and payment channel come from its `profile.json` entry (`ventures.<id>`), else the
reporting currency and the preset's channel, which it lists under "To confirm"; `--currency` and `--channel`
override them. An unknown channel is rejected with the valid names (the engine's built-ins plus the profile's
`channels`). `new` records the venture's currency and channel in the profile, the one record of them: the
project file holds no currency, symbol or fx. A venture whose input prices are quoted in another currency
sets `ventures.<id>.priceCurrency`; the engine derives the symbol and the price conversion from the profile's
exchange rates.

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

Presets are team-neutral. When the venture's team (its profile entry, else the person's) is a paid
`"team"` with a payroll, the preset adds a `team_cost_yr` operating cost from the start; the support ceiling
is the support capacity of the people doing it. Presets are written in US dollars with a `{cur}` token in
their labels; `new` puts every money node (unit starting with "currency") into the venture's currency in one
pass, converting when the profile has the rate (the brief says which) and filling in the symbol.
Every placeholder is an exact-fit metalog through its p10/p50/p90, kept narrow enough that its mean stays
below its p95 and its p99 stays sane (`npx forecaster preview fit metalog p10=… p50=… p90=… --lower=0`). The
cold-start acquisition ramp is a fixed judgement the brief lists under "Judgement settings".

## Test

```sh
npm test               # end to end in a throwaway workspace (uses the engine + compiler beside it)
```
