// The small libraries in lib/: CSV, order-keeping JSON, HTML tokens + entities, xlsx text, arguments.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { parse } from "../lib/args.mjs";
import { parseCsv, parseCsvRecords, writeRecord, writerow } from "../lib/csv.mjs";
import { tokens, unescape } from "../lib/html.mjs";
import { dumps, loads } from "../lib/json.mjs";
import { Exit, roundHalfEven } from "../lib/util.mjs";
import { NotAZip, xlsxText } from "../lib/xlsx.mjs";
import { tmpPath } from "./helpers.mjs";

test("csv: quoted fields, doubled quotes, embedded newlines, blank lines", () => {
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n\r\n"x\ny",z\n'), [["a", "b,c", 'd"e'], ["x\ny", "z"]]);
  assert.deepEqual(parseCsvRecords("h1,h2\n1\n1,2\n"), [{ h1: "1", h2: null }, { h1: "1", h2: "2" }]);
});

test("csv writer keeps MANIFEST's format: minimal quoting, \\r\\n rows", () => {
  assert.equal(writerow(["a", "b c", 'q"', "x,y", "l\nm", null, 1]), 'a,b c,"q""","x,y","l\nm",,1\r\n');
  assert.equal(writerow([""]), '""\r\n');
  assert.throws(() => writeRecord(["a"], { b: 1 }), /not in the header: b/);
});

test("json keeps the file's key order, including integer-like keys", () => {
  const text = '{"b": 1, "2024": {"z": 1, "2019": 2, "a": 3}, "a": [1.5, null, true]}';
  const v = loads(text);
  assert.equal(dumps(v), text);
  assert.deepEqual(Object.values(v[Object.keys(v)[1]]), [1, 2, 3]);   // insertion order, not JS order
  assert.equal(dumps({ b: 1, a: { d: 1, c: 2 } }, { sortKeys: true }), '{"a": {"c": 2, "d": 1}, "b": 1}');
  assert.equal(dumps(loads('{"x": [1, 2]}'), { indent: 1 }), '{\n "x": [\n  1,\n  2\n ]\n}');
  assert.throws(() => loads("{bad}"), SyntaxError);
});

test("unescape follows the HTML5 rules", () => {
  assert.equal(unescape("a &amp; b &lt;c&gt; &copy &notit; &#65;&#x42; &#0; &#x110000;"), "a & b <c> © ¬it; AB � �");
});

test("html tokens: tags, attributes, raw script text, comments skipped", () => {
  const t = [...tokens('<!doctype html><P class="x" id=y>Hi &amp; bye<br/><!-- c --><script>if (a<b) x()</script></p>')];
  assert.deepEqual(t, [
    { type: "start", tag: "p", attrs: [["class", "x"], ["id", "y"]], selfClosing: false },
    { type: "data", text: "Hi & bye" },
    { type: "start", tag: "br", attrs: [], selfClosing: true },
    { type: "start", tag: "script", attrs: [], selfClosing: false },
    { type: "data", text: "if (a<b) x()" },
    { type: "end", tag: "script" },
    { type: "end", tag: "p" },
  ]);
  assert.deepEqual([...tokens("1 < 2 <b")], [{ type: "data", text: "1 " }, { type: "data", text: "<" }, { type: "data", text: " 2 " }]);
});

/** A zip of { name: text } with deflated members. */
function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc32(raw), 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(raw), 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, data); central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

test("xlsx text: shared strings, inline values, sheet order", () => {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const path = join(tmpPath(), "w.xlsx");
  writeFileSync(path, zip({
    "xl/sharedStrings.xml": `<sst ${ns}><si><t>Plan</t></si><si><r><t>Pro</t></r><r><t xml:space="preserve"> &amp; Team</t></r></si></sst>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${ns}><sheetData><row><c t="s"><v>0</v></c><c><v>49</v></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${ns}><sheetData><row><c t="s"><v>1</v></c><c/></row><row/></sheetData></worksheet>`,
  }));
  assert.equal(xlsxText(path), "----- xl/worksheets/sheet1.xml -----\nPro & Team\n----- xl/worksheets/sheet2.xml -----\nPlan\t49");
  const html = join(tmpPath(), "x.xlsx");
  writeFileSync(html, "<html>not a zip</html>");
  assert.throws(() => xlsxText(html), NotAZip);
});

test("args: options, numbers, choices, required, repeatable, positionals, -h", () => {
  const spec = { prog: "t.mjs", positionals: ["id", "rest*"], options: {
    n: { number: true }, k: { choices: ["a", "b"], default: "a" }, req: { required: true },
    for: { multiple: true, dest: "for_nodes" }, flag: { flag: true } } };
  assert.deepEqual(parse(["x", "--req", "r", "--n", "2.5", "--for", "p", "--for", "q", "y", "z"], spec),
    { n: 2.5, k: "a", req: "r", for_nodes: ["p", "q"], flag: false, id: "x", rest: ["y", "z"] });
  const code = (argv) => { try { parse(argv, spec); return 0; } catch (e) { assert.ok(e instanceof Exit); return e.code; } };
  assert.equal(code(["x"]), 2);                            // --req missing
  assert.equal(code(["x", "--req", "r", "--n", "abc"]), 2);
  assert.equal(code(["x", "--req", "r", "--k", "c"]), 2);
  assert.equal(code(["x", "--req", "r", "--bogus"]), 2);
  assert.equal(code(["-h"]), 0);
});

test("roundHalfEven breaks exact binary ties to even", () => {
  assert.equal(roundHalfEven(0.0078125, 6), 0.007812);   // exactly halfway: toFixed would give 0.007813
  assert.equal(roundHalfEven(2.5, 0), 2);
  assert.equal(roundHalfEven(1.23456789, 6), 1.234568);
  assert.equal(roundHalfEven(-2.5, 0), -2);
});
