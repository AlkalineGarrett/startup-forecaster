#!/usr/bin/env node
// startup-forecaster — take a startup idea from a one-line pitch to a researched, simulated forecast.
//
//   forecaster init <dir> [--name "<Title>"] [--link]    create a workspace (portfolio, data, sources, plans)
//   forecaster agent-files [--force]                     add AGENTS.md / CLAUDE.md / GEMINI.md to this workspace
//   forecaster presets                                   the business-model presets + their nodes
//   forecaster new <id> --preset <p> --name "<Name>"     scaffold a venture into this portfolio; currency and
//                  [--currency GBP]                      channel come from profile.json's entry for it unless
//                  [--channel usB2B]                     given here
//   forecaster profile [--json]                          what profile.json answers, what it still lacks
//   forecaster status [<id> ...] [--json]                grounding per node, ranked by influence
//   forecaster <tool> [args]                             any tool in the package (`forecaster help` lists them)
//
// Run anywhere inside a workspace (the folder with portfolio.config.mjs) or pass --portfolio <dir>.
// The agent playbook that drives the whole flow is AGENTS.md at the root of this package.
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initWorkspace, writeAgentFiles } from "../lib/init.mjs";
import { findConfig } from "../../distribution-compiler/compiler/workspace.mjs";
import { loadPortfolio } from "../lib/portfolio.mjs";
import { profileReport, printProfileReport, syncProfileModule } from "../lib/profile.mjs";
import { scaffoldVenture } from "../lib/scaffold.mjs";
import { ventureStatuses, printStatus } from "../lib/status.mjs";
import { isTool, nodeOptions, runTool, toolHelp } from "../lib/tools.mjs";

process.env.NODE_OPTIONS = nodeOptions();   // so `new` / `status` start the engine the same way the tools do

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--json"));

async function presets() {
  const files = readdirSync(join(ROOT, "presets")).filter((f) => f.endsWith(".mjs") && f !== "common.mjs").sort();
  return Promise.all(files.map(async (f) => import(pathToFileURL(join(ROOT, "presets", f)).href)));
}

/** Refresh the workspace's generated profile module (src/profile-data.ts) from profile.json, so every command
 *  runs on the profile as it is now. Outside a workspace there is nothing to do. */
async function syncProfile(dir) {
  const cfg = findConfig(dir, { optional: true });   // MC_CONFIG, else the enclosing workspace
  if (!cfg) return;
  const raw = (await import(pathToFileURL(cfg).href)).default || {};
  const root = dirname(cfg);
  syncProfileModule(root, raw.dataRoot ? join(root, raw.dataRoot) : null);
}

async function main() {
  if (isTool(argv[0])) {
    await syncProfile(process.cwd());
    process.exit(runTool(argv[0], argv.slice(1)));
  }
  const [cmd, ...rest] = positional;
  if (!cmd || cmd === "help" || argv.includes("-h") || argv.includes("--help")) { console.log(usage()); return; }
  if (cmd === "init") {
    if (!rest[0]) throw new Error('usage: forecaster init <dir> [--name "<Title>"]');
    const { root, installed } = initWorkspace(rest[0], { name: flag("--name"), link: argv.includes("--link") });
    console.log(`Created workspace ${root}${installed ? "" : "\n(the startup-forecaster install failed; run \`npm install\` in it)"}\n\n` +
      `Next: cd ${rest[0]} && git init\n` +
      `      then ask your coding agent to forecast an idea (it starts by filling in profile.json with you),\n` +
      `      or fill in profile.json yourself and: npx forecaster new <id> --preset <preset> --name "<Name>"`);
    return;
  }
  if (cmd === "presets") {
    for (const p of await presets()) {
      const b = p.build({ channel: p.defaults.channel, cur: "$" });
      console.log(`${p.name}\n  ${p.description}\n  nodes: ${b.nodes.map((n) => n.id).join(", ")}\n`);
    }
    return;
  }
  const pf = await loadPortfolio(flag("--portfolio", process.cwd()));
  syncProfileModule(pf.root, pf.dataRoot);
  if (cmd === "agent-files") {
    const title = pf.manifest ? (await import(pathToFileURL(pf.manifest).href)).TITLE : undefined;
    const written = writeAgentFiles(pf.root, { name: title, force: argv.includes("--force") });
    console.log(written.length ? `Wrote ${written.join(", ")} in ${pf.root}` : `All agent files already exist in ${pf.root} (use --force to rewrite)`);
    return;
  }
  if (cmd === "new") {
    const id = rest[0];
    const presetName = flag("--preset");
    const name = flag("--name");
    if (!id || !presetName || !name) throw new Error(`usage: ${NEW_USAGE}`);
    const presetModule = (await presets()).find((p) => p.name === presetName);
    if (!presetModule) throw new Error(`unknown preset "${presetName}" — see \`forecaster presets\``);
    const res = scaffoldVenture(pf, {
      id, name, preset: presetName, presetModule,
      flags: { currency: flag("--currency"), cur: flag("--cur"), fx: flag("--fx"), channel: flag("--channel") },
      date: new Date().toISOString().slice(0, 10),
    });
    syncProfileModule(pf.root, pf.dataRoot);
    console.log(`Scaffolded ${id} (${res.nodes} nodes, every one a labelled placeholder):`);
    for (const f of res.written) console.log(`  ${relative(pf.root, f) || f}`);
    if (res.notes.length) console.log(`\nTo confirm:\n${res.notes.map((n) => `  - ${n}`).join("\n")}`);
    console.log(`\nNext: npx forecaster simulate   (compiles the placeholders, regenerates, re-freezes golden)\n      npx forecaster status ${id}   (what to research first)`);
    return;
  }
  if (cmd === "profile") {
    const rep = profileReport(pf);
    if (argv.includes("--json")) console.log(JSON.stringify(rep, null, 2));
    else printProfileReport(rep, { full: true });
    return;
  }
  if (cmd === "status") {
    const ids = rest.length ? rest : readdirSync(join(pf.distributionData, "projects")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, ""));
    const all = ventureStatuses(pf, ids);
    const rep = profileReport(pf, ids);
    if (argv.includes("--json")) { printProfileReport(rep, { stream: console.error }); console.log(JSON.stringify(all, null, 2)); return; }
    printProfileReport(rep);
    console.log("");
    all.forEach((s, i) => { if (i) console.log("\n" + "─".repeat(80) + "\n"); printStatus(s); });
    return;
  }
  console.log(usage());
  process.exitCode = 1;
}

const NEW_USAGE = 'forecaster new <id> --preset <p> --name "<Name>" [--currency <ISO>] [--channel <name>]';

function usage() {
  return `Workspace:\n  forecaster init <dir> [--name "<Title>"] [--link]\n  forecaster agent-files [--force]\n  forecaster presets\n` +
    `  ${NEW_USAGE}\n  forecaster profile [--json]\n  forecaster status [<id> ...] [--json]\n\n${toolHelp()}`;
}

main().catch((e) => { console.error(`forecaster: ${e.message}`); process.exit(1); });
