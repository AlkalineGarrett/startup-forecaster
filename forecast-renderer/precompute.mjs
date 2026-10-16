// Precompute the model's startup state to disk so `npx forecaster serve` boots instantly instead of running
// the init pass. `npx forecaster simulate` already writes it (its results pass, montecarlo-engine
// simulation/results.mjs, shares the portfolio run with golden and the pairwise bake), so this command only
// recomputes when the snapshot is missing or stale, or with --force. A recompute runs one full init,
// v8-serializes appcore's snapshot (RunResults are Float64Arrays + plain objects, which round-trip natively),
// and stamps the source hash so the server knows the cache is current.
//
//   node precompute.mjs            # reuse a fresh snapshot, else recompute it
//   node precompute.mjs --force    # always recompute
import { initAppcore, computePairwiseAsync, snapshotState } from "./src/appcore.ts";
import { CACHE_BIN, cacheIsFresh, writeCache } from "./cache-util.mjs";
import { loadPortfolio } from "../montecarlo-engine/portfolio-loader.mjs";
import { isMain } from "../shared/is-main.mjs";

/** Bring appcore to the snapshot's state: the init pass (every project run once) + the pairwise matrix. */
export async function computeSnapshotState() {
  initAppcore();
  await computePairwiseAsync(); // fold the pairwise matrix into the cache so its tab opens instantly
}

/** Write appcore's snapshot to the cache. Call it after every generated module is written: the stamped hash
 *  covers them. Returns the serialized buffer. */
export function writeSnapshot() {
  return writeCache(snapshotState());
}

export const cacheName = () => CACHE_BIN.split("/").slice(-2).join("/");

if (isMain(import.meta.url)) {
  await loadPortfolio(); // attach the portfolio (portfolio.config.mjs bootstrap, else the example) before any appcore call
  if (!process.argv.includes("--force") && cacheIsFresh()) {
    console.log(`${cacheName()} is up to date with the model's sources (--force recomputes it).`);
  } else {
    const t0 = performance.now();
    process.stderr.write("Precomputing model (init pass + pairwise matrix)…\n");
    await computeSnapshotState();
    const buf = writeSnapshot();
    console.log(`Wrote ${cacheName()} (${(buf.length / 1e6).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
  }
}
