// A node's grounding is read from the corpus ids it references, whatever their prefix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpusKinds, groundingOf } from "../simulation/compiled.mjs";

function corpus(obs: object, gk: object, spec: object) {
  const dir = mkdtempSync(join(tmpdir(), "grounding-"));
  mkdirSync(join(dir, "corpus"));
  writeFileSync(join(dir, "corpus", "observations.json"), JSON.stringify(obs));
  writeFileSync(join(dir, "corpus", "general-knowledge.json"), JSON.stringify(gk));
  writeFileSync(join(dir, "corpus", "speculations.json"), JSON.stringify(spec));
  return corpusKinds(dir);
}

test("an observation without the obs_ prefix grounds a node", () => {
  const kinds = corpus({ ret_vendor_x107: {}, obs_a: {} }, { gk_rule: {} }, { spec_guess: {} });
  const g = groundingOf({ distribution: { atoms: [{ reference: "doc_0123456789ab/ret_vendor_x107" }] } }, kinds);
  assert.equal(g.cls, "sourced");
  assert.deepEqual(g.refs, ["ret_vendor_x107"]);
});

test("words that merely look like ids are not references", () => {
  const kinds = corpus({ obs_a: {} }, { gk_rule: {} }, { spec_guess: {} });
  const g = groundingOf({ distribution: { reasoning: "see obs_missing and gk_rule", refs: ["spec_guess"] } }, kinds);
  assert.equal(g.cls, "judgement");
  assert.deepEqual(g.refs, ["gk_rule", "spec_guess"]);
});

test("evidence cited by a node's inputs grounds it", () => {
  const kinds = corpus({ obs_flow: {} }, {}, {});
  const g = groundingOf({ inputs: { in_flow: { reference: "obs_flow" } }, distribution: { median: { reference: "in_flow" } } }, kinds);
  assert.equal(g.cls, "sourced");
});
