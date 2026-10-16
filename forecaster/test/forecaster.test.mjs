// End to end in a throwaway workspace (`forecaster init`): scaffold a venture with every preset, compile its placeholders with
// the distribution-compiler, generate the engine modules, run the model (golden), build the page, and read its status.
// Needs the montecarlo-engine and distribution-compiler beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "forecaster.mjs");

function portfolio() {
  const root = join(mkdtempSync(join(tmpdir(), "forecaster-")), "ws");
  cli(dirname(root), "init", root, "--name", "Test portfolio", "--link");
  return root;
}
const cli = (root, ...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
// stdout + stderr of a CLI run that may fail
const cliAll = (root, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
const editProfile = (root, f) => {
  const file = join(root, "profile.json");
  const p = JSON.parse(readFileSync(file, "utf8"));
  f(p);
  writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
};
// the workspace's own installed command, as `npx forecaster` would run it
const bin = (root, ...args) => execFileSync(join(root, "node_modules", ".bin", "forecaster"), args, { cwd: root, encoding: "utf8" });
const simulate = (root, to) => bin(root, "simulate", "--to", to);

test("scaffold → compile → generate → run → status, for every preset", { timeout: 300_000 }, () => {
  const root = portfolio();
  for (const f of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) assert.ok(existsSync(join(root, f)), `init writes ${f}`);
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const playbook = agents.match(/read `([^`]+\/AGENTS\.md)`/)[1];
  assert.ok(existsSync(resolve(root, playbook)), "the workspace AGENTS.md points at the real playbook");
  assert.match(cli(root, "agent-files"), /already exist/);

  cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Demo App");
  cli(root, "new", "demo-seats", "--preset", "b2b-per-seat", "--name", "Demo Seats");
  cli(root, "new", "demo-org", "--preset", "b2b-per-org", "--name", "Demo Org");
  assert.ok(existsSync(join(root, "dossiers", "demo-app", "research-brief.md")));
  assert.match(readFileSync(join(root, "src", "projects.ts"), "utf8"), /VENTURES\.push\(demo_seats\);/);
  assert.throws(() => cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Again"), /already exists/);

  const out = simulate(root, "pairwise");
  assert.match(out, /✓ compile/, "placeholders compile cleanly (a compile error fails the stage)");
  assert.match(out, /✓ golden/);
  assert.match(bin(root, "build"), /Built .*montecarlo\.html/, "the page builds (no top-level name collides with the engine's)");
  assert.ok(existsSync(join(root, "dist", "montecarlo.html")));
  const golden = JSON.parse(readFileSync(join(root, "golden.json"), "utf8"));
  for (const id of ["demo-app", "demo-seats", "demo-org"]) {
    assert.ok(golden[id] && Number.isFinite(golden[id].mean) && golden[id].p80 >= golden[id].p20, `${id} simulated`);
  }

  // the fetcher's tools run on the fresh, empty archive
  assert.match(bin(root, "search", "churn"), /0 source/);
  bin(root, "check-sources");
  bin(root, "fetch-request", "list");

  const status = JSON.parse(cli(root, "status", "--json"));
  for (const s of status) {
    assert.equal(s.error, null);
    assert.equal(s.counts.placeholder, s.nodes.length, `${s.id}: every node starts as a placeholder`);
    assert.ok(s.nodes[0].driver, `${s.id}: nodes ranked by influence`);
  }
});

test("every step in AGENTS.md has a doc that opens with its required reading and binding principles", () => {
  const pkg = resolve(HERE, "..", "..");
  const router = readFileSync(join(pkg, "AGENTS.md"), "utf8");
  const steps = [...router.matchAll(/^\| `([a-z-]+)` \| `([^`]+\.md)` \| ([^|]+) \|$/gm)].map(([, id, doc, desc]) => [, id, doc, desc.trim()]);
  assert.ok(steps.length >= 9, "the step table lists every step");
  for (const [, id, doc, desc] of steps) {
    const path = join(pkg, doc);
    assert.ok(existsSync(path), `${id}: ${doc} exists`);
    const text = readFileSync(path, "utf8");
    const title = text.split("\n")[0].match(new RegExp(`^# Step \`${id}\`: (.+)$`));
    assert.ok(title, `${doc} is titled as step ${id}`);
    assert.equal(title[1], desc, `${id}: the router describes it by its title`);
    for (const label of ["Required reading before this step's first action:", "Input:", "Done when:", "Next:"]) {
      assert.ok(text.includes(`**${label}**`), `${doc} has its ${label} line`);
    }
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/:.*/, ""));
    const expected = id.startsWith("audit-") ? ["Principles (binding)", "What to check", "Procedure"] : ["Principles (binding)", "Procedure"];
    assert.deepEqual(sections.filter((x) => expected.includes(x)), expected, `${doc} has the sections ${expected.join(", ")}, in order`);
    for (const [, link] of text.slice(0, text.indexOf("\n\n", text.indexOf("Required reading"))).matchAll(/\]\(([^)]+\.md)\)/g)) {
      assert.ok(existsSync(join(dirname(path), link)), `${doc}: required reading ${link} exists`);
    }
  }
});

test("a data tool run outside a workspace says so instead of reporting an empty answer", async () => {
  const { needsWorkspace, workspaceProblem } = await import("../lib/tools.mjs");
  const outside = mkdtempSync(join(tmpdir(), "no-workspace-"));
  assert.match(workspaceProblem("fetch-request", outside, {}), /^forecaster fetch-request: not inside a workspace/);
  for (const cmd of ["preview", "compile", "build-plan", "exec-plan"]) {
    assert.equal(needsWorkspace(cmd), false, `${cmd} works on explicit files`);
    assert.equal(workspaceProblem(cmd, outside, {}), null);
  }
  assert.ok(needsWorkspace("check-sources") && needsWorkspace("simulate"));
  assert.equal(workspaceProblem("fetch-request", outside, { FORECASTER_DATA: outside }), null);
  assert.equal(workspaceProblem("fetch-request", outside, { MC_DISTRIBUTION_DATA: outside }), null);
  assert.equal(workspaceProblem("simulate", outside, { MC_CONFIG: "examples" }), null, "MC_CONFIG=examples opts into the bundled example");

  // end to end: the CLI refuses a data command here, and still runs the file tools and help
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MC_CONFIG|FORECASTER_DATA|MC_DISTRIBUTION_DATA|GROUNDING_SOURCES|MC_GROUNDING_SOURCES)$/.test(k)));
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: outside, env, encoding: "utf8" });
  for (const cmd of ["check-sources", "citations", "simulate"]) {
    const r = run(cmd);
    assert.equal(r.status, 2, `${cmd} exits 2 outside a workspace`);
    assert.match(r.stderr, new RegExp(`^forecaster ${cmd}: not inside a workspace`));
  }
  assert.match(run("status").stderr, /not inside a workspace/);
  assert.equal(run("help").status, 0);
  const pv = run("preview", '{"kind":"normal","mean":1,"sd":0.1}');
  assert.equal(pv.status, 0, pv.stderr);
});

test("init scaffolds profile.json; the settings come from it and status says what is unanswered", { timeout: 300_000 }, () => {
  const root = portfolio();
  const profile = JSON.parse(readFileSync(join(root, "profile.json"), "utf8"));
  for (const k of ["country", "legalStructure", "team", "founderHoursPerWeek", "meaningfulRevenuePerYear", "decisionFloorPerYear", "businessTaxRate", "reportingCurrency"])
    assert.equal(profile.person[k], null, `person.${k} starts unanswered`);
  assert.equal(profile.person.discountRate, 0.1, "guessable defaults are filled in");
  assert.equal(profile.person.horizonYears, 5);
  assert.match(readFileSync(join(root, "src", "projects.ts"), "utf8"), /configurePortfolio\(\{ \.\.\.PROFILE_SETTINGS, projects: VENTURES \}\)/);
  assert.match(readFileSync(join(root, "src", "profile-data.ts"), "utf8"), /"person\.country"/, "the generated module lists the gaps");

  cli(root, "new", "demo-app", "--preset", "consumer-freemium", "--name", "Demo App");
  bin(root, "simulate", "--to", "golden");
  const r = cliAll(root, "status");
  assert.match(r.stdout, /profile incomplete: person\.country, .*person\.decisionFloorPerYear, ventures\.demo-app\.market/);
  assert.match(r.stdout, /tax: no tax configured/);

  editProfile(root, (p) => {
    Object.assign(p.person, { country: "PT", reportingCurrency: "EUR", legalStructure: "company", businessTaxRate: 0.21, taxNote: "test company tax",
      team: "solo", founderHoursPerWeek: 30, meaningfulRevenuePerYear: 20000, decisionFloorPerYear: "declined",
      exchangeRates: { USD: { rate: 0.9, source: "test", asOf: "2026-10-16" } } });
    p.ventures["demo-app"].market = "Portugal";
  });
  bin(root, "simulate", "--to", "golden");   // the CLI regenerates profile-data.ts before the tool runs
  const gen = readFileSync(join(root, "src", "profile-data.ts"), "utf8");
  assert.match(gen, /"successThreshold": 20000/);
  assert.match(gen, /"businessTax": 0\.21/);
  assert.doesNotMatch(gen, /decisionFloor"/, "a declined field keeps the engine default");
  const out = cli(root, "status");
  assert.match(out, /profile: complete/);
  assert.match(out, /declined: person\.decisionFloorPerYear/);
  assert.match(out, /tax: test company tax/);
  const rep = JSON.parse(cli(root, "profile", "--json"));
  assert.deepEqual(rep.settings.reportingCurrency, { code: "EUR", symbol: "€" });
  assert.deepEqual(rep.gaps, []);
});

test("new: an unknown channel is rejected; a non-USD venture takes its currency from the profile", { timeout: 300_000 }, () => {
  const root = portfolio();
  const bad = cliAll(root, "new", "bad", "--preset", "b2b-per-seat", "--name", "Bad", "--channel", "carrierPigeon");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /unknown payment channel "carrierPigeon" — one of: .*usB2B/);
  assert.ok(!existsSync(join(root, "src", "projects", "bad.ts")), "nothing is written for a rejected venture");

  editProfile(root, (p) => {
    p.person.reportingCurrency = "USD";
    p.person.team = "team";
    p.person.paidTeamCostPerYear = 100000;
    p.ventures["uk-org"] = { market: "United Kingdom", currency: "GBP", channel: "eeaB2B", team: null };
  });
  const made = cli(root, "new", "uk-org", "--preset", "b2b-per-org", "--name", "UK Org");
  assert.match(made, /no GBP → USD exchange rate/, "a missing rate is flagged when the venture is made");
  const ts = readFileSync(join(root, "src", "projects", "uk-org.ts"), "utf8");
  assert.doesNotMatch(ts, /currency:|cur:|fx:/, "the project file holds no currency: the profile is its one record");
  assert.match(ts, /Money is in GBP \(£\)/);
  assert.match(ts, /"channel": "eeaB2B"/);
  assert.match(ts, /Price per customer \(£\/mo, flat\)/);
  assert.doesNotMatch(ts, /team_cost_yr/, "no team cost without a rate to convert the payroll");
  const sim = spawnSync(join(root, "node_modules", ".bin", "forecaster"), ["simulate", "--to", "golden"], { cwd: root, encoding: "utf8" });
  assert.notEqual(sim.status, 0, "a venture with no rate into the reporting currency does not simulate");
  assert.match(sim.stdout + sim.stderr, /no GBP rate/);

  editProfile(root, (p) => { p.person.exchangeRates = { GBP: { rate: 1.25, source: "test", asOf: "2026-10-16" } }; });
  cli(root, "new", "uk-team", "--preset", "b2b-per-seat", "--name", "UK Team", "--currency", "GBP", "--channel", "eeaB2B");
  const team = readFileSync(join(root, "src", "projects", "uk-team.ts"), "utf8");
  assert.match(team, /team_cost_yr/, "a paid team gets its payroll as an operating cost");
  const data = JSON.parse(readFileSync(join(root, "distributions", "projects", "uk-team.json"), "utf8"));
  const pct = (node) => JSON.stringify(data.nodes?.[`uk-team::${node}`] ?? data[`uk-team::${node}`] ?? data);
  assert.match(pct("team_cost_yr"), /80000/, "the USD payroll is converted into GBP (100000 / 1.25)");
  simulate(root, "golden");
  const golden = JSON.parse(readFileSync(join(root, "golden.json"), "utf8"));
  assert.ok(Number.isFinite(golden["uk-team"].mean), "the GBP venture simulates once the rate is set");
  const st = JSON.parse(cli(root, "status", "uk-team", "--json"))[0];
  assert.equal(st.currency, "GBP");
  const profile = JSON.parse(readFileSync(join(root, "profile.json"), "utf8"));
  assert.equal(profile.ventures["uk-team"].currency, "GBP", "new records the venture in the profile");
});

test("profile helpers: gaps, declined, stale answers, cross rates", async () => {
  const P = await import("../lib/profile.mjs");
  const p = P.emptyProfile();
  assert.ok(P.profileGaps(p).includes("person.country"));
  p.person.team = "team";
  assert.ok(P.profileGaps(p).includes("person.paidTeamCostPerYear"), "a team needs its payroll");
  p.person.businessTaxRate = "declined";
  assert.deepEqual(P.profileDeclined(p), ["person.businessTaxRate"]);
  assert.match(P.profileSettings(p).taxNote, /no tax configured/);
  p.person.reportingCurrency = "EUR";
  p.person.exchangeRates = { USD: { rate: 0.8 }, GBP: 1.2 };
  assert.equal(P.rateBetween(p, "USD", "GBP"), 0.8 / 1.2);
  assert.equal(P.rateBetween(p, "EUR", "USD"), 1 / 0.8);
  assert.equal(P.rateBetween(p, "JPY", "EUR"), null);
  p.answeredAt = { "person.country": "2025-01-01 (migrated; confirm)", "person.team": "2026-10-01" };
  assert.deepEqual(P.staleAnswers(p, { today: new Date("2026-10-16") }), ["person.country"]);
  assert.deepEqual(P.profileSettings({ ventures: { a: { currency: "EUR", priceCurrency: "USD" } } }).ventures, { a: { currency: "EUR", priceCurrency: "USD" } }, "ventures pass ISO codes; the engine derives symbol and fx");
});

test("the profile's tax text is the engine's taxDescription wording", async () => {
  const P = await import("../lib/profile.mjs");
  const { configurePortfolio, taxDescription } = await import("../../montecarlo-engine/src/portfolio-context.ts");
  const p = P.emptyProfile();
  assert.equal(P.taxSummary(p), "no tax configured");
  p.person.businessTaxRate = 0.25;
  assert.equal(P.taxSummary(p), "business tax 25% on pre-tax profit");
  p.person.taxNote = "PT company: IRC 21% + derrama";
  assert.equal(P.taxSummary(p), "PT company: IRC 21% + derrama");
  configurePortfolio(P.profileSettings(p));
  assert.equal(taxDescription(), P.taxSummary(p), "the page and the profile report agree");
  p.person.businessTaxRate = "declined";
  p.person.taxNote = null;
  assert.equal(P.taxSummary(p), "no tax configured (declined in the profile)");
});

test("--fx and --cur are gone: the profile's currencies drive both", () => {
  const root = portfolio();
  const r = cliAll(root, "new", "x", "--preset", "b2b-per-org", "--name", "X", "--fx", "0.9");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--fx is gone/);
});
