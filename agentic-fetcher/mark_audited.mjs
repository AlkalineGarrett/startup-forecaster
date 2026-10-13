#!/usr/bin/env node
// Mark documents / observations `"audit": "verified"` — ONLY the ones an audit passed (AUDIT.md).
//
//     node mark_audited.mjs --pass-list build/audit/verdicts_*.json   # verdict files
//     node mark_audited.mjs --obs doc_x/obs_y --obs doc_z/obs_w        # explicit obs
//     node mark_audited.mjs --doc doc_x --doc doc_y                     # explicit docs
//
// A verdict file is a JSON array; an element with verdict `legit` (observation) or `ok` (document) is
// marked verified. Any other verdict is left as-is (fix it first, then re-run). Stamps `audit_date`.
// File-locked (lib/lock.mjs). Two-root model: observations are
// the flat map under PROJECT (corpus/observations.json); document identity is the shared registry under
// GROUNDING (documents.json).
import { existsSync, readFileSync } from "node:fs";
import { ROOTS } from "./paths.mjs";
import { parse } from "./lib/args.mjs";
import { dumps, load, loads, markKey } from "./lib/json.mjs";
import { rewrite, withLock } from "./lib/lock.mjs";
import { expandGlob, isMain, print, runMain, today } from "./lib/util.mjs";

export const TODAY = today();

/** Set audit=verified+date on each key present in the JSON dict at path. Returns count. File-locked. */
async function mark(path, keys) {
  if (!keys.size || !existsSync(path)) return 0;
  return withLock(path, () => {
    const data = loads(readFileSync(path, "utf8"));
    let n = 0;
    for (const k of keys) {
      const mk = markKey(k);
      const e = Object.hasOwn(data, mk) ? data[mk] : null;
      if (e !== null) {
        e.audit = "verified";
        e.audit_date = TODAY;
        n++;
      }
    }
    rewrite(path, dumps(data, { indent: 1 }) + "\n");
    return n;
  });
}

export async function main() {
  const { PROJECT, GROUNDING } = ROOTS;
  const a = parse(process.argv.slice(2), {
    prog: "mark_audited.mjs",
    description: "Mark observations / documents audit=verified (only those an audit passed). Verdict files " +
      "may follow --pass-list or be given as further arguments (a shell-expanded glob).",
    positionals: ["verdicts*"],
    options: {
      "pass-list": { multiple: true, help: "a verdict JSON file or glob" },
      obs: { multiple: true, help: "doc_<sha>/obs_<id> to verify" },
      doc: { multiple: true, help: "doc_<sha> to verify" },
    },
  });

  const obsOk = new Set(a.obs), docOk = new Set(a.doc);
  for (const pat of [...a.pass_list, ...a.verdicts]) {
    for (const f of expandGlob(pat)) {
      for (const v of load(f)) {
        if (v.verdict === "legit" && v.obs) obsOk.add(`${v.doc}/${v.obs}`);
        else if (v.verdict === "ok" && v.doc && !v.obs) docOk.add(v.doc);
      }
    }
  }

  // observations → the flat map under PROJECT (key is the bare obs id)
  const obsKeys = new Set([...obsOk].map((ref) => (ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref)));
  const no = await mark(`${PROJECT}/corpus/observations.json`, obsKeys);
  // documents → the identity registry under GROUNDING
  const nd = await mark(`${GROUNDING}/documents.json`, docOk);
  print(`marked verified: ${no} observation(s), ${nd} document(s)  (date ${TODAY})`);
}

if (isMain(import.meta.url)) runMain(main);
