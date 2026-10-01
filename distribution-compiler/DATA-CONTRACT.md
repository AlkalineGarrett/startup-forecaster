# The consumer contract

What the compiler produces and how a simulator (or any reader) consumes it. The authoring format is
[`schema/SCHEMA.md`](schema/SCHEMA.md); the compiler's per-kind key table is
[`compiler/DESIGN.md`](compiler/DESIGN.md). [`montecarlo-engine`](../montecarlo-engine) implements this
contract (`pipeline/gen-distributions.mjs` reads the compiled artifacts; `src/distributions.ts` samples them).

---

## 1. Where the data is

| | file | what it is |
|---|---|---|
| source | `projects/<project>.json` | one file per project; human/agent-authored, lean (subset of slots filled) |
| **compiled** | `build/<project>.compiled.json` | **consume this** — the same node set with every derived slot filled and checked, plus a `_meta` block |

The build artifact is produced by `python3 compiler/compile.py projects/<project>.json --write`.
Consume the **compiled** artifact, not the source: in it, every `computed_value` formula is
evaluated, every reference resolved to a scalar, and `debug_computed_percentiles` filled.

`_meta`: `{ project, source_sha256, errors, warnings, nodes, authored, todo }`.
- `source_sha256` — a canonical-JSON (parsed, key-sorted) freshness stamp of the source. If it does
  not match `canon_hash(projects/<project>.json)`, the artifact is stale — recompile before reading.
- `errors: 0` and `todo: 0` ⇒ every node in that project is authored and valid. A node still
  `todo` (its `distribution` is `null` / it carries `_todo`) is not yet authored.

Merge across the build files for the full node set; each build's `_meta.nodes` says how many it holds.

## 2. Node keys and variants

Nodes are an object keyed `"project::node"`. A variant node is keyed `"project::variant::node"` and
carries a `variant: { base_project, variant }` field — it is authored separately but shares
structure with its base (invariant I17). E.g. a base `habit-app::churn` with variants
`habit-app::family::churn` and `habit-app::coach::churn`.

## 3. The node record

The full record is specified in [`schema/SCHEMA.md`](schema/SCHEMA.md) §3. A sampler needs only
`distribution` (§4), `truncation` (§5) and — to validate itself — `debug_computed_percentiles` (§6);
`unit`, `model_definition`, `support_score`, `reasoning`, `reconciliation`, `cross_checks` are provenance for
display. A variant node carries `variant: { base_project, variant }`.

Every numeric slot is a **value object**: `{ value_type, reference?, measure, formula?, … }`. The
consumer reads `measure.value` — the resolved scalar (filled in the compiled artifact). A `measure`
states only what the source gave: one of `value` / `mean` / `mode` (scalars), `interval {low,high}`,
`quantiles {p10:…}`, `points {label:…}` (named, non-probability), or a dated `series`.
`value_type`, `reference`, `process`, `reasoning`, `confidence` are provenance — ignore them for
sampling.

## 4. The distribution contract (the sampling spec)

`distribution.kind` **is** the family. Realize the kind from its params and sample by
inverse-transform: draw `U ~ Uniform(0,1)`, return `Q(U)` (the quantile function).
**`compiler/distributions.py` is the executable reference**: `construct(kind, params)` → a `Dist`
with `.ppf(U)` (the sampler), `.cdf(x)`, `.percentiles()`. `compiler/build_dist` (in `compile.py`)
turns a compiled node's `distribution` block into that `Dist` — reuse it directly, or port the math
below.

**Parametric** (scipy `ppf`) — params are scalars (`measure.value`):

| kind | params | support |
|---|---|---|
| `lognormal` | `median`, `sigma` (log-space σ) — X = exp(μ+σZ), median = exp(μ) | (0, ∞) |
| `beta` | `alpha`, `beta` | (0, 1) |
| `normal` | `mean`, `sd` | ℝ |
| `gamma` | `shape`, `rate` (scale = 1/rate) | (0, ∞) |
| `uniform` | `low`, `high` | [low, high] |
| `generalized_pareto` | `location`, `scale`, `shape` | [location, ∞), or bounded above if shape<0 |

**Structural** — params descend into sub-objects (each a value object with a filled `measure.value`):

- `point_mass` — `atoms: [{ value, weight }]`. Weights renormalize to a discrete/weighted step
  quantile. (A single atom is a deterministic constant.)
- `weighted_combination` — `components: [{ distribution, weight }]`. A mixture: **sample a component
  by weight, then sample that component.** A `point_mass` component gives a hurdle / two-part model
  (e.g. a mass at 0 plus a lognormal). An infinite-support component keeps the mixture unbounded on
  that side — do not clamp it to a finite neighbour.
- `splice` — `segments: [ body, tail ]` joined at `splices[0].at` (an **x-value**). Let
  `p* = F_body(at)`. Sample `U`: if `U ≤ p*` return `Q_body(U)`, else `Q_tail((U − p*)/(1 − p*))`.
  Canonical case: a parametric body + a `generalized_pareto` tail whose `scale` is `slope_match`ed
  at the join (so the density is continuous); the tail's `location` and `at` share the same value.
- `metalog` — `anchors: [{ value }]` at plotting positions `i/(n+1)`, or `{ prob, value }` when the value
  restates a source's stated quantile; `k`-term least-squares fit; `lower_bound` and/or `upper_bound` (the
  semi- or doubly-bounded variants, via the log / log-odds transform) and `zero_mass` (a point mass at the
  lower bound — the free-tier hurdle). `Q(y)` is the fitted metalog quantile, guaranteed monotone.
- `piecewise` — `anchors: [{ prob, value }]` through stated quantiles: `Q` interpolates log-linearly
  between two positive points and linearly (floored at 0) when one is ≤ 0, extending the end segments past
  the outer points. Used where an exact metalog can't be fit (a stated point on a bound).

## 5. Truncation

`truncation: { lower?, upper? }` conditions the distribution on `[lower, upper]` **before**
percentiles are derived, so a sampler must condition too: with `ca = F(lower)`, `cb = F(upper)`,
draw `U` and return `Q(ca + U·(cb − ca))`. `distributions.truncate(dist, lower, upper)` implements
it. Only bounds that actually clip are present; a node without `truncation` is unbounded per its kind.

## 6. Percentiles are a derived readout, not the input

`debug_computed_percentiles` `{p05,p10,p50,p90,p95}` is read off the constructed distribution for
cross-checking and display. **Do not sample it** — sample the construction in §4. Use it to
validate your sampler: empirical quantiles of your draws should match these within noise.

## 7. Reference

- **Realize / sample:** `compiler/distributions.py` (`construct` / `Dist.ppf` / `Dist.cdf` /
  `truncate`) and `compiler/build_dist` in `compile.py`. Reuse directly (Python) or port §4–§5.
- **Full field spec:** `schema/SCHEMA.md`; machine schema `project-distributions.schema.json`.
- **Formula grammar** (already evaluated in the compiled artifact): `compiler/formula.py`, DESIGN.md.
