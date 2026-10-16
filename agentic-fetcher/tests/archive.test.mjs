// Archive upkeep: check-transcribed's routing (F4), check-sources' exclusions and the sourcesExclude config
// field (F5), and the prep tools' shared MANIFEST vocabulary plus bootstrap-documents' merge (F6).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classify, domainsIn } from "../check_transcribed.mjs";
import { MAN_COLS } from "../lib/manifest.mjs";
import { runTool, twoRoots } from "./helpers.mjs";

const SHA = (c) => c.repeat(64);
const manifest = (rows) => [MAN_COLS.join(","), ...rows.map((r) => MAN_COLS.map((k) => r[k] ?? "").join(","))].join("\n") + "\n";
const row = (sha, stored, type, extra = {}) => ({ id: `x__${sha.slice(0, 12)}`, tier: stored.split("/")[0], domain: "crew.example",
  title: "t", url: "", type, bytes: "1", copies: "1", sha256: sha, stored, origin: "test", status: "installed", ...extra });

// ---- F4: check-transcribed ----

test("compilation: any TLD counts, file names don't, and a plural Sources list counts its items", () => {
  assert.deepEqual([...domainsIn("Sources: nxcode.io/compare, daily.dev/blog, report.pdf, www.getdx.com")], ["nxcode.io", "daily.dev", "getdx.com"]);
  assert.equal(classify("Pricing notes\nSources: nxcode.io/compare, daily.dev/blog", "https://getdx.com/p"), "compilation");
  assert.equal(classify("Pricing notes\nSources: national statistics report 2024; installer listings; invoicing prices.", ""), "compilation");
  assert.equal(classify("Compilation of competitor prices\nA: $5", ""), "compilation");
  assert.equal(classify("Substitute products for crews\nThe Crew plan is $29.", "https://crew.example/p"), "single");
  assert.equal(classify("Source: report.pdf and data.csv from crew.example", "https://crew.example/p"), "single");
  assert.equal(classify("Sources: crew.example/pricing, captured 2026-09", "https://crew.example/p"), "single");
});

test("browser-only hosts: app stores, human_only fetch requests and the config's browserOnlyHosts", async () => {
  const { tmp, gs, pj, env } = twoRoots();
  const hosts = { app: "https://apps.apple.com/app/crew", queued: "https://www.rendered.example/p",
    configured: "https://configured.example/p", plain: "https://plain.example/p" };
  const docs = {}, obs = {};
  for (const [name, url] of Object.entries(hosts)) {
    writeFileSync(join(gs, "cores", `doc_${name}.txt`), `Crew pricing at ${name}: $29 per seat.\n`);
    docs[`doc_${name}`] = { sha256: SHA("a"), title: name, url, publisher: "", core: `cores/doc_${name}.txt`, capture: "transcribed" };
    obs[`obs_${name}`] = { doc: `doc_${name}`, statement: "s", measure: null, quote: "$29", locator: "", verification: "verified", audit: "unaudited" };
  }
  writeFileSync(join(gs, "documents.json"), JSON.stringify(docs));
  writeFileSync(join(pj, "corpus", "observations.json"), JSON.stringify(obs));
  writeFileSync(join(gs, "fetch-queue.jsonl"), JSON.stringify({ url: "https://rendered.example/other", lane: "human_only", status: "resolved" }) + "\n");
  writeFileSync(join(tmp, "portfolio.config.mjs"), 'export default { browserOnlyHosts: ["configured.example"] };\n');
  const r = await runTool("check_transcribed.mjs", ["--json"], env, tmp);
  assert.equal(r.code, 0, r.stderr);
  const action = Object.fromEntries(JSON.parse(r.stdout).map((x) => [x.doc, x.action]));
  assert.deepEqual(action, { doc_app: "CORROBORATE", doc_configured: "CORROBORATE", doc_plain: "UPGRADE", doc_queued: "CORROBORATE" });
});

// ---- F5: check-sources ----

test("check-sources: built-in exclusions, and sourcesExclude for a workspace's own", async () => {
  const { tmp, gs, env } = twoRoots();
  mkdirSync(join(gs, "manual"), { recursive: true });
  writeFileSync(join(gs, "manual", "a.html"), "<p>a</p>");
  writeFileSync(join(gs, "MANIFEST.csv"), manifest([row("ab".repeat(32), "manual/a.html", "html")]));
  for (const [dir, file] of [["_staging", "draft.html"], ["manual/page_files", "x.html"], ["cores", "doc_x.txt"]]) {   // never evidence
    mkdirSync(join(gs, dir), { recursive: true });
    writeFileSync(join(gs, dir, file), "x");
  }
  writeFileSync(join(gs, "README.md"), "notes");
  let r = await runTool("check_sources.mjs", [], env, tmp);
  assert.equal(r.code, 0, r.stdout);
  mkdirSync(join(gs, "notes"));
  writeFileSync(join(gs, "notes", "todo.txt"), "fetch the crew report");   // evidence-like, not in the manifest
  r = await runTool("check_sources.mjs", [], env, tmp);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /S5 {2}notes\/todo\.txt/);
  writeFileSync(join(tmp, "portfolio.config.mjs"), 'export default { sourcesExclude: ["notes/"] };\n');
  r = await runTool("check_sources.mjs", [], env, tmp);
  assert.equal(r.code, 0, r.stdout);
});

// ---- F6: one vocabulary; bootstrap merges ----

test("extract-cores reads older and newer type names alike", async () => {
  const { gs, env } = twoRoots();
  mkdirSync(join(gs, "manual"));
  const files = [["old.txt", "txt", "1"], ["new.txt", "text", "2"], ["page.htm", "htm", "3"]];
  for (const [f] of files) writeFileSync(join(gs, "manual", f), f.endsWith(".htm") ? "<p>The Crew plan costs 29 dollars per seat each month.</p>" : "The Crew plan costs 29 dollars per seat each month.");
  writeFileSync(join(gs, "MANIFEST.csv"), manifest(files.map(([f, type, c]) => row(SHA(c), `manual/${f}`, type))));
  const r = await runTool("prep/extract_cores.mjs", [], env);
  assert.equal(r.code, 0, r.stderr);
  for (const [, , c] of files) assert.ok(existsSync(join(gs, "cores", `doc_${SHA(c).slice(0, 12)}.txt`)), `no core for ${c}`);
});

test("bootstrap-documents merges into an existing registry; --force replaces it", async () => {
  const { gs, env } = twoRoots();
  const kept = `doc_${SHA("1").slice(0, 12)}`, added = `doc_${SHA("2").slice(0, 12)}`;
  writeFileSync(join(gs, "MANIFEST.csv"), manifest([row(SHA("1"), "manual/a.html", "html"), row(SHA("2"), "manual/b.html", "html"),
    row(SHA("3"), "asset/c.png", "image", { status: "asset" })]));
  const audited = { sha256: SHA("1"), title: "Corrected title", url: "https://crew.example/a", publisher: "crew.example", audit: "verified", audit_date: "2026-10-01" };
  writeFileSync(join(gs, "documents.json"), JSON.stringify({ [kept]: audited }));
  let r = await runTool("prep/bootstrap_documents.mjs", ["--write"], env);
  assert.equal(r.code, 0, r.stderr);
  let docs = JSON.parse(readFileSync(join(gs, "documents.json"), "utf8"));
  assert.deepEqual(Object.keys(docs).sort(), [kept, added].sort());   // the asset is never a document
  assert.deepEqual(docs[kept], audited, "a registered source is left as it is");
  r = await runTool("prep/bootstrap_documents.mjs", ["--write", "--force"], env);
  assert.equal(r.code, 0, r.stderr);
  docs = JSON.parse(readFileSync(join(gs, "documents.json"), "utf8"));
  assert.equal(docs[kept].audit, undefined);
  assert.equal(docs[kept].title, "t");
});

// ---- the schema describes what the tools write (distribution-compiler SCHEMA.md §2) ----

test("documents and observations written by the tools validate against the schema", async () => {
  const { validator } = await import("../../distribution-compiler/compiler/jsonschema.mjs");
  const schema = JSON.parse(readFileSync(new URL("../../distribution-compiler/project-distributions.schema.json", import.meta.url), "utf8"));
  const { tmp, gs, pj, env } = twoRoots();
  writeFileSync(join(gs, "documents.json"), "{}");
  const page = join(tmp, "page.html"), note = join(tmp, "note.txt");
  writeFileSync(page, "<html><body><p>The Crew plan is 29 dollars per seat per month.</p></body></html>");
  writeFileSync(note, "Typed from the app store: the Fleet plan is 49 dollars per seat per month.");
  const run = async (tool, args) => {
    const r = await runTool(tool, args, env);
    assert.equal(r.code, 0, `${tool}: ${r.stderr}`);
    return r.stdout;
  };
  const docOf = (out) => /installed (doc_[0-9a-f]{12})/.exec(out)[1];
  const crew = docOf(await run("install_source.mjs", [page, "--url", "https://crew.example/pricing", "--title", "Crew pricing"]));
  const fleet = docOf(await run("install_source.mjs", [note, "--url", "https://apps.apple.com/app/fleet", "--title", "Fleet listing"]));
  await run("add_observation.mjs", [crew, "obs_crew_price", "--value", "29", "--unit", "USD/seat/mo", "--statement", "Crew plan $29/seat/mo",
    "--quote", "The Crew plan is 29 dollars per seat per month."]);
  await run("add_observation.mjs", [fleet, "obs_fleet_price", "--value", "49", "--unit", "USD/seat/mo", "--statement", "Fleet plan $49/seat/mo",
    "--quote", "the Fleet plan is 49 dollars per seat per month"]);
  await run("add_observation.mjs", [crew, "obs_crew_trial", "--statement", "A free trial is offered"]);   // no quote
  await run("make_derivative.mjs", ["--title", "Mean seat price (derived)", "--from", `${crew}/obs_crew_price`, "--from", `${fleet}/obs_fleet_price`,
    "--records", "29,49", "--compute", "mean", "--unit", "USD/seat/mo", "--obs", "obs_mean_price", "--statement", "mean seat price"]);
  await run("make_derivative.mjs", ["--title", "Crew undercuts Fleet (derived)", "--from", crew, "--from", fleet,
    "--reasoning", "Crew's seat price is below Fleet's on the two vendors' own pages.", "--obs", "obs_undercut"]);
  await run("mark_audited.mjs", ["--obs", `${crew}/obs_crew_price`, "--doc", crew]);
  const documents = JSON.parse(readFileSync(join(gs, "documents.json"), "utf8"));
  const observations = JSON.parse(readFileSync(join(pj, "corpus", "observations.json"), "utf8"));
  assert.equal(Object.keys(documents).length, 4);
  assert.equal(Object.keys(observations).length, 5);
  const errors = [...validator({ ...schema, $defs: schema.$defs }, schema.$defs)({ documents, observations, nodes: {} })];
  assert.deepEqual(errors.map((e) => `${e.path.join("/")}: ${e.message}`), []);
  assert.equal(observations.obs_fleet_price.source_capture, "transcribed");
  assert.equal(documents[crew].audit, "verified");
});
