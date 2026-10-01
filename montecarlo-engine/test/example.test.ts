// Engine test over the fictional example portfolio (examples/habit-tracker.ts). This is the
// portfolio the PUBLIC engine ships with — it lets the engine's simulate path be tested without any
// real venture data. The real portfolio's golden test travels with the data repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../examples/habit-tracker.ts"; // side-effect: attaches the example portfolio
import { PROJECTS } from "../src/portfolio-context.ts";
import { run } from "../src/simulate.ts";
import type { RunResult } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const golden: Record<string, Record<string, number>> = JSON.parse(
  readFileSync(join(here, "..", "examples", "example-golden.json"), "utf8"),
);
const FIELDS: (keyof RunResult)[] = ["p20", "p50", "p80", "p95", "mean", "pSucc", "condP50"];

test("example portfolio is structurally well-formed", () => {
  assert.equal(PROJECTS.length, 2, "two example projects attached");
  const ids = new Set<string>();
  for (const p of PROJECTS) {
    assert.ok(!ids.has(p.id), `duplicate project id ${p.id}`);
    ids.add(p.id);
    const nodeIds = new Set<string>();
    for (const n of p.nodes) {
      assert.ok(!nodeIds.has(n.id), `${p.id}: duplicate node id ${n.id}`);
      nodeIds.add(n.id);
      const vs = Object.values(n.pctiles || {});
      for (let i = 1; i < vs.length; i++) assert.ok(vs[i] >= vs[i - 1], `${p.id}.${n.id} pctiles not monotonic`);
      if (n.kind === "gate") for (const v of vs) assert.ok(v >= 0 && v <= 1, `${p.id}.${n.id} gate rate out of [0,1]`);
    }
  }
});

test("run() produces ordered, finite percentiles for each example project", () => {
  for (const p of PROJECTS) {
    const r = run(p);
    for (const k of FIELDS) assert.ok(Number.isFinite(r[k] as number), `${p.id}.${String(k)} not finite`);
    assert.ok(r.p20 <= r.p50 && r.p50 <= r.p80 && r.p80 <= r.p95, `${p.id} percentiles out of order`);
    assert.ok(r.pSucc >= 0 && r.pSucc <= 1, `${p.id} pSucc out of [0,1]`);
  }
});

test("run() is deterministic for a fixed seed", () => {
  for (const p of PROJECTS) {
    const a = run(p), b = run(p);
    for (const k of FIELDS) assert.strictEqual(a[k], b[k], `${p.id}.${String(k)} not deterministic`);
  }
});

test("run() reproduces the example golden outputs exactly", () => {
  for (const p of PROJECTS) {
    const r = run(p);
    const g = golden[p.id];
    assert.ok(g, `no example-golden fixture for ${p.id}`);
    for (const k of FIELDS) assert.strictEqual(r[k], g[k], `${p.id}.${String(k)} drifted from example golden`);
  }
});
