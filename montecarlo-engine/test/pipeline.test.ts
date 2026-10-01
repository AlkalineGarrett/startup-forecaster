// The pipeline generators run against any portfolio config, not just the real portfolio: a temp
// portfolio pointing at a tiny distribution-data project (one compiled node, one speculation) plus a
// leftover build/ output whose source project is gone, which must NOT leak into the generated modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p: string, o: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o)); };

test("gen-distributions + gen-evidence over a config-described data project", () => {
  const root = mkdtempSync(join(tmpdir(), "mc-pipeline-"));
  const data = join(root, "data");
  json(join(data, "projects", "demo.json"), {});
  json(join(data, "build", "demo.compiled.json"), { nodes: { "demo::signups": {
    unit: "count", model_definition: "Sign-ups", support_score: 30, reasoning: "Judged from spec_demo_signups.",
    distribution: { kind: "lognormal", median: { measure: { value: 1000 } }, sigma: 0.8 },
    debug_computed_percentiles: { p05: 268, p10: 359, p50: 1000, p90: 2786, p95: 3725 },
  } } });
  json(join(data, "build", "gone.compiled.json"), { nodes: { "gone::x": { distribution: { kind: "uniform", low: 0, high: 1 } } } });
  json(join(data, "corpus", "observations.json"), {});
  json(join(data, "corpus", "general-knowledge.json"), {});
  json(join(data, "corpus", "speculations.json"), { spec_demo_signups: { statement: "About a thousand sign-ups", reasoning: "guess" } });
  writeFileSync(join(root, "portfolio.config.mjs"), `export default {
    bootstrap: "src/p.ts", distributionData: "data", engineImport: "montecarlo-engine/src",
    generated: { distributions: "src/distributions-data.ts", evidence: "src/evidence-data.ts" } };\n`);
  mkdirSync(join(root, "src"));
  const run = (s: string) => execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ENGINE, "pipeline", s)],
    { cwd: root, env: { ...process.env, MC_CONFIG: join(root, "portfolio.config.mjs") }, encoding: "utf8" });
  run("gen-distributions.mjs");
  run("gen-evidence.mjs");

  const dist = readFileSync(join(root, "src", "distributions-data.ts"), "utf8");
  assert.match(dist, /from "montecarlo-engine\/src\/portfolio-context\.ts"/);
  const spec = JSON.parse(dist.slice(dist.indexOf("distributions: ") + 15, dist.lastIndexOf(" });")));
  assert.deepEqual(Object.keys(spec), ["demo::signups"], "only nodes of projects that still have a source");
  assert.deepEqual(spec["demo::signups"].d, { kind: "lognormal", median: 1000, sigma: 0.8 });
  assert.equal(spec["demo::signups"].support, 30);

  const ev = readFileSync(join(root, "src", "evidence-data.ts"), "utf8");
  assert.match(ev, /"spec_demo_signups"/);
  assert.match(ev, /"demo::signups":\["spec_demo_signups"\]/, "node → corpus reference indexed");
});
