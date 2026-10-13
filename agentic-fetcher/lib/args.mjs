// Command-line parsing for the tools: node:util parseArgs plus required options, choices, positionals,
// and a generated usage / -h text. A usage error prints the usage line and the error to stderr and
// exits 2; -h / --help prints the help to stdout and exits 0.
//
//   const a = parse(argv, {
//     prog: "add_observation.mjs",
//     description: "Add an observation to the shared corpus.",
//     positionals: ["doc_id", "obs_id"],                       // "name?" = optional
//     options: {
//       statement: { required: true, help: "…" },
//       value: { number: true },                               // converted with toNumber()
//       for: { multiple: true, dest: "for_nodes" },
//       priority: { choices: ["top", "high"], default: "high" },
//       check: { flag: true },
//     },
//   });
import { parseArgs } from "node:util";
import { Exit, toNumber } from "./util.mjs";

const optName = (k) => `--${k}`;
const metavar = (k, o) => (o.flag ? "" : ` ${o.choices ? `{${o.choices.join(",")}}` : (o.dest || k).toUpperCase().replace(/-/g, "_")}`);

/** The one-line usage text for a spec. */
export function usage(spec) {
  const parts = ["[-h]"];
  for (const [k, o] of Object.entries(spec.options || {})) {
    const s = `${optName(k)}${metavar(k, o)}${o.multiple ? " ..." : ""}`;
    parts.push(o.required ? s : `[${s}]`);
  }
  for (const p of spec.positionals || []) {
    parts.push(p.endsWith("?") ? `[${p.slice(0, -1)}]` : p.endsWith("*") ? `[${p.slice(0, -1)} ...]` : p);
  }
  return `usage: ${spec.prog} ${parts.join(" ")}`;
}

/** The -h text for a spec. */
export function help(spec) {
  const out = [usage(spec)];
  if (spec.description) out.push("", spec.description);
  const rows = (spec.positionals || []).map((p) => [p.replace(/[?*]$/, ""), ""]);
  for (const [k, o] of Object.entries(spec.options || {})) {
    const extra = [o.help || "", o.multiple ? "(repeatable)" : "", o.default !== undefined && o.default !== null && o.default !== "" && !o.flag && !o.multiple ? `(default: ${o.default})` : ""];
    rows.push([`${optName(k)}${metavar(k, o)}`, extra.filter(Boolean).join(" ")]);
  }
  rows.unshift(["-h, --help", "show this help and exit"]);
  const w = Math.min(28, Math.max(...rows.map(([a]) => a.length)) + 2);
  out.push("", ...rows.map(([a, b]) => (b ? (a.length + 2 > w ? `  ${a}\n  ${" ".repeat(w)}${b}` : `  ${a.padEnd(w)}${b}`) : `  ${a}`)));
  return out.join("\n");
}

/** Throw the usage error: usage line + message on stderr, exit 2. */
export const usageError = (spec, msg) => { throw new Exit(`${usage(spec)}\n${spec.prog}: error: ${msg}`, 2); };

/** Parse argv by spec → { [dest]: value } (option names with "-" become "_"; positionals by name). */
export function parse(argv, spec) {
  if (argv.includes("-h") || argv.includes("--help")) throw new Exit(help(spec), 0);
  const options = {};
  for (const [k, o] of Object.entries(spec.options || {})) {
    options[k] = { type: o.flag ? "boolean" : "string", ...(o.multiple ? { multiple: true } : {}) };
  }
  let r;
  try {
    r = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (e) {
    usageError(spec, e.message.replace(/\. To specify a positional argument.*$/s, ""));
  }
  const out = {};
  for (const [k, o] of Object.entries(spec.options || {})) {
    const dest = o.dest || k.replace(/-/g, "_");
    let v = r.values[k];
    if (v === undefined) {
      if (o.required) usageError(spec, `the following arguments are required: ${optName(k)}`);
      v = o.flag ? false : o.multiple ? [...(o.default || [])] : (o.default ?? null);
    } else {
      for (const x of [].concat(v)) {
        if (o.choices && !o.choices.includes(x)) usageError(spec, `argument ${optName(k)}: invalid choice: '${x}' (choose from ${o.choices.join(", ")})`);
      }
      if (o.number) {
        const n = toNumber(v);
        if (n === null) usageError(spec, `argument ${optName(k)}: not a number: '${v}'`);
        v = n;
      }
    }
    out[dest] = v;
  }
  const pos = spec.positionals || [];
  const rest = pos.length && pos[pos.length - 1].endsWith("*");      // "name*": all remaining positionals
  const fixed = rest ? pos.slice(0, -1) : pos;
  const need = fixed.filter((p) => !p.endsWith("?")).length;
  if (r.positionals.length < need) usageError(spec, `the following arguments are required: ${fixed.slice(r.positionals.length).filter((p) => !p.endsWith("?")).join(", ")}`);
  if (!rest && r.positionals.length > pos.length) usageError(spec, `unrecognized arguments: ${r.positionals.slice(pos.length).join(" ")}`);
  fixed.forEach((p, i) => {
    const name = p.replace(/\?$/, "");
    out[name] = r.positionals[i] ?? null;
    if (spec.choices?.[name] && out[name] !== null && !spec.choices[name].includes(out[name])) {
      usageError(spec, `argument ${name}: invalid choice: '${out[name]}' (choose from ${spec.choices[name].join(", ")})`);
    }
  });
  if (rest) out[pos[pos.length - 1].slice(0, -1)] = r.positionals.slice(fixed.length);
  return out;
}
