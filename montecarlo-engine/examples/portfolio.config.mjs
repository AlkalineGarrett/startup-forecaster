// The fictional example portfolio's config (see ../config.mjs for every field). It has no compiled
// distribution data — its nodes author percentiles directly — and no pairwise module, so the simulation
// build runs only its golden stage.
export default {
  bootstrap: "habit-tracker.ts",
  dataRoot: ".",
  manifest: "portfolio.manifest.mjs",
  out: "../dist/montecarlo.html",
  golden: "example-golden.json",
  engineImport: "../src",
};
