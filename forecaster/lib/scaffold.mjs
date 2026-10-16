// `startup-forecaster new` — scaffold a venture into a portfolio, ready to research:
//   1. <dataRoot>/projects/<id>.ts      the model's STRUCTURE (node ids, labels, loadings) + its template `model`;
//                                      labels name the venture's currency (its profile entry, or --currency)
//   2. registration                    at the portfolio's `// forecaster:` markers (bootstrap + manifest)
//   3. <distributionData>/projects/<id>.json + corpus speculations
//                                      a PLACEHOLDER distribution per node (wide preset prior, support 5,
//                                      referencing a `…_placeholder` speculation) so the model runs end to end —
//                                      written by distribution-compiler/compiler/scaffold.mjs
//   4. <dossiers>/<id>/research-brief.md  what would ground each node, in the order to research them
//   5. profile.json                    the venture's entry (currency, channel): the one record of its currency
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { identOf, placeholderSpec } from "./portfolio.mjs";
import { emptyVenture, isSet, rateBetween, readProfile, reportingCode, writeProfile } from "./profile.mjs";
import { BUILTIN_CHANNEL_NAMES, symbolOf } from "../../montecarlo-engine/src/settings.mjs";

function insertAtMarker(file, marker, makeLine) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes(`forecaster:${marker}`));
  if (i < 0) throw new Error(`${file}: no "// forecaster:${marker}" marker — add one where new ventures should be registered`);
  const indent = lines[i].match(/^\s*/)[0];
  lines.splice(i, 0, indent + makeLine(lines[i]));
  writeFileSync(file, lines.join("\n"));
}

function projectSource({ pf, id, name, cur, currency, preset, built, date }) {
  const ident = identOf(id);
  const node = (n) => {
    const parts = [`id: ${JSON.stringify(n.id)}`, `label: ${JSON.stringify(n.label)}`, `kind: "${n.kind}"`, `conf: "low"`];
    if (n.bound) parts.push(`bound: "${n.bound}"`);
    if (n.loading) parts.push(`loadings: { [F_EXEC]: ${n.loading} }`);
    return `    { ${parts.join(", ")} },`;
  };
  return `import type { Project } from "startup-forecaster/montecarlo-engine/src/types.ts";
import { F_EXEC } from "startup-forecaster/montecarlo-engine/src/factors.ts";

// ${name} — scaffolded by startup-forecaster (preset ${preset}) on ${date}.
// STRUCTURE ONLY: every node's distribution lives in ${relative(pf.root, join(pf.distributionData, "projects", id + ".json"))},
// starting as a labelled PLACEHOLDER prior. Research each node (${pf.dossiers ? relative(pf.root, join(pf.dossiers, id, "research-brief.md")) : "the research brief"}), replace its
// placeholder with a grounded distribution, then \`npx startup-forecaster simulate\` and \`npx startup-forecaster status ${id}\`.
// Money is in ${currency} (${cur}): the currency profile.json records for it (ventures.${id}.currency).
export const ${ident}: Project = {
  id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, type: ${JSON.stringify(built.type)},
  one: "TODO: one line — what it is, who pays, why now.",
  revNote: ${JSON.stringify(built.revNote)},
  nodes: [
${built.nodes.map(node).join("\n")}
  ],
  model: ${JSON.stringify(built.model, null, 2).replace(/\n/g, "\n  ")},
};
`;
}

function brief({ pf, id, name, preset, built, settings }) {
  const rows = built.nodes.map((n) =>
    `### \`${n.id}\` — ${n.label}\n\n- **Unit:** ${n.unit}${n.bound ? " (a fraction in [0,1])" : ""}\n- **Placeholder (not a finding):** p10 ${n.placeholder.p10} · p50 ${n.placeholder.p50} · p90 ${n.placeholder.p90}\n- **What would ground it:** ${n.research}\n- **Status:** placeholder\n`);
  const data = relative(pf.root, join(pf.distributionData, "projects", `${id}.json`));
  return `# ${name} — research brief

Scaffolded by startup-forecaster (preset \`${preset}\`). Every node below starts as a labelled **placeholder**
prior. Replace each with a distribution **constructed from evidence** in \`${data}\`, following the sourcing
ladder (search the archive first; fetch with an agent; queue genuinely browser-gated pages for a human; never
invent a figure or call a proxy grounded). Aim for at least three independent sources per node unless the
person has set another target; when fewer turn up, try harder within reason, then state the shortfall.

Research in order of influence: run \`npx startup-forecaster simulate\` then \`npx startup-forecaster status ${id}\` — it ranks the nodes
by how strongly each drives the outcome. The cruxes (volume and conversion/penetration) usually lead.

## Model

${built.revNote}

Money is in ${settings.currency} (${settings.cur}); payment channel \`${settings.channel}\`. ${settings.moneyNote}

## Judgement settings

Not nodes, so not researched like one: fixed values in the model, each a judgement until evidence replaces it.

${(built.judgements || []).map((j) => `- ${j}`).join("\n") || "- none"}

## Nodes

${rows.join("\n")}`;
}

/** What `new` scaffolds with, from the flags, else the venture's profile entry, else the person's answers,
 *  else the preset: currency, symbol, channel, the placeholder money scale and the team cost. `notes` say
 *  what was guessed and needs confirming. */
export function ventureSettings(pf, { id, presetModule, flags = {} }) {
  const profile = readProfile(pf.root);
  const person = profile?.person || {};
  const entry = profile?.ventures?.[id] || {};
  const notes = [];
  const reporting = reportingCode(profile);
  for (const k of ["fx", "cur"]) if (flags[k] != null)
    throw new Error(`--${k} is gone: a venture's symbol and price conversion derive from its currencies in profile.json (ventures.${id}.currency, and .priceCurrency when its prices are quoted in another currency)`);

  const currency = (flags.currency || (isSet(entry.currency) ? entry.currency : null) || reporting).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`currency "${currency}" is not an ISO 4217 code (e.g. USD, EUR, GBP)`);
  if (!flags.currency && !isSet(entry.currency)) notes.push(`currency ${currency}: not in profile.json ventures.${id}.currency; guessed from ${profile && isSet(person.reportingCurrency) ? "the reporting currency" : "the default (USD)"}. Confirm it from the market it sells into.`);
  if (!profile && currency !== reporting)
    throw new Error(`currency ${currency}: this workspace has no profile.json to record it in (the reporting currency is ${reporting}); create one with \`startup-forecaster init\` or the onboarding in add-venture.md`);
  const cur = symbolOf(currency);

  const valid = [...new Set([...BUILTIN_CHANNEL_NAMES, ...Object.keys(profile?.channels || {})])];
  const fromEntry = typeof entry.channel === "string" && entry.channel !== "declined" ? entry.channel : null;
  const channel = flags.channel || fromEntry || presetModule.defaults.channel;
  if (!valid.includes(channel)) throw new Error(`unknown payment channel "${channel}" — one of: ${valid.join(", ")} (add another under "channels" in profile.json)`);
  if (!flags.channel && !fromEntry) notes.push(`channel ${channel}: not in profile.json ventures.${id}.channel; the ${presetModule.name} preset's default. Confirm it from the business model and market.`);

  if (currency !== reporting && !rateBetween(profile, currency, reporting))
    notes.push(`no ${currency} → ${reporting} exchange rate: add person.exchangeRates.${currency} to profile.json ({ rate, source, asOf }, researched) before simulating.`);

  // Placeholder money is sized in US dollars: convert it when a rate is known, else say it isn't converted.
  const usd = rateBetween(profile, "USD", currency);
  const moneyScale = usd ?? 1;
  const moneyNote = currency === "USD" ? "" : usd
    ? `Placeholder money was converted from US-dollar-sized priors at 1 USD = ${Number(usd.toPrecision(4))} ${currency}.`
    : `Placeholder money is sized in US dollars and NOT converted (no USD rate in the profile); read it as ${currency} only as a rough start.`;

  // A paid team: the venture's own payroll (its currency), else the person's (reporting currency, converted).
  const team = isSet(entry.team) ? entry.team : person.team;
  let teamCost = null;
  if (team === "team") {
    if (typeof entry.paidTeamCostPerYear === "number") teamCost = entry.paidTeamCostPerYear;
    else if (typeof person.paidTeamCostPerYear === "number") {
      const r = rateBetween(profile, reporting, currency);
      if (r) teamCost = person.paidTeamCostPerYear * r;
      else notes.push(`team cost not added: the payroll is in ${reporting} and there is no ${currency} rate to convert it.`);
    } else notes.push("the team is paid but profile.json has no paidTeamCostPerYear: no team cost line was added.");
  }
  return { profile, currency, cur, channel, moneyScale, moneyNote, teamCost, notes };
}

/** A preset's nodes in the venture's currency, in one pass: every node whose unit starts with "currency" has its
 *  US-dollar placeholder converted (two significant figures) — a payroll node's placeholder, in multiples of the
 *  payroll, becomes the payroll itself (three) — and the {cur} / {payroll} tokens in labels and research text
 *  are filled in. */
export function inVentureCurrency(nodes, { cur, moneyScale = 1, teamCost = null }) {
  const payroll = teamCost != null ? `${cur}${teamCost.toLocaleString("en-US")}` : "{payroll}";
  const fill = (t) => t.replaceAll("{cur}", cur).replaceAll("{payroll}", payroll);
  return nodes.map(({ payroll: isPayroll, ...n }) => {
    const out = { ...n, label: fill(n.label), research: fill(n.research) };
    if (n.unit.startsWith("currency")) {
      const conv = isPayroll ? (m) => Number((teamCost * m).toPrecision(3)) : (v) => Number((v * moneyScale).toPrecision(2));
      out.placeholder = Object.fromEntries(Object.entries(n.placeholder).map(([k, v]) => [k, conv(v)]));
    }
    return out;
  });
}

export function scaffoldVenture(pf, { id, name, preset, presetModule, flags = {}, date }) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`venture id "${id}" must be kebab-case (a-z, 0-9, -)`);
  const tsFile = join(pf.dataRoot, "projects", `${id}.ts`);
  if (existsSync(tsFile)) throw new Error(`${relative(pf.root, tsFile)} already exists`);
  if (!pf.distributionData) throw new Error("the portfolio config has no `distributionData` project to hold the distributions");
  const dataFile = join(pf.distributionData, "projects", `${id}.json`);
  if (existsSync(dataFile)) throw new Error(`${dataFile} already exists`);

  const settings = ventureSettings(pf, { id, presetModule, flags });
  const { profile, currency, cur, channel, moneyScale, teamCost } = settings;
  const preBuilt = presetModule.build({ channel, paidTeam: teamCost > 0 });
  const built = { ...preBuilt, nodes: inVentureCurrency(preBuilt.nodes, { cur, moneyScale, teamCost }) };
  const written = [];

  // 1. structure + model
  mkdirSync(join(pf.dataRoot, "projects"), { recursive: true });
  writeFileSync(tsFile, projectSource({ pf, id, name, cur, currency, preset, built, date }));
  written.push(tsFile);

  // 2. registration
  const ident = identOf(id);
  insertAtMarker(pf.bootstrap, "imports", () => `import { ${ident} } from "./projects/${id}.ts";`);
  insertAtMarker(pf.bootstrap, "register", (marker) => {
    const arr = (marker.match(/forecaster:register\s+([A-Za-z_$][\w$]*)/) || [])[1];
    if (!arr) throw new Error(`${pf.bootstrap}: the register marker must name the projects array, e.g. "// forecaster:register VENTURES"`);
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
    reasoning: `PLACEHOLDER — not researched. A generic wide prior from the startup-forecaster preset so the model runs end to end; it says nothing about this venture. To ground it: ${n.research}`,
    spec_statement: `Placeholder prior for ${name} '${n.label}' — NOT researched: p10=${n.placeholder.p10}, p50=${n.placeholder.p50}, p90=${n.placeholder.p90}`,
    spec_reasoning: `A generic wide prior from the startup-forecaster '${preset}' preset, so the model runs before any research. It carries no evidence about this venture; replace the node's distribution with a researched one.`,
  })) };
  mkdirSync(join(pf.distributionData, "projects"), { recursive: true });
  mkdirSync(join(pf.distributionData, "corpus"), { recursive: true });
  const input = join(mkdtempSync(join(tmpdir(), "forecaster-")), "venture.json");
  writeFileSync(input, JSON.stringify({ projects: [venture] }));
  const r = spawnSync(process.execPath, [join(pf.compiler, "compiler", "scaffold.mjs"), input, id, "--write"],
    { env: { ...process.env, FORECASTER_DATA: pf.distributionData }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`scaffold.mjs failed: ${(r.stderr || r.stdout).trim()}`);
  written.push(dataFile, join(pf.distributionData, "corpus", "speculations.json"));

  // 4. research brief
  if (pf.dossiers) {
    const dir = join(pf.dossiers, id);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "research-brief.md");
    if (!existsSync(f)) { writeFileSync(f, brief({ pf, id, name, preset, built, settings })); written.push(f); }
  }

  // 5. the venture's profile entry: what it was scaffolded with, so the profile stays the record. A value that
  //    was guessed here (not given by flag or profile) is dated as needing confirmation.
  if (profile) {
    const v = { ...emptyVenture(), ...(profile.ventures?.[id] || {}) };
    const at = (profile.answeredAt ||= {});
    for (const [k, val, given] of [["currency", currency, flags.currency || v.currency], ["channel", channel, flags.channel || v.channel]]) {
      if (v[k] === val) continue;
      v[k] = val;
      at[`ventures.${id}.${k}`] = given ? date : `${date} (forecaster new default; confirm)`;
    }
    (profile.ventures ||= {})[id] = v;
    writeProfile(pf.root, profile);
    written.push(join(pf.root, "profile.json"));
  }
  return { written, nodes: built.nodes.length, notes: settings.notes };
}
