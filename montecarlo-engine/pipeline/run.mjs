// The data → model pipeline as one command, for any portfolio with a portfolio.config.mjs:
//
//   compile     distribution-compiler over the config's `distributionData` project (needs `compiler`)
//   gen         compiled graphs + corpus → the generated distributions + evidence modules
//   golden      re-freeze golden (the model moved; run only when that is intended)
//   pairwise    re-bake the Pairwise matrix
//   build       the self-contained live page (config `out`)
//   precompute  the startup cache, so serve / artifacts boot instantly
//
//   node pipeline/run.mjs                     # every stage the config supports
//   node pipeline/run.mjs --from gen --to gen # a sub-range
//   node pipeline/run.mjs --fast              # skip the slow pairwise bake (leaves it STALE)
//   node pipeline/run.mjs --list
//
// Stages a portfolio has no data for (no compiled distributions, no pairwise module) are skipped. Each
// stage runs in its own process, so a stage that loads the portfolio sees the modules just generated.
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
  build: !!CONFIG.manifest,
  precompute: true,
};

const STAGES = {
  compile() {
    const before = digest();
    const projects = readdirSync(join(CONFIG.distributionData, "projects")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
    for (const f of projects) {
      sh("python3", [join(CONFIG.compiler, "compiler", "compile.py"), join("projects", f), "--write", "--quiet"], {
        cwd: CONFIG.distributionData, env: { FORECASTER_DATA: CONFIG.distributionData },
      });
    }
    const after = digest();
    const changed = Object.keys(after).filter((f) => before[f] !== after[f]).map((f) => f.split("/").pop().replace(".compiled.json", ""));
    console.log(changed.length ? `  changed: ${changed.join(", ")}` : "  no compiled project changed");
  },
  gen() { node("pipeline/gen-distributions.mjs"); node("pipeline/gen-evidence.mjs"); },
  golden() { node("pipeline/golden.mjs"); },
  pairwise() { node("pipeline/gen-pairwise.mjs", FAST ? ["--skip"] : []); },
  build() { sh(process.execPath, [join(ENGINE, "build.mjs")]); },
  precompute() { node("precompute.mjs"); },
};
const ORDER = Object.keys(STAGES);

if (argv.includes("--list")) {
  for (const s of ORDER) console.log(`${s.padEnd(11)}${has[s] ? "" : "(not configured — skipped)"}`);
  process.exit(0);
}
const from = opt("--from") ?? ORDER[0], to = opt("--to") ?? ORDER.at(-1);
for (const s of [from, to]) if (!ORDER.includes(s)) { console.error(`unknown stage "${s}" — one of: ${ORDER.join(", ")}`); process.exit(2); }
if (!existsSync(CONFIG_PATH)) { console.error(`no config at ${CONFIG_PATH}`); process.exit(2); }

console.log(`portfolio: ${CONFIG.root}`);
const t0 = performance.now();
for (const s of ORDER.slice(ORDER.indexOf(from), ORDER.indexOf(to) + 1)) {
  if (!has[s]) { console.log(`\n▸ ${s} — not configured, skipped`); continue; }
  const ts = performance.now();
  console.log(`\n▸ ${s}`);
  try { STAGES[s](); } catch (e) { console.error(`\n✗ ${s} failed: ${e.message}`); process.exit(1); }
  console.log(`  ✓ ${s} (${((performance.now() - ts) / 1000).toFixed(1)}s)`);
}
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)}s.${FAST ? " (pairwise skipped — the baked matrix is STALE)" : ""}`);
