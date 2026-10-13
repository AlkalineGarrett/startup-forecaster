# distribution-compiler

The **distribution-modeling toolchain**: the compiler, the distribution kernel, and the format spec
for the *grounded · constructed · derived* node format. It holds tools only; the data it operates on
lives in a distribution-data project (`projects/`, `corpus/`, `build/`).

## What it does

A node states a **distribution** *constructed* from grounded evidence; percentiles are a *derived*
readout. The compiler resolves every value's `reference` to a real measure, evaluates
`computed_value` formulas, and emits `build/<project>.compiled.json` (the artifact a simulator
consumes) with `debug_computed_percentiles` filled.

| path | what |
|---|---|
| `compiler/compile.mjs` | resolve references + formulas → compiled artifact per project |
| `compiler/distributions.mjs` | the sampling kernel (`construct` / `Dist.ppf` / `cdf` / `truncate`) |
| `compiler/formula.mjs` | the computed-value formula grammar |
| `compiler/preview.mjs` | fit a distribution to target quantiles (design aid) |
| `compiler/scaffold.mjs` | lift a simulator's hand-authored nodes into a project file as tracked speculations (input: `montecarlo-engine` `coverage.mjs --json`) |
| `schema/`, `project-distributions.schema.json` | the normative format spec + machine schema |
| `PRINCIPLES.md` · `DATA-CONTRACT.md` (how a simulator consumes the compiled output) | the format contract (invariants: `schema/SCHEMA.md` §8) |

## Data it reads

The compiler reads the workspace's **data project** — the `distributionData` folder named in its
`portfolio.config.mjs` (found by walking up from the current directory; `FORECASTER_DATA` overrides, and
outside a workspace it is the current directory). `compiler/workspace.mjs` resolves it.

- `corpus/observations.json` — the flat evidence map (`obs_<id>` → measure + `doc` backref)
- `corpus/general-knowledge.json`, `corpus/speculations.json` — priors / speculations
- `projects/<project>.json` — the node source

It does not read the source archive: values resolve from `observations.json`, not from the document
registry. The schema it validates against lives in this folder.

```sh
# from the workspace root:
node ../startup-forecaster/distribution-compiler/compiler/compile.mjs distributions/projects/<project>.json --write
```

## Tests

```sh
npm test
```
The end-to-end proof is byte-identical recompilation of the 11 projects against the split corpus.
