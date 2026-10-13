// The one place a portfolio tells the engine where its pieces live: `portfolio.config.mjs`.
//
// Every entrypoint (build, server, precompute, artifacts, coverage, and the pipeline/ generators) reads
// it, so a workspace's npm scripts need no env plumbing. Resolution:
//   1. MC_CONFIG (a path), else
//   2. the nearest portfolio.config.mjs at or above the current directory, else
//   3. the engine's fictional example (examples/portfolio.config.mjs).
// Paths in the config are relative to the config file. Individual env vars still override a field
// (MC_PORTFOLIO, MC_DATA_ROOT, MC_MANIFEST, MC_DISTRIBUTION_DATA, MC_COMPILER, GROUNDING_SOURCES; build.mjs's MC_OUT).
//
//   export default {
//     bootstrap: "src/projects.ts",            // the module whose import calls configurePortfolio()
//     dataRoot: "src",                         // where the bundler finds the portfolio's data modules
//     manifest: "portfolio.manifest.mjs",      // which data modules splice into the bundle, and where
//     out: "dist/montecarlo.html",             // the self-contained live build
//     golden: "golden.json",                   // frozen run() outputs (the reproduction guard)
//     generated: {                             // modules the pipeline writes (omit one to skip that step)
//       distributions: "src/distributions-data.ts",
//       evidence: "src/evidence-data.ts",
//       pairwise: "src/pairwise-data.ts",
//     },
//     distributionData: "distributions",            // optional: a distribution-compiler data project
//     compiler: "../startup-forecaster/distribution-compiler",  // optional: lets the pipeline (re)compile it
//     groundingSources: "sources",                  // optional: the source archive (titles/urls for evidence)
//     engineImport: "montecarlo-engine/src",        // how generated modules import the engine
//     dossiers: "dossiers",                         // optional: per-venture research folders (startup-forecaster)
//   };
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

function findConfig() {
  if (process.env.MC_CONFIG) return resolve(process.env.MC_CONFIG);
  for (let d = resolve("."); ; d = dirname(d)) {
    if (existsSync(join(d, "portfolio.config.mjs"))) return join(d, "portfolio.config.mjs");
    if (dirname(d) === d) return join(DIR, "examples", "portfolio.config.mjs");
  }
}

export const CONFIG_PATH = findConfig();
const raw = (await import(pathToFileURL(CONFIG_PATH).href)).default || {};
const base = dirname(CONFIG_PATH);
const at = (p) => (p == null ? null : resolve(base, p));
const env = (name, fallback) => (process.env[name] ? resolve(process.env[name]) : fallback);

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
  distributionData: env("MC_DISTRIBUTION_DATA", at(raw.distributionData)),
  compiler: env("MC_COMPILER", at(raw.compiler)),
  groundingSources: env("GROUNDING_SOURCES", at(raw.groundingSources)),
  engineImport: raw.engineImport || "montecarlo-engine/src",
  dossiers: at(raw.dossiers),
};
