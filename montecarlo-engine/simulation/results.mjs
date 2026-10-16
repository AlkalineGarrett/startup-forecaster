// The simulation build's results pass: ONE run of the portfolio feeding every stage that needs results, in
// one process (run.mjs starts it after `gen`, so it loads the modules just generated):
//
//   --golden      golden.json from the pass's results (a project's headline run; a variant project's base
//                 unit, which is run(p)) — the same fields simulation/golden.mjs writes
//   --pairwise    the pairwise matrix, baked to the config's `generated.pairwise` (simulation/gen-pairwise.mjs)
//   --precompute  the renderer's startup snapshot (.cache), exactly what `startup-forecaster precompute` writes
//
// For pairwise or precompute the pass is the renderer's own init (appcore.initAppcore → the engine's
// runPortfolio: every unit, variants included) plus its computePairwiseAsync, and golden reads the same results.
// Golden alone runs only each project's headline run(p), as simulation/golden.mjs does. The snapshot is written
// last, so its source hash covers the pairwise module written just before it.
//
//   node simulation/results.mjs --golden --pairwise --precompute
import { CONFIG } from "../config.mjs";
import { loadPortfolio } from "../portfolio-loader.mjs";
import { goldenOf, writeGolden } from "./golden.mjs";
import { writePairwise } from "./gen-pairwise.mjs";

const want = (s) => process.argv.includes(`--${s}`);
const golden = want("golden") && !!CONFIG.golden;
const pairwise = want("pairwise") && !!CONFIG.generated.pairwise;
const precompute = want("precompute");
const secs = (t) => `${((performance.now() - t) / 1000).toFixed(1)}s`;

await loadPortfolio();
const { PROJECTS } = await import("../src/portfolio-context.ts");

if (!pairwise && !precompute) {
  // Golden alone needs only each project's headline run, not the whole portfolio (every variant unit).
  if (golden) {
    const { run } = await import("../src/simulate.ts");
    const t = performance.now();
    writeGolden(goldenOf(PROJECTS, run));
    console.log(`Wrote ${CONFIG.golden.split("/").pop()} for ${PROJECTS.length} projects in ${secs(t)}.`);
  }
  process.exit(0);
}

const { ovResult } = await import("../src/units.ts");
const ac = await import("../../forecast-renderer/src/appcore.ts");
const { writeCache } = await import("../../forecast-renderer/cache-util.mjs");
const { cacheName } = await import("../../forecast-renderer/precompute.mjs");

let t = performance.now();
ac.initAppcore();
console.log(`Ran ${PROJECTS.length} projects (every unit) in ${secs(t)}.`);
t = performance.now();
await ac.computePairwiseAsync();
console.log(`Computed the pairwise matrix in ${secs(t)}.`);
// The snapshot holds every result (slimmed of per-draw arrays only), so golden reads its fields from it.
const snap = ac.snapshotState();
if (golden) {
  writeGolden(goldenOf(PROJECTS, (p) => ovResult(snap.R, p)));
  console.log(`Wrote ${CONFIG.golden.split("/").pop()} for ${PROJECTS.length} projects.`);
}
if (pairwise) console.log(`${writePairwise(ac.pairwiseMatrix())}.`);
if (precompute) {
  const buf = writeCache(snap); // after the pairwise module: the stamped hash covers it
  console.log(`Wrote ${cacheName()} (${(buf.length / 1e6).toFixed(1)} MB).`);
}
