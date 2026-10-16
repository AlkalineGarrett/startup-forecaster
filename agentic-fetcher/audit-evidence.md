# Step `audit-evidence`: audit the evidence before any distribution is built on it

> **Required reading before this step's first action:** this whole file. They are part of the step, not
> background: evidence passed without it has not been audited.

**Input:** what `ground-evidence` produced since the last audit: documents, observations and derivatives.

**Done when:** `npx forecaster check-sources` passes (S1 S2 S5 S6 S7 S8), every node meets the source
target or states its shortfall, and every finding is fixed or flagged.

**Next:** `build-distributions` (`distribution-compiler/build-distributions.md`). Whether a node's
distribution follows from this evidence is audited later, in `audit-distributions`.

The corpus is the shared grounding layer: **documents** (a source + its lean `core`), the
**observations** extracted from them, plus `general-knowledge` and `speculations`. Their fields, including
the `audit`, `audit_date` and `audit_note` this step sets, are defined in
`distribution-compiler/schema/SCHEMA.md` §2. Nothing in it is trusted until it has been audited. Run this step whenever the corpus grows, and again before a run consumes
it. The coordinating (main) session owns it; it can fan the batches out to audit agents.

## Principles (binding)

1. **Verified means audited, nothing less.** A document or observation is marked `"audit": "verified"`
   **only after** it passes the audits below. New observations are `"audit": "unaudited"` (stamped by
   `add-observation` / `make-derivative`); a new document has no `audit` until it passes one. Never mark
   `verified` before the check runs.
2. **A quote match is not an audit.** `verification` on an observation is the *mechanical* quote-in-core
   match; `audit` is the *legitimacy* review: does the quote support the statement, is the measure, unit and
   segment right, is the source real. Both must be clean.
3. **Judge from the core, not the title.** Every verdict is grounded in what the archived core literally
   says; quote it.
4. **Fix toward the source; never fabricate.** A misread or overreach is corrected to match the source, then
   re-checked. A defect that can't be fixed on the spot is `"audit": "flagged"` with a note and is not used
   until resolved. A garbage source, or a quote that isn't there, is removed or re-grounded.
5. **The gate is enforced, and edits reopen it.** `check-sources` **S8** fails while any observation's
   `audit` is absent or `unaudited`, so a run cannot silently consume un-reviewed evidence. An edited entry
   drops back to unaudited and is audited again.

---

## What to check

### Source count, per node

Count each node's independent sources (`ground-evidence` principle 5): different publishers, and not
reprints of the same underlying survey or dataset, which count once. A node with fewer than three needs a
stated shortfall (how many were found, what was tried, why it stopped); one with neither goes back to
`ground-evidence`. Verdict: `ok` · `below_target_explained` · `below_target_unexplained` ·
`not_independent` (sources that are really one).

### Audit 1 — observations (legitimacy)

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

### Audit 2 — documents (metadata + source legitimacy)

For every document that backs an observation (and, on a full sweep, every document), confirm against
its `core`:

1. **Title/url/publisher match the content.** The bootstrapped metadata is often wrong (an `ls -l`
   line, a page delimiter, `(unreadable pdf)`, a URL pointing at an unrelated article).
2. **The core is a coherent single real source** — not a concatenation of several PDFs, not a
   garbage stub, and **not the analyst's own write-up mis-labelled as a source** (grounding a model
   node on your own reasoning is circular).
3. **`origin` is correct** — `primary` (an external source) or `derivative` (composed from other corpus
   entries — see below). It is absent on a source nobody has classified yet; the audit sets it.
4. **`capture` is correct** — `fetched` when the core comes from the archived bytes, `transcribed` when an
   agent typed it. A transcribed source's observations carry `source_capture: "transcribed"`; run
   `npx forecaster check-transcribed` to route each one to a re-fetch, a person, or a re-grounding.

Verdict: `ok` · `mistitled` · `wrong_url` · `garbage` · `bundle` (several sources concatenated) ·
`not_a_source` (internal write-up) · `misclassified`.

Resolution: `ok` → mark `"audit": "verified"`. `mistitled`/`wrong_url` → correct the metadata from
the core, then verify. `garbage`/`bundle`/`not_a_source` → remove the document (and its observations),
or split a bundle into real single-source documents first.

### Audit 3 — derivative documents

A derivative document (`origin: "derivative"`, made by `make_derivative.mjs`) is derived from
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

## Procedure

### The gate

`npx forecaster add-observation` stamps every new observation `audit: "unaudited"`. That is *debt*, not done:
`verification` only means the quote is in the core; the **legitimacy audit** (does the quote support
the statement, is the measure/unit/segment right, is the source real — Audits 1–3 above) is a
separate pass that must actually run. Nothing else stops un-reviewed evidence reaching a run, so the
coordinating session **must** clear it before a run relies on the corpus:

```
npx forecaster check-sources                              # S8 FAILS while any observation is unaudited
npx forecaster audit-prepare obs 3                        # slice the unaudited remainder into batches
#   → spawn one audit agent per batch (prompt template below); collect verdicts_<tag>.json
npx forecaster mark-audited --pass-list build/audit/verdicts_*.json   # mark legit/ok → verified
#   → fix any misread/overreach to match the source and re-verify; flag unfixable defects
npx forecaster check-sources                              # must PASS (S1 S2 S5 S6 S7 S8) before building distributions on the evidence
```

The gate is **S8** in `npx forecaster check-sources`: it fails while any observation's `audit` is absent or
`unaudited`, so a run cannot silently consume un-reviewed evidence. Re-run after any edit — an edited
entry drops back to unaudited.

### Running it (repeatable)

1. `npx forecaster audit-prepare obs [N]` (or `docs`) — slices the not-yet-verified corpus into N
   balanced batch files under `build/audit/batch_*.json` (scratch; keep it out of version control).
2. Spawn one agent per batch with the prompt template below; each writes `verdicts_<tag>.json`.
3. Aggregate the verdicts; fix/remove per the resolutions above.
4. `npx forecaster mark-audited --pass-list <verdicts...>` marks every `legit`/`ok` entry
   `"audit": "verified"` (and stamps the date). Re-run audits after any later edit — an edited entry
   drops back to unaudited.

**Agent prompt template (observations):** "For each document in your batch, read `cores/<core>`;
first judge the SOURCE (Audit 2), then each observation (Audit 1). Ground every judgment in what the
core literally contains — quote the core, never rely on the title. Output a JSON array of
`{doc, obs, verdict, measure_in_core, explanation, suggested_fix}`, one per observation."

**Agent prompt template (documents):** "For each document in your batch, read `cores/<core>` and
compare it to the recorded `title`/`url`/`publisher`. Output `{doc, verdict, correct_title,
correct_url, correct_publisher, origin, explanation}` per document."
