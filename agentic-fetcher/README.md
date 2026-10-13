# agentic-fetcher

A reusable **agentic source-fetching pipeline**: find a source, archive its bytes, extract a lean
searchable text core (HTML-strip / `pdftotext` / offline OCR), register it in a project's corpus,
and author quote-verified observations against it. It holds tools only — it operates on two data
locations that live outside it.

## The two roots

Every tool works on two locations inside your workspace (see `paths.mjs`). Both come from the workspace's
`portfolio.config.mjs`, found by walking up from the current directory, so the tools run from anywhere in it.

| root | config field | override | holds |
|---|---|---|---|
| **PROJECT** | `distributionData` (`distributions/`) | `FORECASTER_DATA` | `corpus/observations.json` (per-node evidence), `corpus/general-knowledge.json`, `corpus/speculations.json`, `projects/` |
| **GROUNDING** | `groundingSources` (`sources/`) | `GROUNDING_SOURCES` | `documents.json` (source-identity registry), `MANIFEST.csv`, `url-aliases.csv`, `fetch-queue.jsonl`, `cores/`, the archived tier folders |

Source **identity** (`documents.json`) lives in the archive (GROUNDING), so one archive can serve several
data projects. Per-node **observations** (`corpus/observations.json`) belong to the data project (PROJECT)
and each carries a `doc` backref to its source. A fresh project can (re)build the identity registry from
the archive's `MANIFEST.csv` with `prep/bootstrap_documents.mjs`.

From the workspace root:

```sh
node ../startup-forecaster/agentic-fetcher/search.mjs "net revenue retention"
node ../startup-forecaster/agentic-fetcher/install_source.mjs saved.html --url https://x.com/p --title "X pricing"
node ../startup-forecaster/agentic-fetcher/add_observation.mjs doc_<sha> obs_<id> --value 49 --unit USD/mo \
    --statement "..." --quote "verbatim from the core"
```

## What's here

| file | role |
|---|---|
| `fetch_request.mjs` | the file-locked fetch queue (add / check / drain / defer / resolve / export) |
| `install_source.mjs` | archive bytes → tier file + core + MANIFEST row + corpus doc skeleton (deduped) |
| `make_derivative.mjs` | compose a computed/reasoned derivative document + self-verifying observation |
| `add_observation.mjs` | author a quote-verified observation into `PROJECT/corpus/observations.json` |
| `add_knowledge.mjs` | author a `gk_`/`spec_` prior into the corpus |
| `audit_prepare.mjs` / `mark_audited.mjs` | slice/mark the corpus for evidence audits |
| `search.mjs` | search the source text layer (cores + OCR sidecars), merged per source; a query with regex metacharacters is a JavaScript regex (flags `i`, `u`) |
| `check_sources.mjs` | source-archive integrity (S1/S2/S5) + corpus↔archive consistency (S6/S7) |
| `ocr_pdf.sh` `ocr.swift` | offline macOS-Vision OCR for scanned PDFs/images (`ocrtool` is built on first use) |
| `SOURCING.md` | the sourcing doctrine — the ladder an agent follows to get a source |
| `AUDIT.md` | the corpus audit procedure — how evidence is reviewed before it is marked `verified` |
| `prep/` | bulk cache maintenance (core extraction, OCR folding, documents.json bootstrap). `prep/extract_cores.mjs` never overwrites an existing core unless given `--force`: observations quote-verify against the stored cores, so re-extracting them can turn verified quotes into `not_in_doc` |
| `paths.mjs` | the two-root resolver, and the schema loader (the `measure` schema `add_observation`/`add_knowledge` validate against is read from `../distribution-compiler` — its single source; `DISTRIBUTION_COMPILER` overrides) |
| `tests/` | `node:test` — hermetic tests that stand up temporary PROJECT + GROUNDING roots |

## Tests

```sh
npm test
```
