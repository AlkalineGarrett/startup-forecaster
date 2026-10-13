#!/usr/bin/env node
// Add an observation to the shared corpus so a node's `reference: "doc_<sha>/obs_<id>"` resolves
// to a real, quote-verified fact — turning grounding from prose into a machine-checked link.
//
//   node add_observation.mjs doc_5697a4de16e7 obs_nrr_arpa_lt50 \
//       --value 94 --unit "%" --statement "Net revenue retention ~94% for <$50 ARPA SaaS" \
//       --quote "Net Revenue Retention (NRR)" --locator "retention table"
//
// Which nodes cite an observation is NOT stored on it (that list drifts into stale/phantom entries).
// It is derived on demand from projects/*.json by `citations.mjs`.
//
// Measure forms (§7): --value / --mean / --mode scalars; --interval "lo,hi"; --quantiles
// "p10:v,p50:v,p90:v"; --series "2021:78841,2024:236888" (feeds extrapolate_cagr/linear).
// --check verifies the quote against the core and prints the result WITHOUT writing.
//
// The quote is matched against the document's lean core (cores/doc_<sha12>.txt) after normalizing
// whitespace and common unicode (dashes/quotes/NBSP), so a figure split across lines or an en-dash
// still matches. verified = found; not_in_doc = core exists but quote absent; unverifiable = no core.
// Reads the doc's identity/core from the shared registry (GROUNDING/documents.json); writes the
// observation into the project's flat evidence map (PROJECT/corpus/observations.json, keyed obs_<id>
// with a `doc` backref) under an exclusive file lock (safe for parallel agents).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
// Observations are written to the flat map under PROJECT (corpus/observations.json); the source
// IDENTITY (+ the core it quote-matches against) is read from GROUNDING. Both overridable for tests.
import { ROOTS, schemaDefs } from "./paths.mjs";
import { validator } from "../distribution-compiler/compiler/jsonschema.mjs";   // the schema lives in distribution-compiler (its single source)
import { parse } from "./lib/args.mjs";
import { dumps, load, loads, markKey } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { Exit, die, isMain, print, readText, runMain, toNumber } from "./lib/util.mjs";

let measureValidator = null;
const MEASURE_V = () => {
  if (!measureValidator) {
    const defs = schemaDefs();
    measureValidator = validator({ ...defs.measure, $defs: defs }, defs);
  }
  return measureValidator;
};

const FOLD = { "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-",
  "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " " };
const FOLD_RE = /[\u2010-\u2015\u2018\u2019\u201c\u201d\u00a0]/g;

/** Collapse whitespace and fold unicode dashes/quotes/NBSP so quote-matching isn't defeated by
 * line wraps or en-dash vs hyphen. */
export function norm(s) {
  return s.normalize("NFKC").replace(FOLD_RE, (c) => FOLD[c]).replace(/\s+/g, " ").trim();
}

export function verifyQuote(doc, quote) {
  const core = doc.core ?? null;
  if (!quote) return "unchecked";
  const q = norm(quote);
  if (q.length < 3 || !/[\p{L}\p{N}]/u.test(q)) return "unchecked";   // too trivial to prove grounding
  if (!core || !existsSync(`${ROOTS.GROUNDING}/${core}`)) return "unverifiable";
  const text = readText(`${ROOTS.GROUNDING}/${core}`, "replace");
  return norm(text).includes(q) ? "verified" : "not_in_doc";
}

const MALFORMED = "malformed measure flag. Formats: --interval 'lo,hi'  --quantiles 'p10:v,p50:v'  --series 'YYYY:v,YYYY:v'";
const num = (x) => {
  const v = toNumber(x);
  if (v === null) die(MALFORMED);
  return v;
};
/** "k:v,k:v" → [[k, v], …]; each item must be exactly one key and one value. */
const pairs = (s) => s.split(",").map((kv) => {
  const p = kv.split(":");
  if (p.length !== 2) die(MALFORMED);
  return [p[0].trim(), num(p[1])];
});

/** a: the parsed flags (unit, value, mean, mode, interval, quantiles, points, series, population,
 * period). Exits on a malformed or schema-invalid measure. */
export function buildMeasure(a) {
  const m = a.unit ? { unit: a.unit } : {};
  for (const k of ["value", "mean", "mode"]) if (a[k] !== null && a[k] !== undefined) m[k] = a[k];
  if (a.interval) {
    const parts = a.interval.split(",");
    if (parts.length !== 2) die(MALFORMED);
    const [lo, hi] = parts.map(num);
    if (lo >= hi) die(`--interval low must be < high (got ${lo},${hi})`);
    m.interval = { low: lo, high: hi };                    // schema §7: interval is {low, high}
  }
  if (a.quantiles) m.quantiles = Object.fromEntries(pairs(a.quantiles).map(([k, v]) => [markKey(k), v]));
  if (a.points) m.points = Object.fromEntries(pairs(a.points).map(([k, v]) => [markKey(k), v]));   // named point-measures (not probability quantiles)
  if (a.series) m.series = pairs(a.series).map(([p, v]) => ({ period: p, value: v }));            // period is a string per schema §7
  if (a.population) m.population = a.population;
  if (a.period) m.period = a.period;
  const errs = MEASURE_V()(JSON.parse(dumps(m)));          // reject a schema-invalid measure at write time
  if (errs.length) {
    die("measure is schema-invalid: " + errs.slice(0, 3).map((e) => e.message.slice(0, 100)).join("; ") +
      "  (quantiles keys must be p10/p50/…; use --points 'label:v,…' for named breakdowns)");
  }
  return m;
}

function registry() {
  const p = `${ROOTS.GROUNDING}/documents.json`;              // source-identity registry (shared cache)
  return [existsSync(p) ? load(p) : {}, p];
}

export async function add(docId, obsId, statement, quote, locator, measure, check = false) {
  const [reg, regPath] = registry();
  if (!Object.hasOwn(reg, markKey(docId))) die(`unknown document ${docId} (not in ${regPath})`);
  const doc = reg[markKey(docId)], v = verifyQuote(doc, quote), cap = doc.capture ?? null;
  if (check) {                                               // verify only, no lock, no write
    print(`[check] ${docId}/${obsId}: verification=${v}`);
    if (v === "not_in_doc") print("  ⚠ quote not found in the core (after whitespace/unicode normalization)");
    if (cap === "transcribed") {
      print("  ⚠ capture:transcribed — quote verifies against an agent transcription, not the live page");
    }
    return v;
  }
  // Note: which nodes cite an observation is NOT stored — it drifts (stale/phantom entries). It is
  // derived on demand from projects/*.json by citations.mjs (always fresh).
  // `audit: unaudited` marks it as owing the legitimacy pass (audit_prepare.mjs → mark_audited.mjs); check_sources S8 counts
  // it as debt until an audit marks it `verified`/`flagged`. Never born pre-audited.
  const obs = { statement, measure, quote: quote || null, locator, verification: v, audit: "unaudited", doc: docId };
  if (cap === "transcribed") obs.source_capture = "transcribed";   // weaker evidence: self-verifies
  if (quote === null || quote === undefined) obs.capture_note = "value read without a verbatim quote";
  const path = `${ROOTS.PROJECT}/corpus/observations.json`;       // the project's flat observation map (keyed obs_<id>)
  mkdirSync(`${ROOTS.PROJECT}/corpus`, { recursive: true });
  await withLock(path, () => {                                     // lock the read-modify-write
    const body = readFileSync(path, "utf8").trim();
    const obsmap = body ? loads(body) : {};
    obsmap[markKey(obsId)] = obs;
    rewrite(path, dumps(obsmap, { indent: 1 }) + "\n");
  });
  print(`${docId}/${obsId}: verification=${v}  measure=${dumps(measure)}`);
  if (v === "not_in_doc") {
    print("  ⚠ quote NOT found in the core (after normalization) — fix the quote/locator or value");
  }
  if (cap === "transcribed") {
    print("  ⚠ source is capture:transcribed — the quote verifies against an AGENT TRANSCRIPTION, not " +
      "the live page. Corroborate with a second source or a human audit before treating as firm.");
  }
  return v;
}

export async function main() {
  const a = parse(process.argv.slice(2), {
    prog: "add_observation.mjs",
    description: "Add a quote-verified observation for a registered document.",
    positionals: ["doc_id", "obs_id"],
    options: {
      statement: { required: true }, quote: {}, unit: {}, locator: { default: "" },
      value: { number: true }, mean: { number: true }, mode: { number: true },
      interval: { help: '"lo,hi"' }, quantiles: { help: '"p10:v,p50:v"' },
      points: { help: '"label:v,label:v" — named point-measures (not probability quantiles)' },
      series: { help: '"YYYY:v,YYYY:v" — feeds extrapolate_cagr/linear' },
      population: {}, period: {},
      check: { flag: true, help: "verify the quote, print, do not write" },
    },
  });
  await add(a.doc_id, a.obs_id, a.statement, a.quote, a.locator, buildMeasure(a), a.check);
}

export { Exit };
if (isMain(import.meta.url)) runMain(main);
