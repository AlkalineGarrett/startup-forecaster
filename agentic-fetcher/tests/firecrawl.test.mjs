// The Firecrawl fetcher against a fake Firecrawl API (no network, no credits). The fetch run happens in its
// own process with the temp roots in its environment, so it can never write into a real archive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, runProc, twoRoots } from "./helpers.mjs";
import { urlsFromList } from "../firecrawl_fetch.mjs";

test("reads the export (markdown or csv) and plain URL lists", () => {
  const md = "# Human fetch worklist — 2 source(s) no agent could reach\n\n## [high] https://a.example/x\n- why: see https://other.example/ref\n" +
    "- after saving: `npx forecaster install-source <saved-file> --url https://a.example/x`\n\n## [low] https://b.example/y?id=2\n";
  assert.deepEqual(urlsFromList(md), ["https://a.example/x", "https://b.example/y?id=2"]);
  const csv = 'priority,url,why,unblocks,suggested_filename\nhigh,https://a.example/x,"a, b",p::n,\nlow,https://b.example/y,,,\n';
  assert.deepEqual(urlsFromList(csv), ["https://a.example/x", "https://b.example/y"]);
  assert.deepEqual(urlsFromList("https://a.example/x\nhttps://www.a.example/x/?utm_source=z\n\nnot a url\n"), ["https://a.example/x"]);
});

// Runs main() with a fake fetch: a.example HTML with a title, b.example a PDF as markdown, c.example rate-limited
// once, d.example answered 404 by the site.
const DRIVER = (tool) => `
const reply = (status, body, headers = {}) => ({ status, ok: status < 400, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
let slowCalls = 0;
const fakeFetch = async (_endpoint, init) => {
  const { url } = JSON.parse(init.body);
  if (url.includes("a.example")) return reply(200, { success: true, data: { rawHtml: "<html><body><p>Pro plan is $49 per month.</p></body></html>", metadata: { title: "A Pricing", statusCode: 200 } } });
  if (url.includes("b.example")) return reply(200, { success: true, data: { markdown: "# Report\\n\\nRevenue grew 12% in 2025.", metadata: { statusCode: 200 } } });
  if (url.includes("c.example")) return ++slowCalls === 1 ? reply(429, { success: false, error: "Rate limit exceeded" }, { "retry-after": "0" })
    : reply(200, { success: true, data: { rawHtml: "<html><body><p>The slow page body says 12 seats.</p></body></html>", metadata: { statusCode: 200 } } });
  return reply(200, { success: true, data: { rawHtml: "<html>Not found</html>", metadata: { statusCode: 404 } } });
};
const { main } = await import(${JSON.stringify(tool)});
await main(process.argv.slice(2), { fetchImpl: fakeFetch, wait: async () => {} });
console.log("slowCalls=" + slowCalls);
`;

test("fetches each queued page, archives it, resolves its request, and leaves failures queued", async () => {
  const { tmp, gs, env } = twoRoots();
  writeFileSync(join(gs, "documents.json"), "{}");
  writeFileSync(join(gs, "MANIFEST.csv"), "id,tier,domain,title,url,type,bytes,copies,sha256,stored,origin,status\n" +
    "x,manual,done.example,Done,https://done.example/page,html,1,1,deadbeef,manual/done.html,x,cited\n");
  const queued = ["https://a.example/pricing", "https://b.example/report.pdf", "https://c.example/slow", "https://d.example/gone"];
  writeFileSync(join(gs, "fetch-queue.jsonl"), queued.map((url) =>
    JSON.stringify({ url, why: "test", for: ["p::n"], priority: "med", lane: "human_only", status: "pending" }) + "\n").join(""));
  const list = join(tmp, "list.txt"), driver = join(tmp, "driver.mjs");
  writeFileSync(list, [...queued, "https://done.example/page"].join("\n"));
  writeFileSync(driver, DRIVER(pathToFileURL(join(REPO, "firecrawl_fetch.mjs")).href));

  const r = await runProc(process.execPath, [driver, list], { ...env, FIRECRAWL_API_KEY: "test-key" });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /slowCalls=2/, "a rate-limited page is retried");
  assert.match(r.stdout, /3 installed, 1 failed, 1 already archived/);

  const docs = Object.values(JSON.parse(readFileSync(join(gs, "documents.json"), "utf8")));
  const byUrl = Object.fromEntries(docs.map((d) => [d.url, d]));
  assert.equal(byUrl["https://a.example/pricing"].title, "A Pricing");
  assert.ok(readFileSync(join(gs, byUrl["https://a.example/pricing"].core), "utf8").includes("Pro plan is $49 per month."));
  assert.ok(readFileSync(join(gs, byUrl["https://b.example/report.pdf"].core), "utf8").includes("Revenue grew 12% in 2025."));
  assert.equal(byUrl["https://c.example/slow"].title, "https://c.example/slow", "an untitled page is titled by its URL");
  assert.ok(!byUrl["https://d.example/gone"], "a page the site answered 404 for is not archived");
  assert.ok(!byUrl["https://done.example/page"], "an already-archived page is not fetched again");
  const status = Object.fromEntries(readFileSync(join(gs, "fetch-queue.jsonl"), "utf8").trim().split("\n")
    .map((l) => JSON.parse(l)).map((q) => [q.url, q.status]));
  assert.equal(status["https://a.example/pricing"], "resolved");
  assert.equal(status["https://d.example/gone"], "pending");
});
