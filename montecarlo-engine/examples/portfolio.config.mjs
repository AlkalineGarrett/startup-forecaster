// The fictional example portfolio's config (see ../config.mjs for every field). It has no compiled
// distribution data — its nodes author percentiles directly — so the pipeline runs golden → build →
// precompute only.
export default {
  bootstrap: "habit-tracker.ts",
  dataRoot: ".",
  manifest: "portfolio.manifest.mjs",
  out: "../dist/montecarlo.html",
  golden: "example-golden.json",
  engineImport: "../src",
};
