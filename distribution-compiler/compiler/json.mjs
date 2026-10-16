// JSON as the tools read and write it: JSON.parse / JSON.stringify, plus key sorting and the compiler's
// freshness stamp. Text is written as UTF-8 as-is (no \u escapes).
import { createHash } from "node:crypto";

/** A deep copy of `v` with every object's keys sorted (code-unit order). Keys become own data properties
 *  (Object.fromEntries), so a `__proto__` key stays a key instead of setting the copy's prototype — the same
 *  as JSON.parse makes it. The one implementation: agentic-fetcher's json.mjs sorts with it too. */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** JSON.stringify with an optional indent and key sorting. */
export function dumps(value, { indent = null, sortKeys: sort = false } = {}) {
  return JSON.stringify(sort ? sortKeys(value) : value, null, indent ?? undefined);
}

export const loads = (text) => JSON.parse(text);

/** The compiler's freshness stamp: sha256 of the parsed, key-sorted, compact JSON (raw text if it does not parse). */
export function canonHash(text) {
  let canon;
  try {
    canon = JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    canon = text;   // not valid JSON (mid-edit): hash the raw text
  }
  return createHash("sha256").update(canon, "utf8").digest("hex");
}
