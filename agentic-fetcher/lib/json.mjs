// JSON that keeps the key order of the file.
//
// JSON.parse lists integer-like keys ("2019") before all others, so a read-modify-write would reorder
// them, and `Object.values(measure.points)` (make_derivative --records-from) would take its inputs in
// a different order than they were given. loads() therefore carries such keys with a marker prefix
// (KEY_MARK), which keeps insertion order; dumps() strips it again. Code that looks up a key that may
// be integer-like goes through markKey(); printing goes through unmarkKey() / dumps().
import { readFileSync } from "node:fs";

export const KEY_MARK = "\u0000\u0001";
export const unmarkKey = (k) => (k.startsWith(KEY_MARK) ? k.slice(KEY_MARK.length) : k);
export const markKey = (k) => (/^(?:0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1 ? KEY_MARK + k : k);

const NUM = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;
const WS = /[ \t\n\r]*/y;

/** JSON.parse with the file's key order kept (see above). */
export function loads(s) {
  let i = 0;
  const ws = () => { WS.lastIndex = i; WS.exec(s); i = WS.lastIndex; };
  const fail = (what) => { throw new SyntaxError(`invalid JSON: ${what} at position ${i}`); };
  const str = () => {
    const start = i;
    for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++;
    if (i >= s.length) fail("unterminated string");
    i++;
    return JSON.parse(s.slice(start, i));
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '"') return str();
    if (c === "{") {
      i++;
      const obj = {};
      ws();
      if (s[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail("expected a property name");
        const k = markKey(str());
        ws();
        if (s[i++] !== ":") fail("expected ':'");
        Object.defineProperty(obj, k, { value: value(), enumerable: true, writable: true, configurable: true });
        ws();
        if (s[i] === "}") { i++; return obj; }
        if (s[i++] !== ",") fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr = [];
      ws();
      if (s[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        if (s[i] === "]") { i++; return arr; }
        if (s[i++] !== ",") fail("expected ',' or ']'");
      }
    }
    for (const [lit, v] of [["null", null], ["true", true], ["false", false]]) {
      if (s.startsWith(lit, i)) { i += lit.length; return v; }
    }
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m) fail("expected a value");
    i = NUM.lastIndex;
    return Number(m[0]);
  };
  const v = value();
  ws();
  if (i !== s.length) fail("unexpected data after the value");
  return v;
}

/** loads() of a utf-8 file. */
export const load = (path) => loads(readFileSync(path, "utf8"));

const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);

/** JSON text: `indent` spaces per level (none: compact), keys sorted when `sortKeys`; markers stripped.
 * Compact output uses ", " and ": " separators (the format derivative ids have always hashed). */
export function dumps(value, { indent = null, sortKeys = false } = {}) {
  const v = sortKeys ? sortDeep(value) : value;
  let text;
  if (indent !== null) text = JSON.stringify(v, null, indent);
  else {
    const enc = (x) => (Array.isArray(x) ? `[${x.map(enc).join(", ")}]`
      : x && typeof x === "object" ? `{${Object.keys(x).map((k) => `${JSON.stringify(k)}: ${enc(x[k])}`).join(", ")}}`
      : JSON.stringify(x) ?? "null");
    text = enc(v);
  }
  return text.replaceAll('"\\u0000\\u0001', '"');
}
