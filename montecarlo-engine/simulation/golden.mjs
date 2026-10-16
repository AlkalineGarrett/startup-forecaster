// The golden snapshot: each project's frozen run() headline fields — the exact-reproduction guard. A
// portfolio's golden test calls checkGolden(); `node simulation/golden.mjs` rewrites the file (run it
// ONLY when a model change is intended — then also re-bake pairwise). The simulation build
// (simulation/results.mjs) writes it from the portfolio pass it already ran, through goldenOf + writeGolden.
import { readFileSync, writeFileSync } from "node:fs";
import { isMain } from "../../shared/is-main.mjs";
import { CONFIG } from "../config.mjs";

export const GOLDEN_FIELDS = ["p20", "p50", "p80", "p95", "mean", "pSucc", "condP50"];

/** Run every project once and keep the golden fields. `run` maps a project to its result: the engine's
 *  run(p), or a lookup into results already computed (a variant project's golden is its base unit's run,
 *  which is run(p)). */
export function goldenOf(projects, run, progress) {
  const out = {};
  projects.forEach((p, i) => {
    const r = run(p);
    out[p.id] = Object.fromEntries(GOLDEN_FIELDS.map((k) => [k, r[k]]));
    if (progress) progress(i, p);
  });
  return out;
}

/** Write a goldenOf() map to the golden file (the config's `golden` unless `file` is given). */
export function writeGolden(out, file = CONFIG.golden) {
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
}

/** Compare a run against the saved golden; returns a list of mismatch messages (empty = reproduced). */
export function checkGolden(projects, run, file = CONFIG.golden) {
  const golden = JSON.parse(readFileSync(file, "utf8"));
  const bad = [];
  for (const p of projects) {
    const g = golden[p.id];
    if (!g) { bad.push(`no golden entry for ${p.id}`); continue; }
    const r = run(p);
    for (const k of GOLDEN_FIELDS) if (r[k] !== g[k]) bad.push(`${p.id}.${k}: ${r[k]} != golden ${g[k]}`);
  }
  return bad;
}

const runDirectly = isMain(import.meta.url);
if (runDirectly) {
  if (!CONFIG.golden) { console.log("golden: no `golden` path in the config — nothing to do."); process.exit(0); }
  const { loadPortfolio } = await import("../portfolio-loader.mjs");
  await loadPortfolio();
  const { PROJECTS } = await import("../src/portfolio-context.ts");
  const { run } = await import("../src/simulate.ts");
  const t0 = performance.now(), tty = process.stderr.isTTY;
  const out = goldenOf(PROJECTS, run, (i, p) => {
    const msg = `  [${i + 1}/${PROJECTS.length}] ${p.id}`;
    process.stderr.write(tty ? `\r\x1b[K${msg}` : msg + "\n");
  });
  if (tty) process.stderr.write("\r\x1b[K");
  writeGolden(out);
  console.log(`Wrote ${CONFIG.golden.split("/").pop()} for ${PROJECTS.length} projects in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
}
