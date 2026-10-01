// Which portfolio the engine's entrypoints (server, precompute, build-artifact, build-full-artifact, coverage,
// pipeline/) run: the config's `bootstrap` module (see config.mjs — MC_PORTFOLIO overrides it), the one whose
// import attaches everything via configurePortfolio(). The entrypoints `await loadPortfolio()` before
// touching appcore.
//
// PORTFOLIO_ROOT is the directory holding the portfolio's sources; cache-util folds its .ts files into the
// precompute cache key, so a data change busts the cache exactly as an engine change does.
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG } from "./config.mjs";

export const PORTFOLIO_ENTRY = CONFIG.bootstrap;
export const PORTFOLIO_ROOT = dirname(PORTFOLIO_ENTRY);

/** Import the portfolio bootstrap (side effect: configurePortfolio). */
export async function loadPortfolio() {
  await import(pathToFileURL(PORTFOLIO_ENTRY).href);
  return PORTFOLIO_ENTRY;
}
