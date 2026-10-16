#!/usr/bin/env node
// Preview a distribution's percentiles without authoring a node or running the full compiler —
// and fit params to target quantiles (the actual authoring task). No corpus, no file write.
//
// The beta and gamma fits solve two quantile equations with a 2-D Newton iteration.
const DOC = `Preview a distribution's percentiles without authoring a node or running the full compiler —
and fit params to target quantiles (the actual authoring task). No corpus, no file write.

  # percentiles + support + mean for an inline construction (params: plain numbers or value objects)
  npx forecaster preview '{"kind":"lognormal","median":9,"sigma":0.64}'
  npx forecaster preview '{"kind":"splice","segments":[...],"splices":[...]}'

  # fit params to hit target quantiles, then show the resulting percentiles
  npx forecaster preview fit beta p10=0.25 p90=0.70
  npx forecaster preview fit lognormal p50=9 p90=20
  npx forecaster preview fit normal p10=100 p90=140
  npx forecaster preview fit gamma p10=0.1 p50=0.47 p90=1.5
  npx forecaster preview fit metalog p10=50 p50=120 p90=400 [--lower=0]   # a source-stated LADDER

Reach for \`metalog\` when a source states a quantile LADDER (>=3 points) whose shape isn't a clean
parametric family — asymmetric, or lower-bounded (a $0 floor). A lognormal fit to just p10/p90
throws away a stated p50 that disagrees; a metalog honors every anchor.

CHOOSING THE ANCHOR PROBABILITIES (this is where ladders go wrong):
  - Source STATES the percentiles ("25th pct = X, median = Y, 90th = Z", levels.fyi p25/50/75/90,
    a ChartMogul retention decile table) -> anchor at the source's OWN stated percentiles.
  - Values are DATA POINTS / observed items (list-price tiers, an enumeration, measured samples) ->
    they are NOT p10/p90. Use plotting positions p_i = i/(n+1) (Weibull): for n=3 that is
    0.25/0.50/0.75, for n=4 0.20/0.40/0.60/0.80. Anchoring 3 data points at 0.10/0.50/0.90 pretends
    the outer two span an 80% interval they don't — it makes the fit far too narrow.
  - Values are a SUBJECTIVE low/median/high elicitation ("my plausible low/typical/high") -> that IS
    an 80% credible interval, so 0.10/0.50/0.90 is the correct convention; keep it.
`;
import { isMain } from "../../shared/is-main.mjs";
import * as D from "./distributions.mjs";
import * as C from "./compile.mjs";
import * as N from "./numerics.mjs";
import { round, sig } from "./format.mjs";

const Z = (p) => N.ndtri(p);
/** Stop with a message on stderr and exit code 1. */
class Exit extends Error {}
const exit = (msg) => { throw new Exit(msg); };

function show(dist) {
  const mean = N.mean(dist.ppf(D.GRID));
  const [lo, hi] = dist.support;
  console.log("  percentiles:", JSON.stringify(dist.percentiles()));
  console.log(`  mean≈${sig(mean)}   support=(${sig(lo)}, ${sig(hi)})`);
}

/** targets: Map prob -> value. Returns a params object for `kind`. */
export function fit(kind, targets) {
  const ps = [...targets.keys()].sort((a, b) => a - b);
  const p1 = ps[0], p2 = ps[ps.length - 1], v1 = targets.get(p1), v2 = targets.get(p2);
  if (kind === "normal") {
    const sd = (v2 - v1) / (Z(p2) - Z(p1));
    return { mean: round(v1 - Z(p1) * sd, 6), sd: round(sd, 6) };
  }
  if (kind === "lognormal") {
    const sig = (Math.log(v2) - Math.log(v1)) / (Z(p2) - Z(p1));
    const med = Math.exp(Math.log(v1) - Z(p1) * sig);
    return { median: round(med, 6), sigma: round(sig, 6) };
  }
  if (kind === "beta") {
    const resid = ([a, b]) => [N.betaincinv(a, b, p1) - v1, N.betaincinv(a, b, p2) - v2];
    const [a, b] = N.newton2(resid, [2.0, 2.0]);
    return { alpha: round(a, 6), beta: round(b, 6) };
  }
  if (kind === "gamma") {
    const pm = ps[Math.floor(ps.length / 2)], vm = targets.get(pm);
    const resid = (kr) => {
      const k = Math.abs(kr[0]), r = Math.abs(kr[1]);
      return [N.gammaincinv(k, p1) / r - v1, N.gammaincinv(k, pm) / r - vm];
    };
    const [k, r] = N.newton2(resid, [1.5, 1.0]);
    return { shape: round(Math.abs(k), 6), rate: round(Math.abs(r), 6) };
  }
  exit(`fit not supported for kind '${kind}' (have: normal, lognormal, beta, gamma)`);
}

/** For lognormal/normal, the params are a closed form of two quantiles — so author them as
 *  GROUNDED computed_value formulas over your two source observations, not inferred numbers. */
function groundedForm(kind, targets) {
  const ps = [...targets.keys()].sort((a, b) => a - b);
  if (!["lognormal", "normal"].includes(kind) || ps.length < 2) return;
  const lo = ps[0], hi = ps[ps.length - 1], zlo = Z(lo), zhi = Z(hi), zspread = round(zhi - zlo, 4);
  const r4 = (x) => round(x, 4);
  const pp = (x) => String(Math.round(x * 100)).padStart(2, "0");
  console.log(`  ↳ prefer computed_value (grounded, not inferred) — replace <lo>/<hi> with your `
    + `p${pp(lo)}/p${pp(hi)} source obs:`);
  if (kind === "lognormal") {
    const med = Math.abs(zlo + zhi) < 1e-9 ? "exp((log(<lo>.value) + log(<hi>.value)) / 2)"
      : `exp(log(<lo>.value) - (${r4(zlo)}) * (log(<hi>.value) - log(<lo>.value)) / ${zspread})`;
    console.log(`      median: ${med}`);
    console.log(`      sigma:  (log(<hi>.value) - log(<lo>.value)) / ${zspread}`);
  } else {
    const mean = Math.abs(zlo + zhi) < 1e-9 ? "(<lo>.value + <hi>.value) / 2"
      : `<lo>.value - (${r4(zlo)}) * (<hi>.value - <lo>.value) / ${zspread}`;
    console.log(`      mean: ${mean}`);
    console.log(`      sd:   (<hi>.value - <lo>.value) / ${zspread}`);
  }
}

function run(argv) {
  if (argv[0] === "-h" || argv[0] === "--help") { console.log(DOC); return; }
  if (argv.length < 1) exit(DOC);
  if (argv[0] === "fit") {
    const kind = argv[1];
    if (kind === undefined) exit("usage: preview.mjs fit <kind> pNN=value ... [--lower=x] [--upper=x]");
    const targets = new Map();
    let lower = null, upper = null;
    for (const tok of argv.slice(2)) {
      if (tok.startsWith("--lower=")) { lower = numArg(tok.slice(8)); continue; }
      if (tok.startsWith("--upper=")) { upper = numArg(tok.slice(8)); continue; }
      const m = /^p(\d+)=(.+)$/.exec(tok);
      if (!m) exit(`expected pNN=value, got '${tok}'`);
      targets.set(Number(m[1]) / 100, numArg(m[2]));
    }
    if (kind === "metalog") {                        // a source-stated quantile LADDER (3+ points),
      const anchors = [...targets.entries()].sort((a, b) => a[0] - b[0]);   // asymmetric / bounded — not a parametric shape
      if (anchors.length < 2) exit("metalog needs >= 2 quantiles (a ladder), e.g. fit metalog p10=50 p50=120 p90=400 [--lower=0] [--upper=1]");
      let d;
      try {
        d = D.construct("metalog", { _anchors: anchors, k: anchors.length, lower_bound: lower, upper_bound: upper, zero_mass: 0.0 });
      } catch (e) {
        exit(`metalog infeasible: ${e.message} — reduce k, widen the spacing, or set --lower=<bound>`);
      }
      const authored = {
        kind: "metalog", k: anchors.length,
        ...(lower !== null ? { lower_bound: lower } : {}),
        ...(upper !== null ? { upper_bound: upper } : {}),
        anchors: anchors.map(([p, v]) => ({ prob: p, value: v })),
      };
      console.log("author this distribution (each anchor is a source quantile — reference the obs on `value`):");
      console.log("  " + JSON.stringify(authored));
      show(d);
      return;
    }
    const params = fit(kind, targets);
    let d, bad;
    try {                                            // reject inverted targets (→ negative scale → NaN)
      d = D.construct(kind, params);
      bad = [...targets.keys()].some((p) => !Number.isFinite(d.ppf(p)));
    } catch {
      bad = true;
    }
    if (bad) exit(`fit produced an infeasible distribution ${JSON.stringify(params)} — the higher-probability value must be larger`);
    console.log(`fit ${kind}: ${JSON.stringify(params)}`);
    show(d);
    groundedForm(kind, targets);
  } else {
    const distJson = JSON.parse(argv[0]);
    const diag = new C.Diag("preview");
    const ctx = { ids: {}, _corpus: new Map(), segments: [], splices: [] };   // no corpus: an empty index
    const dist = C.buildDist(distJson, ctx, diag, "preview");
    for (const [lvl, , p, m] of diag) console.log(`  ${lvl === "error" ? "✗" : "⚠"} ${p}: ${m}`);
    if (dist === null) exit("could not construct");
    show(dist);
  }
}
function numArg(s) {
  const v = Number(s);
  if (s.trim() === "" || Number.isNaN(v)) exit(`not a number: '${s}'`);
  return v;
}

function main(argv) {
  try { run(argv); } catch (e) {
    if (!(e instanceof Exit)) throw e;
    process.stderr.write(e.message.endsWith("\n") ? e.message : e.message + "\n");
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
