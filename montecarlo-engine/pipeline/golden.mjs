// The golden snapshot: each project's frozen run() headline fields — the exact-reproduction guard. A
// portfolio's golden test calls checkGolden(); `node pipeline/golden.mjs` rewrites the file (run it
// ONLY when a model change is intended — then also re-bake pairwise).
import { readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.mjs";

export const GOLDEN_FIELDS = ["p20", "p50", "p80", "p95", "mean", "pSucc", "condP50"];

/** Run every project once and keep the golden fields. */
export function goldenOf(projects, run, progress) {
  const out = {};
  projects.forEach((p, i) => {
    const r = run(p);
    out[p.id] = Object.fromEntries(GOLDEN_FIELDS.map((k) => [k, r[k]]));
    if (progress) progress(i, p);
  });
  return out;
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

const runDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
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
  writeFileSync(CONFIG.golden, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${CONFIG.golden.split("/").pop()} for ${PROJECTS.length} projects in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
}
