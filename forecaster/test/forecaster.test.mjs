// End to end in a throwaway workspace (`forecaster init`): scaffold a venture with every preset, compile its placeholders with
// the distribution-compiler, generate the engine modules, run the model (golden), build the page, and read its status.
// Needs the montecarlo-engine and distribution-compiler beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "forecaster.mjs");
const WS = resolve(HERE, "..", "..");
const ENGINE = join(WS, "montecarlo-engine");

function portfolio() {
  const root = join(mkdtempSync(join(tmpdir(), "forecaster-")), "ws");
  cli(dirname(root), "init", root, "--name", "Test portfolio");
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
  assert.match(readFileSync(join(root, "src", "projects.ts"), "utf8"), /VENTURES\.push\(demo_seats\);/);
  assert.throws(() => cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Again"), /already exists/);

  const out = pipeline(root, "build");
  assert.match(out, /✓ compile/, "placeholders compile cleanly (a compile error fails the stage)");
  assert.match(out, /✓ golden/);
  assert.match(out, /✓ build/, "the bundle builds (no top-level name collides with the engine's)");
  assert.ok(existsSync(join(root, "dist", "montecarlo.html")));
  const golden = JSON.parse(readFileSync(join(root, "golden.json"), "utf8"));
  for (const id of ["demo-app", "demo-seats", "demo-org"]) {
    assert.ok(golden[id] && Number.isFinite(golden[id].mean) && golden[id].p80 >= golden[id].p20, `${id} simulated`);
  }

  // the fetcher's tools run on the fresh, empty archive
  const fetcher = (tool, ...args) => execFileSync(process.execPath, [join(WS, "agentic-fetcher", tool), ...args], { cwd: root, encoding: "utf8" });
  assert.match(fetcher("search.mjs", "churn"), /0 source/);
  fetcher("check_sources.mjs");
  fetcher("fetch_request.mjs", "list");

  const status = JSON.parse(cli(root, "status", "--json"));
  for (const s of status) {
    assert.equal(s.error, null);
    assert.equal(s.counts.placeholder, s.nodes.length, `${s.id}: every node starts as a placeholder`);
    assert.ok(s.nodes[0].driver, `${s.id}: nodes ranked by influence`);
  }
});
