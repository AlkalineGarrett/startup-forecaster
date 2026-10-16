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
 *
 * src/dom-shared.mjs, the shared DOM layer (a plain script of declarations), is
 * bundled ahead of app.ts, so the self-contained page and the server's client
 * (which loads it before client.mjs) run one copy of the pure-DOM interactions.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG } from "../montecarlo-engine/config.mjs";
import { isMain } from "../shared/is-main.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

// Three roots. The simulation's modules are read from montecarlo-engine's src/, the rendering modules
// (render/*, app.ts) from this tool's own src/, and the PORTFOLIO's data modules + manifest from the
// portfolio config (config.mjs: `dataRoot`, `manifest`; MC_DATA_ROOT / MC_MANIFEST override).
const ENGINE_ROOT = join(DIR, "..", "montecarlo-engine", "src");
const RENDERER_ROOT = join(DIR, "src");
const RENDERER_MODULES = new Set(["view-model.ts", "dom-shared.mjs", "app.ts"]);
const rootOf = (m) => (m.startsWith("render/") || RENDERER_MODULES.has(m) ? RENDERER_ROOT : ENGINE_ROOT);
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
  "settings.mjs",         // side-effect-free settings (currency symbols, built-in channels, tax text): format/accounting/context read it
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
  "pairwise.ts",          // the Pairwise matrix computation (engine), used by app.ts like appcore.ts
  "render/bar.ts",
  "render/graph.ts",
  "render/horizons.ts",
  "render/linechart.ts",
  "render/yoy.ts",
  "render/overview.ts",
  "render/pairwise.ts",
  "render/project.ts",
  "render/evidence.ts",   // ← anchor: precomputed pairwise matrix
  "view-model.ts",        // derived view state, shared by app.ts (browser) and appcore.ts (server)
  "dom-shared.mjs",       // the shared DOM layer (tab routing, hovers, sorting, card toggles), also loaded by client.mjs's pages
  "app.ts",
];

// The full bundle order: each engine or renderer module (read from its root), followed by any portfolio
// data modules anchored to it (read from DATA_ROOT). Each entry carries the root it is read from.
const MODULES = ENGINE_MODULES.flatMap((m) => [
  { file: m, root: rootOf(m) },
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

/** The precomputed results (precompute.mjs's snapshot) as a script that sets globalThis.MC_SNAPSHOT. Written as
 *  a JavaScript literal, not JSON, so NaN and ±Infinity survive. */
function snapshotScript(snap) {
  const js = JSON.stringify(snap, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? `__MC_NUM_${v}__` : v))
    .replace(/"__MC_NUM_(NaN|Infinity|-Infinity)__"/g, "$1")
    .replace(/<\//g, "<\\/");
  return `globalThis.MC_SNAPSHOT = ${js};\n`;
}

/** The current precompute snapshot; computes it first (precompute.mjs) when it is missing or stale. */
export async function currentSnapshot() {
  const { readFreshCache } = await import("./cache-util.mjs");
  let snap = readFreshCache();
  if (!snap) {
    console.log("The precompute snapshot is missing or stale; computing it first.");
    execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(DIR, "precompute.mjs")], { stdio: "inherit" });
    snap = readFreshCache();
    if (!snap) throw new Error("precompute did not produce a current snapshot");
  }
  return snap;
}

/** The full self-contained HTML: styles.css and the JS bundle inlined into template.html. With a `snapshot`
 *  (the precompute state), the page starts from those results instead of simulating on load. */
export function buildHtml(snapshot = null) {
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
    .replace("/*__MC_BUNDLE__*/", () => (snapshot ? snapshotScript(snapshot) : "") + buildBundle());
}

// Write the artifact when run directly (`node build.mjs`); stay side-effect-free when imported.
// Output path is the config's `out` (default <portfolio>/dist/montecarlo.html); MC_OUT overrides it,
// resolved against the current working directory.
const runDirectly = isMain(import.meta.url);
if (runDirectly) {
  const html = buildHtml(await currentSnapshot());
  const outPath = process.env.MC_OUT ? resolve(process.env.MC_OUT) : CONFIG.out;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  console.log(`Built ${outPath} (${html.length} bytes) from ${MODULES.length} modules, starting from the precomputed results.`);
}
