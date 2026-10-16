# Step `build-simulation`: change the model and re-run the simulation

> **Required reading before this step's first action:** this whole file, and §F–§G of the principles in
> [`audit-simulation.md`](audit-simulation.md) (metric, golden and simulation-build integrity). They are part
> of the step, not background: a simulation built without them has not been built.

**Input:** a change to the data or the structure (a changed distribution has passed `audit-distributions`), or
a request to re-run the simulation.

**Done when:** the simulation build (`npx forecaster simulate`) has run from the stage the change touched to
the end, the golden diff shows only the intended ventures moving, and the workspace's own tests pass if it has
any (`npm test`).

**Next:** `audit-simulation` (`audit-simulation.md`), before anyone relies on the numbers.

## Principles (binding)

Paths below are the fields of the workspace's `portfolio.config.mjs` (see `config.mjs`); a typical workspace
has `distributionData: "distributions"` and its venture files under the `bootstrap`'s folder (`src/projects/`).

1. **Numbers live in the distribution data, structure in the venture files.** A number (a price, a rate, a
   market size) is changed in the node's distribution in `<distributionData>/projects/<id>.json` (see
   `build-distributions`). Never type numbers into the venture `.ts` files; those hold structure, and each
   venture's words-only brief. Settings about the person and the business (currency, tax, thresholds, when
   costs start) are the `configurePortfolio` call in the `bootstrap` module, not node data.
2. **Never hand-edit generated files**: the config's `generated.distributions`, `generated.evidence` and
   `generated.pairwise` modules, `<distributionData>/build/`, and the rendered pages (`out`). The simulation
   build (or the renderer) rewrites them.
3. **Re-running the simulation means running `npx forecaster simulate`.** That command compiles the
   distributions, regenerates the model's modules, re-freezes golden, re-bakes pairwise and writes the
   precompute snapshot the pages start from (all three from one run of the portfolio). It does not render the
   pages; that is `render-forecast`. `npx forecaster status` and `npx forecaster coverage` read the generated
   modules (status reads its headlines and drivers from that snapshot), so they show current numbers only once
   it has run.
4. **Run the chain in order.** Each stage feeds the next; a change one layer up with stale layers below
   ships old numbers.
5. **Read the golden diff.** Only the ventures you meant to change may move. Golden tracks revenue draws, so
   a change to costs, tax or presentation must leave it unchanged; if it moved, the draws changed by accident.

## Procedure

1. **Make the change where it belongs.** A structural change (a new node, a revenue stream, a different
   business model) edits the venture's `.ts` file and adds matching nodes to its distributions file.
   Business-model templates live in `montecarlo-engine/src/templates.ts` in the package.
2. **Run the simulation build:**
   ```sh
   npx forecaster simulate                  # compile → gen → golden → pairwise → precompute
   npx forecaster simulate --fast           # skips the slow pairwise and precompute stages (both are then stale)
   npx forecaster simulate --from gen --to gen
   npx forecaster simulate --list
   ```
   It always runs the whole portfolio, even for a one-venture change. Use `--fast` when the
   pairwise view doesn't matter for the request, and say that it is stale. The workspace's npm scripts
   (`npm run simulate`, …) are shortcuts for the same commands.
3. **Check the golden diff:** the file is the config's `golden` (e.g. `golden.json`). Under git, `git diff` it;
   otherwise copy it aside before running the simulation build and compare the two afterwards.
4. **Run the workspace's tests** if it has any: `npm test`.
