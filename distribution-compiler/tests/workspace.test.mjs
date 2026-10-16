// workspace.mjs finds the data project and source archive from the enclosing portfolio.config.mjs.
// Each case runs in a child process: the config is resolved from the working directory and cached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WS = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), "compiler", "workspace.mjs")).href;

function ws(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dcjs-ws-")));
  writeFileSync(join(root, "portfolio.config.mjs"), `export default ${body};\n`);
  const sub = join(root, "distributions", "projects");
  mkdirSync(sub, { recursive: true });
  return [root, sub];
}
const ENV_KEYS = ["MC_CONFIG", "FORECASTER_DATA", "MC_DISTRIBUTION_DATA", "GROUNDING_SOURCES", "MC_GROUNDING_SOURCES"];
/** [dataRoot, sourcesRoot] resolved in `cwd` with only `env`'s overrides set; "ERR <message>" when it throws. */
function roots(cwd, env) {
  const e = { ...process.env, ...env };
  for (const k of ENV_KEYS) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const w = await import(${JSON.stringify(WS)}); try { console.log(JSON.stringify([await w.dataRoot(), await w.sourcesRoot()])); } catch (e) { console.log("ERR " + (e instanceof w.WorkspaceError ? "" : "(not a WorkspaceError) ") + e.message); }`],
  { cwd, env: e, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.startsWith("ERR ") ? r.stdout.trim() : JSON.parse(r.stdout);
}
const outside = () => realpathSync(mkdtempSync(join(tmpdir(), "dcjs-none-")));

test("paths come from the enclosing config", () => {
  const [root, sub] = ws('{ distributionData: "distributions", groundingSources: "../shared-sources" }');
  assert.deepEqual(roots(sub, {}), [join(root, "distributions"), join(dirname(root), "shared-sources")]);
});

test("env overrides: both names of each are accepted, and need no workspace", () => {
  const [root, sub] = ws("{}");
  assert.deepEqual(roots(sub, { FORECASTER_DATA: join(root, "elsewhere") }), [join(root, "elsewhere"), join(root, "sources")]);   // archive beside the data project
  assert.deepEqual(roots(sub, { MC_DISTRIBUTION_DATA: join(root, "elsewhere") }), [join(root, "elsewhere"), join(root, "sources")]);
  const none = outside();
  assert.deepEqual(roots(none, { MC_DISTRIBUTION_DATA: join(none, "d"), MC_GROUNDING_SOURCES: join(none, "g") }), [join(none, "d"), join(none, "g")]);
  assert.deepEqual(roots(none, { FORECASTER_DATA: join(none, "a"), MC_DISTRIBUTION_DATA: join(none, "b") })[0], join(none, "a"), "FORECASTER_DATA wins when both are set");
});

test("no workspace, or one without a data project, is an error — never the current directory", () => {
  const [, sub] = ws("{}");
  assert.match(roots(sub, {}), /^ERR .*portfolio\.config\.mjs names no `distributionData`/);
  assert.match(roots(outside(), {}), /^ERR not inside a workspace \(no portfolio\.config\.mjs in .* or above it\).*MC_CONFIG=examples/);
  assert.match(roots(outside(), { MC_CONFIG: join(outside(), "nope.mjs") }), /^ERR MC_CONFIG names .*nope\.mjs, which does not exist/);
});

test("MC_CONFIG names the workspace; MC_CONFIG=examples opts into the bundled example", () => {
  const [root] = ws('{ distributionData: "distributions" }');
  assert.deepEqual(roots(outside(), { MC_CONFIG: join(root, "portfolio.config.mjs") }), [join(root, "distributions"), join(root, "sources")]);
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const w = await import(${JSON.stringify(WS)}); console.log(w.findConfig());`], { cwd: outside(), env: { ...process.env, MC_CONFIG: "examples" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /montecarlo-engine\/examples\/portfolio\.config\.mjs$/);
});

function list(cwd, field) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const w = await import(${JSON.stringify(WS)}); try { console.log(JSON.stringify(await w.configList(${JSON.stringify(field)}))); } catch (e) { console.log("ERR " + e.message); }`],
  { cwd, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !ENV_KEYS.includes(k))), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.startsWith("ERR ") ? r.stdout.trim() : JSON.parse(r.stdout);
}

test("list fields: read from the config, empty by default, a wrong type is an error", () => {
  const [, sub] = ws('{ sourcesExclude: ["assets/", "notes.json"], browserOnlyHosts: "levels.fyi" }');
  assert.deepEqual(list(sub, "sourcesExclude"), ["assets/", "notes.json"]);
  assert.deepEqual(list(sub, "unsetField"), []);
  assert.match(list(sub, "browserOnlyHosts"), /^ERR .*browserOnlyHosts.* must be a list of strings/);
  assert.deepEqual(list(outside(), "sourcesExclude"), []);   // outside a workspace
});
