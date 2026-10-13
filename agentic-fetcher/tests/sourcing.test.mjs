// Source acquisition: install_source (fetched file -> raw archive + cleaned core + MANIFEST + corpus
// doc, deduped) and fetch_request (the file-locked human-fetch queue). Plus the chained loop:
// install a source, then ground a node's reference against the freshly-extracted core.
//
// Two-root model: the source cache (MANIFEST/cores/queue/tier files) and the identity registry live
// under GROUNDING_SOURCES; the corpus lives under FORECASTER_DATA.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readCsvFile } from "../lib/csv.mjs";
import { runTool, twoRoots } from "./helpers.mjs";

const HTML = "<!doctype html><html><head><title>Acme Pricing</title><style>.x{color:red}</style></head>" +
  "<body><h1>Acme Pricing</h1><p>The Pro plan is $49 per month.</p>" +
  "<script>var a=1;</script><p>Gross margin was 82% in FY2025.</p></body></html>";

/** Separate grounding (source cache + identity registry) and project (corpus) roots. */
function roots() {
  const r = twoRoots();
  writeFileSync(join(r.gs, "documents.json"), "{}");     // the shared source-identity registry
  return r;
}
const docId = (text) => "doc_" + createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
const queue = (gs) => readFileSync(join(gs, "fetch-queue.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const MANIFEST_ACME = "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\n" +
  "x,manual,acme.com,Acme,https://acme.com/p,html,1,1,deadbeef,manual/acme.html,x,cited\n";

test("install extracts a clean core and registers it", async () => {
  const { tmp, gs, env } = roots();
  const src = join(tmp, "page.html"); writeFileSync(src, HTML);
  const r = await runTool("install_source.mjs", [src, "--url", "https://acme.com/pricing", "--title", "Acme Pricing"], env);
  assert.equal(r.code, 0, r.stderr);
  const id = docId(HTML);
  const core = readFileSync(join(gs, "cores", `${id}.txt`), "utf8");
  assert.ok(core.includes("The Pro plan is $49 per month."));
  assert.ok(!core.includes("var a=1") && !core.includes("color:red"));   // script/style stripped
  const docs = JSON.parse(readFileSync(join(gs, "documents.json"), "utf8"));   // identity registered in the shared cache
  assert.ok(id in docs);
  assert.equal(docs[id].publisher, "acme.com");
  assert.ok(readCsvFile(join(gs, "MANIFEST.csv")).some((row) => row.sha256.startsWith(id.slice(4))));
});

test("install dedupes identical bytes", async () => {
  const { tmp, gs, env } = roots();
  const src = join(tmp, "page.html"); writeFileSync(src, HTML);
  await runTool("install_source.mjs", [src, "--url", "https://acme.com/pricing", "--title", "Acme"], env);
  const r2 = await runTool("install_source.mjs", [src, "--url", "https://acme.com/pricing", "--title", "Acme"], env);
  assert.ok(r2.stdout.includes("already archived"));
  assert.equal(readCsvFile(join(gs, "MANIFEST.csv")).length, 1, "duplicate manifest row written");
});

test("install never overwrites a different source with a colliding slug", async () => {
  // Long titles differing only past the slug cutoff ("… (page 2)" / "… (page 3)") once collided
  // and the second install silently overwrote the first's raw bytes.
  const { tmp, gs, env } = roots();
  const stem = "Top Artificial Intelligence Companies in Portugal Oct 2026 Rankings";
  const stored = [];
  for (const n of [2, 3]) {
    const html = HTML.replace("$49", `$${n}9`);
    const src = join(tmp, `p${n}.html`); writeFileSync(src, html);
    const r = await runTool("install_source.mjs", [src, "--url", `https://acme.com/list?page=${n}`, "--title", `${stem} (page ${n})`], env);
    assert.equal(r.code, 0, r.stderr);
    const row = readCsvFile(join(gs, "MANIFEST.csv")).find((x) => x.sha256.startsWith(docId(html).slice(4)));
    stored.push(row.stored);
    assert.equal(readFileSync(join(gs, row.stored), "utf8"), html);
  }
  assert.notEqual(stored[0], stored[1]);
  assert.equal(readFileSync(join(gs, stored[0]), "utf8"), HTML.replace("$49", "$29"));   // page 2 survives page 3's install
});

test("install a plain-text source", async () => {
  const { tmp, gs, env } = roots();
  const text = "Median seat price is $30 per month across the sample.\n";
  const src = join(tmp, "note.txt"); writeFileSync(src, text);
  const r = await runTool("install_source.mjs", [src, "--url", "https://x.com/n", "--title", "Note"], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(readFileSync(join(gs, "cores", `${docId(text)}.txt`), "utf8").includes("Median seat price is $30"));
});

test("fetch queue: add, list, resolve", async () => {
  const { env } = roots();
  await runTool("fetch_request.mjs", ["add", "--url", "https://ashbyhq.com/report", "--why", "JS-rendered",
    "--for", "habit-app::acceptance_rate", "--priority", "top"], env);
  const out = (await runTool("fetch_request.mjs", ["list"], env)).stdout;
  assert.ok(out.includes("1 pending") && out.includes("ashbyhq.com/report"));
  await runTool("fetch_request.mjs", ["resolve", "--url", "https://ashbyhq.com/report"], env);
  assert.ok((await runTool("fetch_request.mjs", ["list"], env)).stdout.includes("0 pending"));
});

test("fetch queue merges the same URL", async () => {
  const { gs, env } = roots();
  await runTool("fetch_request.mjs", ["add", "--url", "https://x.com/r", "--for", "a::b", "--why", "reason one"], env);
  await runTool("fetch_request.mjs", ["add", "--url", "https://x.com/r/", "--for", "c::d", "--why", "reason two"], env);   // trailing slash
  const q = queue(gs);
  assert.equal(q.length, 1, "same URL should merge, not duplicate");
  assert.deepEqual(new Set(q[0].for), new Set(["a::b", "c::d"]));
});

test("install auto-resolves a matching request", async () => {
  const { tmp, gs, env } = roots();
  await runTool("fetch_request.mjs", ["add", "--url", "https://acme.com/pricing", "--for", "acme::price", "--priority", "top"], env);
  const src = join(tmp, "page.html"); writeFileSync(src, HTML);
  await runTool("install_source.mjs", [src, "--url", "https://acme.com/pricing", "--title", "Acme"], env);
  assert.equal(queue(gs)[0].status, "resolved");
});

test("an installed core is quote-verifiable", async () => {
  // The whole point: after install, add_observation can quote-verify against the new core.
  const { tmp, env } = roots();
  const src = join(tmp, "page.html"); writeFileSync(src, HTML);
  await runTool("install_source.mjs", [src, "--url", "https://acme.com/pricing", "--title", "Acme"], env);
  const r = await runTool("add_observation.mjs", [docId(HTML), "obs_price", "--value", "49", "--unit", "USD/mo",
    "--statement", "Pro plan $49/mo", "--quote", "The Pro plan is $49 per month."], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes("verification=verified"));
});

test("fetch_request check flags already-archived domains", async () => {
  const { gs, env } = roots();
  writeFileSync(join(gs, "MANIFEST.csv"), MANIFEST_ACME);
  await runTool("fetch_request.mjs", ["add", "--url", "https://acme.com/pricing", "--for", "a::b", "--force"], env);   // --force: it IS archived
  await runTool("fetch_request.mjs", ["add", "--url", "https://notarchived.example/x", "--for", "c::d"], env);
  const out = (await runTool("fetch_request.mjs", ["check"], env)).stdout;
  assert.ok(out.includes("POSSIBLE MATCH") && out.includes("acme.com/pricing"));
  assert.ok(out.includes("not in archive") && out.includes("notarchived.example"));
});

test("fetch_request add refuses an already-archived domain", async () => {
  // add must refuse a domain already in the archive (no --force) — never queue a redundant fetch.
  const { gs, env } = roots();
  writeFileSync(join(gs, "MANIFEST.csv"), MANIFEST_ACME);
  const r = await runTool("fetch_request.mjs", ["add", "--url", "https://acme.com/pricing", "--for", "a::b"], env);
  assert.ok(r.stdout.includes("NOT queued"));
  const qp = join(gs, "fetch-queue.jsonl");
  assert.ok(!existsSync(qp) || !readFileSync(qp, "utf8").includes("acme.com"));
});
