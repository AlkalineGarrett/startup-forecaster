// Module hook: run this package's TypeScript (the engine is shipped as .ts source) when it is installed
// under node_modules, where Node's own type stripping refuses to run. Files outside node_modules (a
// workspace's own src/) are left to Node's built-in stripping.
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts") && url.includes("/node_modules/")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url }), shortCircuit: true };
  }
  return nextLoad(url, context);
}
