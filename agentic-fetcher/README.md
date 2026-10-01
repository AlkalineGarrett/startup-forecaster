# agentic-fetcher

A reusable **agentic source-fetching pipeline**: find a source, archive its bytes, extract a lean
searchable text core (HTML-strip / `pdftotext` / offline OCR), register it in a project's corpus,
and author quote-verified observations against it. It holds tools only — it operates on two data
locations that live outside it.

## The two roots

Every tool resolves paths from two environment-configurable roots (see `paths.py`):

| root | env var | default | holds |
|---|---|---|---|
| **PROJECT** | `FORECASTER_DATA` | current directory | `corpus/observations.json` (per-node evidence), `corpus/general-knowledge.json`, `corpus/speculations.json`, `projects/` |
| **GROUNDING** | `GROUNDING_SOURCES` | `../grounding-sources` | `documents.json` (source-identity registry), `MANIFEST.csv`, `url-aliases.csv`, `fetch-queue.jsonl`, `cores/`, the archived tier folders |

Source **identity** (`documents.json`) lives in the shared cache (GROUNDING), so it is shared across
projects. Per-node **observations** (`corpus/observations.json`) are per-project (PROJECT) and each
carries a `doc` backref to its source. A fresh project can (re)build the identity registry from the
shared `MANIFEST.csv` with `prep/bootstrap_documents.py`.

Typical invocation from inside a data project (so `FORECASTER_DATA` defaults to `.`):

```sh
export GROUNDING_SOURCES=../grounding-sources          # or wherever the cache lives
python3 ../startup-forecaster/agentic-fetcher/search.py "net revenue retention"
python3 ../startup-forecaster/agentic-fetcher/install_source.py saved.html --url https://x.com/p --title "X pricing"
python3 ../startup-forecaster/agentic-fetcher/add_observation.py doc_<sha> obs_<id> --value 49 --unit USD/mo \
    --statement "..." --quote "verbatim from the core"
```

## What's here

| file | role |
|---|---|
| `fetch_request.py` | the file-locked fetch queue (add / check / drain / defer / resolve / export) |
| `install_source.py` | archive bytes → tier file + core + MANIFEST row + corpus doc skeleton (deduped) |
| `make_derivative.py` | compose a computed/reasoned derivative document + self-verifying observation |
| `add_observation.py` | author a quote-verified observation into `PROJECT/corpus/documents.json` |
| `add_knowledge.py` | author a `gk_`/`spec_` prior into the corpus |
| `audit_prepare.py` / `mark_audited.py` | slice/mark the corpus for evidence audits |
| `search.py` | search the source text layer (cores + OCR sidecars), merged per source |
| `check_sources.py` | source-archive integrity (S1/S2/S5) + corpus↔archive consistency (S6/S7) |
| `ocr_pdf.sh` `ocr.swift` | offline macOS-Vision OCR for scanned PDFs/images (`ocrtool` is built on first use) |
| `SOURCING.md` | the sourcing doctrine — the ladder an agent follows to get a source |
| `AUDIT.md` | the corpus audit procedure — how evidence is reviewed before it is marked `verified` |
| `prep/` | bulk cache maintenance (core extraction, OCR folding, documents.json bootstrap) |
| `paths.py` | the two-root resolver, and the schema loader (the `measure` schema `add_observation`/`add_knowledge` validate against is read from `../distribution-compiler` — its single source; `DISTRIBUTION_COMPILER` overrides) |
| `tests/` | `pytest` — hermetic tests that stand up temporary PROJECT + GROUNDING roots |

## Tests

```sh
python3 -m pytest tests/ -q
```
