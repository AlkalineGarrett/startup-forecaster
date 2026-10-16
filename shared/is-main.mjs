// "Was this module the script node was asked to run?" — the one check every CLI entrypoint uses to stay
// side-effect-free when imported. No imports with side effects, so any module can use it.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at `metaUrl` (its import.meta.url) is the script node was asked to run. Compared as
 *  real paths, so a symlinked path (macOS /var → /private/var, a node_modules link) still counts. */
export function isMain(metaUrl) {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}
