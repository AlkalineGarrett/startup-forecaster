// The one place a portfolio tells the engine where its pieces live: `portfolio.config.mjs`.
//
// Every entrypoint (build, server, precompute, artifacts, coverage, and the simulation/ generators) reads
// it, so a workspace's npm scripts need no env plumbing. It is found by the one workspace resolver
// (distribution-compiler/compiler/workspace.mjs findConfig, shared with every data tool):
//   1. MC_CONFIG (a path, or "examples" for the engine's fictional example, examples/portfolio.config.mjs), else
//   2. the nearest portfolio.config.mjs at or above the current directory, else
//   3. an error — the example is never a silent fallback.
// Paths in the config are relative to the config file. Individual env vars still override a field
// (MC_PORTFOLIO, MC_DATA_ROOT, MC_MANIFEST, MC_COMPILER, build.mjs's MC_OUT; the data project and the source
// archive take the shared overrides FORECASTER_DATA / MC_DISTRIBUTION_DATA and GROUNDING_SOURCES /
// MC_GROUNDING_SOURCES, workspace.mjs OVERRIDES). Every field except `bootstrap` is optional.
//
//   export default {
//     bootstrap: "src/projects.ts",            // the module whose import calls configurePortfolio()
//     dataRoot: "src",                         // where the bundler finds the portfolio's data modules
//     manifest: "portfolio.manifest.mjs",      // which data modules splice into the bundle, and where
//     out: "dist/montecarlo.html",             // the self-contained live build
//     golden: "golden.json",                   // frozen run() outputs (the reproduction guard)
//     generated: {                             // modules the simulation build writes (omit one to skip that step)
//       distributions: "src/distributions-data.ts",
//       evidence: "src/evidence-data.ts",
//       pairwise: "src/pairwise-data.ts",
//     },
//     distributionData: "distributions",            // optional: a distribution-compiler data project
//     compiler: "…/distribution-compiler",          // optional: default, the one in this package
//     groundingSources: "sources",                  // optional: the source archive (titles/urls for evidence)
//     engineImport: "startup-forecaster/montecarlo-engine/src",  // how generated modules import the engine
//     dossiers: "dossiers",                         // optional: per-venture research folders (startup-forecaster)
//     sourcesExclude: [],                           // optional: archive paths check-sources never treats as evidence
//     browserOnlyHosts: [],                         // optional: hosts that only render in a live browser
//   };
//
// The last two are read by the source tools (distribution-compiler/compiler/workspace.mjs documents them).
// Settings about the person and the business (currency, tax, thresholds, cost timing, shared factors) are not
// here: the bootstrap passes them to configurePortfolio() (src/portfolio-context.ts documents each).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findConfig, overridePath } from "../distribution-compiler/compiler/workspace.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH = findConfig();   // throws outside a workspace (MC_CONFIG=examples opts into the example)
const raw = (await import(pathToFileURL(CONFIG_PATH).href)).default || {};
const base = dirname(CONFIG_PATH);
const at = (p) => (p == null ? null : resolve(base, p));
const env = (name, fallback) => (process.env[name] ? resolve(process.env[name]) : fallback);
const override = (field, fallback) => { const v = overridePath(field); return v ? resolve(v) : fallback; };

/** The resolved config: every path absolute (or null when the portfolio doesn't use that piece). */
export const CONFIG = {
  root: base,
  bootstrap: env("MC_PORTFOLIO", at(raw.bootstrap)),
  dataRoot: env("MC_DATA_ROOT", at(raw.dataRoot)),
  manifest: env("MC_MANIFEST", at(raw.manifest)),
  out: at(raw.out ?? "dist/montecarlo.html"),   // build.mjs: MC_OUT overrides
  golden: at(raw.golden),
  generated: {
    distributions: at(raw.generated?.distributions),
    evidence: at(raw.generated?.evidence),
    pairwise: at(raw.generated?.pairwise),
  },
  distributionData: override("distributionData", at(raw.distributionData)),
  compiler: env("MC_COMPILER", at(raw.compiler) ?? join(DIR, "..", "distribution-compiler")),
  groundingSources: override("groundingSources", at(raw.groundingSources)),
  engineImport: raw.engineImport || "startup-forecaster/montecarlo-engine/src",
  dossiers: at(raw.dossiers),
};
