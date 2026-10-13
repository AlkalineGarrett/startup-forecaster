// Shared helpers for the schema generators: where they write, and a few small number utilities.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export * as N from "../../compiler/numerics.mjs";
export { dumps, loads } from "../../compiler/json.mjs";
export { round, sig } from "../../compiler/format.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
/** generators/data/<name> (created on demand). */
export function data(name) {
  mkdirSync(join(HERE, "data"), { recursive: true });
  return join(HERE, "data", name);
}
/** x with n decimals. */
export const fx = (x, n) => Number(x).toFixed(n);
/** An integer with thousands separators (14,260). */
export const commas = (n) => Number(n).toLocaleString("en-US");
/** The first index i with a[i] >= x in an ascending array. */
export function bisectLeft(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
/** The sum of a list of numbers. */
export function sum(xs) { let s = 0; for (const x of xs) s += x; return s; }
