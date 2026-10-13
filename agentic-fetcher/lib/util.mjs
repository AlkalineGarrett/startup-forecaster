// Small shared helpers: text reads, synchronous console output, CLI exits, process runs, URLs.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEC_REPLACE = new TextDecoder("utf-8", { ignoreBOM: true });
const DEC_STRICT = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });

/** utf-8 bytes → string. "strict" throws on invalid bytes; "replace" inserts U+FFFD. A BOM is kept. */
export function decode(buf, errors = "strict") {
  return (errors === "replace" ? DEC_REPLACE : DEC_STRICT).decode(buf);
}

/** A text file, decoded, with \r\n and lone \r turned into \n. */
export function readText(path, errors = "strict") {
  return decode(readFileSync(path), errors).replace(/\r\n?/g, "\n");
}

/** The lines of a text (split on \n), without the empty string after a final newline. */
export function lines(text) {
  const out = text.split("\n");
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/** round(x, nd) with ties to even on the exact binary value (toFixed rounds ties away from zero).
 * A derivative's id hashes its rounded result, so a tie must always round the same way. */
export function roundHalfEven(x, nd = 0) {
  x = Number(x);
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 1e21) return x;                                    // already integral at any nd >= 0
  const exact = a.toFixed(Math.min(100, nd + 40));            // exact decimal digits of the double
  const [ip, fp = ""] = exact.split(".");
  let r = Number(a.toFixed(nd));
  if (/^50*$/.test(fp.slice(nd))) {                           // an exact tie: round half to even
    const kept = ip + fp.slice(0, nd);
    if (Number(kept[kept.length - 1]) % 2 === 0) r = Number(nd ? `${ip}.${fp.slice(0, nd)}` : ip);
  }
  return x < 0 ? -r : r;
}

/** A number from a command-line string, or null when it is not one ("" and "abc" are not). */
export function toNumber(s) {
  if (typeof s === "number") return s;
  if (typeof s !== "string" || s.trim() === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** URL parts, tolerant of strings that are not URLs (host "" and the raw text as the path). */
export function urlHost(u) {
  try { return new URL(u).host; } catch { return ""; }
}
export function urlPath(u) {
  try { return new URL(u).pathname; } catch { return ""; }
}

// ---- output: synchronous writes, so an exit right after never truncates piped output ----
function writeAll(fd, s) {
  const buf = Buffer.from(s, "utf8");
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      if (e.code !== "EAGAIN") throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);   // pipe full: wait, retry
    }
  }
}
export const print = (...args) => writeAll(1, args.join(" ") + "\n");
export const eprint = (...args) => writeAll(2, args.join(" ") + "\n");
export const writeOut = (s) => writeAll(1, s);

/** Ends a CLI run: the message goes to stderr (stdout for code 0) and the process exits with `code`. */
export class Exit extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}
export const die = (msg) => { throw new Exit(msg); };

/** Run a CLI main: an Exit prints its message and sets its code; anything else propagates (exit 1). */
export async function runMain(main) {
  try {
    const rc = await main();
    if (typeof rc === "number") process.exitCode = rc;
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    if (e.message) writeAll(e.code === 0 ? 1 : 2, e.message + "\n");
    process.exitCode = e.code;
  }
}

/** True when this module file is the script node was asked to run. */
export function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

/** Today's local date, YYYY-MM-DD. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Run a program, capturing its output: { code, stdout, stderr } (Buffers). Throws when the program is
 * missing or the timeout (seconds) expires. */
export function run(cmd, args, { timeout = null } = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 2 ** 31 - 1, timeout: timeout ? timeout * 1000 : undefined });
  if (r.error) throw new Error(r.error.code === "ETIMEDOUT" ? `${cmd} timed out after ${timeout}s` : `${cmd}: ${r.error.message}`);
  return { code: r.status ?? r.signal, stdout: r.stdout, stderr: r.stderr };
}

/** Files matching a pattern whose last segment may hold * and ? (the directory part is literal);
 * a pattern without wildcards is returned as is when the file exists. Sorted. */
export function expandGlob(pattern) {
  const slash = pattern.lastIndexOf("/");
  const dir = slash >= 0 ? pattern.slice(0, slash) || "/" : ".", base = pattern.slice(slash + 1);
  if (!/[*?]/.test(base)) return existsSync(pattern) ? [pattern] : [];
  const re = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  let names = [];
  try { names = readdirSync(dir); } catch { /* no such directory */ }
  return names.filter((n) => re.test(n) && (base.startsWith(".") || !n.startsWith("."))).sort()
    .map((n) => (slash >= 0 ? `${pattern.slice(0, slash + 1)}${n}` : n));
}
