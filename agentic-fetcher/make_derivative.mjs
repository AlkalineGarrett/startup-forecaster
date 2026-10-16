#!/usr/bin/env node
// Compose a DERIVATIVE document: a new corpus doc whose content is DERIVED from one or more
// originals — then cite it like any other source. Two kinds:
//
//   • COMPUTED (--compute)   — a statistic/blend over records (mean, median, percentiles, cagr, …).
//                              Reproducible by construction, so it is the STRONGER evidence.
//   • REASONING (--reasoning) — a reasoned synthesis or summary over the sources, optionally with a
//                              scalar conclusion (--value). A judgement, so it is WEAKER evidence.
//
// Either way the tool writes a transparent core (derived_from + method/reasoning + result + provenance)
// and registers a `doc_<sha>` with `origin: "derivative"`, `derivation_kind`, `derived_from`, and a
// `derivation` block. An observation is added for the result/conclusion, whose quote matches the core —
// so it self-verifies. Prefer a computed derivative when the number can be computed; use a reasoning
// derivative when the conclusion is a judgement the sources support but do not arithmetically yield.
//
//     # median monthly price across habit apps whose prices were read from their own source docs:
//     npx forecaster make-derivative \
//         --title "Median monthly price across habit apps (derived)" \
//         --from doc_<sha_a>/obs_app_a_price --from doc_<sha_b>/obs_app_b_price \
//         --records "4.99,7.99,9.99,6.49,12.99" --compute median \
//         --unit "USD/mo" --obs obs_habit_app_median_price \
//         --statement "Median monthly price across 5 habit apps = derived"
//
//     # a statistic over a series already in the corpus (pulls the series values):
//     npx forecaster make-derivative --title "CAGR of US field-service crews (derived)" \
//         --records-from doc_<sha>/obs_field_crews_series --compute cagr \
//         --unit "fraction/yr" --obs obs_field_crews_cagr --statement "Field-service crew count CAGR 2021-2024 = derived"
//
// Methods: mean median sum count min max stdev p05 p10 p25 p50 p75 p90 p95 range cagr.
// Deterministic: the same inputs always give the same doc_<sha> (dedupe). Paths resolve through paths.mjs.
// The audit (audit-evidence.md) still applies: a reviewer checks the transcribed records against the
// originals in `derived_from` before the derivative doc is marked verified.
//
// The statistics are exact float64 kernels (pairwise summation, linear-interpolation percentiles between
// closest ranks, median, sample stdev), and the result is rounded half-to-even to 6 dp. Both are kept
// exact on purpose: the doc id hashes the derivation, so the same inputs must always give the same bits.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readCorpus } from "../distribution-compiler/compiler/refs.mjs";
import { ROOTS } from "./paths.mjs";   // derivative doc + observation → PROJECT/corpus; derived core → GROUNDING/cores
import { parse, usageError } from "./lib/args.mjs";
import { dumps, load, loads, markKey } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { die, isMain, print, roundHalfEven, runMain, toNumber } from "./lib/util.mjs";

// ---- float64 statistics kernels ----
/** Pairwise summation (8 accumulators, blocks of 128): accurate, and order-stable for a given input. */
function pairwiseSum(a, lo = 0, n = a.length) {
  if (n < 8) {
    let res = 0.0;
    for (let i = 0; i < n; i++) res += a[lo + i];
    return res;
  }
  if (n <= 128) {
    const r = a.slice(lo, lo + 8);
    let i;
    for (i = 8; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.trunc(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, lo, n2) + pairwiseSum(a, lo + n2, n - n2);
}
const sum = (a) => 0.0 + pairwiseSum(a);
const mean = (a) => sum(a) / a.length;
const sortedNum = (a) => [...a].sort((x, y) => (Number.isNaN(x) ? 1 : Number.isNaN(y) ? -1 : x - y));
function median(a) {
  const s = sortedNum(a);
  if (s.some(Number.isNaN)) return NaN;
  const n = s.length, h = Math.trunc(n / 2);
  return n % 2 ? s[h] : mean([s[h - 1], s[h]]);
}
/** The p-th percentile, linear interpolation between closest ranks. */
function percentile(a, p) {
  const s = sortedNum(a);
  const n = s.length;
  if (Number.isNaN(s[n - 1])) return NaN;
  const q = p / 100;
  const virtual = (n - 1) * q;
  let prev = Math.floor(virtual), next = prev + 1;
  if (virtual >= n - 1) { prev = -1; next = -1; }
  if (virtual < 0) { prev = 0; next = 0; }
  const gamma = virtual - prev;
  const at = (i) => s[i < 0 ? n + i : i];
  const x = at(prev), y = at(next);
  const diff = y - x;
  return gamma >= 0.5 ? y - diff * (1 - gamma) : x + diff * gamma;
}
function sampleStdev(a) {
  const m = mean(a);
  const sq = a.map((x) => (x - m) * (x - m));
  return Math.sqrt(sum(sq) / Math.max(a.length - 1, 0));
}

/** A record as a number; an error for anything that is not one. */
function toFloat(x) {
  const v = typeof x === "boolean" ? null : toNumber(x);
  if (v === null) throw new Error(`not a number: ${JSON.stringify(x)}`);
  return v;
}

const P = { p05: 5, p10: 10, p25: 25, p50: 50, p75: 75, p90: 90, p95: 95 };
export function compute(method, xs) {
  if (!Array.isArray(xs)) throw new Error("records must be a list");
  const a = xs.map(toFloat);
  if (!a.length) throw new Error("no records to compute over");
  if (Object.hasOwn(P, method)) return percentile(a, P[method]);
  if (method === "mean") return mean(a);
  if (method === "median") return median(a);
  if (method === "sum") return sum(a);
  if (method === "count") return a.length;
  if (method === "min") return a.reduce((m, x) => (m <= x || Number.isNaN(m) ? m : x));
  if (method === "max") return a.reduce((m, x) => (m >= x || Number.isNaN(m) ? m : x));
  if (method === "range") return compute("max", a) - compute("min", a);
  if (method === "stdev") return a.length > 1 ? sampleStdev(a) : 0.0;
  if (method === "cagr") {                                   // first→last compound annual growth (needs >=2)
    if (a.length < 2 || a[0] <= 0) throw new Error("cagr needs >=2 positive records (first must be > 0)");
    return (a[a.length - 1] / a[0]) ** (1.0 / (a.length - 1)) - 1.0;
  }
  throw new Error(`unknown method '${method}'`);
}

const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : Boolean(v));
function seriesValues(measure) {
  if (nonEmpty(measure.series)) return measure.series.map((pt) => (Array.isArray(pt) ? pt[1] : pt.value));
  if (nonEmpty(measure.quantiles)) return Object.values(measure.quantiles);
  if (nonEmpty(measure.points)) return Object.values(measure.points);
  if (nonEmpty(measure.interval)) {
    const iv = measure.interval;
    return Array.isArray(iv) ? [...iv] : [iv.low, iv.high];
  }
  return measure.value !== null && measure.value !== undefined ? [measure.value] : [];
}

function resolveRecordsFrom(ref, obs) {
  const ok = ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;
  const o = obs[markKey(ok)];
  if (!nonEmpty(o)) die(`--records-from: ${ref} not found in observations`);
  const xs = seriesValues(nonEmpty(o.measure) ? o.measure : {});
  if (!xs.length) die(`--records-from: ${ref} has no series/quantiles/interval/value to compute over`);
  return xs;
}

const head = (s) => s.split("/", 1)[0];

const SPEC = {
  prog: "make_derivative.mjs",
  description: "Compose a derivative corpus document (computed or reasoned).",
  options: {
    title: { required: true },
    from: { multiple: true, dest: "sources", help: "a source doc_<sha> or doc_<sha>/obs_<id> this is derived from" },
    // COMPUTED derivative (strong evidence — reproducible):
    records: { help: 'explicit data: "12,29,22.99"' },
    "records-from": { help: "doc_<sha>/obs_<id> whose series/quantiles/interval supplies the data" },
    compute: { help: "a statistic: mean median p50 cagr … (computed derivative)" },
    // REASONING/SUMMARY derivative (a judgement over sources — weaker evidence):
    reasoning: { help: "the derived reasoning/summary text (reasoning derivative; give --value for a scalar conclusion)" },
    value: { number: true, help: "the conclusion value of a reasoning derivative" },
    unit: {},
    obs: { help: "also add an observation with this id for the result/conclusion" },
    statement: {},
    check: { flag: true, help: "preview, do not write" },
  },
};

export async function main() {
  const { PROJECT, GROUNDING } = ROOTS;
  const a = parse(process.argv.slice(2), SPEC);
  if (Boolean(a.compute) === Boolean(a.reasoning)) {
    usageError(SPEC, "give exactly one of --compute (computed derivative) or --reasoning (reasoning derivative)");
  }

  const regPath = `${GROUNDING}/documents.json`;              // source-identity registry (shared cache)
  let reg = existsSync(regPath) ? load(regPath) : {};
  const { obs, gk, spec } = readCorpus(`${PROJECT}/corpus`, loads);   // the compiler's corpus reader, key order kept
  for (const s of a.sources) {                                // provenance must resolve (doc, gk, or spec)
    const base = head(s);
    if (![reg, gk, spec].some((m) => Object.hasOwn(m, markKey(base)))) {
      usageError(SPEC, `--from ${s}: unknown id ${base} (not a doc_/gk_/spec_ in the corpus)`);
    }
  }

  let kind, result, derivation, resultLine, body, provenance, xs;
  const unit = a.unit ? ` ${a.unit}` : "";
  if (a.compute) {                                            // ---- computed derivative (strong) ----
    if (a.records) {
      xs = a.records.split(",").filter((x) => x.trim() !== "").map(toFloat);
    } else if (a.records_from) {
      xs = resolveRecordsFrom(a.records_from, obs);
      if (!a.sources.map(head).includes(head(a.records_from))) {
        a.sources.push(a.records_from);                       // a series source is also provenance
      }
    } else {
      usageError(SPEC, "--compute needs --records or --records-from");
    }
    kind = "computed";
    result = roundHalfEven(compute(a.compute, xs), 6);
    derivation = { kind, method: a.compute, inputs: xs, result, unit: a.unit, derived_from: a.sources, description: a.title };
    resultLine = `Result: ${a.compute} = ${result}${unit}`;
    body = `Method: ${a.compute}  (computed — reproducible, stronger evidence)\n` +
      `Records (n=${xs.length}): ${xs.join(", ")}\n${resultLine}\n`;
    provenance = "Provenance: each record is transcribed from its source document (see 'Derived from'); " +
      "the audit checks the records against those originals before this doc is marked verified.";
  } else {                                                    // ---- reasoning / summary derivative (weaker) ----
    kind = "reasoning";
    result = a.value !== null ? roundHalfEven(a.value, 6) : null;
    derivation = { kind, method: "reasoning", reasoning: a.reasoning, result, unit: a.unit, derived_from: a.sources, description: a.title };
    resultLine = result !== null ? `Conclusion: ${result}${unit}` : `Summary: ${a.title}`;
    body = "Kind: reasoning (a judgement/synthesis over the sources — weaker evidence than a computed " +
      `derivative)\nReasoning: ${a.reasoning}\n${resultLine}\n`;
    provenance = "Provenance: this is the analyst/agent's reasoning over the sources in 'Derived from'; " +
      "the audit checks the reasoning is sound and those sources actually support it before " +
      "this doc is marked verified.";
  }

  const sha = createHash("sha256").update(dumps(derivation, { sortKeys: true }), "utf8").digest("hex");
  const docId = `doc_${sha.slice(0, 12)}`;
  const core = `# Derivative document — ${a.title}\n` +
    `origin: derivative (${kind}; made by make_derivative.mjs)\n` +
    `Derived from: ${a.sources.join(", ") || "(supplied inline)"}\n` +
    `${body}\n${provenance}\n`;

  if (a.check) {
    print(`[check] ${docId}  (${kind})  ${resultLine}`);
    print(`[check] ${Object.hasOwn(reg, docId) ? "DUPLICATE (already in registry)" : "new derivative"}`);
    print("[check] core preview:\n    " + core.replaceAll("\n", "\n    "));
    return;
  }

  const coreRel = `cores/${docId}.txt`;
  mkdirSync(`${GROUNDING}/cores`, { recursive: true });
  writeFileSync(`${GROUNDING}/${coreRel}`, core, "utf8");

  // 1) register the derivative's IDENTITY (+ derivation provenance) in the shared registry (GROUNDING)
  await withLock(regPath, () => {
    const text = readFileSync(regPath, "utf8").trim();
    reg = text ? loads(text) : {};
    const entry = reg[docId] || {};
    Object.assign(entry, { sha256: sha, title: a.title, url: "", publisher: "derived",
      origin: "derivative", derivation_kind: kind, derived_from: a.sources,
      derivation, core: coreRel, verification: "unchecked" });
    reg[docId] = entry;
    rewrite(regPath, dumps(reg, { indent: 1 }) + "\n");
  });

  // 2) the derived result as a project OBSERVATION (flat map under PROJECT), with a doc backref
  if (a.obs) {
    const measure = a.unit ? { unit: a.unit } : {};
    if (result !== null) measure.value = result;
    const obsRec = {
      statement: a.statement || (a.compute ? `${a.compute} over ${xs.length} records = ${result}` : a.title),
      measure, quote: resultLine, locator: "derivation result line",
      verification: "unchecked", audit: "unaudited", derived: true, derivation_kind: kind,
      doc: docId,
    };
    const obsPath = `${PROJECT}/corpus/observations.json`;
    mkdirSync(`${PROJECT}/corpus`, { recursive: true });
    await withLock(obsPath, () => {
      const text = readFileSync(obsPath, "utf8").trim();
      const obsmap = text ? loads(text) : {};
      obsmap[markKey(a.obs)] = obsRec;
      rewrite(obsPath, dumps(obsmap, { indent: 1 }) + "\n");
    });
  }

  print(`derivative ${docId} (${kind}): ${resultLine}`);
  print(`  core: ${coreRel}   derived_from: ${a.sources.join(", ") || "(inline)"}`);
  if (a.obs) {
    print(`  obs ${docId}/${a.obs} added (quote self-verifies against the core)`);
    print(`  → cite it:  "reference": "${docId}/${a.obs}"`);
  }
}

if (isMain(import.meta.url)) runMain(main);
