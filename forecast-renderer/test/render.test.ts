// The results UI over the engine's fictional example portfolio: the self-contained page builds, the server's
// panels render, and the app core's Pairwise matrix is the engine's computation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "..");
process.env.MC_CONFIG = join(RENDERER, "..", "montecarlo-engine", "examples", "portfolio.config.mjs");
process.env.MC_N ??= "500";

test("the self-contained page builds from the engine and renderer sources", () => {
  const out = join(mkdtempSync(join(tmpdir(), "renderer-")), "page.html");
  execFileSync(process.execPath, [join(RENDERER, "build.mjs")], { env: { ...process.env, MC_OUT: out }, encoding: "utf8" });
  const html = readFileSync(out, "utf8");
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.ok(html.length > 50_000, "the bundle holds the engine, the renderers and the portfolio");
});

test("server-side panels render, and Pairwise is the engine's matrix", async () => {
  const { loadPortfolio } = await import("../../montecarlo-engine/portfolio-loader.mjs");
  await loadPortfolio();
  const ac = await import("../src/appcore.ts");
  const { computePairwise, runPortfolio } = await import("../../montecarlo-engine/src/pairwise.ts");
  ac.initAppcore();
  assert.match(ac.overviewHTML(), /<table/);
  for (const t of ac.tabList()) assert.ok(ac.panelHTML(t.id).length > 0, `${t.id} panel renders`);
  await ac.computePairwiseAsync();
  assert.deepEqual(ac.pairwiseMatrix(), await computePairwise(runPortfolio()));
});
