# Step `plan-build`: plan a product as a sequenced feature roadmap with competitor comparisons

> **Required reading before this step's first action:** this whole file, [`PRINCIPLES.md`](PRINCIPLES.md) in
> full, and the data model in [`README.md`](README.md). They are part of the step, not background: a plan made
> without them has not been made.

**Input:** a venture whose product is to be planned as a sequence of releases.

**Done when:** the plan's spec module in the workspace's `plans/` renders to a page, and the page meets every
binding principle in `PRINCIPLES.md` (§1–4).

**Next:** `plan-execution` (`exec-plan-generator/plan-execution.md`) if the person wants the work laid out
week by week; otherwise the request is done.

## Principles (binding)

`PRINCIPLES.md` §1–4 are binding and §5 is a recommended house style. Together they cover what counts
as a feature, how a feature is classified given the steps before it, importance (including the definitional tier), honesty and grounding of every competitor claim,
and how the page reads. A competitor comparison is evidence: each claim about a competitor needs a source,
the same as any other figure.

## Procedure

1. Copy `build-plan-generator/example.mjs` from the package into the workspace's `plans/` as
   `<plan>.mjs`, and replace its content with the venture's steps, keeping the shape `README.md` describes.
2. Render it: `npx forecaster build-plan plans/<plan>.mjs` (writes a full HTML document to
   `plans/<plan>-build-plan.html`; pass an output path as a second argument to change it, and
   `--fragment` if the page goes into a host that supplies its own `<html>/<head>/<body>`).
3. Edit the spec, never the generated HTML, and re-render.
