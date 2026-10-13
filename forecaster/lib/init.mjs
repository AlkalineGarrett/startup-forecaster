// Create a workspace: the one folder that holds a user's whole forecasting data — the portfolio the engine
// simulates, the distribution data the compiler builds, the source archive the fetcher fills, the per-venture
// dossiers and the plans. Every tool finds its part through the root's portfolio.config.mjs.
//
//   <workspace>/
//     portfolio.config.mjs     where everything lives (montecarlo-engine/config.mjs documents each field)
//     portfolio.manifest.mjs   which portfolio modules the engine bundles, and where
//     package.json             npm run pipeline / serve / artifact … (engine entrypoints)
//     src/projects.ts          the ventures as code (`forecaster new` registers each one here)
//     distributions/           projects/<id>.json (the nodes), corpus/ (evidence), build/ (compiled)
//     sources/                 the source archive: documents.json, cores/, archived files, fetch queue
//     dossiers/<id>/           description, research brief, outcomes
//     plans/                   build and execution plans
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKOUT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const rel = (from, to) => {
  const r = relative(from, to);
  return r.startsWith(".") ? r : `./${r}`;
};

export function initWorkspace(dir, { name = "Venture portfolio" } = {}) {
  if (existsSync(dir) && readdirSync(dir).filter((f) => !f.startsWith(".")).length) {
    throw new Error(`${resolve(dir)} is not empty — init creates a new workspace`);
  }
  mkdirSync(dir, { recursive: true });
  const root = realpathSync(dir);   // relative links to the checkout must survive symlinked parents
  const engine = join(CHECKOUT, "montecarlo-engine");
  const files = {
    "portfolio.config.mjs": `// Where this workspace's pieces live (montecarlo-engine/config.mjs documents every field).
export default {
  bootstrap: "src/projects.ts",
  dataRoot: "src",
  manifest: "portfolio.manifest.mjs",
  out: "dist/montecarlo.html",
  golden: "golden.json",
  generated: {
    distributions: "src/distributions-data.ts",
    evidence: "src/evidence-data.ts",
  },
  distributionData: "distributions",
  groundingSources: "sources",
  dossiers: "dossiers",
  compiler: ${JSON.stringify(rel(root, join(CHECKOUT, "distribution-compiler")))},
};
`,
    "portfolio.manifest.mjs": `export const TITLE = ${JSON.stringify(name)};

export const PORTFOLIO_MODULES = {
  "portfolio-context.ts": ["distributions-data.ts", "evidence-data.ts"],
  "accounting.ts": [
    // forecaster:modules
  ],
  "apply-distributions.ts": ["projects.ts"],
};
`,
    "package.json": JSON.stringify({
      name: "forecasts",
      private: true,
      type: "module",
      dependencies: { "montecarlo-engine": `file:${rel(root, engine)}` },
      scripts: {
        pipeline: "node node_modules/montecarlo-engine/pipeline/run.mjs",
        build: "node node_modules/montecarlo-engine/build.mjs",
        precompute: "node --experimental-strip-types node_modules/montecarlo-engine/precompute.mjs",
        serve: "node --experimental-strip-types node_modules/montecarlo-engine/server.mjs",
        artifact: "node --experimental-strip-types node_modules/montecarlo-engine/build-artifact.mjs",
        "artifact:full": "node --experimental-strip-types node_modules/montecarlo-engine/build-full-artifact.mjs",
        coverage: "node --experimental-strip-types node_modules/montecarlo-engine/coverage.mjs",
      },
    }, null, 2) + "\n",
    ".gitignore": "node_modules/\ndist/\n.cache/\n.DS_Store\n__pycache__/\n",
    "src/projects.ts": `import type { Project } from "montecarlo-engine/src/types.ts";
import { configurePortfolio } from "montecarlo-engine/src/portfolio-context.ts";
import { applyDistributions } from "montecarlo-engine/src/apply-distributions.ts";
import "./distributions-data.ts";
// forecaster:imports
const VENTURES: Project[] = [];
// forecaster:register VENTURES
applyDistributions(VENTURES);
configurePortfolio({ projects: VENTURES });
`,
    "src/distributions-data.ts": `import { configurePortfolio } from "montecarlo-engine/src/portfolio-context.ts";\nconfigurePortfolio({ distributions: {} });\n`,
    "src/evidence-data.ts": "export {};\n",
    "distributions/corpus/observations.json": "{}\n",
    "distributions/corpus/general-knowledge.json": "{}\n",
    "distributions/corpus/speculations.json": "{}\n",
    "sources/documents.json": "{}\n",
    "sources/MANIFEST.csv": "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\r\n",
    "sources/url-aliases.csv": "requested_url,resolves_to_manifest_id,status,note\r\n",
    "sources/fetch-queue.jsonl": "",
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  for (const d of ["src/projects", "distributions/projects", "sources/cores", "dossiers", "plans"]) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, ".gitkeep"), "");
  }
  // what `npm install` would link — so the workspace runs straight away
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(rel(join(root, "node_modules"), engine), join(root, "node_modules", "montecarlo-engine"));
  return { root, files: Object.keys(files) };
}
