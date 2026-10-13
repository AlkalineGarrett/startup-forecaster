// Where the data lives: the forecasting workspace.
//
// A workspace is a folder with a portfolio.config.mjs at its root (`forecaster init` creates one). Its
// `distributionData` and `groundingSources` fields name the distribution-data project and the source
// archive, relative to the config. The tools find the workspace by walking up from the current directory,
// so they run from anywhere inside it.
//
// Overrides: FORECASTER_DATA (the data project) and GROUNDING_SOURCES (the source archive). Outside a
// workspace the data project is the current directory and the archive is a sources/ folder beside it.
import { existsSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG = "portfolio.config.mjs";
const fields = new Map();

/** The nearest portfolio.config.mjs at or above `start` (default: cwd), or null. */
export function findConfig(start = process.cwd()) {
  for (let d = resolve(start); ; d = dirname(d)) {
    if (existsSync(join(d, CONFIG))) return join(d, CONFIG);
    if (dirname(d) === d) return null;
  }
}

/** The config's data paths, resolved against it: { distributionData, groundingSources } (null when unset). */
export async function configPaths(cfg) {
  if (!fields.has(cfg)) {
    const raw = (await import(pathToFileURL(cfg).href)).default || {};
    const at = (p) => (p ? resolve(dirname(cfg), p) : null);
    fields.set(cfg, { distributionData: at(raw.distributionData), groundingSources: at(raw.groundingSources) });
  }
  return fields.get(cfg);
}

async function fromConfig(field) {
  const cfg = findConfig();
  return cfg ? (await configPaths(cfg))[field] : null;
}

/** The distribution-data project (projects/, corpus/, build/). */
export async function dataRoot() {
  return process.env.FORECASTER_DATA || (await fromConfig("distributionData")) || process.cwd();
}

/** The source archive (documents.json, cores/, MANIFEST.csv, the fetch queue, archived files). */
export async function sourcesRoot(data = null) {
  const g = process.env.GROUNDING_SOURCES || (await fromConfig("groundingSources"));
  if (g) return g;
  return normalize(join(data || (await dataRoot()), "..", "sources"));   // os.path.normpath: a relative root stays relative
}
