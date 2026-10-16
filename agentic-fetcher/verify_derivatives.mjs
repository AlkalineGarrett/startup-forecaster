#!/usr/bin/env node
// Algorithmic re-verification of every `computed` derivative document (audit-evidence.md, Audit 3).
//
// A computed derivative records `derivation = { method, inputs, result, derived_from }`. Because the
// method is deterministic, the derivative is *reproducible*: recomputing `method(inputs)` must reproduce
// `result`. This tool does exactly that for every `origin: derivative`, `derivation_kind: computed`
// document in the shared registry, and reports:
//
//   ARITHMETIC  result == compute(method, inputs)        — fully mechanical, PASS/FAIL
//   PROVENANCE  each doc/obs id in derived_from resolves, and its measure value is present among the
//               recorded inputs                            — mechanical where derived_from is a doc/obs
//               pair; reported as INFO (a page-enumeration derivative lists source pages, not obs, so
//               its inputs legitimately don't map 1:1 — that part is Audit-3 step 1, read by an agent).
//
// Exit status: 0 iff every computed derivative reproduces (ARITHMETIC PASS). Reuses make_derivative's
// own `compute()` so the check matches how the value was produced. Two-root model: derivative identity
// + derivation live in GROUNDING/documents.json; observations in PROJECT/corpus/observations.json.
//
//     npx startup-forecaster verify-derivatives            # human-readable report
//     npx startup-forecaster verify-derivatives --json      # machine verdicts
import { existsSync } from "node:fs";
import { ROOTS } from "./paths.mjs";
import { compute } from "./make_derivative.mjs";
import { parse } from "./lib/args.mjs";
import { dumps, load, markKey } from "./lib/json.mjs";
import { isMain, print, roundHalfEven, runMain, toNumber } from "./lib/util.mjs";

const TOL = 1e-6;   // inputs/result are stored rounded to 6 dp

/** A stored value as a number; an error for anything that is not one. */
function toFloat(x) {
  const v = typeof x === "boolean" ? null : toNumber(x);
  if (v === null) throw new Error(`not a number: ${JSON.stringify(x)}`);
  return v;
}

function measureScalar(m) {
  if (m === null || typeof m !== "object" || Array.isArray(m)) return null;
  for (const k of ["value", "mean", "mode"]) if (m[k] !== null && m[k] !== undefined) return toFloat(m[k]);
  return null;
}

export function verify() {
  const { PROJECT, GROUNDING } = ROOTS;
  const docs = load(`${GROUNDING}/documents.json`);
  const opath = `${PROJECT}/corpus/observations.json`;
  const obs = existsSync(opath) ? load(opath) : {};

  const verdicts = [];
  for (const [docid, d] of Object.entries(docs)) {
    if (d.origin !== "derivative" || d.derivation_kind !== "computed") continue;
    const der = d.derivation || {};
    const method = der.method ?? null, inputs = der.inputs ?? null, result = der.result ?? null;
    const v = { doc: docid, method, inputs, result, arithmetic: "FAIL", recomputed: null, provenance: [] };
    try {
      const rec = compute(method, inputs);
      v.recomputed = roundHalfEven(rec, 6);
      const res = toFloat(result);
      v.arithmetic = Math.abs(rec - res) <= Math.max(TOL, Math.abs(Number(result)) * 1e-9) ? "PASS" : "FAIL";
    } catch (e) {
      v.recomputed = `error: ${e.message}`;
    }
    // provenance: for each derived_from that is a doc/obs pair, does its measure value appear in inputs?
    for (const ref of der.derived_from ?? []) {
      if (!ref.includes("/")) {
        v.provenance.push({ ref, kind: "doc-only", note: "page/source doc (no obs) — read by agent" });
        continue;
      }
      const oid = ref.slice(ref.indexOf("/") + 1);
      const o = obs[markKey(oid)] ?? null;
      if (o === null) {
        v.provenance.push({ ref, kind: "obs", resolves: false });
        continue;
      }
      const val = measureScalar(o.measure ?? null);
      const present = val !== null && inputs.some((x) => Math.abs(val - toFloat(x)) <= Math.max(TOL, Math.abs(val) * 1e-3));
      v.provenance.push({ ref, kind: "obs", resolves: true, measure_value: val, in_inputs: present });
    }
    verdicts.push(v);
  }
  return verdicts;
}

export async function main() {
  const a = parse(process.argv.slice(2), {
    prog: "verify_derivatives.mjs",
    description: "Recompute every computed derivative and check its recorded result and provenance.",
    options: { json: { flag: true, help: "machine verdicts" } },
  });
  const verdicts = verify();
  if (a.json) {
    print(dumps(verdicts, { indent: 2 }));
    return verdicts.every((v) => v.arithmetic === "PASS") ? 0 : 1;
  }

  let ok = 0;
  for (const v of verdicts) {
    const mark = v.arithmetic === "PASS" ? "✓" : "✗";
    print(`${mark} ${v.doc}  ${v.method}(${JSON.stringify(v.inputs)}) = ${v.recomputed}  (recorded ${v.result})  [${v.arithmetic}]`);
    for (const p of v.provenance) {
      if (p.kind === "doc-only") print(`     · ${p.ref}  — ${p.note}`);
      else if (!p.resolves) print(`     ✗ ${p.ref}  — obs does not resolve`);
      else {
        const flag = p.in_inputs ? "in inputs" : "NOT in inputs (check transform: FX/price-divide/etc.)";
        print(`     · ${p.ref}  measure=${p.measure_value}  — ${flag}`);
      }
    }
    ok += v.arithmetic === "PASS";
  }
  print(`\n${ok}/${verdicts.length} computed derivatives reproduce arithmetically.`);
  return ok === verdicts.length ? 0 : 1;
}

if (isMain(import.meta.url)) runMain(main);
