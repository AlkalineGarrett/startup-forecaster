// End to end in a throwaway portfolio: scaffold a venture with every preset, compile its placeholders with
// the distribution-compiler, generate the engine modules, run the model (golden), and read its status.
// Needs the sibling montecarlo-engine and distribution-compiler repos (python3 + numpy for the compiler).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "forecaster.mjs");
const WS = resolve(HERE, "..", "..");
const ENGINE = join(WS, "montecarlo-engine"), COMPILER = join(WS, "distribution-compiler");

function portfolio() {
  const root = mkdtempSync(join(tmpdir(), "forecaster-"));
  mkdirSync(join(root, "node_modules"));
  symlinkSync(ENGINE, join(root, "node_modules", "montecarlo-engine"));
  mkdirSync(join(root, "src", "projects"), { recursive: true });
  writeFileSync(join(root, "portfolio.config.mjs"), `export default {
  bootstrap: "src/projects.ts", dataRoot: "src", manifest: "portfolio.manifest.mjs", golden: "golden.json",
  generated: { distributions: "src/distributions-data.ts", evidence: "src/evidence-data.ts" },
  distributionData: "data", compiler: ${JSON.stringify(COMPILER)}, dossiers: "dossiers" };\n`);
  writeFileSync(join(root, "portfolio.manifest.mjs"), `export const PORTFOLIO_MODULES = {
  "portfolio-context.ts": ["distributions-data.ts", "evidence-data.ts"],
  "accounting.ts": [
    // forecaster:modules
  ],
  "apply-distributions.ts": ["projects.ts"],
};\n`);
  writeFileSync(join(root, "src", "projects.ts"), `import type { Project } from "montecarlo-engine/src/types.ts";
import { configurePortfolio } from "montecarlo-engine/src/portfolio-context.ts";
import { applyDistributions } from "montecarlo-engine/src/apply-distributions.ts";
import "./distributions-data.ts";
// forecaster:imports
const PROJECTS: Project[] = [];
// forecaster:register PROJECTS
applyDistributions(PROJECTS);
configurePortfolio({ projects: PROJECTS });
`);
  writeFileSync(join(root, "src", "distributions-data.ts"), `import { configurePortfolio } from "montecarlo-engine/src/portfolio-context.ts";\nconfigurePortfolio({ distributions: {} });\n`);
  writeFileSync(join(root, "src", "evidence-data.ts"), `export {};\n`);
  mkdirSync(join(root, "data", "corpus"), { recursive: true });
  for (const f of ["observations.json", "general-knowledge.json", "speculations.json"]) writeFileSync(join(root, "data", "corpus", f), "{}\n");
  return root;
}
const cli = (root, ...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
const pipeline = (root, to) => execFileSync(process.execPath, [join(ENGINE, "pipeline", "run.mjs"), "--to", to], { cwd: root, encoding: "utf8", env: { ...process.env, MC_CONFIG: join(root, "portfolio.config.mjs") } });

test("scaffold → compile → generate → run → status, for every preset", { timeout: 300_000 }, () => {
  const root = portfolio();
  cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Demo App");
  cli(root, "new", "demo-seats", "--preset", "b2b-per-seat", "--name", "Demo Seats");
  cli(root, "new", "demo-org", "--preset", "b2b-per-org", "--name", "Demo Org");
  assert.ok(existsSync(join(root, "dossiers", "demo-app", "research-brief.md")));
  assert.match(readFileSync(join(root, "src", "projects.ts"), "utf8"), /PROJECTS\.push\(demo_seats\);/);
  assert.throws(() => cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Again"), /already exists/);

  const out = pipeline(root, "golden");
  assert.match(out, /✓ compile/, "placeholders compile cleanly (a compile error fails the stage)");
  assert.match(out, /✓ golden/);
  const golden = JSON.parse(readFileSync(join(root, "golden.json"), "utf8"));
  for (const id of ["demo-app", "demo-seats", "demo-org"]) {
    assert.ok(golden[id] && Number.isFinite(golden[id].mean) && golden[id].p80 >= golden[id].p20, `${id} simulated`);
  }

  const status = JSON.parse(cli(root, "status", "--json"));
  for (const s of status) {
    assert.equal(s.error, null);
    assert.equal(s.counts.placeholder, s.nodes.length, `${s.id}: every node starts as a placeholder`);
    assert.ok(s.nodes[0].driver, `${s.id}: nodes ranked by influence`);
  }
});
