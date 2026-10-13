// The cell text of an .xlsx workbook, for a searchable core: shared strings + every sheet's cell values.
// A minimal zip reader (central directory; stored or deflated members) and regex extraction of the
// few SpreadsheetML elements needed — no general XML parser.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export class NotAZip extends Error {}

/** zip member name → () => Buffer. Throws NotAZip when the file has no end-of-central-directory record. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new NotAZip("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const members = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    members.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip compression method ${method} is not supported`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

const ENT = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };
/** XML text content: CDATA kept, the five predefined entities and numeric references decoded. */
const xmlText = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|apos|quot);/g, (_m, cdata, e) =>
    cdata ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]))
  .replace(/\r\n?/g, "\n");
const T = "(?:[\\w.-]+:)?";                                  // an optional namespace prefix

/** The workbook's text: "----- xl/worksheets/sheetN.xml -----", then one tab-joined line per row. */
export function xlsxText(path) {
  const zip = readZip(readFileSync(path));
  const shared = [];
  if (zip.has("xl/sharedStrings.xml")) {
    const xml = zip.get("xl/sharedStrings.xml")().toString("utf8");
    for (const [, si] of xml.matchAll(new RegExp(`<${T}si\\b[^>]*>([\\s\\S]*?)</${T}si>`, "g"))) {
      const ts = [...si.matchAll(new RegExp(`<${T}t\\b[^>]*?(?:/>|>([\\s\\S]*?)</${T}t>)`, "g"))];
      shared.push(ts.map((t) => xmlText(t[1] ?? "")).join(""));
    }
  }
  const out = [];
  const sheets = [...zip.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  for (const name of sheets) {
    out.push(`----- ${name} -----`);
    const xml = zip.get(name)().toString("utf8");
    for (const [, row] of xml.matchAll(new RegExp(`<${T}row\\b[^>]*?(?:/>|>([\\s\\S]*?)</${T}row>)`, "g"))) {
      const cells = [];
      for (const [, attrs, body] of (row || "").matchAll(new RegExp(`<${T}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${T}c>)`, "g"))) {
        const v = /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(body || "");
        if (!v) continue;
        const text = xmlText(v[1]);
        if (/\bt\s*=\s*["']s["']/.test(attrs)) cells.push(shared[Number(text)] ?? text);
        else cells.push(text);
      }
      if (cells.length) out.push(cells.join("\t"));
    }
  }
  return out.join("\n");
}
