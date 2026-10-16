// Locate a workspace (the folder with portfolio.config.mjs, at or above the given directory) and the engine it runs on, and read the config
// THROUGH THE ENGINE (montecarlo-engine/config.mjs) — one reader of the format. The engine is MC_ENGINE, else
// the workspace's node_modules/startup-forecaster/montecarlo-engine, else this package's own.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findConfig } from "../../distribution-compiler/compiler/workspace.mjs";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadPortfolio(dir = process.cwd()) {
  const cfgPath = findConfig(dir);
  if (!cfgPath) throw new Error(`no portfolio.config.mjs in or above ${resolve(dir)} — run inside a workspace (\`startup-forecaster init <dir>\` makes one)`);
  // the engine: MC_ENGINE, else the workspace's installed package, else this package's own
  const candidates = [process.env.MC_ENGINE && resolve(process.env.MC_ENGINE), join(dirname(cfgPath), "node_modules", "startup-forecaster", "montecarlo-engine"), join(CHECKOUT, "montecarlo-engine")].filter(Boolean);
  const engineDir = candidates.find((d) => existsSync(join(d, "config.mjs")));
  if (!engineDir) throw new Error(`montecarlo-engine not found (looked in: ${candidates.join(", ")})`);
  process.env.MC_CONFIG = cfgPath; // the engine's config.mjs reads this portfolio's config
  const { CONFIG, CONFIG_PATH } = await import(pathToFileURL(join(engineDir, "config.mjs")).href);
  return {
    ...CONFIG,
    configPath: CONFIG_PATH,
    engine: realpathSync(engineDir),
    // the compiler the simulation build uses, else this checkout's (for seeding placeholders)
    compiler: CONFIG.compiler || join(CHECKOUT, "distribution-compiler"),
  };
}

/** A JS identifier for a venture id ("my-app" → "my_app"). */
export const identOf = (id) => id.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^([0-9])/, "_$1");

/** The speculation id holding a node's placeholder prior. */
export const placeholderSpec = (id, node) => `spec_${identOf(id)}_${node}_placeholder`;
