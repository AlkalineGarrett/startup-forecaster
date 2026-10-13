// Path resolution for the agentic fetcher.
//
// The fetcher operates on two data locations, both resolved by the compiler's `workspace` module (from the
// enclosing workspace's `portfolio.config.mjs`, or the `FORECASTER_DATA` / `GROUNDING_SOURCES` overrides):
//
//   • PROJECT   — the distribution-data project (`corpus/observations.json` — the per-node evidence, plus
//                 `corpus/general-knowledge.json`, `corpus/speculations.json`, `projects/`).
//
//   • GROUNDING — the source archive (`documents.json` — the source-identity registry, `cores/`,
//                 `MANIFEST.csv`, `url-aliases.csv`, `fetch-queue.jsonl` and the archived files in tier
//                 folders at its root).
//
// Both are resolved fresh by projectRoot() / groundingRoot() so a test (or a run against a different
// project) can flip the environment between invocations. `ROOTS` holds the single resolution made at
// import for the common case; every tool reads ROOTS.PROJECT / ROOTS.GROUNDING at call time, so a test
// may point them elsewhere.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot, sourcesRoot } from "../distribution-compiler/compiler/workspace.mjs";
import { die } from "./lib/util.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));

/** The distribution-compiler checkout: `DISTRIBUTION_COMPILER`, else the sibling of this tool. */
export function compilerRoot() {
  return normalize(process.env.DISTRIBUTION_COMPILER || join(HERE, "..", "distribution-compiler"));
}

export const projectRoot = () => dataRoot();
export const groundingRoot = (project = null) => sourcesRoot(project);

const _project = await projectRoot();
export const ROOTS = { PROJECT: _project, GROUNDING: await groundingRoot(_project) };
export const PROJECT = ROOTS.PROJECT;
export const GROUNDING = ROOTS.GROUNDING;

/** The node/measure schema's `$defs` — read from the distribution-compiler, its single source.
 * `DISTRIBUTION_COMPILER` points at that repo; default: the sibling `../distribution-compiler` of this
 * tool. Missing → a clear error (validation is never silently skipped for want of the schema). */
export function schemaDefs() {
  const path = join(compilerRoot(), "project-distributions.schema.json");
  if (!existsSync(path)) die(`schema not found at ${path} — set DISTRIBUTION_COMPILER to the distribution-compiler repo`);
  return JSON.parse(readFileSync(path, "utf8")).$defs;
}

/** The macOS-Vision OCR binary beside this tool, compiled from `ocr.swift` on first use. */
export function ocrtool() {
  const binary = join(HERE, "ocrtool");
  try {
    accessSync(binary, constants.X_OK);
  } catch {
    const r = spawnSync("swiftc", ["-O", join(HERE, "ocr.swift"), "-o", binary], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`swiftc failed (${r.status ?? r.error})`);
  }
  return binary;
}
