// Shared paths + source fingerprint for the precomputed-init cache, used by precompute.mjs and the simulation
// build's results pass (montecarlo-engine simulation/results.mjs) (writers), server.mjs, the page builders and
// `startup-forecaster status` (coverage.mjs --drivers) (readers). The cache holds the sim-derived state (appcore.snapshotState) so a page can
// skip the startup pass. It is invalidated by a content hash of everything that could move the numbers:
//   - the engine's sources and this renderer's app core (src/, minus render/);
//   - the portfolio: its bootstrap's directory, its `dataRoot`, the `generated.*` modules, the manifest and
//     portfolio.config.mjs itself.
// .ts, .mjs and .json files count. render/* and dom-shared.mjs are deliberately excluded — they only turn the
// cached state into HTML or wire the page, never feed the sim — so UI edits keep the cache warm. The cache lives beside the portfolio's config
// (<config dir>/.cache, or MC_CACHE_DIR), so each portfolio keeps its own.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTFOLIO_ROOT } from "../montecarlo-engine/portfolio-loader.mjs";
import { CONFIG, CONFIG_PATH } from "../montecarlo-engine/config.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = process.env.MC_CACHE_DIR ? resolve(process.env.MC_CACHE_DIR) : join(CONFIG.root, ".cache");
export const CACHE_BIN = join(CACHE_DIR, "init.v8");
export const CACHE_HASH = join(CACHE_DIR, "init.hash");

const SOURCE = /\.(ts|mjs|json)$/;
// Never descend into: the renderer's HTML layer, dependencies, build output, or dot-directories (the cache).
const SKIP_DIR = (name) => name === "render" || name === "node_modules" || name === "dist" || name.startsWith(".");
// …nor read the renderer's browser-only DOM layer (it is under the renderer's src/ but never feeds the sim).
const SKIP_FILE = new Set([join(DIR, "src", "dom-shared.mjs")]);

function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR(e.name)) walk(p, acc); }
    else if (SOURCE.test(e.name) && !SKIP_FILE.has(p)) acc.push(p);
  }
  return acc;
}

/** sha256 over the sources above (paths relative to their root + contents), so any model change invalidates.
 *  Paths are hashed relative to their root, so the key doesn't depend on where repos live. */
export function sourceHash() {
  const h = createHash("sha256");
  const seen = new Set();
  const add = (tag, root, f) => {
    if (seen.has(f)) return;
    seen.add(f);
    h.update(tag + ":" + relative(root, f));
    h.update(readFileSync(f));
  };
  const dirs = [
    ["engine", join(DIR, "..", "montecarlo-engine", "src")],
    ["renderer", join(DIR, "src")],
    ["portfolio", PORTFOLIO_ROOT],
    ["data", CONFIG.dataRoot],
  ];
  for (const [tag, root] of dirs) {
    if (!root || !existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const f of walk(root, []).sort()) add(tag, root, f);
  }
  const files = [CONFIG_PATH, CONFIG.manifest, ...Object.values(CONFIG.generated)];
  for (const f of files) if (f && existsSync(f)) add("file", CONFIG.root, f);
  return h.digest("hex");
}

/** Whether the cache exists and was written from the current sources (its hash matches sourceHash()). */
export function cacheIsFresh() {
  return existsSync(CACHE_BIN) && existsSync(CACHE_HASH) && readFileSync(CACHE_HASH, "utf8").trim() === sourceHash();
}

/** The cached state when the cache is fresh (cacheIsFresh), else null. Throws if the cache file can't be read
 *  or deserialized. */
export function readFreshCache() {
  if (!cacheIsFresh()) return null;
  return deserialize(readFileSync(CACHE_BIN));
}

/** Write `state` (appcore.snapshotState()) to the cache, stamped with the current source hash; returns the
 *  serialized buffer. */
export function writeCache(state) {
  const buf = serialize(state);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_BIN, buf);
  writeFileSync(CACHE_HASH, sourceHash());
  return buf;
}
