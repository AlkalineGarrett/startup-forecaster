// The simulation build (data → model) as one command, for any portfolio with a portfolio.config.mjs:
//
//   compile     distribution-compiler over the config's `distributionData` project (needs `compiler`)
//   gen         compiled graphs + corpus → the generated distributions + evidence modules
//   golden      re-freeze golden (the model moved; run only when that is intended)
//   pairwise    re-bake the Pairwise matrix
//   precompute  write forecast-renderer's startup snapshot (.cache), as `forecaster precompute` does
//
// golden, pairwise and precompute share ONE run of the portfolio: whichever of them are selected run together
// in one process (simulation/results.mjs). Rendering the results (the live page, static pages) is
// forecast-renderer's job (`forecaster build` / `serve` / `artifact`), and they start from that snapshot.
//
//   node simulation/run.mjs                     # every stage the config supports
//   node simulation/run.mjs --from gen --to gen # a sub-range
//   node simulation/run.mjs --fast              # skip the slow pairwise bake and the snapshot (both STALE)
//   node simulation/run.mjs --list
//
// Stages a portfolio has no data for (no compiled distributions, no pairwise module) are skipped. Each
// step runs in its own process, so the results pass sees the modules just generated.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, CONFIG_PATH } from "../config.mjs";
import { compiledFiles } from "./compiled.mjs";

const ENGINE = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const FAST = argv.includes("--fast");

function sh(cmd, args, opts = {}) {
  console.log(`  $ ${[cmd, ...args].map((a) => a.replace(ENGINE + "/", "")).join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: CONFIG.root, ...opts, env: { ...process.env, MC_CONFIG: CONFIG_PATH, ...opts.env } });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}
const node = (script, extra = []) => sh(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ENGINE, script), ...extra]);
const digest = () => Object.fromEntries(compiledFiles(CONFIG.distributionData).map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex")]));

const has = {
  compile: !!(CONFIG.distributionData && CONFIG.compiler),
  gen: !!(CONFIG.distributionData && (CONFIG.generated.distributions || CONFIG.generated.evidence)),
  golden: !!CONFIG.golden,
  pairwise: !!CONFIG.generated.pairwise,
  precompute: existsSync(join(ENGINE, "..", "forecast-renderer", "precompute.mjs")),
};
// The stages that read the portfolio's results: run together, over one portfolio pass.
const RESULTS = ["golden", "pairwise", "precompute"];

const STAGES = {
  compile() {
    const before = digest();
    const projects = readdirSync(join(CONFIG.distributionData, "projects")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
    for (const f of projects) {
      // the compiler resolves the same data project from MC_CONFIG (and the same overrides): one resolver
      sh(process.execPath, [join(CONFIG.compiler, "compiler", "compile.mjs"), join("projects", f), "--write", "--quiet"], { cwd: CONFIG.distributionData });
    }
    const after = digest();
    const changed = Object.keys(after).filter((f) => before[f] !== after[f]).map((f) => f.split("/").pop().replace(".compiled.json", ""));
    console.log(changed.length ? `  changed: ${changed.join(", ")}` : "  no compiled project changed");
  },
  gen() { node("simulation/gen-distributions.mjs"); node("simulation/gen-evidence.mjs"); },
  golden: null, pairwise: null, precompute: null, // → results(stages)
};
const ORDER = Object.keys(STAGES);
function results(stages) { node("simulation/results.mjs", stages.map((s) => `--${s}`)); }

if (argv.includes("--list")) {
  for (const s of ORDER) console.log(`${s.padEnd(11)}${has[s] ? "" : "(not configured — skipped)"}`);
  process.exit(0);
}
const from = opt("--from") ?? ORDER[0], to = opt("--to") ?? ORDER.at(-1);
for (const s of [from, to]) if (!ORDER.includes(s)) { console.error(`unknown stage "${s}" — one of: ${ORDER.join(", ")}`); process.exit(2); }

console.log(`portfolio: ${CONFIG.root}`);
const t0 = performance.now();
const selected = ORDER.slice(ORDER.indexOf(from), ORDER.indexOf(to) + 1);
const fastSkipped = FAST ? selected.filter((s) => s === "pairwise" || s === "precompute") : [];
const pending = selected.filter((s) => RESULTS.includes(s) && has[s] && !fastSkipped.includes(s));
for (const s of selected) {
  if (!has[s]) { console.log(`\n▸ ${s} — not configured, skipped`); continue; }
  if (fastSkipped.includes(s)) { console.log(`\n▸ ${s} — skipped (--fast)`); continue; }
  if (RESULTS.includes(s) && s !== pending[0]) continue; // ran with the first results stage
  const step = RESULTS.includes(s) ? pending.join(" + ") : s;
  const ts = performance.now();
  console.log(`\n▸ ${step}`);
  try { if (RESULTS.includes(s)) results(pending); else STAGES[s](); } catch (e) { console.error(`\n✗ ${step} failed: ${e.message}`); process.exit(1); }
  console.log(`  ✓ ${step} (${((performance.now() - ts) / 1000).toFixed(1)}s)`);
}
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)}s.${fastSkipped.length ? ` (${fastSkipped.join(" and ")} skipped — STALE until re-run)` : ""}`);
