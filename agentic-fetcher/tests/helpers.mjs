// Shared test scaffolding: temp roots, running a tool as a separate process, and approximate equality.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** A fresh temp directory. */
export const tmpPath = () => mkdtempSync(join(tmpdir(), "afjs-"));

/** grounding/ (+cores/) and project/ (+corpus/) under a temp dir; returns { tmp, gs, pj, env }. */
export function twoRoots() {
  const tmp = tmpPath(), gs = join(tmp, "grounding"), pj = join(tmp, "project");
  for (const d of [gs, join(gs, "cores"), pj, join(pj, "corpus")]) mkdirSync(d, { recursive: true });
  return { tmp, gs, pj, env: { ...process.env, FORECASTER_DATA: pj, GROUNDING_SOURCES: gs } };
}

/** Run `cmd args…` (in `cwd`, default this process's) → Promise<{ code, stdout, stderr }>. */
export function runProc(cmd, args, env, cwd = undefined) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run one of this port's tools (e.g. "add_observation.mjs") in its own node process. */
export const runTool = (tool, args, env, cwd = undefined) => runProc(process.execPath, [join(REPO, tool), ...args], env, cwd);

/** Approximate equality: relative tolerance 1e-6, absolute 1e-12. */
export const approx = (actual, expected) => Math.abs(actual - expected) <= Math.max(1e-6 * Math.abs(expected), 1e-12);

/** A zip of { name: text } with deflated members. */
export function zip(files) {
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
