import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
for (const f of files) {
  const t = readFileSync(f, "utf8").replace(/\r\n?/g, "\n");
  const name = f.split("/").pop();
  let bad = 0;
  for (const m of t.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)) {
    const o = (m[1].match(/<span\b/g) || []).length, c = (m[1].match(/<\/span>/g) || []).length;
    if (o !== c) bad += 1;
  }
  console.log(`${name}: unbalanced <pre> blocks = ${bad}`);
}

// show a highlight region in the comparison to confirm hl spans survived expansion
const comp = files.filter((f) => f.includes("construction"));
if (comp.length) {
  const t = readFileSync(comp[0], "utf8").replace(/\r\n?/g, "\n");
  const i = t.indexOf('"p10": 1790');
  if (i > 0) {
    console.log("--- hl region (comparison) ---");
    console.log(t.slice(Math.max(0, i - 120), i + 80));
  }
}
