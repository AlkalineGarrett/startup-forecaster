// H. Concurrency — the file-locked corpus writers. Spawn many parallel add_observation processes
// writing distinct ids to the same observations.json and assert EVERY write survives and the file stays
// valid JSON. A lock regression shows up as a lost update or a corrupt file.
//
// The lock is an O_EXCL lock file beside the data file (lib/lock.mjs).
//
// Two-root model: the core (for quote-verification) lives under GROUNDING_SOURCES; the corpus written
// to lives under FORECASTER_DATA.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runTool, twoRoots } from "./helpers.mjs";

function seedRoots() {
  const r = twoRoots();
  writeFileSync(join(r.gs, "cores", "doc_test.txt"), "the reported metric is 42 percent in the study\n");
  // doc identity → shared registry (GROUNDING); observations get written to PROJECT during the test
  writeFileSync(join(r.gs, "documents.json"), JSON.stringify({ doc_test: { sha256: "test", title: "T", core: "cores/doc_test.txt" } }));
  writeFileSync(join(r.pj, "corpus", "general-knowledge.json"), "{}");
  writeFileSync(join(r.pj, "corpus", "speculations.json"), "{}");
  return r;
}
const obsArgs = (i) => ["doc_test", `obs_p${i}`, "--value", String(i), "--unit", "%",
  "--statement", `metric ${i}`, "--quote", "42 percent"];
const range = (n) => Array.from({ length: n }, (_, i) => i);

test("parallel add_observation: no lost writes", async () => {
  const { pj, env } = seedRoots();
  const N = 16;
  const results = await Promise.all(range(N).map((i) => runTool("add_observation.mjs", obsArgs(i), env)));
  assert.ok(results.every((r) => r.code === 0), results.filter((r) => r.code).map((r) => r.stderr).join("\n"));
  const obs = JSON.parse(readFileSync(join(pj, "corpus", "observations.json"), "utf8"));   // must still be valid JSON
  const missing = range(N).map((i) => `obs_p${i}`).filter((k) => !(k in obs));
  assert.deepEqual(missing, [], `lost writes under concurrency: ${missing}`);
  assert.ok(Object.values(obs).every((o) => o.verification === "verified"));
});

test("parallel add_knowledge: no lost writes", async () => {
  const { pj, env } = seedRoots();
  const N = 12;
  const results = await Promise.all(range(N).map((i) =>
    runTool("add_knowledge.mjs", ["gk", `gk_p${i}`, "--statement", `fact ${i}`, "--reasoning", "r"], env)));
  assert.ok(results.every((r) => r.code === 0), results.filter((r) => r.code).map((r) => r.stderr).join("\n"));
  const gk = JSON.parse(readFileSync(join(pj, "corpus", "general-knowledge.json"), "utf8"));
  const missing = range(N).map((i) => `gk_p${i}`).filter((k) => !(k in gk));
  assert.deepEqual(missing, [], `lost knowledge writes under concurrency: ${missing}`);
});

test("parallel fetch_request add: one merged queue, no lost requests", async () => {
  const { gs, env } = seedRoots();
  const N = 12;
  const results = await Promise.all(range(N).map((i) =>
    runTool("fetch_request.mjs", ["add", "--url", `https://q${i % 4}.example/x`, "--for", `p::n${i}`], env)));
  assert.ok(results.every((r) => r.code === 0), results.filter((r) => r.code).map((r) => r.stderr).join("\n"));
  const q = readFileSync(join(gs, "fetch-queue.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(q.length, 4);
  assert.equal(q.reduce((n, r) => n + r.for.length, 0), N);
});


test("a stale lock left by a dead process is broken, not waited on", async () => {
  const { pj, env } = seedRoots();
  const path = join(pj, "corpus", "general-knowledge.json");
  writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), time: Date.now() }));
  const r = await runTool("add_knowledge.mjs", ["gk", "gk_after_stale", "--statement", "s", "--reasoning", "r"], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok("gk_after_stale" in JSON.parse(readFileSync(path, "utf8")));
  assert.ok(!existsSync(`${path}.lock`));
});
