// Precompute the model's startup state to disk so `npm run serve` boots instantly instead of running
// the ~20s init pass. Run this whenever the model changes (the pipeline's last stage): it runs
// one full init, v8-serializes appcore's snapshot (RunResults are Float64Arrays + plain objects, which
// round-trip natively), and stamps the engine source hash so the server knows the cache is current.
import { serialize } from "node:v8";
import { writeFileSync, mkdirSync } from "node:fs";
import { initAppcore, computePairwiseAsync, snapshotState } from "./src/appcore.ts";
import { CACHE_DIR, CACHE_BIN, CACHE_HASH, sourceHash } from "./cache-util.mjs";
import { loadPortfolio } from "./portfolio-loader.mjs";

await loadPortfolio(); // attach the portfolio (portfolio.config.mjs bootstrap, else the example) before any appcore call

const t0 = performance.now();
process.stderr.write("Precomputing model (init pass + pairwise matrix)…\n");
initAppcore();
await computePairwiseAsync(); // fold the pairwise matrix into the cache so its tab opens instantly
const buf = serialize(snapshotState());
mkdirSync(CACHE_DIR, { recursive: true });
writeFileSync(CACHE_BIN, buf);
writeFileSync(CACHE_HASH, sourceHash());
console.log(`Wrote ${CACHE_BIN.split("/").slice(-2).join("/")} (${(buf.length / 1e6).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
