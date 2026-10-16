// Where the data lives: the forecasting workspace.
//
// A workspace is a folder with a portfolio.config.mjs at its root (`startup-forecaster init` creates one). Its
// `distributionData` and `groundingSources` fields name the distribution-data project and the source
// archive, relative to the config. The tools find the workspace by walking up from the current directory,
// so they run from anywhere inside it.
//
// Resolution — the one resolver every tool uses (the engine's config.mjs too):
//   1. MC_CONFIG: a config path, or "examples" for the engine's bundled fictional example (an explicit
//      opt-in: nothing falls back to it), else
//   2. the nearest portfolio.config.mjs at or above the current directory, else
//   3. an error (WorkspaceError) saying so — outside a workspace a data tool would otherwise read an empty
//      folder and report nothing, which looks like a real answer.
//
// Path overrides, each accepted under both names (the first wins when both are set):
//   the data project    FORECASTER_DATA, MC_DISTRIBUTION_DATA
//   the source archive  GROUNDING_SOURCES, MC_GROUNDING_SOURCES
// A data-project override needs no workspace; without a groundingSources (override or config field) the
// archive is the sources/ folder beside the data project.
//
// Optional fields the source tools read (agentic-fetcher; both default to empty):
//   sourcesExclude    paths in the archive that check-sources' S5 never treats as evidence, on top of its
//                     built-in exclusions. Each entry is a pattern, relative to the archive root: "dir/" a
//                     folder, "name.ext" a file name anywhere, "a/b.txt" one path; * and ? are wildcards
//                     within a path segment, ** across segments.
//   browserOnlyHosts  hosts that only render in a live browser, beyond the built-in app stores and the hosts
//                     with a human_only fetch request: check-transcribed routes their sources to a person.
import { existsSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CONFIG = "portfolio.config.mjs";
/** The engine's bundled fictional example portfolio, used only when MC_CONFIG=examples asks for it. */
export const EXAMPLE_CONFIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "montecarlo-engine", "examples", CONFIG);
/** The env vars that override a resolved path, by config field (the first set one wins). */
export const OVERRIDES = {
  distributionData: ["FORECASTER_DATA", "MC_DISTRIBUTION_DATA"],
  groundingSources: ["GROUNDING_SOURCES", "MC_GROUNDING_SOURCES"],
};
const fields = new Map(), raws = new Map();

/** No workspace where one is needed (or a config that lacks what a tool needs). */
export class WorkspaceError extends Error {}

async function rawConfig(cfg) {
  if (!raws.has(cfg)) raws.set(cfg, (await import(pathToFileURL(cfg).href)).default || {});
  return raws.get(cfg);
}

/** The env override of a config field's path (`OVERRIDES`), as given, or null when none is set. */
export function overridePath(field, env = process.env) {
  for (const name of OVERRIDES[field] || []) if (env[name]) return env[name];
  return null;
}

/** The workspace config: MC_CONFIG ("examples" = the bundled example), else the nearest portfolio.config.mjs
 *  at or above `start` (default: cwd). Throws a WorkspaceError when there is none — or returns null when
 *  `optional`, for callers to whom a workspace is extra (a list field, the profile sync). */
export function findConfig(start = process.cwd(), { optional = false, env = process.env } = {}) {
  const named = env.MC_CONFIG;
  if (named) {
    const cfg = named === "examples" ? EXAMPLE_CONFIG : resolve(named);
    if (!existsSync(cfg)) throw new WorkspaceError(`MC_CONFIG names ${cfg}, which does not exist.`);
    return cfg;
  }
  for (let d = resolve(start); ; d = dirname(d)) {
    if (existsSync(join(d, CONFIG))) return join(d, CONFIG);
    if (dirname(d) === d) break;
  }
  if (optional) return null;
  throw new WorkspaceError(`not inside a workspace (no ${CONFIG} in ${resolve(start)} or above it). ` +
    "Run it from your workspace folder, or create one with `npx startup-forecaster init <dir>`; " +
    "MC_CONFIG=<config path> names one explicitly (MC_CONFIG=examples: the bundled example portfolio).");
}

/** Why the workspace's data can't be found from `cwd`, or null when it can: no data-project override and
 *  no config. (A config that names no data project is reported by dataRoot() itself.) */
export function workspaceProblem({ cwd = process.cwd(), env = process.env } = {}) {
  if (overridePath("distributionData", env)) return null;
  try { findConfig(cwd, { env }); return null; } catch (e) {
    if (e instanceof WorkspaceError) return e.message;
    throw e;
  }
}

/** The config's data paths, resolved against it: { distributionData, groundingSources } (null when unset). */
export async function configPaths(cfg) {
  if (!fields.has(cfg)) {
    const raw = await rawConfig(cfg);
    const at = (p) => (p ? resolve(dirname(cfg), p) : null);
    fields.set(cfg, { distributionData: at(raw.distributionData), groundingSources: at(raw.groundingSources) });
  }
  return fields.get(cfg);
}

/** The distribution-data project (projects/, corpus/, build/): the override, else the workspace config's
 *  `distributionData`. Throws a WorkspaceError outside a workspace or when the config names none. */
export async function dataRoot({ cwd = process.cwd(), env = process.env } = {}) {
  const o = overridePath("distributionData", env);
  if (o) return o;
  const cfg = findConfig(cwd, { env });
  const d = (await configPaths(cfg)).distributionData;
  if (!d) throw new WorkspaceError(`${cfg} names no \`distributionData\` (the distribution-data project), and neither FORECASTER_DATA nor MC_DISTRIBUTION_DATA is set.`);
  return d;
}

/** The source archive (documents.json, cores/, MANIFEST.csv, the fetch queue, archived files): the override,
 *  else the config's `groundingSources`, else sources/ beside the data project (`data`, default dataRoot()). */
export async function sourcesRoot(data = null, { cwd = process.cwd(), env = process.env } = {}) {
  const o = overridePath("groundingSources", env);
  if (o) return o;
  const known = data || overridePath("distributionData", env);
  const cfg = findConfig(cwd, { env, optional: !!known });
  const g = cfg && (await configPaths(cfg)).groundingSources;
  if (g) return g;
  return normalize(join(known || (await dataRoot({ cwd, env })), "..", "sources"));   // os.path.normpath: a relative root stays relative
}

/** A list-valued config field (e.g. sourcesExclude) of the nearest workspace: its strings, [] when unset or
 *  outside a workspace. A value that is not a list of strings is an error, never silently ignored. */
export async function configList(field, start = process.cwd()) {
  const cfg = findConfig(start, { optional: true });
  if (!cfg) return [];
  const v = (await rawConfig(cfg))[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new Error(`${cfg}: \`${field}\` must be a list of strings`);
  }
  return [...v];
}
