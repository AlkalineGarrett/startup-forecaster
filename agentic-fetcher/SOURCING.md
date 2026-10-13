# Sourcing — how an agent gets a source it needs

You are grounding a node and need a figure. Follow this ladder; stop at the first step that works.
The goal is a **quote-verifiable** fact: an observation whose `--quote` matches the document's core.

> **Step 1 is an invariant, not advice.** A session hook can enforce it: deny any fetch or queue of a URL
> already archived (check it against `documents.json` + `url-aliases.csv` + `MANIFEST.csv`), and inject
> this ladder at session start.

## Two principles that govern the whole ladder

**1. Never send the human to fetch something an agent could have fetched.** Always search the
archive first (step 1) — the page is often already on disk under a redirected/canonical URL. If it
isn't, the agent that needs it finds and fetches it (steps 2–3a). Subagents and the main session have
the same web tools: `WebSearch` finds a page, and `curl` (or `install_source.mjs --url`) gets its bytes.
`WebFetch` only returns a model's reading of the page, not the bytes, so it can confirm a figure but
can't archive one. The writers are file-locked, so parallel agents can install sources safely; still
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
retrieval is limited to `curl` / `WebFetch` (steps 2–3a). The moment a page needs a *rendered*
browser (JS-gated content, anti-bot walls, login/portal, or the raw bytes only render client-side),
do **not** reach for browser automation. Many sites fingerprint automated interaction — mouse
movement, timing, headless signals — and can flag or block the **user's own browser or account**,
which is a cost far larger than any single source. So a page that needs a live browser is a
`human_only` queue item (step 3b): the human fetches it by hand in their normal browser and hands the
file/URL back for `install_source.mjs`. Flip an `agent_fetchable` request that only fails because it
needs rendering to `human_only` with `fetch_request.mjs defer` — it is unreachable *by an agent*, even
though a human browser can reach it.

## 1. Search what we already have — don't refetch

```
node search.mjs "net revenue retention"      # phrase; falls back to any-of-words
node search.mjs "\\b3[0-9]% churn"           # a real regex (has metachars) → used as-is
```

A query with regex metacharacters is a **JavaScript** regular expression, matched with the `i` and `u`
flags: `\w`, `\b` and `\d` are ASCII-only (use `\p{L}` / `\p{N}` for any letter or digit), and named
groups are `(?<name>…)`.

Returns one merged record per matching source (title, url, publisher, raw file, core, OCR sidecars,
matching snippets). If the figure is here, ground it directly — the core already exists:

```
node add_observation.mjs doc_<sha> obs_<id> --value <v> --unit "<u>" \
    --statement "<what it says>" --quote "<verbatim from the core>"
```

## 2. Not in the archive → find it on the web

You have **WebSearch** and **WebFetch**. Search for the primary source (a vendor pricing page, a
10-K, a benchmark report, a statistics portal), then WebFetch to read it and confirm the figure.

## 3a. You can get the bytes → install it, then ground it

If you can save the raw file — a WebFetch you wrote to disk, a `curl`/download, a PDF you fetched —
install it. This archives the bytes, extracts a lean **core** (HTML stripped to text; a text PDF via
`pdftotext`; a scanned PDF via offline OCR), writes the MANIFEST row, and registers the corpus doc:

```
node install_source.mjs <saved-file> --url <source-url> --title "<title>"
node install_source.mjs <saved-file> --url <url> --check     # preview hash/dedupe/core first
node install_source.mjs --url <url>                          # or let it curl (needs network)
```

Then `add_observation` against the `doc_<sha>` it prints — the quote will verify against the new core.

## 3b. You cannot retrieve the bytes → queue the fetch, and move on

If *you* can't pull the bytes, queue the fetch and record the node as evidence-debt so you can finish
everything else. Which **lane** depends on *why* you can't get it — this is the handoff, so get it right:

```
# Your fetch failed on a normal public page (DNS, a 403 to curl, a timeout) — another fetch may get it.
node fetch_request.mjs add --url <url> --priority <top|high|med|low> \
    --why "holds offer-acceptance 73/79/84%" --for <project::node>          # lane defaults to agent_fetchable

# The page is genuinely gated — paywall / login / VPN / JS-rendered / portal PDF — no agent can reach it.
node fetch_request.mjs add --url <url> --lane human_only --priority top \
    --why "login-walled; holds …" --for <project::node>
```
(`--priority` is one of `top` · `high` · `med` · `low` — not `normal`.) **This is your only move for a
source you can't retrieve — do NOT guess a value or substitute a proxy** (principle 2). Queue
it, leave the node's value `reference: null` with a `missing_document: "<what you need and why>"` (the
compiler tracks it as declared evidence-debt, not an error), and move on. The one exception is a number
no external comp could *ever* ground (inherent judgement) — that is grounded on an intent speculation,
not queued; see `build/rebase/FIX-PROTOCOL.md` rule 2.

## 4. Between phases — drain what agents couldn't fetch

Between the grounding phase and any human handoff, the **main interactive session** works the queue
in three steps:

```
node fetch_request.mjs check                # 1. flag pending requests already in the archive
node fetch_request.mjs drain                # 2. the agent_fetchable worklist — fetch + install each
node fetch_request.mjs export --md          # 3. what's LEFT — only pages no agent could reach
```

1. **Dedupe first** — a source is often archived under a redirected/canonical URL. For each flagged
   request, open the archived core; if the figure is there, `resolve --url <url> --note "already
   archived: doc_… — …"` — don't fetch it again.
2. **Drain the agent-fetchable lane** — for each, `WebFetch` (or `curl`) the page and
   `install_source.mjs <saved> --url <url>` (auto-resolves the entry). If this retry *also* fails, `fetch_request.mjs defer --url <url> --note "main WebFetch failed: <err>"` moves it to
   the human lane. A follow-up pass then authors the now-available observation and swaps each
   `missing_document` node onto its real `doc_<sha>/obs_<id>` — recompile; the debt is gone.
3. **Hand off the remainder** — `export` now lists only `human_only` requests: the sources no agent
   could reach. That is the human's worklist.

### Pre-fetch beats guess-then-fix
The cheapest ordering is to **pre-fetch before fanning out**: resolve and install the sources a run will need
*first* (a recon pass, or a recon subagent), so the fleet grounds on real observations and never has to guess. For gaps discovered
mid-run, the queue+`drain` above is the recovery path; with the Agent tool you can also resume the same
subagent via `SendMessage` once its source is installed, so it continues from where it stopped with its
context intact.

The human works that `export` list the same way — save each file and run `install_source.mjs <file>
--url <url>`, which **auto-resolves** the matching entry — then the same follow-up pass authors the
observations and clears the `missing_document` debt.

## 5. Before the run consumes the corpus — the MAIN session runs the audit (not optional)

`add_observation.mjs` stamps every new observation `audit: "unaudited"`. That is *debt*, not done:
`verification` only means the quote is in the core; the **legitimacy audit** (does the quote support
the statement, is the measure/unit/segment right, is the source real — [`AUDIT.md`](AUDIT.md)) is a
separate pass that must actually run. A whole batch once shipped un-reviewed, so the coordinating
session **must** clear it before compiling:

```
node check_sources.mjs                              # S8 FAILS while any observation is unaudited
node audit_prepare.mjs obs 3                        # slice the unaudited remainder into batches
#   → spawn one audit agent per batch (prompt template in AUDIT.md); collect verdicts_<tag>.json
node mark_audited.mjs --pass-list build/audit/verdicts_*.json   # mark legit/ok → verified
#   → fix any misread/overreach to match the source and re-verify; flag unfixable defects
node check_sources.mjs                              # must PASS (S1 S2 S5 S6 S7 S8) before compiling
```

The gate is **S8** in `check_sources.mjs`: it fails while any observation's `audit` is absent or
`unaudited`, so a run cannot silently consume un-reviewed evidence. Re-run after any edit — an edited
entry drops back to unaudited.

---
Every tool resolves its paths from the workspace (`FORECASTER_DATA` / `GROUNDING_SOURCES` override, e.g.
for isolated runs and tests). Writers are file-locked — safe for parallel agents. `check_sources.mjs` (S1/S2/S5 archive + S6/S7 corpus + **S8 audit coverage**) proves
the archive stays consistent and every observation has been audited before a run consumes it.
