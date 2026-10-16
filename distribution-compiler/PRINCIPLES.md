# Operating principles

How to work on the project-axis distributions in the grounded/constructed/derived format. Each principle
states what to do and why; each guards against a failure that happens in practice. The
compact source of truth is [`schema/SCHEMA.md`](schema/SCHEMA.md) §9 — this file is the expanded
version with the rationale.

## The seven principles

1. **One grounded interpretation.** Each node states a single distribution and the evidence behind
   it — no rival versions, no rejected alternatives, no back-pointers.
   *Why:* how a number was arrived at (who proposed what, which reading won) is an elicitation method,
   not part of the output; a node that narrates its adjudication cannot stand alone. Competing readings
   of a source resolve to one answer; a genuinely disproven figure survives only as a `cross_check`
   refutation.

2. **The measure is the atomic unit.** Record what the source actually says — a `value`, an
   `interval`, a `mean`, a `mode`, stated `quantiles`, or a dated `series` — in the `measure`
   superstructure, never force-fit into a p10/p50/p90 template.
   *Why:* a fixed percentile template forces sources that state a mean or a range into a shape they
   never had.

3. **Distributions are constructed, not authored.** A node's distribution is *built* from its
   grounded measures — atoms with an `allocation`, a parametric family with grounded params, a
   `weighted_combination`, a `splice`, or a `metalog` fit to an observed sample. The object a node
   contributes is a distribution, not a number.
   *Why:* hand-authored quantiles hide the judgement inside a number. Combining nodes into outputs is
   the simulator's job, not the project-axis distributions'.

4. **Percentiles are derived output, never authored.** You never hand-guess p10/p50/p90. They are
   read off the constructed distribution when the simulator needs them (`debug_computed_percentiles`
   is a throwaway readout).
   *Why:* the difference between an authored and a derived percentile *is* the guessing.

5. **Widen only on grounded conflict.** An interval is wide because the evidence is wide — two
   grounded sources disagree (spanned via plural `references`, neither rejected), or a heavy tail is
   evidenced. Never widen to hedge or to span a guess.
   *Why:* widening is a claim that uncertainty is real; it is wrong where one reading simply lacked a
   source another had (a coverage gap the union of evidence settles).

6. **Heavy tails are modelled, not extrapolated.** Where a source mean implies a heavier tail than
   the body quantiles support, splice a Generalized Pareto tail (a `splice` with a
   `generalized_pareto` upper segment, shape from the mean, scale slope-matched); never a hard cap.
   *Why:* a hard cap invents a maximum the evidence doesn't state; the mean is real information about
   the tail and should shape it.

7. **Everything traces to a source.** Every measure references a document/observation or a named
   reference-class prior; judgement enters only as a *documented adjustment* to a grounded
   construction, recorded in `reasoning`.
   *Why:* an un-sourced number is indistinguishable from an invented one. A specific-but-unarchived
   document is a `reference: null` with a `missing_document` — a counted gap, not a silent hole.

## Working rules

**The shared corpus is at the root.** Documents (each holding its observations),
general_knowledge, and speculations live once at the top level, referenced by id
(`obs_` / `gk_` / `spec_`). A fact used by five nodes is *one* observation those five nodes all
reference by that shared id — the shared id is the correlation record. Which nodes use it is *not*
stored on the observation (that list drifted stale); it is derived on demand from the node references
in `projects/*.json` (`agentic-fetcher/citations.mjs`). A node holds no evidence of its own.

**A value carries its trail.** Every grounded number — a param, an atom's/anchor's `at`, an input, a
cross-check, a splice threshold — is a `value`:
`{ value_type, reference|formula, measure, basis?, process, reasoning, confidence }`. `direct_value`
takes the source's number as-is (including a plain reference to a shared value); `computed_value`
carries a `formula`; the rest transform it.

**Inputs are the reuse layer.** A number used in several places is defined **once** as a node
`input` (`in_…`) and referenced by id — a DAG (I19). A later revision then changes one number, not
several copies.

**Reconcile, don't duplicate.** When multiple or conflicting sources combine into the distribution,
record how in `reconciliation { process, reasoning }` (spanned both / superseded the weaker /
anchored on the primary). A grounded refutation that anchors no part of the build goes in
`cross_checks` with `usage: refutation` and a resolving `superseded_by`.

**Support is one node-level score.** `support_score` (0–100) rates how grounded the whole
distribution is; the node's one free-standing `reasoning` says why — which parts are evidenced, which
are guesses, where judgement enters. Every construction piece already carries its own
`process`/`reasoning`.

**Verification is a spectrum, not a checkbox.** `verified` means the quote is present in the
document's `core`; `unchecked`, `not_in_doc` (swept, figure absent), and `unverifiable` (real but not
yet parseable — carries `blocked_on`) are distinct, honest states. A number read off a chart image is
`quote: null` + a `capture_note`, not a fabricated quote.

**Retrieval before declaring a gap.** Blocked is not the same as unavailable. Search the archive
(`npx startup-forecaster search`), then fetch the page with `curl` or a web-fetch tool (normalise the URL; try the
page's own API), and only then queue it `human_only` for a person to fetch in their own browser
(`agentic-fetcher/ground-evidence.md`). Never drive an automated browser. Record a `reference: null` only
once the request is queued, and archive what you retrieve when you retrieve it.

**Scripts check structure; meaning is read.** A script verifies shape (an id resolves, a quote is
present, a constraint evaluates, quantiles order). It never asserts support, aboutness, or sameness —
those are read by an agent. See `schema/SCHEMA.md` §8 (invariants).
