// Shared paths + source fingerprint for the precomputed-init cache, used by both precompute.mjs (writer)
// and server.mjs (reader). The cache holds the sim-derived state (appcore.snapshotState) so the server
// can skip its ~20s startup pass. It is invalidated by a content hash of the ENGINE sources plus the
// PORTFOLIO's sources (the config bootstrap's directory): any change that could move the numbers
// busts the cache and forces a recompute, so stale results can't be served. The cache lives beside the
// portfolio's config (<config dir>/.cache, or MC_CACHE_DIR), so each portfolio keeps its own.
// render/* is deliberately excluded — it only turns the cached state into HTML, never feeds the sim — so
// UI edits keep the cache warm.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTFOLIO_ROOT } from "./portfolio-loader.mjs";
import { CONFIG } from "./config.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = process.env.MC_CACHE_DIR ? resolve(process.env.MC_CACHE_DIR) : join(CONFIG.root, ".cache");
export const CACHE_BIN = join(CACHE_DIR, "init.v8");
export const CACHE_HASH = join(CACHE_DIR, "init.hash");

function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "render" || e.name === "node_modules") continue; // render/* doesn't affect the numbers — keep the cache warm across UI edits
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** sha256 over the engine's + the portfolio's TypeScript sources (paths + contents), so any model change
 * invalidates. Paths are hashed relative to their root, so the key doesn't depend on where repos live. */
export function sourceHash() {
  const h = createHash("sha256");
  for (const [tag, root] of [["engine", join(DIR, "src")], ["portfolio", PORTFOLIO_ROOT]]) {
    for (const f of walk(root, []).sort()) { h.update(tag + ":" + f.slice(root.length)); h.update(readFileSync(f)); }
  }
  return h.digest("hex");
}
