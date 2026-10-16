# Step `build-distributions`: build the nodes' distributions from their audited evidence

> **Required reading before this step's first action:** this whole file, [`PRINCIPLES.md`](PRINCIPLES.md) in
> full, and §3 (the node) and §8 (the invariants) of [`schema/SCHEMA.md`](schema/SCHEMA.md) in full; the rest
> of SCHEMA.md is reference for the fields you use. They are part of the step, not background: distributions
> built without them have not been built.

**Input:** the nodes whose evidence has passed `audit-evidence`: by default the ones just researched, or the
nodes the request names.

**Done when:** each node's distribution in `distributions/projects/<id>.json` is constructed from its
evidence, and every changed project compiles with 0 errors (`npx forecaster compile
distributions/projects/<id>.json`).

**Next:** `audit-distributions` (`audit-distributions.md`) for every node this step built or changed.

Paths here are the default layout: `distributions/` is the workspace's `distributionData` folder and
`sources/` its `groundingSources` folder (both set in `portfolio.config.mjs`).

## Principles (binding)

`PRINCIPLES.md` is the full set. The rules most often broken:

1. **Construct, then read.** The distribution is built from the evidence: `direct_value` references to
   observations, `computed_value` formulas over them, and `inferred_value` only where genuine judgement sets
   a number (with reasoning and a confidence). Percentiles are a read-out of that construction, never typed
   in.
2. **Anchor at the right probabilities.** A source's stated quantiles anchor at the source's own
   percentiles; elicited low / likely / high anchor at 10 / 50 / 90; raw data points anchor at plotting
   positions `i/(n+1)`.
3. **Widen only for grounded disagreement.** A disagreeing source widens the distribution only if it
   measures the same thing (same population, unit and period). One that measures something else is a
   cross-check (`cross_checks`, SCHEMA.md §5), not an anchor. Never widen because parties argue.
4. **Add to existing evidence; don't replace it.** When the node already has evidence, put the new
   observation into the construction (another anchor, input or component) or into `cross_checks`, and
   record how the sources were combined in `reconciliation`.
5. **Be honest about support.** Score `support_score` for what the evidence actually supports, including how
   many independent sources it rests on (three is the target), and write `reasoning` that stands on its own:
   what the sources say, how they were combined, what changed and why, and any source shortfall
   `ground-evidence` stated.

## Procedure

For each node in the input:

1. Open it in `distributions/projects/<id>.json` (a venture's variants have their own entries, keyed
   `<id>::<variant>::<node>`; change the ones the request is about).
2. Try shapes before writing them:
   ```sh
   npx forecaster preview fit <kind> p10=… p90=…                         # params from target quantiles
   npx forecaster preview '{"kind":"lognormal","median":9,"sigma":0.6}'  # percentiles of a construction
   ```
3. Write the construction: references to the observations, formulas, anchors, `support_score`,
   `reasoning`, and `reconciliation` / `cross_checks` where sources were combined.
Then compile each changed project: `npx forecaster compile distributions/projects/<id>.json` must report 0
errors. Read the warnings; each one is a question about a construction.
