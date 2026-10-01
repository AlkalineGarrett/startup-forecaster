// `forecaster new` — scaffold a venture into a portfolio, ready to research:
//   1. <dataRoot>/projects/<id>.ts      the model's STRUCTURE (node ids, labels, loadings) + its template `model`
//   2. registration                    at the portfolio's `// forecaster:` markers (bootstrap + manifest)
//   3. <distributionData>/projects/<id>.json + corpus speculations
//                                      a PLACEHOLDER distribution per node (wide preset prior, support 5,
//                                      referencing a `…_placeholder` speculation) so the model runs end to end —
//                                      written by distribution-compiler/compiler/scaffold.py
//   4. <dossiers>/<id>/research-brief.md  what would ground each node, in the order to research them
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { identOf, placeholderSpec } from "./portfolio.mjs";


function insertAtMarker(file, marker, makeLine) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes(`forecaster:${marker}`));
  if (i < 0) throw new Error(`${file}: no "// forecaster:${marker}" marker — add one where new ventures should be registered`);
  const indent = lines[i].match(/^\s*/)[0];
  lines.splice(i, 0, indent + makeLine(lines[i]));
  writeFileSync(file, lines.join("\n"));
}

function projectSource({ id, name, cur, fx, preset, built, date }) {
  const ident = identOf(id);
  const node = (n) => {
    const parts = [`id: ${JSON.stringify(n.id)}`, `label: ${JSON.stringify(n.label)}`, `kind: "${n.kind}"`, `conf: "low"`];
    if (n.bound) parts.push(`bound: "${n.bound}"`);
    if (n.loading) parts.push(`loadings: { [F_EXEC]: ${n.loading} }`);
    return `    { ${parts.join(", ")} },`;
  };
  return `import type { Project } from "montecarlo-engine/src/types.ts";
import { F_EXEC } from "montecarlo-engine/src/factors.ts";

// ${name} — scaffolded by startup-forecaster (preset ${preset}) on ${date}.
// STRUCTURE ONLY: every node's distribution lives in the distribution-data project (projects/${id}.json),
// starting as a labelled PLACEHOLDER prior. Research each node (dossiers/${id}/research-brief.md), replace its
// placeholder with a grounded distribution, then \`npm run pipeline\` and \`forecaster status ${id}\`.
export const ${ident}: Project = {
  id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, cur: ${JSON.stringify(cur)}, fx: ${fx}, type: ${JSON.stringify(built.type)},
  one: "TODO: one line — what it is, who pays, why now.",
  revNote: ${JSON.stringify(built.revNote)},
  nodes: [
${built.nodes.map(node).join("\n")}
  ],
  model: ${JSON.stringify(built.model, null, 2).replace(/\n/g, "\n  ")},
};
`;
}

function brief({ id, name, preset, built }) {
  const rows = built.nodes.map((n) =>
    `### \`${n.id}\` — ${n.label}\n\n- **Unit:** ${n.unit}${n.bound ? " (a fraction in [0,1])" : ""}\n- **Placeholder (not a finding):** p10 ${n.placeholder.p10} · p50 ${n.placeholder.p50} · p90 ${n.placeholder.p90}\n- **What would ground it:** ${n.research}\n- **Status:** placeholder\n`);
  return `# ${name} — research brief

Scaffolded by startup-forecaster (preset \`${preset}\`). Every node below starts as a labelled **placeholder**
prior. Replace each with a distribution **constructed from evidence** in the distribution-data project
(\`projects/${id}.json\`), following the sourcing ladder (search the archive first; fetch with an agent;
queue genuinely browser-gated pages for a human; never invent a figure or call a proxy grounded).

Research in order of influence: run \`npm run pipeline\` then \`forecaster status ${id}\` — it ranks the nodes
by how strongly each drives the outcome. The cruxes (volume and conversion/penetration) usually lead.

## Model

${built.revNote}

## Nodes

${rows.join("\n")}`;
}

export function scaffoldVenture(pf, { id, name, preset, presetModule, cur, fx, channel, date }) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`venture id "${id}" must be kebab-case (a-z, 0-9, -)`);
  const tsFile = join(pf.dataRoot, "projects", `${id}.ts`);
  if (existsSync(tsFile)) throw new Error(`${relative(pf.root, tsFile)} already exists`);
  if (!pf.distributionData) throw new Error("the portfolio config has no `distributionData` project to hold the distributions");
  const dataFile = join(pf.distributionData, "projects", `${id}.json`);
  if (existsSync(dataFile)) throw new Error(`${dataFile} already exists`);

  const built = presetModule.build({ channel });
  const written = [];

  // 1. structure + model
  mkdirSync(join(pf.dataRoot, "projects"), { recursive: true });
  writeFileSync(tsFile, projectSource({ id, name, cur, fx, preset, built, date }));
  written.push(tsFile);

  // 2. registration
  const ident = identOf(id);
  insertAtMarker(pf.bootstrap, "imports", () => `import { ${ident} } from "./projects/${id}.ts";`);
  insertAtMarker(pf.bootstrap, "register", (marker) => {
    const arr = (marker.match(/forecaster:register\s+([A-Za-z_$][\w$]*)/) || [])[1];
    if (!arr) throw new Error(`${pf.bootstrap}: the register marker must name the projects array, e.g. "// forecaster:register PROJECTS"`);
    return `${arr}.push(${ident});`;
  });
  insertAtMarker(pf.manifest, "modules", () => `"projects/${id}.ts",`);
  written.push(pf.bootstrap, pf.manifest);

  // 3. placeholder distributions + their speculations — written by the distribution-compiler's scaffolder
  //    (the one writer of the node format), fed the preset's priors with the placeholder labelling.
  const venture = { id, nodes: built.nodes.map((n) => ({
    key: `${id}::${n.id}`, node: n.id, label: n.label, kind: n.kind, bound: n.bound || "semi-lo",
    pctiles: { ...n.placeholder }, prov: {}, conf: "low", basis: "", urls: [], source: "hand",
    unit: n.unit, support: 5, spec_id: placeholderSpec(id, n.id),
    reasoning: `PLACEHOLDER — not researched. A generic wide prior from the forecaster preset so the model runs end to end; it says nothing about this venture. To ground it: ${n.research}`,
    spec_statement: `Placeholder prior for ${name} '${n.label}' — NOT researched: p10=${n.placeholder.p10}, p50=${n.placeholder.p50}, p90=${n.placeholder.p90}`,
    spec_reasoning: `A generic wide prior from the startup-forecaster '${preset}' preset, so the model runs before any research. It carries no evidence about this venture; replace the node's distribution with a researched one.`,
  })) };
  mkdirSync(join(pf.distributionData, "projects"), { recursive: true });
  mkdirSync(join(pf.distributionData, "corpus"), { recursive: true });
  const input = join(mkdtempSync(join(tmpdir(), "forecaster-")), "venture.json");
  writeFileSync(input, JSON.stringify({ projects: [venture] }));
  const r = spawnSync("python3", [join(pf.compiler, "compiler", "scaffold.py"), input, id, "--write"],
    { env: { ...process.env, FORECASTER_DATA: pf.distributionData }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`scaffold.py failed: ${(r.stderr || r.stdout).trim()}`);
  written.push(dataFile, join(pf.distributionData, "corpus", "speculations.json"));

  // 4. research brief
  if (pf.dossiers) {
    const dir = join(pf.dossiers, id);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "research-brief.md");
    if (!existsSync(f)) { writeFileSync(f, brief({ id, name, preset, built })); written.push(f); }
  }
  return { written, nodes: built.nodes.length };
}
