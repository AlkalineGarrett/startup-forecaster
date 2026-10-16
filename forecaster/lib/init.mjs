// Create a workspace: the one folder that holds a user's whole forecasting data — the portfolio the engine
// simulates, the distribution data the compiler builds, the source archive the fetcher fills, the per-venture
// dossiers and the plans. Every tool finds its part through the root's portfolio.config.mjs.
//
//   <workspace>/
//     portfolio.config.mjs     where everything lives (montecarlo-engine/config.mjs documents each field)
//     portfolio.manifest.mjs   which portfolio modules the engine bundles, and where
//     package.json             depends on startup-forecaster; npm run simulate / serve / … (forecaster commands)
//     profile.json             the person's and each venture's answers the settings come from (add-venture.md)
//     src/projects.ts          the ventures as code (`startup-forecaster new` registers each one here); passes the
//                              profile's settings (src/profile-data.ts, generated from profile.json) to the engine
//     distributions/           projects/<id>.json (the nodes), corpus/ (evidence), build/ (compiled)
//     sources/                 the source archive: documents.json, cores/, archived files, fetch queue
//     dossiers/<id>/           description, research brief, market notes
//     plans/                   build and execution plans
//     AGENTS.md                what a coding agent reads first (CLAUDE.md and GEMINI.md import it)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyProfile, profileModuleSource, PROFILE_FILE } from "./profile.mjs";

const CHECKOUT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const VERSION = JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")).version;
const PLAYBOOK = "node_modules/startup-forecaster/AGENTS.md";

const rel = (from, to) => {
  const r = relative(from, to);
  return r.startsWith(".") ? r : `./${r}`;
};

/** The files that point a coding agent (Codex, Claude Code, Gemini CLI) at the playbook, for a workspace at
 *  `root` titled `name`. */
export function agentFiles(name = "Venture portfolio") {
  return {
    "AGENTS.md": `# ${name}

A startup-forecaster workspace: this folder holds the forecasting data. The tools are the
\`startup-forecaster\` package it depends on (\`npx startup-forecaster help\` lists them).

**Before acting on any request here, read \`${PLAYBOOK}\` and follow it end to end.**
It covers adding a venture, researching and grounding assumptions, building and re-running the simulation,
visualizing or publishing results, auditing the model and making plans. This file only says where things are.
If \`node_modules/\` is missing, run \`npm install\` first.

- Config: \`portfolio.config.mjs\` names every part of this workspace.
- Profile: \`profile.json\`, the person's answers (country, tax, team, thresholds) and each venture's
  (market, currency, channel). Read it first; the onboarding in the playbook's \`add-venture\` step fills it.
- Ventures as code: \`src/projects/<id>.ts\` (structure and a words-only brief, never numbers).
- Distributions and evidence: \`distributions/\`. Source archive: \`sources/\`.
- Research notes: \`dossiers/<id>/\`. Plans: \`plans/\`.
`,
    "CLAUDE.md": "@AGENTS.md\n",
    "GEMINI.md": "@AGENTS.md\n",
  };
}

/** Write the agent files into an existing workspace; existing files are kept unless `force`. */
export function writeAgentFiles(root, { name, force = false } = {}) {
  const written = [];
  for (const [f, body] of Object.entries(agentFiles(name))) {
    if (existsSync(join(root, f)) && !force) continue;
    writeFileSync(join(root, f), body);
    written.push(f);
  }
  return written;
}

/** Create a workspace in `dir`. It depends on this package: installed from npm, or with `link`, linked to
 *  this checkout (for working on the tools themselves). */
export function initWorkspace(dir, { name = "Venture portfolio", link = false } = {}) {
  if (existsSync(dir) && readdirSync(dir).filter((f) => !f.startsWith(".")).length) {
    throw new Error(`${resolve(dir)} is not empty — init creates a new workspace`);
  }
  mkdirSync(dir, { recursive: true });
  const root = realpathSync(dir);   // relative links to the checkout must survive symlinked parents
  const cmd = (c) => `startup-forecaster ${c}`;
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
};
`,
    "portfolio.manifest.mjs": `export const TITLE = ${JSON.stringify(name)};

export const PORTFOLIO_MODULES = {
  "portfolio-context.ts": ["distributions-data.ts", "evidence-data.ts", "profile-data.ts"],
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
      dependencies: { "startup-forecaster": link ? `file:${rel(root, CHECKOUT)}` : `^${VERSION}` },
      scripts: {
        simulate: cmd("simulate"),
        build: cmd("build"),
        precompute: cmd("precompute"),
        serve: cmd("serve"),
        "artifact:full": cmd("artifact-full"),
        coverage: cmd("coverage"),
        status: cmd("status"),
      },
    }, null, 2) + "\n",
    ".gitignore": "node_modules/\ndist/\n.cache/\n.DS_Store\n",
    [PROFILE_FILE]: JSON.stringify(emptyProfile(), null, 2) + "\n",
    "src/projects.ts": `import type { Project } from "startup-forecaster/montecarlo-engine/src/types.ts";
import { configurePortfolio } from "startup-forecaster/montecarlo-engine/src/portfolio-context.ts";
import { applyDistributions } from "startup-forecaster/montecarlo-engine/src/apply-distributions.ts";
import "./distributions-data.ts";
// The settings from profile.json (currency, tax, thresholds, cost timing): \`startup-forecaster\` regenerates
// profile-data.ts from it before every command. Edit profile.json, never profile-data.ts.
import { PROFILE_SETTINGS } from "./profile-data.ts";
// forecaster:imports
const VENTURES: Project[] = [];
// forecaster:register VENTURES
applyDistributions(VENTURES);
configurePortfolio({ ...PROFILE_SETTINGS, projects: VENTURES });
`,
    "src/profile-data.ts": profileModuleSource(emptyProfile()),
    "src/distributions-data.ts": `import { configurePortfolio } from "startup-forecaster/montecarlo-engine/src/portfolio-context.ts";\nconfigurePortfolio({ distributions: {} });\n`,
    "src/evidence-data.ts": "export {};\n",
    "distributions/corpus/observations.json": "{}\n",
    "distributions/corpus/general-knowledge.json": "{}\n",
    "distributions/corpus/speculations.json": "{}\n",
    "sources/documents.json": "{}\n",
    "sources/MANIFEST.csv": "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\r\n",
    "sources/url-aliases.csv": "requested_url,resolves_to_manifest_id,status,note\r\n",
    "sources/fetch-queue.jsonl": "",
    ...agentFiles(name),
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  for (const d of ["src/projects", "distributions/projects", "sources/cores", "dossiers", "plans"]) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, ".gitkeep"), "");
  }
  let installed = true;
  if (link) {
    // what `npm install` does for a file: dependency — so the workspace runs straight away, offline
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    symlinkSync(rel(join(root, "node_modules"), CHECKOUT), join(root, "node_modules", "startup-forecaster"));
    symlinkSync("../startup-forecaster/forecaster/bin/startup-forecaster.mjs", join(root, "node_modules", ".bin", "startup-forecaster"));
  } else {
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
    installed = r.status === 0;
  }
  return { root, files: Object.keys(files), installed };
}
