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
| `compiler/compile.py` | resolve references + formulas → compiled artifact per project |
| `compiler/distributions.py` | the sampling kernel (`construct` / `Dist.ppf` / `cdf` / `truncate`) |
| `compiler/formula.py` | the computed-value formula grammar |
| `compiler/preview.py` | fit a distribution to target quantiles (design aid) |
| `compiler/scaffold.py` | lift a simulator's hand-authored nodes into a project file as tracked speculations (input: `montecarlo-engine` `coverage.mjs --json`) |
| `schema/`, `project-distributions.schema.json` | the normative format spec + machine schema |
| `PRINCIPLES.md` · `DATA-CONTRACT.md` (how a simulator consumes the compiled output) | the format contract (invariants: `schema/SCHEMA.md` §8) |

## Data it reads (the two-location convention)

The compiler reads the **data project** given by `FORECASTER_DATA` (default: current directory):

- `corpus/observations.json` — the flat evidence map (`obs_<id>` → measure + `doc` backref)
- `corpus/general-knowledge.json`, `corpus/speculations.json` — priors / speculations
- `projects/<project>.json` — the node source

It has **no dependency on the source cache** (`grounding-sources/`): it resolves values from
`observations.json`, not from the doc identity registry. The schema it validates against lives
in this folder.

```sh
# from inside the data project (FORECASTER_DATA defaults to .):
FORECASTER_DATA=. python3 ../startup-forecaster/distribution-compiler/compiler/compile.py projects/<project>.json --write
```

## Tests

```sh
python3 -m pytest tests/ -q      # the distribution + formula kernels (corpus-independent)
```
The end-to-end proof is byte-identical recompilation of the 11 projects against the split corpus.
