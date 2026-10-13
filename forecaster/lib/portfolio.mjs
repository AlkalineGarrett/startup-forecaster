// Locate a workspace (the folder with portfolio.config.mjs, at or above the given directory) and the engine it runs on, and read the config
// THROUGH THE ENGINE (montecarlo-engine/config.mjs) — one reader of the format. The engine is the portfolio's
// node_modules/montecarlo-engine, else MC_ENGINE, else this checkout's montecarlo-engine/.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The nearest portfolio.config.mjs at or above `dir`, or null. */
export function findConfig(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "portfolio.config.mjs"))) return join(d, "portfolio.config.mjs");
    if (dirname(d) === d) return null;
  }
}

export async function loadPortfolio(dir = process.cwd()) {
  const cfgPath = findConfig(dir);
  if (!cfgPath) throw new Error(`no portfolio.config.mjs in or above ${resolve(dir)} — run inside a workspace (\`forecaster init <dir>\` makes one)`);
  const candidates = [process.env.MC_ENGINE && resolve(process.env.MC_ENGINE), join(dirname(cfgPath), "node_modules", "montecarlo-engine"), join(CHECKOUT, "montecarlo-engine")].filter(Boolean);
  const engineDir = candidates.find((d) => existsSync(join(d, "config.mjs")));
  if (!engineDir) throw new Error(`montecarlo-engine not found (looked in: ${candidates.join(", ")})`);
  process.env.MC_CONFIG = cfgPath; // the engine's config.mjs reads this portfolio's config
  const { CONFIG, CONFIG_PATH } = await import(pathToFileURL(join(engineDir, "config.mjs")).href);
  return {
    ...CONFIG,
    configPath: CONFIG_PATH,
    engine: realpathSync(engineDir),
    // the compiler the pipeline uses, else this checkout's (for seeding placeholders)
    compiler: CONFIG.compiler || join(CHECKOUT, "distribution-compiler"),
  };
}

/** A JS identifier for a venture id ("my-app" → "my_app"). */
export const identOf = (id) => id.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^([0-9])/, "_$1");

/** The speculation id holding a node's placeholder prior. */
export const placeholderSpec = (id, node) => `spec_${identOf(id)}_${node}_placeholder`;
