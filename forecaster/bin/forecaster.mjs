#!/usr/bin/env node
// startup-forecaster — take a startup idea from a one-line pitch to a researched, simulated forecast.
//
//   forecaster init <dir> [--name "<Title>"]             create a workspace (portfolio, data, sources, plans)
//   forecaster presets                                   the business-model presets + their nodes
//   forecaster new <id> --preset <p> --name "<Name>"     scaffold a venture into this portfolio
//                  [--cur $] [--fx 1] [--channel usB2B]
//   forecaster status [<id> ...] [--json]                grounding per node, ranked by influence
//
// Run anywhere inside a workspace (the folder with portfolio.config.mjs) or pass --portfolio <dir>.
// The agent playbook that drives the whole flow is SKILL.md.
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initWorkspace } from "../lib/init.mjs";
import { loadPortfolio } from "../lib/portfolio.mjs";
import { scaffoldVenture } from "../lib/scaffold.mjs";
import { ventureStatuses, printStatus } from "../lib/status.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--json"));

async function presets() {
  const files = readdirSync(join(ROOT, "presets")).filter((f) => f.endsWith(".mjs") && f !== "common.mjs").sort();
  return Promise.all(files.map(async (f) => import(pathToFileURL(join(ROOT, "presets", f)).href)));
}

async function main() {
  const [cmd, ...rest] = positional;
  if (cmd === "init") {
    if (!rest[0]) throw new Error('usage: forecaster init <dir> [--name "<Title>"]');
    const { root } = initWorkspace(rest[0], { name: flag("--name") });
    console.log(`Created workspace ${root}\n\nNext: cd ${relative(process.cwd(), root) || "."} && git init\n      forecaster new <id> --preset <preset> --name "<Name>"   (see \`forecaster presets\`)`);
    return;
  }
  if (cmd === "presets") {
    for (const p of await presets()) {
      const b = p.build(p.defaults);
      console.log(`${p.name}\n  ${p.description}\n  nodes: ${b.nodes.map((n) => n.id).join(", ")}\n`);
    }
    return;
  }
  const pf = await loadPortfolio(flag("--portfolio", process.cwd()));
  if (cmd === "new") {
    const id = rest[0];
    const presetName = flag("--preset");
    const name = flag("--name");
    if (!id || !presetName || !name) throw new Error('usage: forecaster new <id> --preset <preset> --name "<Name>" [--cur $] [--fx 1] [--channel …]');
    const presetModule = (await presets()).find((p) => p.name === presetName);
    if (!presetModule) throw new Error(`unknown preset "${presetName}" — see \`forecaster presets\``);
    const d = presetModule.defaults;
    const res = scaffoldVenture(pf, {
      id, name, preset: presetName, presetModule,
      cur: flag("--cur", d.cur), fx: Number(flag("--fx", d.fx)), channel: flag("--channel", d.channel),
      date: new Date().toISOString().slice(0, 10),
    });
    console.log(`Scaffolded ${id} (${res.nodes} nodes, every one a labelled placeholder):`);
    for (const f of res.written) console.log(`  ${relative(pf.root, f) || f}`);
    console.log(`\nNext: npm run pipeline   (compiles the placeholders, regenerates, re-freezes golden)\n      forecaster status ${id}   (what to research first)`);
    return;
  }
  if (cmd === "status") {
    const ids = rest.length ? rest : readdirSync(join(pf.distributionData, "projects")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, ""));
    const all = ventureStatuses(pf, ids);
    if (argv.includes("--json")) { console.log(JSON.stringify(all, null, 2)); return; }
    all.forEach((s, i) => { if (i) console.log("\n" + "─".repeat(80) + "\n"); printStatus(s); });
    return;
  }
  console.log(readFileHeader());
}

function readFileHeader() {
  return `usage:\n  forecaster init <dir> [--name "<Title>"]\n  forecaster presets\n  forecaster new <id> --preset <p> --name "<Name>" [--cur $] [--fx 1] [--channel …]\n  forecaster status [<id> ...] [--json]`;
}

main().catch((e) => { console.error(`forecaster: ${e.message}`); process.exit(1); });
