# Corpus audit — the repeatable procedure

The corpus is the shared grounding layer: **documents** (a source + its lean `core`), the
**observations** extracted from them, plus `general-knowledge` and `speculations`. Nothing in it is
trusted until it has been audited. This file is the procedure — run it whenever the corpus grows,
and again before a run consumes it.

**Marking rule (the whole point):** a document or observation is marked `"audit": "verified"` **only
after** it passes the audit below. Freshly added entries are `"audit": "unaudited"` (stamped by
`add_observation.py` / `make_derivative.py`). A defect that can't be fixed on the spot is
`"audit": "flagged"` with a note, and is not used until resolved. Never mark `verified` before the
check runs. (`verification` on an observation is the *mechanical* quote-in-core match; `audit` is
this *legitimacy/metadata* review — both must be clean.)

**Enforced, not optional.** `check_sources.py` **S8** fails while any observation's `audit` is absent
or `unaudited`, so the coordinating session cannot compile/consume the corpus until this pass has run
(see [`SOURCING.md`](SOURCING.md) §5). This is the gate that stops a batch from silently
shipping un-reviewed.

---

## Audit 1 — observations (legitimacy)

For every observation, confirm three things against the document's `core` (the source of truth at
`cores/doc_<sha>.txt` in the grounding cache), not the title:

1. **Quote present** — the `quote` appears verbatim in the core (allow whitespace/line-wrap and
   unicode dash/quote normalization, nothing more).
2. **Quote supports the statement** — read the surrounding context; the quote actually backs the
   `statement`, not a look-alike figure elsewhere.
3. **Measure correct** — the `measure` value AND unit are what the quote/context say. Watch for:
   a misread number; a unit error (percent vs fraction, monthly vs annual, MRR vs ARR, thousands vs
   millions); the wrong segment/population/period; a statement that overreaches the source.

> **Vendor-domain pricing is authoritative.** A price captured from the service's **own domain** is
> the primary source for that service's price — it needs **no** corroborating second source or
> `corroboration` cross_check. Corroboration effort is for *transcribed*/third-party/aggregator
> pricing (supersede it onto the vendor's own page when available) or for contested non-price figures,
> not for a price already on the vendor's site.

Verdict, one of: `legit` · `misread_measure` · `quote_unsupported` · `quote_not_found` ·
`overreach` · `garbage_source` (the document itself is not a usable source — see Audit 2).

Resolution: `legit` → mark `"audit": "verified"`. `misread_measure`/`overreach` → fix the measure
or statement to match the source, then verify. `quote_unsupported`/`quote_not_found`/`garbage_source`
→ remove the observation (or re-ground it to a real source).

## Audit 2 — documents (metadata + source legitimacy)

For every document that backs an observation (and, on a full sweep, every document), confirm against
its `core`:

1. **Title/url/publisher match the content.** The bootstrapped metadata is often wrong (an `ls -l`
   line, a page delimiter, `(unreadable pdf)`, a URL pointing at an unrelated article).
2. **The core is a coherent single real source** — not a concatenation of several PDFs, not a
   garbage stub, and **not the analyst's own write-up mis-labelled as a source** (grounding a model
   node on your own reasoning is circular).
3. **`origin` is correct** — `primary` (a fetched external source), `derivative` (computed from
   originals — see below), or `archived` (a prior-run copy).

Verdict: `ok` · `mistitled` · `wrong_url` · `garbage` · `bundle` (several sources concatenated) ·
`not_a_source` (internal write-up) · `misclassified`.

Resolution: `ok` → mark `"audit": "verified"`. `mistitled`/`wrong_url` → correct the metadata from
the core, then verify. `garbage`/`bundle`/`not_a_source` → remove the document (and its observations),
or split a bundle into real single-source documents first.

## Audit 3 — derivative documents

A derivative document (`origin: "derivative"`, made by `make_derivative.py`) is derived from
originals in one of two ways (`derivation_kind`):

- **`computed`** (stronger evidence — reproducible). Audit by: (1) each value in `derivation.inputs`
  is transcribed from a source listed in `derived_from` (open those cores and check); (2) the method
  is appropriate and `derivation.result` reproduces (the tool recomputes deterministically, so a
  mismatch means the inputs were hand-edited — re-run the tool); (3) the result observation's quote
  matches the core (self-verifying by construction).
- **`reasoning`** (weaker evidence — a judgement/summary). Audit by: (1) the sources in `derived_from`
  actually support the reasoning; (2) the reasoning is sound and does not overreach them; (3) the
  conclusion (if any) follows. A reasoning derivative that could instead be *computed* should be
  redone as `computed`.

Resolution: traces + sound → `"audit": "verified"`. A reasoning derivative carries less weight than a
computed one; a node leaning on it should reflect that in its `support_score`.

---

## Audit 4 — construction (the evidence → distribution inference)

Audits 1–3 check the *evidence*. Audit 4 checks the *inference* from that evidence up to the
distribution: given the observations/specs a node cites, is the constructed distribution a tight,
justified representation? Per node:

1. **Kind** — does `distribution.kind` match the evidence shape? (a multimodal source in one
   lognormal; a bounded fraction off [0,1]; a source-stated ladder flattened to a 2-quantile fit; a
   *metalog over directional/judgement evidence*, which reads as a measured ladder the evidence
   can't support).
2. **Params** — do the params follow from the cited evidence? Recompute: lognormal median/sigma from
   the right two quantiles (z-spread 2.5631 p10/p90, 3.2897 p05/p95); FX (direction + value);
   derivatives; metalog anchors = the stated quantiles; splice `slope_match`. `compiler/preview.py`
   checks a construction or a fit.
3. **Tightness** — is the spread justified? Flag OVERCONFIDENT (too-narrow given weak/single-source/
   judgement evidence) and UNDER-confident (absurdly wide).
4. **Coherence** — does `reasoning` connect the cited evidence to the distribution? (non-sequiturs,
   double-counting, wrong population/segment/period, unit confusion, a median that ignores a stated
   central value, an unquantified conversion step).
5. **Cross-checks / support_score / truncation** — refutations reference the right obs; support
   reflects the real grounding; truncation clips where the quantity is physically bounded.

Prepare bundles (node + its resolved evidence) per project, run one review agent each, collect
`{ node, category, severity, issue, suggested_fix }` findings, then fix — **making the construction
honest**: fix the distribution when it misrepresents the evidence; fix the label/reasoning when only
that is wrong; never fabricate evidence. Re-run Audits 1–4 after fixing (edited entries drop back to
unaudited).

## Running it (repeatable)

1. `python3 ../startup-forecaster/agentic-fetcher/audit_prepare.py obs [N]` (or `docs`) — slices the not-yet-verified corpus into N
   balanced batch files under `build/audit/batch_*.json` (gitignored scratch).
2. Spawn one agent per batch with the prompt template below; each writes `verdicts_<tag>.json`.
3. Aggregate the verdicts; fix/remove per the resolutions above.
4. `python3 ../startup-forecaster/agentic-fetcher/mark_audited.py --pass-list <verdicts...>` marks every `legit`/`ok` entry
   `"audit": "verified"` (and stamps the date). Re-run audits after any later edit — an edited entry
   drops back to unaudited.

**Agent prompt template (observations):** "For each document in your batch, read `cores/<core>`;
first judge the SOURCE (Audit 2), then each observation (Audit 1). Ground every judgment in what the
core literally contains — quote the core, never rely on the title. Output a JSON array of
`{doc, obs, verdict, measure_in_core, explanation, suggested_fix}`, one per observation."

**Agent prompt template (documents):** "For each document in your batch, read `cores/<core>` and
compare it to the recorded `title`/`url`/`publisher`. Output `{doc, verdict, correct_title,
correct_url, correct_publisher, origin, explanation}` per document."
