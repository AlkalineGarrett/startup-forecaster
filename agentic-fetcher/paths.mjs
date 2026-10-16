// Path resolution for the agentic fetcher.
//
// The fetcher operates on two data locations, both resolved by the compiler's `workspace` module (from the
// enclosing workspace's `portfolio.config.mjs`, MC_CONFIG, or the data-project / source-archive overrides):
//
//   • PROJECT   — the distribution-data project (`corpus/observations.json` — the per-node evidence, plus
//                 `corpus/general-knowledge.json`, `corpus/speculations.json`, `projects/`).
//
//   • GROUNDING — the source archive (`documents.json` — the source-identity registry, `cores/`,
//                 `MANIFEST.csv`, `url-aliases.csv`, `fetch-queue.jsonl` and the archived files in tier
//                 folders at its root).
//
// `ROOTS` holds both, resolved once at import. Every tool reads ROOTS.PROJECT / ROOTS.GROUNDING at call
// time, so a test may point them elsewhere (assign them). Outside a workspace the import still succeeds (a
// module's helpers stay importable), but reading a root that could not be resolved throws the resolver's
// WorkspaceError — a tool never runs on a made-up location.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceError, dataRoot, sourcesRoot } from "../distribution-compiler/compiler/workspace.mjs";
import { die } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The distribution-compiler checkout: `DISTRIBUTION_COMPILER`, else the sibling of this tool. */
function compilerRoot() {
  return normalize(process.env.DISTRIBUTION_COMPILER || join(HERE, "..", "distribution-compiler"));
}

/** fn()'s value, or the WorkspaceError it threw (anything else propagates). */
async function attempt(fn) {
  try { return await fn(); } catch (e) { if (e instanceof WorkspaceError) return e; throw e; }
}
const _project = await attempt(() => dataRoot());
const _grounding = await attempt(() => sourcesRoot(_project instanceof Error ? null : _project));

export const ROOTS = {};
for (const [k, v] of [["PROJECT", _project], ["GROUNDING", _grounding]]) {
  let value = v;
  Object.defineProperty(ROOTS, k, {
    enumerable: true,
    get() { if (value instanceof Error) throw value; return value; },
    set(x) { value = x; },
  });
}

/** The node/measure schema's `$defs` — read from the distribution-compiler, its single source.
 * `DISTRIBUTION_COMPILER` points at that repo; default: the sibling `../distribution-compiler` of this
 * tool. Missing → a clear error (validation is never silently skipped for want of the schema). */
export function schemaDefs() {
  const path = join(compilerRoot(), "project-distributions.schema.json");
  if (!existsSync(path)) die(`schema not found at ${path} — set DISTRIBUTION_COMPILER to the distribution-compiler repo`);
  return JSON.parse(readFileSync(path, "utf8")).$defs;
}
