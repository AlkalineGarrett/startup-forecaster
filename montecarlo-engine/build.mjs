#!/usr/bin/env node
/*
 * Build dist/montecarlo.html from the TypeScript sources in src/.
 *
 * The published artifact must be a single self-contained file (the artifact CSP
 * blocks every external request), so we can't ship ES modules or a runtime
 * loader. This is a tiny zero-dependency bundler:
 *   1. strip the types from each module (node:module.stripTypeScriptTypes),
 *   2. drop the import/export lines — after concatenation every module shares
 *      one function scope, so cross-module references just resolve as locals,
 *   3. concatenate in dependency order inside one IIFE and inline it into
 *      template.html at the /*__MC_BUNDLE__*​/ marker.
 *
 * This works because top-level names are unique across modules and imports are
 * written on single lines. The source stays idiomatic ESM so it type-checks and
 * unit-tests normally (see test/).
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG } from "./config.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

// Two roots (the tool/data split). ENGINE modules are read from this package's own src/; the
// PORTFOLIO's data modules + manifest come from the portfolio config (config.mjs: `dataRoot`, `manifest`;
// MC_DATA_ROOT / MC_MANIFEST override).
const ENGINE_ROOT = join(DIR, "src");
const DATA_ROOT = CONFIG.dataRoot;
const MANIFEST = CONFIG.manifest;
const manifest = await import(pathToFileURL(MANIFEST).href);
const { PORTFOLIO_MODULES } = manifest;

// The ENGINE modules, in dependency order (types.ts erases to nothing but is listed for
// completeness). The portfolio's DATA modules are NOT hardcoded here — they are spliced in from the
// portfolio manifest, each group immediately after its engine "anchor" module (see MODULES below).
// This is what lets the engine build with any portfolio's data.
const ENGINE_MODULES = [
  "types.ts",
  "rng.ts",
  "ramp.ts",
  "format.ts",
  "quantile.ts",
  "metalog.ts",
  "distributions.ts",
  "portfolio-context.ts", // ← anchor: distributions/evidence data attach after the seam
  "factors.ts",
  "qmc.ts",
  "cohort.ts",
  "templates.ts",         // before accounting.ts: project modules (anchored after accounting) use it; its calls are runtime-only
  "accounting.ts",        // ← anchor: correlations + per-project graphs + project helpers
  "apply-distributions.ts", // ← anchor: the projects.ts bootstrap
  "simulate.ts",
  "units.ts",             // project → simulation units, shared by app.ts (browser) and appcore.ts (server)
  "render/bar.ts",
  "render/graph.ts",
  "render/horizons.ts",
  "render/linechart.ts",
  "render/yoy.ts",
  "render/overview.ts",
  "render/pairwise.ts",
  "render/project.ts",
  "render/evidence.ts",   // ← anchor: precomputed pairwise matrix
  "app.ts",
];

// The full bundle order: each engine module (read from ENGINE_ROOT), followed by any portfolio data
// modules anchored to it (read from DATA_ROOT). Each entry carries the root it is read from.
const MODULES = ENGINE_MODULES.flatMap((m) => [
  { file: m, root: ENGINE_ROOT },
  ...((PORTFOLIO_MODULES[m] || []).map((f) => ({ file: f, root: DATA_ROOT }))),
]);

/** Strip TS types, then remove ESM import/export syntax so the file is scope-local. */
function flatten(file, root) {
  const ts = readFileSync(join(root, file), "utf8");
  const js = stripTypeScriptTypes(ts, { mode: "strip" });
  return js
    .split("\n")
    .filter((line) => !/^\s*import\s/.test(line)) // drop `import ... from "..."`
    .filter((line) => !/^\s*export\s*\{/.test(line)) // drop `export { ... }`
    .map((line) => line.replace(/^(\s*)export\s+(?=(async\s+)?(function|const|let|var|class))/, "$1"))
    // `import type ...` lines are blanked (not removed) by the type-stripper, leaving trailing
    // whitespace whose length depends on the (repo-relative) import path. Trim trailing whitespace so
    // the bundle is path-independent and byte-stable regardless of where modules are imported from.
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** Top-level (column-0) declaration names in a flattened module — for collision detection. */
function topLevelNames(js) {
  const names = [];
  for (const line of js.split("\n")) {
    const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) || line.match(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** The flattened, IIFE-wrapped JavaScript bundle. */
export function buildBundle() {
  const flat = MODULES.map(({ file, root }) => ({ f: file, js: flatten(file, root) }));
  // Everything shares one scope after flattening, so a top-level name defined in two
  // modules silently overwrites — the later one wins. Fail loudly instead.
  const seen = new Map();
  for (const { f, js } of flat) {
    for (const name of topLevelNames(js)) {
      if (seen.has(name)) throw new Error(`Duplicate top-level name "${name}" in ${f} and ${seen.get(name)} — the flatten bundler needs unique top-level names across modules.`);
      seen.set(name, f);
    }
  }
  const body = flat.map(({ f, js }) => `// ===== ${f} =====\n${js}`).join("\n\n");
  return `(function(){\n"use strict";\n${body}\n})();`;
}

/** The full self-contained HTML: styles.css and the JS bundle inlined into template.html. */
export function buildHtml() {
  const template = readFileSync(join(DIR, "template.html"), "utf8");
  for (const marker of ["/*__MC_STYLES__*/", "/*__MC_BUNDLE__*/", "/*__MC_TITLE__*/"]) {
    if (!template.includes(marker)) throw new Error(`template.html is missing the ${marker} marker`);
  }
  const css = readFileSync(join(DIR, "styles.css"), "utf8");
  // The static <title> comes from the manifest's TITLE (or MC_TITLE override); the running app also
  // sets document.title from the injected PORTFOLIO_TITLE once the bundle boots, so keep them in sync.
  const title = process.env.MC_TITLE || manifest.TITLE || "Monte-Carlo Portfolio";
  return template
    .replace("/*__MC_TITLE__*/", () => title)
    .replace("/*__MC_STYLES__*/", () => css)
    .replace("/*__MC_BUNDLE__*/", () => buildBundle());
}

// Write the artifact when run directly (`node build.mjs`); stay side-effect-free when imported.
// Output path is the config's `out` (default <portfolio>/dist/montecarlo.html); MC_OUT overrides it,
// resolved against the current working directory. Compare realpaths so invocation through a
// node_modules symlink (workspace → file: dependency) still counts as "run directly".
const runDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (runDirectly) {
  const html = buildHtml();
  const outPath = process.env.MC_OUT ? resolve(process.env.MC_OUT) : CONFIG.out;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  console.log(`Built ${outPath} (${html.length} bytes) from ${MODULES.length} modules.`);
}
