// The renderer on a portfolio unlike the user's (test/fixtures/portable): a 3-year horizon, EUR reporting with a
// USD venture, a flat 21% business tax and hidden nodes. The year views follow the horizon, each venture shows
// its own currency, cross-venture views show the reporting currency, and hidden nodes never reach the page.
// (Own file: node --test runs each file in its own process, so these portfolio settings can't leak.)
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.MC_CONFIG = join(HERE, "fixtures", "portable", "portfolio.config.mjs");
process.env.MC_CACHE_DIR = mkdtempSync(join(tmpdir(), "renderer-portable-"));
process.env.MC_N ??= "400";

const { loadPortfolio } = await import("../../montecarlo-engine/portfolio-loader.mjs");
await loadPortfolio();
const ac = await import("../src/appcore.ts");
const { HORIZON_YEARS } = await import("../../montecarlo-engine/src/types.ts");
ac.initAppcore();
await ac.computePairwiseAsync();

const yearHeads = (html: string): string[] => [...new Set(html.match(/Year \d+/g) || [])].sort();

test("the fixture runs on a 3-year horizon", () => assert.equal(HORIZON_YEARS, 3));

test("a venture's year chart and income statement follow the horizon", () => {
  const html = ac.panelHTML("alpha");
  assert.deepEqual(yearHeads(html), ["Year 1", "Year 2", "Year 3"]);
  assert.match(html, /class="ycsvg"/, "the year chart renders");
  assert.match(html, /data-icline="revenue"/, "the income statement renders");
  assert.match(html, /colspan="4"/, "notes span the line label + 3 years");
});

test("the tax note states the configured 21% rate", () => {
  const html = ac.panelHTML("alpha");
  assert.match(html, /Business tax at 21% of <b>pre-tax profit<\/b>/);
  assert.doesNotMatch(html, /≈ 25%/);
});

test("hidden nodes reach neither node cards, the graph nor the driver bars", () => {
  for (const id of ["alpha", "beta"]) assert.doesNotMatch(ac.panelHTML(id), /Secret knob/, id);
  ac.selectVariant("beta", "lean");
  assert.doesNotMatch(ac.panelHTML("beta"), /Secret knob/, "variant body");
  ac.selectVariant("beta", "compare");
});

test("a venture shows its own currency; its thresholds are converted", () => {
  const beta = ac.panelHTML("beta").replace(/<svg class="strip"[\s\S]*?<\/svg>/g, ""); // minus the shared (€) spread axis
  assert.doesNotMatch(beta, /€/, "the USD venture's panel is in $");
  assert.match(beta, /\$\d/);
  ac.selectVariant("beta", "generic");
  const base = ac.panelHTML("beta");
  assert.match(base, /P\(meaningful · ≥ \$8k\/yr\)/, "€4k threshold at 0.5 → $8k");
  assert.match(base, /P\(&lt; \$20k\/yr\)/, "€10k floor → $20k");
  ac.selectVariant("beta", "compare");
  assert.match(ac.panelHTML("beta"), />Base</, "an unnamed base unit is called Base");
});

test("the Overview's shared axis, chart and thresholds are in the reporting currency", () => {
  const ov = ac.overviewHTML();
  assert.match(ov, /P\(≥ €4k\/yr\)/);
  const axis = ov.match(/<svg class="strip" width="\d+" height="16"[\s\S]*?<\/svg>/)![0];
  assert.match(axis, /€/);
  assert.doesNotMatch(axis, /\$/);
  const chart = ov.match(/<svg class="mlchart[\s\S]*?<\/svg>/)![0];
  assert.doesNotMatch(chart, /\$/, "the year-over-year chart is one axis, in €");
  assert.deepEqual(yearHeads(chart), ["Year 1", "Year 2", "Year 3"]);
  assert.match(ov, /\$\d/, "the USD venture's own row stays in $");
  assert.doesNotMatch(ov, /⚠/, "no reference p90 configured → no optimism flag");
});

test("Pairwise is in the reporting currency and names no haircut when there is none", () => {
  const pw = ac.pairwiseHTML();
  assert.ok(pw.length > 0);
  assert.doesNotMatch(pw, /\$/);
  assert.doesNotMatch(pw, /haircut/);
});

test("a configured split-attention haircut is named in the Pairwise heading", async () => {
  const { configurePortfolio } = await import("../../montecarlo-engine/src/portfolio-context.ts");
  configurePortfolio({ pairAttentionOverhead: 0.15 });
  assert.match(ac.pairwiseHTML(), /15% split-attention haircut per pair/);
  configurePortfolio({ pairAttentionOverhead: 0 });
});

test("empty optional tabs are left out", () => {
  assert.deepEqual(ac.optionalTabs(), { pw: true, gr: false, arch: false });
});

test("the self-contained page boots without Grounding or Archived tabs", async () => {
  const { buildHtml } = await import("../build.mjs");
  const code = buildHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  let tabs = 0, panels = 0;
  const el = (onAppend?: () => void): Record<string, unknown> => ({
    innerHTML: "", textContent: "", dataset: {}, style: {}, className: "",
    classList: { toggle() {}, add() {}, remove() {} }, appendChild() { onAppend?.(); },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, setAttribute() {}, getAttribute: () => null, closest: () => null,
  });
  const tabbar = el(() => tabs++), panelsEl = el(() => panels++);
  const document = {
    getElementById: (id: string) => (id === "tabbar" ? tabbar : id === "panels" ? panelsEl : el()),
    createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    documentElement: { style: { setProperty() {} } },
  };
  const sandbox = { __MC_N: 200, document, window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.equal(tabs, 2 + 2, "Overview + Pairwise + one per venture");
  assert.equal(panels, 2 + 2);
});
