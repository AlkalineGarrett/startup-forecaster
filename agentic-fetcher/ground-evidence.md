# Step `ground-evidence`: find, archive and record the evidence for a venture's nodes

> **Required reading before this step's first action:** this whole file. They are part of the step, not
> background: nodes researched without it have not been grounded.

**Input:** the nodes to research: by default the venture's top drivers, in the order `npx startup-forecaster status
<id>` ranks them (its `driver` column is each node's influence on the outcome), or the nodes the request
names. For a venture made with `npx startup-forecaster new`, `dossiers/<id>/research-brief.md` (in the config's
`dossiers` folder, `dossiers/` by default) says what evidence
would ground each node; otherwise each node's `model_definition` and the venture's dossier say what it
measures.

**Done when:** each node has observations from **at least three independent sources** whose quotes verify
against archived cores, or a stated shortfall (principle 5); every figure that is still missing is queued
with its gap recorded as `missing_document`. New observations are stamped `unaudited`.

**Next:** `audit-evidence` (`audit-evidence.md`) for everything this step recorded, before any distribution is
built on it.

The goal for every figure is a **quote-verifiable** fact: an observation whose `--quote` matches the
document's core.

> **Step 1 is an invariant, not advice.** Never fetch or queue a URL that is already archived: check it
> against `documents.json`, `url-aliases.csv` and `MANIFEST.csv` first (`npx startup-forecaster fetch-request add`
> refuses a page that is already archived).

## Principles (binding)

**1. Never send the human to fetch something an agent could have fetched.** Always search the
archive first (step 1) — the page is often already on disk under a redirected/canonical URL. If it
isn't, the agent that needs it finds and fetches it (steps 2–3a). Subagents and the main session have
the same web tools: a web search finds a page, and `curl` (or `npx startup-forecaster install-source --url`) gets its
bytes. A web-fetch tool only returns a model's reading of the page, not the bytes, so it can confirm a
figure but can't archive one. The writers are file-locked, so parallel agents can install sources safely; still
search the archive first so ten agents don't each fetch the same pricing page. A fetch that fails for
one agent (a site this machine can't resolve, a 403 to curl) goes to the `agent_fetchable` lane for a
retry, never straight to the human. The human queue (step 3b) is the *last* resort, reserved for pages **no** agent can reach (paywalled,
login/VPN-walled, JS-rendered, portal PDFs) — never a stand-in for "the agent that needed it couldn't
retrieve it."

**2. Never quietly do without a source that would help.** If a real figure sits behind a wall no
agent can pass, **queue it for the human** — do not paper over the gap by guessing, inventing a
plausible number, or substituting a weaker proxy source and calling it grounded. We want the best
grounded source that exists, even at the cost of a human round-trip. Under-queuing (shipping a guess
to avoid asking) is as much a failure as over-queuing (asking for what an agent could fetch). When a
needed source is genuinely unreachable, ground on the honest best-available and record the debt
(`missing_document`) so the gap is visible, not hidden.

**3. Never drive an automated browser to fetch a source — a live browser is a HUMAN fetch.** Agent
retrieval is limited to `curl` and the agent's web-fetch tool (steps 2–3a). The moment a page needs a *rendered*
browser (JS-gated content, anti-bot walls, login/portal, or the raw bytes only render client-side),
do **not** reach for browser automation. Many sites fingerprint automated interaction — mouse
movement, timing, headless signals — and can flag or block the **user's own browser or account**,
which is a cost far larger than any single source. So a page that needs a live browser is a
`human_only` queue item (step 3b): the human fetches it by hand in their normal browser and hands the
file/URL back for `npx startup-forecaster install-source`. Flip an `agent_fetchable` request that only fails because
it needs rendering to `human_only` with `npx startup-forecaster fetch-request defer` — it is unreachable *by an
agent*, even though a human browser can reach it.

**4. Record figures exactly.** A figure is recorded with a quote copied verbatim from the archived core,
in the source's own unit, population and period. Never round, convert or paraphrase it into a stronger
claim; a conversion is a derivative (`npx startup-forecaster make-derivative`), not an edit. A price on the
vendor's own site needs no second source.

**5. Aim for three independent sources per node; more is better.** A node is grounded on at least three
sources that are independent of each other: different publishers, and not reprints or summaries of the same
underlying survey or dataset (those count once). Three is a floor to aim for, not a cap; more only helps.
Principle 4's vendor rule still holds: one vendor's price needs only its own page, but a node about a market
quantity (typical price, churn, conversion) counts each vendor or study as one source toward the three.
When fewer than three turn up, try harder within reason before settling: rephrase the searches, look for
other kinds of source (filings, government statistics, industry benchmarks, academic studies, competitors'
own pages), check the archive for adjacent sources, and queue gated ones for the person. Stop when further
effort is out of proportion to the node's influence on the outcome (a top driver earns more effort than a
minor node). Then state the shortfall: how many independent sources were found, what was tried, and why it
stopped. `build-distributions` carries that into the node's `reasoning`, and its `support_score` reflects
the count.

## Procedure: the sourcing ladder

Work through the nodes in the order of the input. For each figure a node needs, climb the ladder and stop
at the first rung that works.

### 1. Search what we already have — don't refetch

```
npx startup-forecaster search "net revenue retention"      # phrase; falls back to any-of-words
npx startup-forecaster search "\\b3[0-9]% churn"           # a real regex (has metachars) → used as-is
```

A query with regex metacharacters is a **JavaScript** regular expression, matched with the `i` and `u`
flags: `\w`, `\b` and `\d` are ASCII-only (use `\p{L}` / `\p{N}` for any letter or digit), and named
groups are `(?<name>…)`.

Returns one merged record per matching source (title, url, publisher, raw file, core, OCR sidecars,
matching snippets). If the figure is here, ground it directly — the core already exists:

```
npx startup-forecaster add-observation doc_<sha> obs_<id> --value <v> --unit "<u>" \
    --statement "<what it says>" --quote "<verbatim from the core>"
```

### 2. Not in the archive → find it on the web

Use your web search tool to find the primary source (a vendor pricing page, a filing, a benchmark report,
a statistics portal), and your web-fetch tool to read it and confirm the figure. Then get the bytes (3a).

### 3a. You can get the bytes → install it, then ground it

If you can save the raw file — a `curl` download, a PDF you fetched, a page the person saved — install it. This archives the bytes, extracts a lean **core** (HTML stripped to text; a text PDF via
`pdftotext`; a scanned PDF via offline OCR), writes the MANIFEST row, and registers the corpus doc:

```
npx startup-forecaster install-source <saved-file> --url <source-url> --title "<title>"
npx startup-forecaster install-source <saved-file> --url <url> --check     # preview hash/dedupe/core first
npx startup-forecaster install-source --url <url>                          # or let it curl (needs network)
```

It refuses a file it can't read and one whose text comes out empty (a page saved before it rendered, a
blank scan): nothing could be quote-checked against it. A scanned PDF or an image needs OCR (see the
`agentic-fetcher` README). Anything you keep in the archive that is not a source (notes, scratch, a
browser save's `_files/` folder) goes under a name starting with `_`, so `check-sources` doesn't count it as
missing from the manifest.

Then record each figure against the `doc_<sha>` it prints; the quote is checked against the new core and a
quote that isn't in it is rejected:

```
npx startup-forecaster add-observation doc_<sha> obs_<id> --value <v> --unit "<u>" \
    --statement "<what it says>" --quote "<verbatim from the core>"
```

A figure computed from other sources goes through `npx startup-forecaster make-derivative`; a broadly known prior
or a labelled judgement goes through `npx startup-forecaster add-knowledge gk|spec <id> --statement … --reasoning …`.

### 3b. You cannot retrieve the bytes → queue the fetch, and move on

If *you* can't pull the bytes, queue the fetch and record the node as evidence-debt so you can finish
everything else. Which **lane** depends on *why* you can't get it — this is the handoff, so get it right:

```
# Your fetch failed on a normal public page (DNS, a 403 to curl, a timeout) — another fetch may get it.
npx startup-forecaster fetch-request add --url <url> --priority <top|high|med|low> \
    --why "holds offer-acceptance 73/79/84%" --for <project::node>          # lane defaults to agent_fetchable

# The page is genuinely gated — paywall / login / VPN / JS-rendered / portal PDF — no agent can reach it.
npx startup-forecaster fetch-request add --url <url> --lane human_only --priority top \
    --why "login-walled; holds …" --for <project::node>
```
(`--priority` is one of `top` · `high` · `med` · `low` — not `normal`.) **This is your only move for a
source you can't retrieve — do NOT guess a value or substitute a proxy** (principle 2). Queue
it, leave the node's value `reference: null` with a `missing_document: "<what you need and why>"` (the
compiler tracks it as declared evidence-debt, not an error), and move on. The one exception is a number
no external comp could *ever* ground (inherent judgement): record it as a labelled speculation
(`npx startup-forecaster add-knowledge spec …`, saying why no source can exist) instead of queuing it.

### 4. Between phases — drain what agents couldn't fetch

Between the grounding phase and any human handoff, the **main interactive session** works the queue
in three steps:

```
npx startup-forecaster fetch-request check                # 1. flag pending requests already in the archive
npx startup-forecaster fetch-request drain                # 2. the agent_fetchable worklist — fetch + install each
npx startup-forecaster fetch-request export --md          # 3. what's LEFT — only pages no agent could reach
```

1. **Dedupe first** — a source is often archived under a redirected/canonical URL. For each flagged
   request, open the archived core; if the figure is there, `resolve --url <url> --note "already
   archived: doc_… — …"` — don't fetch it again.
2. **Drain the agent-fetchable lane** — for each, `curl` the page and
   `npx startup-forecaster install-source <saved> --url <url>` (auto-resolves the entry). If this retry *also*
   fails, `npx startup-forecaster fetch-request defer --url <url> --note "retry failed: <err>"` moves it to the human
   lane. A follow-up pass then authors the now-available observation and swaps each
   `missing_document` node onto its real `doc_<sha>/obs_<id>` — recompile; the debt is gone.
3. **Hand off the remainder** — `export` now lists only `human_only` requests: the sources no agent
   could reach. That is the human's worklist: give it to them as the closing block of your reply, never
   earlier in it (`AGENTS.md`, "Ending your reply").

#### Pre-fetch beats guess-then-fix
The cheapest ordering is to **pre-fetch before fanning out**: resolve and install the sources a run will need
*first* (a recon pass, or a recon subagent), so the fleet grounds on real observations and never has to guess. For gaps discovered
mid-run, the queue+`drain` above is the recovery path; where your agent can resume a subagent, resume the
one that needed the source once it is installed, so it continues from where it stopped.

The human works that `export` list. If they have a Firecrawl key, one command gets most of it:
`npx startup-forecaster firecrawl` reads the queue and fetches every pending request (`--list` previews; a list file
limits it to those pages). Firecrawl renders each page in its own browser
(so JavaScript pages and most bot walls come back), installs it, and resolves its entry; failures stay in the
queue. It spends the person's Firecrawl credits, so the person runs it; an agent does not. What is left they
save by hand and install with `npx startup-forecaster install-source <file> --url <url>`, which also **auto-resolves**
the matching entry. Then the same follow-up pass authors the observations and clears the
`missing_document` debt.

### When to stop researching

Stop when each of the venture's top drivers has three independent sources, or a stated shortfall
(principle 5), or is explicit, reasoned judgement where no source can exist, and no top driver is still a
placeholder. Any remaining placeholders are named in the venture's brief (`render-forecast`).

---
Every tool resolves its paths from the workspace (`FORECASTER_DATA` / `GROUNDING_SOURCES` override, e.g.
for isolated runs and tests; outside a workspace without them a tool stops with an error). Writers are file-locked — safe for parallel agents.
