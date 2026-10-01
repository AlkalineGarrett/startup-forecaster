---
name: startup-forecaster
description: Take a startup idea from a pitch to a researched, simulated revenue forecast — scaffold the venture into a Monte-Carlo portfolio from a business-model preset, ground every node in sourced evidence (most influential first), run the model, and write up the outcome. Use when the user wants to evaluate, forecast, or add a new venture/startup idea/product line to their portfolio model.
---

# Startup forecaster

You turn an idea into a forecast whose every number traces to evidence. The tools do the mechanics; your
job is the research and the honesty. Work inside the user's **portfolio repo** (the one with
`portfolio.config.mjs`), which sits next to this `startup-forecaster` checkout. Its tools are the
checkout's `montecarlo-engine/`, `distribution-compiler/`, `agentic-fetcher/` and `forecaster/`; below,
`forecaster` means `node ../startup-forecaster/forecaster/bin/forecaster.mjs`.

## The loop

### 1. Frame the venture
Get, from the user and existing notes: what it is · who pays and how (subscription? per seat? per org?) ·
the beachhead market · what already exists (code, audience, relationships) · the founder's real constraints
(time, location, what they will and won't do). Write it to `dossiers/<id>/2-description.md` in plain words.
Ask only about what is genuinely the user's call; look everything else up.

### 2. Pick a preset
`forecaster presets`. Choose the one whose mechanics match how money actually arrives. If none fits
(marketplace take-rate, usage-based, services capped by delivery hours, a multi-stream business), say so
plainly: use the closest preset only if the mismatch is minor and note it in the description; otherwise the
venture needs a new engine template (montecarlo-engine `src/templates.ts`) or, last resort, a hand-written
`sim()` — propose that to the user rather than forcing a wrong shape.

### 3. Scaffold
```sh
forecaster new <id> --preset <preset> --name "<Name>" [--cur $] [--fx 1] [--channel usB2B|usStripe|appStoreSBP|eeaB2B]
npm run pipeline            # compiles the placeholders, regenerates, re-freezes golden, builds
forecaster status <id>      # every node: placeholder, ranked by how much it drives the outcome
```
Fill the project's `one:` line. Every node now holds a **placeholder** — a generic wide prior that only lets
the model run. Never present a placeholder-driven number as a forecast.

### 4. Research, most influential first
Take nodes in the order `forecaster status` ranks them (the research brief in `dossiers/<id>/research-brief.md`
says what would ground each). For each node:

1. **Search the archive first** — `python3 ../startup-forecaster/agentic-fetcher/search.py "<distinctive phrase>"` (content
   search) and the fetch queue (`fetch_request.py list`). An archived source is grounded already: use it, never
   re-fetch or re-ask.
2. **Find and fetch** — subagents may find URLs; the main session fetches (curl / WebFetch), archives with
   `install_source.py`, and records each figure with `add_observation.py … --quote "<verbatim>"`.
3. **Browser-gated pages** (JS-rendered, logins, anti-bot) are never driven with an automated browser. Queue
   them for the human (`fetch_request.py add --url … --for <id>::<node>`, lane human_only) and record the
   gap as `reference: null` + `missing_document` — never substitute a weaker proxy and call it grounded.
4. **Construct the distribution** in the data project (`projects/<id>.json`, replacing the placeholder):
   built from the observations (`direct_value` references; `computed_value` formulas; `inferred_value` only
   where genuine judgement sets a number, with reasoning + confidence). Stated quantiles anchor at the
   source's percentiles; elicited low/likely/high at 10/50/90; raw data points at plotting positions.
   Percentiles are derived, never authored. Widen only for grounded disagreement. Score `support_score`
   honestly and write self-contained `reasoning`. Fit shapes with `../startup-forecaster/distribution-compiler/compiler/preview.py`.
5. **Compile and re-run** — `python3 ../startup-forecaster/distribution-compiler/compiler/compile.py projects/<id>.json` (in the
   data project) must be clean; then `npm run pipeline` and `forecaster status <id>`.

Stop when the top drivers are sourced (or are explicit, reasoned judgement where no source can exist) and no
driver is still a placeholder. Name any remaining placeholders in the write-up.

### 5. Audit the model
Check the result against the portfolio's simulation-audit principles (SIMULATION-AUDIT.md where present):
tax on pre-tax profit; no cash cost for the founder's own time; costs begin at their real trigger;
independent line items; trace any surprising number to its formula. Compare the median with the venture's
reference class (set `refP90`/`refNote` on the project) and explain a gap rather than tuning it away.

### 6. Write the outcome
`dossiers/<id>/4-outcomes.md`: the headline (sustained average yearly revenue, years 2–5: P20 / P50 / P80),
what drives it (the status ranking), which inputs are sourced vs judgement, what would change the answer,
and the **cheapest validation steps** that would retire the biggest uncertainty — distribution, demand and
pricing tests usually beat more building. Plain words; no hype.

### 7. Share (only when asked)
A static page scoped to the venture: `MC_PROJECTS=<id> MC_OUT=<id>.html npm run artifact:full`. Publishing is
outward-facing — confirm with the user first. Build / execution plans: the `build-plan-generator` and
`exec-plan-generator` tools.

## Rules that do not bend
- Every number in the model traces to the data project; nothing numeric is typed into the project file.
- A placeholder, a guess, or a proxy is labelled as such — in the data (support score, speculation) and in
  anything you tell the user.
- Show the user source data verbatim; don't paraphrase a source's figures into stronger claims.
- Commit as you go (one coherent change per commit); never push.
