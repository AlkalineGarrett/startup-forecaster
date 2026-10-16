// Every tool in the package, as a `startup-forecaster <command>`. A command runs its script with the arguments
// that follow it, from the current directory (each tool finds the workspace by walking up to
// portfolio.config.mjs), and exits with the script's exit code.
import { spawnSync } from "node:child_process";
import { workspaceProblem as dataProblem } from "../../distribution-compiler/compiler/workspace.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The Node options every tool runs with: TypeScript stripping, plus the hook that strips this package's
 *  own .ts when it is installed under node_modules. Set in NODE_OPTIONS so the processes a tool starts
 *  (the simulation build's stages) get them too. */
export function nodeOptions() {
  const own = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning",
    `--import=${pathToFileURL(join(PKG, "forecaster", "lib", "register-ts.mjs")).href}`];
  const current = process.env.NODE_OPTIONS || "";
  return [current, ...own.filter((o) => !current.includes(o))].filter(Boolean).join(" ");
}

const fetcher = (f) => `agentic-fetcher/${f}.mjs`;
const prep = (f) => `agentic-fetcher/prep/${f}.mjs`;

/** command → [script (relative to the package), one-line description, options], grouped for `startup-forecaster help`.
 *  Options: `workspace: false` for a tool that works on explicit files and needs no workspace; every other
 *  tool reads the workspace's data. */
const FILES_ONLY = { workspace: false };
export const TOOLS = {
  Simulation: {
    simulate: ["montecarlo-engine/simulation/run.mjs", "build and run the simulation: compile → gen → golden → pairwise → precompute (--fast, --from, --to, --list)"],
    coverage: ["montecarlo-engine/coverage.mjs", "compiled vs hand-authored nodes, grounding, orphans ([<id>…] [--json] [--drivers])"],
  },
  "Results pages": {
    build: ["forecast-renderer/build.mjs", "the self-contained interactive page (dist/montecarlo.html)"],
    precompute: ["forecast-renderer/precompute.mjs", "the startup snapshot for serve and the static pages (simulate writes it; this recomputes it when stale, or --force)"],
    serve: ["forecast-renderer/server.mjs", "the interactive model at http://localhost:8137 (PORT overrides)"],
    "artifact-full": ["forecast-renderer/build-full-artifact.mjs", "a static page of every panel (MC_PROJECTS=a,b MC_OUT=file to subset)"],
  },
  Distributions: {
    compile: ["distribution-compiler/compiler/compile.mjs", "compile a project's distributions (<file> [--write] [--quiet])", FILES_ONLY],
    preview: ["distribution-compiler/compiler/preview.mjs", "percentiles of a construction, or fit params to quantiles", FILES_ONLY],
    scaffold: ["distribution-compiler/compiler/scaffold.mjs", "restate hand-authored nodes as a project file"],
  },
  Sources: {
    search: [fetcher("search"), "search the text of every archived source"],
    "install-source": [fetcher("install_source"), "archive a fetched file (or --url) and extract its text"],
    "add-observation": [fetcher("add_observation"), "record a figure from a source, with a verbatim quote"],
    "add-knowledge": [fetcher("add_knowledge"), "record a general-knowledge prior (gk) or a labelled judgement (spec)"],
    "make-derivative": [fetcher("make_derivative"), "a figure computed or reasoned from other sources"],
    "fetch-request": [fetcher("fetch_request"), "the fetch queue (add, list, check, drain, defer, resolve, export)"],
    firecrawl: [fetcher("firecrawl_fetch"), "fetch the queue's pending pages through Firecrawl and archive them ([<list file>|-] [--list])"],
    "check-sources": [fetcher("check_sources"), "archive and corpus integrity, audit coverage"],
    citations: [fetcher("citations"), "which nodes cite which observations"],
    "check-transcribed": [fetcher("check_transcribed"), "route transcribed sources to upgrade or re-ground"],
    "verify-derivatives": [fetcher("verify_derivatives"), "recompute every computed derivative"],
    "audit-prepare": [fetcher("audit_prepare"), "batch the unaudited corpus for audit agents"],
    "mark-audited": [fetcher("mark_audited"), "mark what an audit passed as verified"],
    "bootstrap-documents": [prep("bootstrap_documents"), "register MANIFEST.csv sources in documents.json (merges into the existing file; --force replaces it)"],
    "extract-cores": [prep("extract_cores"), "extract text cores (keeps existing cores unless --force)"],
    "extract-remaining": [prep("extract_remaining"), "extract cores for xlsx / json / gz sources"],
    "ocr-cores": [prep("ocr_cores"), "OCR scanned PDFs and images into cores (macOS)"],
    "ocr-images": [prep("ocr_images"), "OCR images inside saved pages (macOS)"],
    "fold-ocr-into-cores": [prep("fold_ocr_into_cores"), "append image OCR to the owning page's core"],
  },
  Plans: {
    "build-plan": ["build-plan-generator/render.mjs", "render a build-plan page from a spec module", FILES_ONLY],
    "exec-plan": ["exec-plan-generator/build.mjs", "render an execution-plan page from a data module", FILES_ONLY],
  },
};

const ENTRIES = Object.assign({}, ...Object.values(TOOLS));
const SCRIPTS = Object.fromEntries(Object.entries(ENTRIES).map(([k, [s]]) => [k, s]));

export const isTool = (cmd) => cmd in SCRIPTS;

/** Does `cmd` read the workspace's data (every tool but the `workspace: false` ones)? */
export const needsWorkspace = (cmd) => (ENTRIES[cmd]?.[2] || {}).workspace !== false;

/** Why `cmd` can't run here, or null — the workspace resolver's own answer (workspace.mjs: MC_CONFIG, the
 *  enclosing portfolio.config.mjs, or a data-project override), asked only of tools that need a workspace. */
export function workspaceProblem(cmd, cwd = process.cwd(), env = process.env) {
  if (!needsWorkspace(cmd)) return null;
  const problem = dataProblem({ cwd, env });
  return problem && `startup-forecaster ${cmd}: ${problem}`;
}

/** Run a tool with `args`; returns its exit code. */
export function runTool(cmd, args) {
  const problem = workspaceProblem(cmd);
  if (problem) { console.error(problem); return 2; }
  const r = spawnSync(process.execPath, [join(PKG, SCRIPTS[cmd]), ...args], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: nodeOptions() } });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/** The tool list for `startup-forecaster help`. */
export function toolHelp() {
  const width = Math.max(...Object.keys(SCRIPTS).map((k) => k.length));
  return Object.entries(TOOLS).map(([group, tools]) =>
    `${group}:\n` + Object.entries(tools).map(([k, [, d]]) => `  startup-forecaster ${k.padEnd(width)}  ${d}`).join("\n")).join("\n\n");
}
