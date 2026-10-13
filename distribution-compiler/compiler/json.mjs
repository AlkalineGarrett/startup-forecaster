// JSON as the tools read and write it: JSON.parse / JSON.stringify, plus key sorting and the compiler's
// freshness stamp. Text is written as UTF-8 as-is (no \u escapes).
import { createHash } from "node:crypto";

/** A deep copy of `v` with every object's keys sorted (code-unit order). */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
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
