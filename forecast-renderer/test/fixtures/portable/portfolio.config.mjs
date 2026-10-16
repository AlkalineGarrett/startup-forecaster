// A fictional portfolio that exercises the renderer's portable settings (test/portable.test.ts): a 3-year
// horizon, two currencies, a flat 21% business tax and a hidden node.
export default {
  bootstrap: "portable.ts",
  dataRoot: ".",
  manifest: "portfolio.manifest.mjs",
  out: "dist/montecarlo.html",
  engineImport: "../../../../montecarlo-engine/src",
};
