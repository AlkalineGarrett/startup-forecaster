# Step `plan-execution`: lay out the work as a calendar of tasks by phase, with dependencies

> **Required reading before this step's first action:** this whole file, and the data shape and template rules
> in [`README.md`](README.md). They are part of the step, not background: a plan made without them has not
> been made.

**Input:** a plan of work to lay out week by week.

**Done when:** the plan's data module in the workspace's `plans/` renders to a page whose dependencies and
gates follow the principles below.

**Next:** none: the request is done.

## Principles (binding)

1. **The data module is the source of truth.** Edit `data-<plan>.mjs`, never the generated HTML.
2. **Dependencies are explicit and one level deep.** Each task lists its direct prerequisites in `deps`;
   the template draws them and places every prerequisite above the tasks that depend on it.
3. **Decision gates are implicit.** Never list a gate id in any `deps` array; gates carry no deps of their
   own.
4. **Plans serve the forecast.** A plan's early tasks should include the cheapest steps that retire the
   biggest uncertainty named in the venture's brief (its next steps), not only building.

## Procedure

1. Copy `exec-plan-generator/data-example.mjs` from the package into the workspace's `plans/` as
   `data-<plan>.mjs`, and replace its content, keeping the data shape `README.md` describes.
2. Render it: `npx startup-forecaster exec-plan plans/data-<plan>.mjs <out>.html` (writes a full HTML
   document; add `--fragment` for a host that supplies its own `<html>/<head>/<body>`, `--check` for a dry run).
