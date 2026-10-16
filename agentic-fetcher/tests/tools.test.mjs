// The evidence-authoring tools (add_observation, add_knowledge), hermetic via redirected roots.
// The corpus is written under PROJECT; the core quote-matched against lives under GROUNDING.
// Hermetic: each test points paths.ROOTS at its own temp dir.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOTS } from "../paths.mjs";
import * as AO from "../add_observation.mjs";
import * as AK from "../add_knowledge.mjs";
import { Exit } from "../lib/util.mjs";
import { tmpPath } from "./helpers.mjs";

/** Point the tools' roots at one tmp dir (it holds both cores/ and corpus/). */
function at(tmp) {
  ROOTS.PROJECT = tmp;
  ROOTS.GROUNDING = tmp;
}

test("norm folds whitespace and unicode", () => {
  assert.equal(AO.norm("a\n  b\tc"), "a b c");
  assert.equal(AO.norm("$10–25"), "$10-25");        // en-dash → hyphen
  assert.equal(AO.norm("“q”"), '"q"');              // curly quotes
});

function corpus(tmp, coreText) {
  // GROUNDING and PROJECT both point at tmp here, so: the identity registry is tmp/documents.json,
  // the core is tmp/cores/…, observations go to tmp/corpus/…
  mkdirSync(join(tmp, "cores"));
  writeFileSync(join(tmp, "cores", "doc_abc.txt"), coreText, "utf8");
  mkdirSync(join(tmp, "corpus"));
  writeFileSync(join(tmp, "documents.json"), JSON.stringify({ doc_abc: { sha256: "a".repeat(64), core: "cores/doc_abc.txt" } }));
}

test("verifyQuote normalizes", () => {
  const tmp = tmpPath();
  at(tmp);
  corpus(tmp, "line one\n76.4%\nline three");
  const doc = { core: "cores/doc_abc.txt" };
  assert.equal(AO.verifyQuote(doc, "76.4%"), "verified");
  assert.equal(AO.verifyQuote(doc, "line one 76.4%"), "verified");   // matches across the newline
  assert.equal(AO.verifyQuote(doc, "not present"), "not_in_doc");
  assert.equal(AO.verifyQuote({ core: null }, "a real quote"), "unverifiable");
  // a trivial quote can't prove grounding → unchecked (not verified), even if it "appears"
  assert.equal(AO.verifyQuote(doc, " "), "unchecked");
  assert.equal(AO.verifyQuote(doc, "ID"), "unchecked");
});

const ns = (kw) => ({ unit: "c", value: null, mean: null, mode: null, interval: null, quantiles: null, points: null,
  series: null, population: null, period: null, ...kw });

test("buildMeasure rejects bad flags", () => {
  assert.throws(() => AO.buildMeasure(ns({ interval: "10,1" })), Exit);   // low >= high
  assert.throws(() => AO.buildMeasure(ns({ series: "FY21:x" })), Exit);   // non-numeric value
});

test("buildMeasure all forms", () => {
  const m = AO.buildMeasure(ns({ interval: "1,9", quantiles: "p10:2,p90:8", series: "2021:100,2024:144" }));
  assert.deepEqual(m.interval, { low: 1, high: 9 });
  assert.deepEqual(m.quantiles, { p10: 2, p90: 8 });
  assert.deepEqual(m.series, [{ period: "2021", value: 100 }, { period: "2024", value: 144 }]);   // schema: string period
});

test("buildMeasure rejects named quantile keys", () => {
  assert.throws(() => AO.buildMeasure(ns({ quantiles: "gaap:72,nongaap:77" })), Exit);   // named keys must use --points
});

test("buildMeasure accepts points", () => {
  const m = AO.buildMeasure(ns({ points: "gaap:72,nongaap:77" }));
  assert.deepEqual(m.points, { gaap: 72, nongaap: 77 });
});

test("add_observation writes verified", async () => {
  const tmp = tmpPath();
  at(tmp);
  corpus(tmp, "gross margin 76.4% reported");
  await AO.add("doc_abc", "obs_gm", "stmt", "76.4%", "loc", { unit: "%", value: 76.4 });
  const o = JSON.parse(readFileSync(join(tmp, "corpus", "observations.json"), "utf8")).obs_gm;
  assert.equal(o.verification, "verified");
  assert.equal(o.measure.value, 76.4);
  assert.ok(!("cited_by" in o));                          // node usage is derived, not stored (citations.mjs)
  assert.equal(o.doc, "doc_abc");                         // observation carries its source backref
});

test("add_observation --check does not write", async () => {
  const tmp = tmpPath();
  at(tmp);
  corpus(tmp, "value 5 here");
  await AO.add("doc_abc", "obs_x", "s", "value 5", "", { unit: "u", value: 5 }, true);
  assert.ok(!existsSync(join(tmp, "corpus", "observations.json")));   // --check writes nothing
});

test("add_knowledge writes", async () => {
  const tmp = tmpPath();
  at(tmp);
  mkdirSync(join(tmp, "corpus"));
  writeFileSync(join(tmp, "corpus", "general-knowledge.json"), "{}");
  await AK.add("gk", "gk_x", "stmt", "because it is a heuristic", 40, "%", null, null, null);
  const d = JSON.parse(readFileSync(join(tmp, "corpus", "general-knowledge.json"), "utf8"));
  assert.equal(d.gk_x.measure.value, 40);
  assert.ok(d.gk_x.reasoning.startsWith("because"));
});

test("add_knowledge rejects a bad id prefix", async () => {
  const tmp = tmpPath();
  at(tmp);
  mkdirSync(join(tmp, "corpus"));
  writeFileSync(join(tmp, "corpus", "speculations.json"), "{}");
  await assert.rejects(AK.add("spec", "gk_wrongprefix", "s", "r", null, null, null, null, null), Exit);
});
