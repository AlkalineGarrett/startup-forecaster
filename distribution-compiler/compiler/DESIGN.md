# The compiler — design

## Why

Verification is *compilation*. A node's distribution is a **description of
an idea** (a beta's params, a splice's segments, a formula), authored in `projects/*.json` against
the shared `corpus/`. Many slots in that description are **derived** — a `computed_value`'s number
comes from its `formula`, and `debug_computed_percentiles` is a readout of the construction, never
authored. So nobody hand-fills them:

**The compiler computes the closure and either fills the blanks or flags the mismatches.** Every
value slot is in one of three states — **given** (taken as-is), **derived** (agent left it out →
compiler computes it), or **given+formula** (agent wrote both → compiler computes and diagnoses a
mismatch). "Author a subset and let the compiler fill it" and "author it all and let the compiler
check it" are the same engine at different strictness. The agent runs the compiler, reads a diff,
fixes what's flagged; "is this node valid" means "did compilation run and pass".

This is **deterministic**, node-local, and **not** simulation. Distributions are descriptions;
a simulator consumes the *compiled* descriptions downstream (DATA-CONTRACT.md). There is no
cross-node propagation — every node is an elicited leaf (SCHEMA.md: "none is a formula over other
nodes … no node references another node").

## What it does (per node, independently)

```
load project + corpus
  → resolve references   in_ / obs_ / gk_ / spec_  →  values from the node's inputs and the corpus
  → evaluate formulae    computed_value.formula over the closed I22 grammar (below)
  → construct            distribution.kind + its params  →  a quantile function Q(p)
  → derive               debug_computed_percentiles = { p05,p10,p50,p90,p95 } from Q
  → check                authored-vs-computed mismatches + the checkable invariants
  → emit                 filled node  +  diagnostics
```

### Distribution kinds → `Q(p)` / percentiles

- **parametric** (`lognormal, beta, normal, gamma, uniform, generalized_pareto`) — scipy `ppf`.
- **point_mass** — atoms + allocation → a discrete/weighted quantile step function.
- **weighted_combination** — components + allocation → mixture; percentiles by numeric inversion
  of the combined CDF.
- **splice** — segments joined at `splices[].at`; piecewise quantile with a continuous CDF
  (canonical case: a parametric body + a `generalized_pareto` tail whose `scale` is
  `slope_match`ed at the splice — ported from `schema/generators/gpd_fit.py`).
- **metalog** — anchors at plotting positions `i/(n+1)`, k-term fit; lower-semi-bounded variant
  supported (ported from `schema/generators/metalog_fit.py`), with the monotonicity assert.

Percentiles are computed analytically where the family gives a `ppf`, else by a numeric CDF grid
(`grid_percentiles` in `schema/generators/compute_params.py`).

### Formula grammar (closed, I22)

`min`, `max`, `extrapolate_cagr`, `extrapolate_linear`, `slope_match`, plus arithmetic, over:
- **ids** — `in_x.value`, `obs_y.value` (an input or a corpus observation's measure), and
- **the distribution's own structure** — `segments[i]`, `splices[i]`.

No node ids — formulae never reference other nodes.

**Formula operand rules (authoring gotchas):**
- Inside a `formula`, reference a corpus fact by its **bare id** — `obs_y.value`, `gk_z.value`,
  `in_x.value`. The full `doc_<sha>/obs_y` path does **not** resolve inside a formula (only in a
  value's `reference` field, which accepts either the full path or a bare `obs_y`).
- An operand resolves to `.value` (scalar), `.series` (dated points), or — for an **interval**
  measure — `.low` / `.high` (the endpoints). So a lognormal fit to a source band `[lo, hi]` needs
  no duplicate scalar obs: `median = exp((log(obs_band.low) + log(obs_band.high)) / 2)`,
  `sigma = (log(obs_band.high) - log(obs_band.low)) / 2.5631`.
- An operand that resolves to `None` (e.g. `obs_y.value` on an interval-only obs) errors — use
  `.low`/`.high`, or add a scalar observation.

## Output

- **Build artifact** `build/<project>.compiled.json` — the fully-filled node set, plus a
  `_meta` block recording `source_sha256` (freshness) and a diagnostics summary. Downstream (and
  eventually the MC sim) reads this, not the lean source.
- **Diff** — printed source-vs-compiled: every slot the compiler **filled** and every
  **mismatch** (authored ≠ computed, beyond tolerance). This is what the agent acts on.
- **Diagnostics** — `error` (mismatch, unresolved ref, non-monotonic, out-of-unit, allocation ≠ 1,
  infeasible fit) vs `warning`. Non-zero exit if any `error`.

## Agent workflow

1. Author `projects/<project>.json` — as lean or as complete as you like.
2. `python3 compiler/compile.py projects/<project>.json` → build artifact + diff + diagnostics.
3. Fix flagged mismatches; re-run until clean.

A project is **fresh and clean** when `build/<project>.compiled.json` exists, its recorded
`source_sha256` matches the current source, and it carries zero `error` diagnostics — i.e. *"you ran
the compiler and it passed."* An unresolved reference is a compiler `error`, so it cannot slip through
as a dangling id.

## Layout

```
compiler/
  compile.py        # CLI driver: load → resolve → evaluate → construct → derive → check → emit
  distributions.py  # kind → Q(p) / percentiles (scipy + ported generators)
  formula.py        # the closed I22 grammar evaluator
  DESIGN.md         # this file
build/
  <project>.compiled.json
```

## Exact keys the compiler reads (authoring reference)

Where the prose spec and the compiler differ, **this table and `testdata/_test.json` win** —
that fixture is the canonical, runnable example of every kind. Each param below is a `value`
(a plain number, or `{ "measure": { "value": … } }`, or `{ "formula": … }`).

| kind | keys |
|---|---|
| `lognormal` | `median`, `sigma` (log-space σ) |
| `beta` | `alpha`, `beta` |
| `normal` | `mean`, `sd` |
| `gamma` | `shape`, `rate` |
| `uniform` | `low`, `high` |
| `generalized_pareto` | `location`, `scale`, `shape` |
| `point_mass` | `atoms: [{ value, weight }]` (weights renormalize; I3 warns if ≠1) |
| `weighted_combination` | `components: [{ distribution, weight }]` — the mixture; a `point_mass` component gives a two-part/hurdle model |
| `splice` | `segments: [{distribution} body, {distribution} tail]`, `splices: [{ at }]`. `at` is the **x-value** where the tail takes over; the tail's `location` references the **same** value; the tail's `scale` is a `computed_value` with `formula: "slope_match(segments[0], splices[0])"`, so only `shape` is authored |
| `metalog` | `anchors: [{ value }]` (or `{ at }`; `{ prob, value }` when the value restates a source's stated quantile via `quantile: "pNN"`), `lower_bound` (or `boundedness`+`lower`), `upper_bound` (or `boundedness`+`upper`), `zero_mass` (mass at the lower bound — the $0 free-tier hurdle), `k` (or `terms`) |
| `piecewise` | `anchors: [{ prob, value }]` — monotone interpolation through stated quantiles: log-linear between positive points, linear (floored at 0) when one is ≤ 0, end segments extended. The simulator's own fallback rule; `scaffold.py` emits it where an exact metalog can't be fit (a point on a bound) |

**Free-tier / hurdle model:** use a `metalog` with `zero_mass`, or a `weighted_combination` with a
`point_mass` component at the boundary. (Not a `splice` of a `point_mass` — a splice partitions by
x-value and degenerates on a point-mass body.)

**Don't hand-solve params — use the preview/fit tool:**
```
python3 compiler/preview.py '{"kind":"lognormal","median":9,"sigma":0.64}'   # percentiles + mean + support
python3 compiler/preview.py fit beta p10=0.25 p90=0.70                        # params from target quantiles
python3 compiler/preview.py fit lognormal p50=9 p90=20                        # (also: normal, gamma)
```
(σ shortcut for a lognormal: `sigma = ln(p90/p10) / (2·1.2816)`.)

## Value types — prefer grounded over judged

Most→least grounded: **`direct_value`** (a figure read from a source as-is — bare: `reference` +
`measure`, no `process`/`reasoning`) and **`computed_value`** (derived by a `formula`, e.g. a
splice tail's `scale = slope_match(...)`) are preferred; **`inferred_value`** is for a number set
by genuine judgement (e.g. shape params fit to a target) and must carry `reasoning` + `confidence`.
The compile summary prints the **grounding mix** and flags a node set that leans mostly on
*bare* `inferred_value` (no reference) — a nudge to check whether any could be read direct or computed.

**Compute your distribution params — don't infer them.** A parametric shape param is usually a
*closed form of two source quantiles*, so it should be a `computed_value` (grounded, checkable),
not an `inferred_value` (a hand-tuned number). For a lognormal / normal fit to a p10/p90 (or
p05/p95) pair of source observations `<lo>`, `<hi>`:

| kind | param | computed_value formula |
|---|---|---|
| lognormal | `median` | `exp((log(<lo>.value) + log(<hi>.value)) / 2)` |
| lognormal | `sigma` | `(log(<hi>.value) - log(<lo>.value)) / <z-spread>` |
| normal | `mean` | `(<lo>.value + <hi>.value) / 2` |
| normal | `sd` | `(<hi>.value - <lo>.value) / <z-spread>` |

`<z-spread>` = `2.5631` for p10/p90, `3.2897` for p05/p95. `compiler/preview.py fit lognormal
p10=… p90=…` prints these formulas ready to paste (replace `<lo>/<hi>` with your two source obs).
This turns a lognormal/normal node from 2 inferred params into 2 **computed** ones — fully
grounded, zero judgement. `inferred_value` then remains only for genuinely un-formulaic params
(beta `alpha`/`beta`, a splice `shape`) where no closed form exists.

## Grounding — the corpus and the observation writer

A value's `reference` resolves to `in_<id>` (a node input), or `doc_<sha>/obs_<id>` / `gk_<id>` /
`spec_<id>` in the shared `corpus/` (obs/gk/spec ids also resolve when used directly inside a
`formula`, e.g. `extrapolate_cagr(obs_x.series, 2026)`). The compiler **warns** when a `reference`
is present but does not resolve (id not found) or resolves without a scalar (I4). Corpus starts
empty; add entries with the file-locked, schema-checked writers (safe for parallel agents):
```
python3 ../startup-forecaster/agentic-fetcher/add_observation.py doc_<sha> obs_<id> --unit "…" --statement "…" \
    --quote "<verbatim from the core>" --cited-by project::node \
    [--value <v> | --mean <v> | --interval "lo,hi" | --quantiles "p10:v,p50:v" | --series "2021:v,2024:v"]
python3 ../startup-forecaster/agentic-fetcher/add_observation.py doc_<sha> obs_<id> --quote "…" --check   # verify only, no write
python3 ../startup-forecaster/agentic-fetcher/add_knowledge.py gk|spec  <id> --statement "…" --reasoning "…" [--value <v> --unit …]
```
The quote is matched against `cores/doc_<sha12>.txt` after normalizing whitespace + unicode
(dashes/quotes/NBSP), so a figure split across lines or an en-dash still verifies
(`verification: verified | not_in_doc | unverifiable`). `--series` feeds `extrapolate_cagr/linear`.
Note: a prior-run artifact `a_<sha>` is the same content as the corpus `doc_<sha>`.

The compile **grounding-mix** readout counts a *bare* `inferred_value` (no reference) apart from a
grounded one (a shape param fit to a referenced anchor is fine); it nudges only on bare judgement.

**Need a source you don't have?** See `../startup-forecaster/agentic-fetcher/SOURCING.md` — the ladder is: search the archive
(`../startup-forecaster/agentic-fetcher/search.py`) → WebSearch/WebFetch to find it → if you can get the bytes,
`../startup-forecaster/agentic-fetcher/install_source.py <file> --url <url> --title "…"` (archives + extracts a searchable core +
registers the `doc_<sha>`), then `add_observation` against it → if it's gated/paywalled/JS-rendered,
`../startup-forecaster/agentic-fetcher/fetch_request.py add --url … --for project::node` to pool it into the human-fetch queue and
leave the node as `missing_document` debt. At end of run the human works `fetch_request.py list`,
installs the files (which auto-resolves the queue), and a follow-up pass grounds the freed nodes.

## Out of scope

- Cross-node / corpus-correlation checks — which nodes use an observation is derived on demand from the
  node references by `agentic-fetcher/citations.py`, never stored on the observation.
