// Shared test scaffolding: temp roots, running a tool as a separate process, and approximate equality.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** A fresh temp directory. */
export const tmpPath = () => mkdtempSync(join(tmpdir(), "afjs-"));

/** grounding/ (+cores/) and project/ (+corpus/) under a temp dir; returns { tmp, gs, pj, env }. */
export function twoRoots() {
  const tmp = tmpPath(), gs = join(tmp, "grounding"), pj = join(tmp, "project");
  for (const d of [gs, join(gs, "cores"), pj, join(pj, "corpus")]) mkdirSync(d, { recursive: true });
  return { tmp, gs, pj, env: { ...process.env, FORECASTER_DATA: pj, GROUNDING_SOURCES: gs } };
}

/** Run `cmd args…` → Promise<{ code, stdout, stderr }>. */
export function runProc(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run one of this port's tools (e.g. "add_observation.mjs") in its own node process. */
export const runTool = (tool, args, env) => runProc(process.execPath, [join(REPO, tool), ...args], env);

/** Approximate equality: relative tolerance 1e-6, absolute 1e-12. */
export const approx = (actual, expected) => Math.abs(actual - expected) <= Math.max(1e-6 * Math.abs(expected), 1e-12);
