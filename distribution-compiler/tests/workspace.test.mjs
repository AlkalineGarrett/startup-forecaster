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
function roots(cwd, env) {
  const e = { ...process.env, ...env };
  for (const k of ["FORECASTER_DATA", "GROUNDING_SOURCES"]) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const w = await import(${JSON.stringify(WS)}); console.log(JSON.stringify([await w.dataRoot(), await w.sourcesRoot()]));`],
  { cwd, env: e, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("paths come from the enclosing config", () => {
  const [root, sub] = ws('{ distributionData: "distributions", groundingSources: "../shared-sources" }');
  assert.deepEqual(roots(sub, {}), [join(root, "distributions"), join(dirname(root), "shared-sources")]);
});

test("env overrides, and outside a workspace", () => {
  const [root, sub] = ws("{}");
  assert.deepEqual(roots(sub, { FORECASTER_DATA: join(root, "elsewhere") }), [join(root, "elsewhere"), join(root, "sources")]);   // archive beside the data project
  assert.equal(roots(sub, {})[0], sub);   // config names no data project → cwd
});
