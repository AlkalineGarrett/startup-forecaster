// `node --test tests/` entry point. Node ≥ 21 treats a --test argument as a file or glob, not a
// directory, so a bare `tests/` resolves to this index, which loads every *.test.mjs beside it into
// one test run. (`node --test` with no argument also works: its default glob finds the same files.)
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((n) => n.endsWith(".test.mjs")).sort()) await import(`./${f}`);
