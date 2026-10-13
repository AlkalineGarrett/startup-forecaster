// Derivative documents (make_derivative) and the audit tooling (audit_prepare / mark_audited).
// A derivative doc is computed from originals, reproducible by construction, and self-verifying.
//
// Two-root split: a derivative's IDENTITY (+derivation) and its core land under GROUNDING (the shared
// registry + cache); the derived OBSERVATION lands under PROJECT (corpus/observations.json, flat, with
// a `doc` backref).
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compute } from "../make_derivative.mjs";
import { approx, runTool, twoRoots } from "./helpers.mjs";

// ---- the compute kernel (pure) ----
test("compute methods", () => {
  const xs = [12, 29, 22.99, 8.99, 5.49];
  assert.ok(approx(compute("median", xs), 12.0));
  assert.ok(approx(compute("mean", xs), xs.reduce((a, b) => a + b) / 5));
  assert.ok(approx(compute("min", xs), 5.49));
  assert.ok(approx(compute("max", xs), 29.0));
  assert.equal(compute("count", xs), 5);
  assert.ok(approx(compute("p90", [1, 2, 3, 4, 5]), 4.6));
  assert.ok(approx(compute("cagr", [100, 130, 160, 210]), (210 / 100) ** (1 / 3) - 1));
});

test("cagr needs a positive start", () => {
  assert.throws(() => compute("cagr", [0, 10]), /cagr needs/);
});

function roots() {
  const r = twoRoots();
  // source identity → shared registry (GROUNDING)
  writeFileSync(join(r.gs, "documents.json"), JSON.stringify({ doc_src: { sha256: "s", title: "Src", core: "" } }));
  // its observation → project's flat observation map, carrying a doc backref
  writeFileSync(join(r.pj, "corpus", "observations.json"), JSON.stringify({ obs_series: { statement: "", measure: { series: [
    { period: "2021", value: 100 }, { period: "2024", value: 210 }] }, quote: "x", verification: "verified", doc: "doc_src" } }));
  return r;
}
const reg = (gs) => JSON.parse(readFileSync(join(gs, "documents.json"), "utf8"));
const obs = (pj) => JSON.parse(readFileSync(join(pj, "corpus", "observations.json"), "utf8"));
const derivatives = (gs) => Object.values(reg(gs)).filter((d) => d.origin === "derivative");

test("make_derivative writes a doc and a self-verifying obs", async () => {
  const { gs, pj, env } = roots();
  const r = await runTool("make_derivative.mjs", ["--title", "Median price (derived)", "--from", "doc_src/obs_series",
    "--records", "12,29,22.99,8.99,5.49", "--compute", "median", "--unit", "USD/mo",
    "--obs", "obs_med", "--statement", "median seat price (derived)"], env);
  assert.equal(r.code, 0, r.stderr);
  const der = derivatives(gs);
  assert.equal(der.length, 1);
  const d = der[0];
  assert.equal(d.derivation.result, 12.0);
  assert.deepEqual(d.derived_from, ["doc_src/obs_series"]);
  const o = obs(pj).obs_med;
  assert.equal(o.measure.value, 12.0);
  assert.equal(o.derived, true);
  assert.ok(o.doc in reg(gs));                            // backref resolves to a registry entry
  const core = readFileSync(join(gs, d.core), "utf8");    // quote self-verifies against the core
  assert.ok(core.includes(o.quote));
});

test("make_derivative is deterministic and dedupes", async () => {
  const { gs, env } = roots();
  const args = ["--title", "M", "--from", "doc_src", "--records", "1,2,3", "--compute", "mean", "--obs", "obs_m", "--statement", "s"];
  await runTool("make_derivative.mjs", args, env);
  await runTool("make_derivative.mjs", args, env);
  assert.equal(derivatives(gs).length, 1);               // same inputs → one doc
});

test("make_derivative --records-from a series", async () => {
  const { gs, env } = roots();
  const r = await runTool("make_derivative.mjs", ["--title", "CAGR (derived)", "--records-from", "doc_src/obs_series",
    "--compute", "cagr", "--unit", "fraction/yr", "--obs", "obs_cagr", "--statement", "cagr"], env);
  assert.equal(r.code, 0, r.stderr);
  const d = derivatives(gs)[0];
  assert.ok(approx(d.derivation.result, (210 / 100) ** (1 / 1) - 1));   // 2 points, 1 step
});

test("reasoning derivative", async () => {
  const { gs, pj, env } = roots();
  const r = await runTool("make_derivative.mjs", ["--title", "PT senior SWE ~EUR90k (synthesis)", "--from", "doc_src",
    "--reasoning", "Levels.fyi and Landing.Jobs bands overlap around 85-95k for senior; take 90k as the central estimate.",
    "--value", "90000", "--unit", "EUR/yr", "--obs", "obs_pt_senior_synth",
    "--statement", "PT senior SWE central estimate EUR90k (reasoning derivative)"], env);
  assert.equal(r.code, 0, r.stderr);
  const d = Object.values(reg(gs)).find((x) => x.derivation_kind === "reasoning");
  assert.equal(d.derivation.kind, "reasoning");
  assert.equal(d.derivation.result, 90000.0);
  const o = obs(pj).obs_pt_senior_synth;
  assert.equal(o.measure.value, 90000.0);
  assert.equal(o.derivation_kind, "reasoning");
  assert.ok(readFileSync(join(gs, d.core), "utf8").includes(o.quote));   // self-verifies
});

test("--compute and --reasoning are mutually exclusive", async () => {
  const { env } = roots();
  const r = await runTool("make_derivative.mjs", ["--title", "bad", "--from", "doc_src", "--records", "1,2", "--compute", "mean",
    "--reasoning", "also reasoning"], env);
  assert.notEqual(r.code, 0);
  assert.ok((r.stderr + r.stdout).includes("exactly one"));
});

test("audit_prepare and mark_audited", async () => {
  const { pj, env } = roots();
  mkdirSync(join(pj, "build"));
  let r = await runTool("audit_prepare.mjs", ["obs", "2"], env);
  assert.equal(r.code, 0, r.stderr);
  const batches = readdirSync(join(pj, "build", "audit")).filter((f) => /^batch_.*\.json$/.test(f));
  assert.ok(batches.length, "no audit batches written");
  // write a verdict file and mark the obs verified
  const vf = join(pj, "build", "audit", "verdicts_A.json");
  writeFileSync(vf, JSON.stringify([{ doc: "doc_src", obs: "obs_series", verdict: "legit" }]));
  r = await runTool("mark_audited.mjs", ["--pass-list", vf], env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(obs(pj).obs_series.audit, "verified");
  // now that it's verified, audit_prepare should exclude it
  r = await runTool("audit_prepare.mjs", ["obs", "2"], env);
  assert.ok(r.stdout.includes("0 across") || r.stdout.includes("total obs: 0"));
});
