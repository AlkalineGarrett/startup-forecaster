# agentic-fetcher

A reusable **agentic source-fetching toolkit**: find a source, archive its bytes, extract a lean
searchable text core (HTML-strip / `pdftotext` / offline OCR), register it in a project's corpus,
and author quote-verified observations against it. It holds tools only — it operates on two data
locations that live outside it.

> **Doing this as a step?** Read its step docs first: [`ground-evidence.md`](ground-evidence.md) (step `ground-evidence`), [`audit-evidence.md`](audit-evidence.md) (step `audit-evidence`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## The two roots

Every tool works on two locations inside your workspace (see `paths.mjs`). Both come from the workspace's
`portfolio.config.mjs`, found by walking up from the current directory, so the tools run from anywhere in it.

| root | config field | override | holds |
|---|---|---|---|
| **PROJECT** | `distributionData` (default `distributions/`) | `FORECASTER_DATA` | `corpus/observations.json` (per-node evidence), `corpus/general-knowledge.json`, `corpus/speculations.json`, `projects/` |
| **GROUNDING** | `groundingSources` (default `sources/`) | `GROUNDING_SOURCES` | `documents.json` (source-identity registry), `MANIFEST.csv`, `url-aliases.csv`, `fetch-queue.jsonl`, `cores/`, the archived tier folders |

Source **identity** (`documents.json`) lives in the archive (GROUNDING), so one archive can serve several
data projects. Per-node **observations** (`corpus/observations.json`) belong to the data project (PROJECT)
and each carries a `doc` backref to its source. A fresh project can (re)build the identity registry from
the archive's `MANIFEST.csv` with `prep/bootstrap_documents.mjs`.

From the workspace root:

```sh
npx forecaster search "net revenue retention"
npx forecaster install-source saved.html --url https://x.com/p --title "X pricing"
npx forecaster add-observation doc_<sha> obs_<id> --value 49 --unit USD/mo \
    --statement "..." --quote "verbatim from the core"
```

## The source archive

GROUNDING holds the archive. The format of `documents.json` (each source's identity) and of the observations
is in [`distribution-compiler/schema/SCHEMA.md`](../distribution-compiler/schema/SCHEMA.md) §2. The rest is
described here.

| path | what it is | written by |
|---|---|---|
| `<tier>/…` | the archived bytes, one folder per tier (below) | `install-source`, `firecrawl` |
| `MANIFEST.csv` | the byte ledger: one row per archived file | `install-source`, `firecrawl` |
| `cores/doc_<sha12>.txt` | each source's lean, searchable text (the text quotes are checked against) | `install-source`, `make-derivative`, `prep/` |
| `*.ocr.txt` | OCR sidecars beside a scanned PDF or a saved page's images | `ocr_pdf.sh`, `ocr-images` |
| `documents.json` | the source-identity registry | `install-source`, `make-derivative`, `mark-audited`, `bootstrap-documents` |
| `fetch-queue.jsonl` | sources an agent could not fetch, one request per line | `fetch-request` |
| `url-aliases.csv` | optional: other URLs an archived page is known by | by hand |

**MANIFEST.csv columns** (`lib/manifest.mjs` reads and writes them):

| column | meaning |
|---|---|
| `id` | `<domain-slug>__<sha12>` |
| `tier` | the folder the file is stored under. `manual` is `install-source`'s default (a file an agent or a person saved, or a curl fetch; `--tier` picks another). `fetched` is what `firecrawl` writes. Any other folder name is allowed. Rows in a `crawls` tier are crawl summaries, which `extract-remaining` skips. |
| `domain` | the source's host, without `www.` |
| `title`, `url` | provenance (`url` is empty when unknown) |
| `type` | which extractor reads it: `html` · `pdf` · `text` · `json` · `xlsx` · `gz` · `image`. Older rows may say `txt`, `htm` or an image extension (`png`, `jpg`); every tool reads those as `text`, `html` and `image`. |
| `bytes`, `copies` | the file's size; how many byte-identical copies were collapsed into this row |
| `sha256` | the content hash, which is the source's identity (`doc_<sha12>`). `-` on a crawl summary row. |
| `stored` | the file's path relative to the archive root |
| `origin` | free text: how the file was obtained (`agent-install`, `firecrawl`, a note) |
| `status` | `installed` (what `install-source` writes) or `asset` (a page's support file, never evidence; every tool skips it). Older rows may say `cited` or `uncited`, which mean the same as `installed`. |

**What `install-source` reads.** HTML is stripped to text, a PDF's text layer is read with `pdftotext`
(poppler), an `.xlsx` gives its cell values, a `.gz` its text, and `.txt`/`.md`/`.csv`/`.json` are kept
verbatim. A scanned PDF or an image goes through OCR. It refuses any other file, and any file whose core
comes out (near) empty, since nothing could be quote-checked against it.

**OCR** (`lib/ocr.mjs`). Set `FORECASTER_OCR` to a command that takes a PDF or image path and prints its
text, and every tool uses it. Without it, the built-in OCR uses macOS Vision, offline: it needs macOS,
`pdftoppm` (poppler) for PDFs, and `swiftc` the first time, to build `ocrtool` from `ocr.swift`. Off macOS
with no `FORECASTER_OCR`, anything that needs OCR stops and says so. `FORECASTER_OCR_LANGS` sets the
built-in OCR's languages (`en-US,pt-PT`); by default Vision detects them.

**The `_` convention.** A file or folder whose name starts with `_` is staging: a browser save's
`page_files/` folder, scratch notes, helper scripts. `check-sources` never counts it as evidence missing
from the manifest. Other paths a workspace keeps in the archive without manifesting them go in the
config's `sourcesExclude` list (patterns relative to the archive: `"dir/"`, `"name.ext"`, `"a/*.txt"`).

## What's here

| file | role |
|---|---|
| `fetch_request.mjs` | the file-locked fetch queue (add / check / drain / defer / resolve / export) |
| `install_source.mjs` | archive bytes → tier file + core + MANIFEST row + corpus doc skeleton (deduped) |
| `firecrawl_fetch.mjs` | fetch the queue's pending pages (or a list file) through Firecrawl and install each, in one go; run by the person, on their `FIRECRAWL_API_KEY` |
| `make_derivative.mjs` | compose a computed/reasoned derivative document + self-verifying observation |
| `add_observation.mjs` | author a quote-verified observation into `PROJECT/corpus/observations.json` |
| `add_knowledge.mjs` | author a `gk_`/`spec_` prior into the corpus |
| `audit_prepare.mjs` / `mark_audited.mjs` | slice/mark the corpus for evidence audits |
| `search.mjs` | search the source text layer (cores + OCR sidecars), merged per source; a query with regex metacharacters is a JavaScript regex (flags `i`, `u`) |
| `check_sources.mjs` | source-archive integrity (S1/S2/S5) + corpus↔archive consistency (S6/S7) + the audit gate (S8) |
| `check_transcribed.mjs` | routes each transcribed source to UPGRADE / CORROBORATE / REGROUND |
| `lib/ocr.mjs` `ocr_pdf.sh` `ocr.swift` | the OCR backends: `FORECASTER_OCR`, else offline macOS Vision (`ocrtool` is built on first use) |
| `lib/manifest.mjs` | MANIFEST.csv's columns and type vocabulary |
| `ground-evidence.md` | the step doc for `ground-evidence`: the sourcing principles and the ladder an agent follows to get a source |
| `audit-evidence.md` | the step doc for `audit-evidence`: how the grounding is audited before it is marked `verified` and relied on |
| `prep/` | bulk cache maintenance (core extraction, OCR folding, documents.json bootstrap, which merges into an existing registry unless given `--force`). `prep/extract_cores.mjs` never overwrites an existing core unless given `--force`: observations quote-verify against the stored cores, so re-extracting them can turn verified quotes into `not_in_doc` |
| `paths.mjs` | the two-root resolver, and the schema loader (the `measure` schema `add_observation`/`add_knowledge` validate against is read from `../distribution-compiler` — its single source; `DISTRIBUTION_COMPILER` overrides) |
| `tests/` | `node:test` — hermetic tests that stand up temporary PROJECT + GROUNDING roots |

## Tests

```sh
npm test
```
