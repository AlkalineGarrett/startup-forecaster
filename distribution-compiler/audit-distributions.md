# Step `audit-distributions`: audit each distribution against its evidence

> **Required reading before this step's first action:** this whole file, and [`PRINCIPLES.md`](PRINCIPLES.md)
> in full (the rules every construction is checked against). They are part of the step, not background:
> distributions passed without them have not been audited.

**Input:** the nodes `build-distributions` built or changed since the last audit.

**Done when:** every such node passes the checks below, every finding is fixed (or the node is labelled for
what it really is), and each changed project compiles with 0 errors.

**Next:** `build-simulation` (`montecarlo-engine/build-simulation.md`).

Paths here are the default layout: `distributions/` is the workspace's `distributionData` folder and
`sources/` its `groundingSources` folder (both set in `portfolio.config.mjs`).

This step audits the *inference*: how a node gets from its cited evidence to a distribution. The evidence
itself was audited in `audit-evidence`; what the simulation then does with the distribution is audited in
`audit-simulation`.

## Principles (binding)

1. **Construct, then read.** A node's distribution is built from its grounded construction; percentiles are
   derived from it. A hand-authored percentile that contradicts the construction is a defect.
2. **Anchor probabilities correctly.** Data points at plotting positions `i/(n+1)`; stated quantiles at the
   source's own percentiles; subjective low / likely / high at 10 / 50 / 90.
3. **The spread must be earned.** A narrow distribution on weak, single-source or judgement evidence is
   overconfident; an absurdly wide one is underconfident. Both are findings.
4. **Make the construction honest; never fabricate.** Fix the distribution when it misrepresents the
   evidence, fix the label or reasoning when only that is wrong, and never invent evidence to justify a
   shape.

## What to check

Given the observations and speculations a node cites, is its constructed distribution a tight, justified
representation of them? Check each node:

1. **Kind** — does `distribution.kind` match the evidence shape? (a multimodal source in one
   lognormal; a bounded fraction off [0,1]; a source-stated ladder flattened to a 2-quantile fit; a
   *metalog over directional/judgement evidence*, which reads as a measured ladder the evidence
   can't support).
2. **Params** — do the params follow from the cited evidence? Recompute: lognormal median/sigma from
   the right two quantiles (z-spread 2.5631 p10/p90, 3.2897 p05/p95); FX (direction + value);
   derivatives; metalog anchors = the stated quantiles; splice `slope_match`. `npx forecaster preview`
   checks a construction or a fit.
3. **Tightness** — is the spread justified? Flag OVERCONFIDENT (too-narrow given weak/single-source/
   judgement evidence) and UNDER-confident (absurdly wide).
4. **Coherence** — does `reasoning` connect the cited evidence to the distribution? (non-sequiturs,
   double-counting, wrong population/segment/period, unit confusion, a median that ignores a stated
   central value, an unquantified conversion step).
5. **Cross-checks / support_score / truncation** — refutations reference the right obs; support
   reflects the real grounding; truncation clips where the quantity is physically bounded.

Prepare bundles (node + its resolved evidence) per project, run one review agent each, collect
`{ node, category, severity, issue, suggested_fix }` findings, then fix — **making the construction
honest**: fix the distribution when it misrepresents the evidence; fix the label/reasoning when only
that is wrong; never fabricate evidence. If a fix needs new or corrected evidence, that goes back through
`ground-evidence` and `audit-evidence` first.

## Procedure

1. List the nodes built or changed since the last audit: the ones `build-distributions` reported, or, when
   the workspace is a git repository, `git diff distributions/projects/`.
2. For each, open its cited evidence (`npx forecaster search`, the cores in `sources/cores/`) and check it
   against the list above. For many nodes, bundle each project's nodes with their resolved evidence and give
   each bundle to a review agent.
3. Fix what's found, then compile each changed project: `npx forecaster compile distributions/projects/<id>.json`
   must report 0 errors.
