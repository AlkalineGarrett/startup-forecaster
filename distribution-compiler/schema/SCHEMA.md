# The project-distributions schema — grounded · constructed · derived

**This file is the normative spec.** `schema-grounded.html` is its illustrated companion
(worked examples + density graphs); where they differ, this file wins.

A node states a **distribution** that is **constructed** from grounded evidence. Percentiles
are a **derived** readout of that construction — never authored. Everything traces to a
source in a shared corpus.

Three laws:

1. **Constructed, not authored.** A node's distribution is built — atoms with an allocation,
   a parametric family with grounded params, a weighted combination, or a fit to an observed
   sample. The object a node contributes is a distribution, not a number.
2. **Percentiles are derived.** No node stores authored quantiles. `debug_computed_percentiles`
   is a throwaway readout recomputed from the construction.
3. **Everything traces to a source.** Every measure references a document/observation, a
   named reference-class prior, or a tracked gap (`reference: null` + `missing_document`).
   Judgement enters only as a documented adjustment.

---

## 1. Top-level shape

```jsonc
{
  "documents":        { "doc_<sha256[:12]>": { … } },   // shared corpus — referenced by id
  "general_knowledge":{ "gk_<id>": { … } },
  "speculations":     { "spec_<id>": { … } },
  "nodes":            { "project::node": { … } }
}
```

Documents, observations, general knowledge, and speculations are a **shared corpus at the
root**. A fact used by many nodes is *one* observation, referenced by id; that shared id is
the correlation record. A node holds no evidence of its own — only references into the corpus.

---

## 2. The shared corpus

### document — `doc_<sha256[:12]>`

| field | type | rule |
|---|---|---|
| `sha256` | string | content hash = identity; identical bytes are one record |
| `title` · `url` · `publisher` | string | provenance |
| `origin` | enum | `primary \| secondary \| internal` |
| `trust_score` | int 0–100 | source trust |
| `capture` | enum | `full_text \| image_only \| js_shell \| partial \| failed` |
| `core` | path | lean, image-OCR'd text a reader opens instead of the raw file |
| `derivation` | object? | present only if computed from others: `{ method, from[], how, script? }`; every `from` id resolves |
| `observations` | `{ obs_id: observation }` | facts drawn from this document |

### observation — `obs_<id>` (under a document)

| field | type | rule |
|---|---|---|
| `statement` | string | the fact in words |
| `measure` | measure | the magnitude (§7); may be `null` for a purely qualitative fact |
| `quote` | string \| **null** | verbatim sentence from the doc's `core`. May be `null` when the figure is read from a non-textual capture (a chart/table image) — pair with `capture_note`. |
| `capture_note` | string | why there is no verbatim quote — e.g. *"value read from a chart/table image; verbatim sentence not extracted"*. Present iff `quote: null`. |
| `locator` | string | where in the doc |
| `verification` | enum | four states: |
| `blocked_on` | string | present iff `verification: unverifiable` — names what unblocks it, e.g. *"OCR sidecar for chartmogul PDF benchmark table"* |

*(There is no `cited_by` field. Which nodes use an observation is derived on demand from the node
references in `projects/*.json` — see `agentic-fetcher/citations.mjs` — never stored, because a stored
list drifts into stale/phantom entries.)*

**`verification` states**:

- `verified` — a non-empty `quote` is present in the document's `core`.
- `unchecked` — not yet swept.
- `not_in_doc` — the doc *was* swept and the claimed figure is **not** there (a negative
  result, not an open gap).
- `unverifiable` — the value is real but from a source not yet parseable (scanned PDF, image);
  carries `blocked_on`, and typically `quote: null` + `capture_note`.

### general_knowledge — `gk_<id>`
`{ statement, measure, reasoning }` — a broadly-held reference-class prior admissible without a
single citation. `reasoning` explains why it is admissible.

### speculation — `spec_<id>`
`{ statement, measure, reasoning }` — a stated-but-unsourced load-bearing guess. Distinct from
an observation (has a doc + quote) and from general_knowledge (broadly held). Low `confidence`
and the `spec_` prefix flag the risk. `reasoning` = why we lean on it and what would confirm it.

---

## 3. The node — `project::node` (under `nodes`)

The project-axis distribution the model consumes. Fields, in order:

```jsonc
{
  "unit": "…",
  "model_definition": "what this quantity is",
  "variant": { "base_project": "…", "variant": "warm|cold|…" },   // optional lineage
  "inputs": { "in_<id>": value },                                  // optional, §6

  "truncation":     { "lower?": bound, "upper?": bound },          // optional — only real clips
  "distribution":   { "kind": "…", … },                            // §4 — the build
  "reconciliation": { "process": "…", "reasoning": "…" },          // optional — how sources combined
  "cross_checks":   [ cross_check ],                               // optional — §5
  "support_score":  0-100,                                         // node-level groundedness
  "reasoning":      "…",                                           // the rationale for support_score
  "debug_computed_percentiles": { "p10": …, "p50": …, "mean": … }  // throwaway readout, never authored
}
```

- **`truncation`** — optional `{ lower?, upper? }`; only bounds that actually **clip** beyond the
  distribution's natural domain. Each is a fixed `{ value }` or a `{ reference }`. Omit what the
  family already gives (`lower:0` under a lognormal, `[0,1]` under a beta).
- **`reconciliation`** — optional `{ process, reasoning }`; how multiple/conflicting sources were
  combined (spanned both / superseded the weaker / anchored on the primary). Its `reasoning` is
  about the *combination*, distinct from the support rationale.
- **`support_score` + `reasoning`** — a single 0–100 node-level groundedness read and its
  rationale (which parts are evidenced, which are guesses, where judgement enters).
- **`debug_computed_percentiles`** — percentiles/mean read off the construction; recomputable;
  never authored. If they drift from the construction, the construction wins.

---

## 4. `distribution` — the build (kind = family)

`kind` **is** the family; it selects the required fields. There is no separate `family` axis.

- **Structural** (3): `point_mass`, `weighted_combination`, `splice`.
- **Quantile-parameterized** (1): `metalog`.
- **Parametric families** (extensible): `lognormal`, `beta`, `normal`, `gamma`, `uniform`,
  `generalized_pareto`, …

### 4.1 point_mass — fixed regimes
`{ "kind": "point_mass", "atoms": [ atom ], "allocation": allocation }`. Mass lives **only** at
the atoms (a PMF). Use when the "modes" are fixed authored regimes, not sampled data.

**atom** — a `value` (§6) whose `measure` gives the position, plus a `weight` scalar:
`{ name, <value trail>, weight }` (the position may also be nested under `value`). The `weight`'s
provenance is the single `allocation`. (`at` is reserved for a splice transition, not an atom.)

### 4.2 weighted_combination — a weighted blend
`{ "kind": "weighted_combination", "components": [ component ], "allocation": allocation }`.
Recursive: a component is any distribution.

**component** — `{ name, distribution, weight }`. `distribution` is any nested build; its params
carry their own trails, so a component needs no separate one.

### 4.3 splice — one distribution transitions into another
`{ "kind": "splice", "segments": [ segment ], "splices": [ splice ] }`. The support is **partitioned**:
each segment governs a consecutive slice and hands off to the next at a threshold. This is the
*transition* combinator — in contrast to `weighted_combination`, which **overlays** distributions (a
mixture, each spanning the whole support). A splice of `n` segments has `n − 1` splices; each
`at` threshold sets the mass in each segment (a splice's grounded transition decision, the analogue
of an `allocation`).

**segment** — `{ name, distribution }`. A full distribution (recursively) governing one slice of the
support, ordered lower → upper. A parameter tied to a splice isn't re-authored: a `generalized_pareto` `location` references the same
value as the splice `at`, and its `scale` is a `computed_value` = `slope_match(...)`.

**splice point** — `{ at }`. The handoff between two consecutive segments:
- `at` — the threshold, a `value`: a **position** (in the quantity's unit, when the lower segment is
  continuous — the tail's `location` references the same value) or a **mass fraction** (when the lower
  segment is a point mass). A grounded judgement about where one regime hands off; it sets the mass in
  each segment.

The canonical use is a **heavy tail**: a body (e.g. `lognormal`) spliced with a `generalized_pareto`
segment past the threshold — its `location` references the same value as the splice `at`, its `scale`
is `slope_match(...)`, and only its `shape` is authored (grounded in the mean) — the modelled heavy
tail of principle 6, never a hard cap.

```jsonc
"distribution": {
  "kind": "splice",
  "segments": [
    {
      "name": "body",
      "distribution": { "kind": "lognormal", "median": { … }, "sigma": { … } }
    },
    {
      "name": "tail",
      "distribution": {
        "kind": "generalized_pareto",           // 3 params: location + scale + shape; the splice pins the first two
        "location": {                           // μ = the shared threshold value (also used by the splice `at`)
          "value_type": "direct_value",
          "reference": "in_body_ceiling"
        },
        "shape": {                              // ξ — the one authored param, grounded in the mean
          "value_type": "inferred_value",
          "reference": "obs_mean",
          "measure": { "value": 0.75 },
          "process": "solved ξ so the spliced distribution reproduces the stated mean",
          "reasoning": "the mean sits above the body's implied mean, demanding a heavier tail"
        },
        "scale": {                              // σ — a computed_value, slope-matched at the splice (C¹)
          "value_type": "computed_value",
          "formula": "slope_match(segments[0], splices[0])"
        }
      }
    }
  ],
  "splices": [
    {
      "at": {                                   // the threshold — the same value the tail's `location` uses
        "value_type": "direct_value",
        "reference": "in_body_ceiling"
      }
    }
  ]
}
```

Here `in_body_ceiling` is a node `input` (§6) — the single grounded judgement of *where the body ends*;
both the splice `at` and the tail's `location` reference it, so the threshold lives in one place.

### 4.4 metalog — an observed sample fit to a curve
`{ "kind": "metalog", "lower_bound?": …, "upper_bound?": …, "zero_mass?": …, "k": int, "anchors": [ anchor ] }`.
*(The compiler reads these keys; `boundedness`+`lower`/`upper`/`terms` are accepted as aliases for
`lower_bound`/`upper_bound`/`k`. See `../compiler/DESIGN.md` for the exact per-kind key table.)*

The observed values are an **ordered sample**; each anchor's percentile is its **rank**
(plotting position `i/(n+1)`), not authored. A metalog (a quantile-parameterized distribution)
fits the anchors into a smooth curve. `lower_bound` gives the lower-semi-bounded variant (e.g. `0`
for a non-negative price). **Free-tier / hurdle model** (e.g. a $0 tier): set `zero_mass` to the
probability mass at the lower bound — that fraction sits exactly at `lower_bound`, the rest is the
metalog curve. (Do **not** splice a `point_mass`: a splice partitions by x-value and degenerates
on a point-mass body. A `weighted_combination` with a `point_mass` component is the other valid
route.) No weights — the *spacing* of the values carries the density.

**anchor** — `{ name, value, <value trail> }`. `value` is one observed value; usually `direct_value`
with a `reference` to its observation. Its percentile is its rank position (the `i`-th of `n`
sorted anchors sits at `p = i/(n+1)`), so **no percentile is stored**. Unlike an atom it carries
**no weight**.

**Stated quantiles.** When the source itself *states* percentiles (`measure.quantiles` — an
elicited band, a published p10/p50/p90, or a speculation recording a model's authored judgement),
each anchor restates one of them: `{ prob, value: { value_type: "direct_value", reference, quantile:
"pNN" } }` with `prob` = that quantile. The percentile is then the source's, not authored here
(I1 holds); the compiler checks each value against the stated point. `compiler/scaffold.mjs` emits
exactly this when lifting a simulator's hand-authored node into a project file.

### 4.4b piecewise — interpolation through stated quantiles
`{ "kind": "piecewise", "anchors": [ { "prob", "value" } ] }`. Only for **stated** quantiles (each
anchor restates one, `quantile: "pNN"`): the quantile function runs log-linearly between two positive
points and linearly (floored at 0) when one is ≤ 0, and the end segments extend past the outer
points. Use it where an exact metalog cannot be fit — a stated quantile sitting on a bound (a
"p10 = $0" fee, a fraction's p99 = 1) — rather than inventing boundary mass. It carries no shape
assumption beyond the points, which is also why it should be replaced as soon as evidence allows.

### 4.5 parametric families
Each states its own named parameters directly, every param a `value`:

| kind | params | note |
|---|---|---|
| `lognormal` | `median`, `sigma` | median (e^μ) and log-sigma |
| `beta` | `alpha`, `beta` | naturally bounded to [0,1] |
| `normal` | `mean`, `sd` | symmetric |
| `gamma` | `shape`, `rate` | shape k, rate β; heavy near zero |
| `uniform` | `low`, `high` | flat band; e.g. a near-zero structural band |
| `generalized_pareto` | `location`, `scale`, `shape` | three params: μ (threshold), σ, ξ. As a `splice` tail segment `location` references the same value as the splice `at`, and `scale` = `slope_match(...)`, so only `shape` (grounded in the mean) is authored |

### 4.6 allocation — the one mass-split decision
`{ constraint, references[], process, reasoning, confidence }`. On `point_mass` /
`weighted_combination`.

- `constraint` — a boolean predicate over the build's own fields, written as an **executable
  formula**: `"sum(atoms[].weight) == 1"` (or `components[]`). The probability-simplex rule,
  spelled out — not a magic word. Weights are non-negative (they are masses).
- `references` — obs/gk that ground *the split* (positions have their own references). Plural
  references are how conflicting grounded sources are spanned, not rejected.
- `process` — the logic of the split (which component takes the plurality, how the remainder
  divides); not a re-listing of the weights.
- `reasoning` · `confidence` — the self-contained why, and one firmness score for the whole
  decision.

---

## 5. cross_check — corroboration / refutation
An item of `cross_checks[]`. A figure that agrees with or disproves the built distribution but
anchors **no part** of it.

| field | type | rule |
|---|---|---|
| `id` · `reference` · `measure` | | an ordinary `value`; may be a `computed_value` with a `formula` |
| `usage` | enum | `corroboration \| refutation` — one list holds both |
| `superseded_by` | ref | present only on a `refutation` — the observation that replaced the disproven claim |
| `process` · `reasoning` · `confidence` | | the comparison run, the self-contained why, and firmness |

A grounded refutation survives (it is not silently discarded); a party-disagreement rejection
does not exist in this schema.

---

## 6. value — the recurring trail, `inputs`, `basis`

### value
The shape behind every grounded number — a param, an atom, an anchor, a splice `at`, an input, a
cross-check, a `generalized_pareto` shape, a truncation bound.

| field | type | rule |
|---|---|---|
| `value_type` | enum | open, suggested: `direct_value \| value_bounds \| inferred_value \| computed_value \| directional`. `direct_value` takes the source number as-is (no `process`/`reasoning`) — including one that just *references a shared value* by id (an input, another value); a `computed_value` carries a `formula`; the others transform it. |
| `reference` | ref \| null | → observation / general_knowledge / speculation / input by id (`obs_`/`gk_`/`spec_`/`in_`). `null` = a specific document is intended but not yet archived — a counted gap. |
| `quantile` | `pNN`? | select one stated quantile of the referenced measure's `quantiles` (e.g. `"p10"`) — the value restates that point, so a `direct_value` is checked against it exactly |
| `references` | `[ ref ]` | plural, when the value spans several grounded sources |
| `formula` | string | for a `computed_value` instead of a `reference` — §6.1 |
| `measure` | measure | the number held (§7); required unless `direct_value` |
| `basis` | object? | metric comparability — §6.2 |
| `process` · `reasoning` · `confidence` | string · string · int 0–100 | the mechanical how, the self-contained why, firmness. On any non-`direct_value`. |
| `missing_document` | string | present iff `reference: null` — names the document to find |

### 6.1 formula grammar (closed function vocabulary)
A `computed_value.formula` is **one grammar**: an expression over ids (`obs_x.value`, `in_y.value`,
`obs_z.series`) **and** the distribution's own structure (`segments[i]`, `splices[i]`), with literals,
arithmetic (`+ - * / ( )`) and a **closed** function set — extensible only by a spec change:

| function | meaning |
|---|---|
| `min(a, b, …)` / `max(a, b, …)` | **pick** among grounded alternatives (e.g. bottom-up vs top-down) — the choice, not a blend |
| `extrapolate_cagr(series_ref, target_period)` | compound-annual-growth extrapolation of a series observation to a target period |
| `extrapolate_linear(series_ref, target_period)` | linear-trend extrapolation of a series to a target period |
| `slope_match(segment, splice)` | the C¹ tail `scale` σ matching a body segment's density at a splice |

Operands resolve by id (I4) or structural reference (`segments[i]`, `splices[i]`); `series_ref` points
at an observation carrying a `series` (§7). No other functions are permitted.

### 6.2 basis — metric comparability
Optional on a `value`/`input`. Marks *what kind* of metric a number is, so incompatible metrics
are not reconciled silently:

```jsonc
"basis": { "metric": "logo | revenue | count | rate | …", "unit_of": "user | account | business | seat | …" }
```

Combining a logo-retention and a revenue-retention figure in one node is a real modeling error,
not a formatting nit. See invariant I21.

### inputs — `in_<id>` (node-local named Values)
A computed/inferred/bounded number defined **once** and referenced by id from the distribution,
cross_checks, and truncation. `{ name, value_type, reference|formula, measure, population,
basis?, process, reasoning, confidence }`. Inputs form a DAG (I19): a value reused in two places
is one input, not two copies.

---

## 7. measure — the superstructure
One object; only the parts the source states. Never force-fit into a p10/p50/p90 template.

```jsonc
"measure": {
  "unit": "…",
  // ---- the magnitude: whichever the source actually states ----
  "value": …,                                  // an exact scalar
  "mean": …,                                   // arithmetic mean (grounds a `splice` tail's shape, §4.3)
  "mode": …,                                   // most common value
  "interval": { "low": …, "high": … },         // a stated range
  "quantiles": { "p25": …, "p50": …, "p90": … },// stated percentile points
  "series": [ { "period": "2019", "value": 13120 },  // a dated time series
              { "period": "2023", "value": 14260 } ],
  // ---- the context that gives the magnitude meaning ----
  "population": "…",                            // who/what it is over
  "period": "…",                               // when (the date lives here)
  "denominator": "…"                           // the base a rate/share is taken against
}
```

**`series`** — an ordered list of `{ period, value }` points for a dated multi-point
source (e.g. a census count across years). It is a first-class magnitude form alongside
`value`/`mean`/`interval`/`quantiles`, and is the operand `extrapolate_cagr` /
`extrapolate_linear` consume (§6.1).

---

## 8. Invariants

Each is checkable; the build fails if it does not hold. A script verifies **shape**; support,
aboutness, and sameness are read by an agent.

- **I1 — Percentiles never authored.** No node stores input quantiles; `debug_computed_percentiles`
  is a recomputed throwaway readout of the distribution. *(P4)*
- **I2 — Distribution complete for its kind.** point_mass: atoms+allocation · weighted_combination:
  components+allocation · splice: ≥2 segments + a splice each · metalog: ≥2 ordered anchors + boundedness · a parametric kind: all its
  named params. *(P3)*
- **I3 — Constraint holds.** `allocation.constraint` evaluates true (e.g. `sum(atoms[].weight)==1`);
  weights non-negative. *(P3)*
- **I4 — Referential integrity.** Every `reference` — in allocation, a truncation bound, a param, a
  `splice` threshold, a formula operand — resolves to an observation/gk/speculation/input. *(P7)*
- **I5 — Every measure grounds out.** A measure the node uses matches an observation's own or is a
  documented adjustment in `reasoning` — never a bare number. *(P7)*
- **I6 — Verification is honest.** `verified` ⇒ a non-empty `quote` present in
  the doc's `core`. `unchecked`/`not_in_doc` carry no quote. `unverifiable` carries a `blocked_on`
  (and typically `quote: null` + `capture_note`). A `null` quote is allowed **only** with a
  `capture_note` and a non-`verified` state. *(P7)*
- **I7 — Widen only on grounded conflict.** A wide interval traces to ≥2 grounded sources that
  disagree (spanned, neither rejected), or an evidenced heavy tail — never hedging or a guess. *(P5)*
- **I8 — Tails are modelled, not capped.** a heavier-than-body tail is a `splice` whose upper segment
  is a `generalized_pareto` (its `shape` grounded in the mean, its `scale` derived by a `slope_match`
  splice) — never a hard cap or a `truncation`/`upper` bound standing in for one. *(P6)*
- **I9 — One interpretation.** No rival versions, no rejected alternatives, no back-pointers; a node
  states one distribution and its evidence. *(P1)*
- **I10 — Native measure, no template.** A measure records only the parts the source states —
  including `series` for dated multi-point sources; no measure is back-filled into a p10/p50/p90
  shape. *(P2)*
- **I11 — Dedup & correlation.** Two references to the same `(statement, measure)` share one
  observation. Which nodes use it is derived on demand from `projects/*.json`
  (`agentic-fetcher/citations.mjs`), never stored — a stored list would drift into stale/phantom
  entries. *(P1)*
- **I12 — One path to evidence.** A node reaches a document only via
  `distribution → reference → observation → its document` in the shared corpus; there is no per-node
  evidence list. *(P7)*
- **I13 — Derived documents show their work.** A document with a `derivation` carries
  `{ method, from[] }` and every `from` resolves. *(P7)*
- **I14 — Ready = no open gap.** A node is ready iff none of its references is `null`. *(P7)*
- **I15 — Null is a tracked gap.** Any `reference: null` requires a `missing_document`; the build
  reports the null count as evidence debt. *(P7)*
- **I16 — Well-formed & unit-consistent.** Derived quantiles non-decreasing; any `truncation` bounds
  order and lie within the distribution's own range; `unit` agrees with `model_definition`. *(P3)*
- **I17 — Variants track base.** Every `::variant` node stays consistent with `variant.base_project`.
  *(P1)*
- **I18 — Nothing dangles.** A grounded figure the distribution doesn't consume goes into
  `cross_checks` with a `usage`; a `refutation` carries a resolving `superseded_by`. No checked-and-disproven
  figure is silently discarded. *(P7)*
- **I19 — Inputs form a DAG.** Every `in_` id in a formula/reference resolves to an observation, gk,
  or an *earlier* input; no cycles. A value reused twice is one input. *(P7)*
- **I20 — Splice is grounded.** a `splice`'s `segments` partition the support in order; each `splice` point
  carries an `at` threshold. A `generalized_pareto` tail segment's `location` references the same value
  as that `at`, and its `scale` is a `computed_value` = `slope_match(...)`, leaving `shape` (ξ) as the
  one authored param, grounded in a source `mean`; add one only when the mean demands it. *(P6)*
- **I21 — Basis comparability.** Operands combined in one node share a compatible `basis`;
  a `metric`/`unit_of` mismatch (e.g. logo- vs revenue-retention) is flagged, never silently
  reconciled. *(P2)*
- **I22 — Closed formula vocabulary.** One grammar: a `formula` uses only arithmetic and the closed
  function set (`min`, `max`, `extrapolate_cagr`, `extrapolate_linear`, `slope_match`); every operand
  resolves — an id (`obs_`/`gk_`/`in_`) or a structural reference (`segments[i]`, `splices[i]`);
  `extrapolate_*` targets a `series`. *(P7)*

**Mechanical** (script-checkable): I1–I4, I6 presence, I11 dedup key, I12–I16, I20, I22.
**Semantic** (read by an agent): every `value_type`/`measure`, `trust_score`, whether a quote backs
the value, whether a width is truly demanded (I7), basis compatibility (I21), and observation
sameness (I11).

---

## 9. Principles

1. **One grounded interpretation.** Each node states a single distribution and its evidence.
2. **The measure is the atomic unit.** Record what the source says — value, interval, mean, mode,
   quantiles, or a dated series — never force-fit a template.
3. **Distributions are constructed, not authored.** Built from grounded measures; the object is a
   distribution, not a number. Combining nodes into outputs is the simulator's job.
4. **Percentiles are derived output, never authored.** Read off the constructed distribution when
   the simulator needs them.
5. **Widen only on grounded conflict.** An interval is wide because the evidence is wide.
6. **Heavy tails are modelled, not extrapolated.** Where a mean implies a heavier tail than the body
   quantiles, splice a Generalized Pareto tail (a `splice` with a `generalized_pareto` upper segment, shape from the mean); never a
   hard cap.
7. **Everything traces to a source.** Judgement enters only as a documented adjustment to a grounded
   construction.

---

## 10. Scope — where the schema stops

Every node is an **elicited leaf** — each holds
its own distribution; none is a formula over other nodes. Node **combination** (a Monte-Carlo
revenue simulation with a Gaussian copula over shared factors, Dirichlet regime-weight coupling)
lives in the **simulator**, downstream of this dataset, and is deliberately out of the project-axis distributions.
There is no `propagate`/`compose` kind and no node references another node.

---

## 11. Companion & provenance

- **`schema-grounded.html`** — the illustrated companion: a worked example + density graph for
  every kind (point_mass, weighted_combination, metalog, lognormal, beta, normal, gamma, uniform),
  the full field-by-field reference, and the invariants rendered.
- **`generators/`** — dependency-free scripts computing every param, percentile, and graph
  (`compute_params.mjs`, `metalog_fit.mjs`, `gen_graphs.mjs`, `gen_mix_viz.mjs`,
  `build_metalog_example.mjs`, `verify.mjs`). See `README.md`.
- **Verification:** `generators/verify.mjs` (`<pre>` span balance in the HTML companion).
