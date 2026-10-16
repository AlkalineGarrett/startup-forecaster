# Step `audit-simulation`: check the simulation is right before anyone relies on its numbers

> **Required reading before this step's first action:** this whole file; its principles and checks are applied
> in full, not sampled. They are part of the step, not background: a simulation passed without them has not
> been audited.

**Input:** the simulation `build-simulation` just built, from distributions that passed `audit-distributions`.

**Done when:** every check below holds, or each one that doesn't is fixed or explained in what you report.

**Next:** `render-forecast` (`forecast-renderer/render-forecast.md`).

How to check that a Monte-Carlo result is *correct*, not just that it runs. Nearly every defect in a model
like this first shows up as a number that looks wrong to a person reading the output: tax bigger than net,
a cost that shouldn't exist, a loss that lasts too long. The audit's job is to catch those before the
reader does, by reading the output the way a skeptic would and tracing anything surprising back to the
formula that produced it.

## Principles (binding)

### A. The income statement must be an income statement
1. **Tax is on pre-tax profit.** Tax = rate × max(0, revenue − cost of revenue − operating cost). Every
   deductible expense is deducted *before* tax; a loss year pays zero tax, never negative (`simulate.ts`
   `netFrom`).
2. **Reconciliation is exact at the mean.** Revenue − cost of revenue − operating cost − tax = net, to the
   cent, at the mean. If it doesn't, a term is double-counted, missing, or in the wrong order.
3. **The implied effective rates must be sane.** Effective tax ≈ the configured rate (`taxNote` /
   `businessTax`, or the unit's own `afterTax`) in profitable years;
   gross margin in the range the sources support; net margin plausible for the business type. Tax exceeding
   net, or an effective rate far from statutory, is a defect until proven otherwise.
4. **Display order follows computation order.** Cost lines above tax; tax above net.

### B. Costs must be real, correctly timed and correctly shaped
5. **Charge labour as cash only when someone is paid for it.** Unpaid founder time is free: where the model
   treats it as a time lag, no line may re-bill it as a cost (support, onboarding, "ops"). Paid people —
   a team's salaries, contractors, work hired out past a capacity limit — are real operating cost from the
   month they start.
6. **A cost begins when it is actually incurred on the timeline.** The portfolio's `costsStart` sets when
   operating cost begins ("start" for a team paid from month 0, "readiness" after an unpaid build, "launch");
   a cost line whose trigger differs sets its own `from`. Compliance and certification spend belongs to the
   readiness phase (`readiness_months`), not the build (`code_months`); go-to-market spend to launch. A cost
   charged before its trigger inflates early burn with money no one would spend yet.
7. **Fixed vs variable must match reality.** A fixed annual outlay is an absolute amount (a `$/yr` node),
   not a share of revenue; a variable cost scales with its true driver (revenue, users, volume).
8. **Capacity gates cost, when the model has a capacity cap.** If the active base is capped at the team's
   capacity, costs that only arise past that capacity should be about zero in the modelled range. If a cost
   is meant to appear only past a cap, verify the cap is ever reached in the draws.
9. **A cost that scales with the customer base is a rate, not a flat annual number.** Per-user hosting or
   inference charged as `finalUsers × cost × 12` overstates early years and ignores churn. Express it as a
   cost-of-revenue rate so it tracks each year's revenue; keep flat operating-cost lines for genuinely fixed
   outlays (compliance, audits).

### C. Revenue is billed gross; platform take is a cost line
10. **Report revenue gross (billed), not collected.** The payment or platform take (card fees, app-store
    commission, reverse-charge collection) is the gap between billed and collected. It belongs as the first
    cost-of-revenue line, not silently netted into revenue. A `realise()` / `realiseMix()` factor inside a
    sim *is* that take; if revenue is stored net of it, also charging a payment cost line double-counts. The
    templates integrate the gross price and set `_platformRate = 1 − realise` for a "Platform & payment
    fees" line.
11. **Keep each real cost in exactly one place.** A single `gross_margin` node plus a separately charged
    per-user infrastructure cost double-counts if the margin was set low *because of* that same
    infrastructure. Derive the margin from the itemised cost lines.

### D. Itemisation integrity
12. **Every line is its own sampled quantity.** Never back-compute a component as a share of a total.
    Derive the aggregate *from* the parts (margin = 1 − Σ cost-of-revenue rates), not the reverse.
13. **Itemise by real structure, not to a template.** The number of sub-lines equals the number of genuine
    components; one formula is one line; no padding to match a sibling row.
14. **State the non-additivity.** Wherever independent sub-lines sit under a parent, say plainly that they
    sum only at the **mean**; percentiles of independent draws do not add.

### E. Distributions in the simulation
(Whether each distribution follows from its evidence is `audit-distributions`; this is what the simulation
does with them.)
15. **Clamp anything that can compound.** Any multiplier that could exceed its intended bound (a
    willingness-to-pay, uplift or expansion factor) must be clamped, so overlapping draws can't blow the
    output up to absurd magnitudes.
16. **The source of truth is the source.** Changing a rendered node's percentiles does nothing; edit the
    distribution in the data project and regenerate. Confirm the change moved the simulation, not just a
    label.

### F. Metric definition and golden
17. **Know exactly what the headline is.** It is average yearly revenue from `headlineFromYear` (default 2)
    to the end of the horizon (`horizonYears`, default 5); revenue, not net; not a cumulative total divided
    by the horizon. Both are set in `configurePortfolio`. Every summary number inherits this definition;
    check it hasn't drifted. Know its currency too: a venture's numbers are in its own currency (`currency`,
    from the profile); anything combining ventures (pairwise, a total) is in the reporting currency; the thresholds
    (`successThreshold`, `decisionFloor`, `referenceP90`) are reporting-currency settings converted per
    venture. Check the exchange rates are the cited ones.
18. **Golden tracks revenue.** Net, tax, operating-cost and margin changes do **not** move golden; only
    changes to the node set or the draw sequence do — and pSucc / condP50 also move with `successThreshold`
    or an exchange rate. After an accounting-only change, golden must be
    *unchanged* (if it moved, the draws changed by accident). After a node-set change, re-freeze it and
    confirm *only* the intended venture moved.

### G. Simulation-build integrity
19. **A field must be threaded end to end or it is inert.** Source node → compile → `run()` → `RunUnit` →
    `recordDraw` → `finalize`. Verify the value appears in the *output*, not just the source.
20. **Regenerate the whole chain in order.** compile → gen → golden → pairwise → precompute. A change one layer up with
    stale layers below ships old numbers.

### H. Verification discipline
21. **Verify against the running system, not a copy of its output.** Read numbers from an actual `run()`
    (`npx forecaster status --json`, `npx forecaster coverage --json`), not from a built page, which can be
    stale.
22. **Reconcile numerically before believing a screenshot.** Sub-lines sum to their parent at the mean; the
    income-statement identity holds; year-over-year moves go in a direction you can explain.
23. **Trace every surprising number to its formula.** Tax above net, a cost that shouldn't exist, a
    negative that lasts too long, a value in scientific notation: each is a formula waiting to be read.

## What to check

Run this against a simulation before reporting or publishing its numbers.

**Accounting**
- [ ] Revenue − cost of revenue − operating cost − tax = net, exactly, at the mean.
- [ ] Tax is zero in every loss year and close to the configured rate on pre-tax profit in profitable years.
- [ ] Gross and net margins are inside the range the sources support.
- [ ] Every cost line is a genuine cash outlay: paid people count from their start; unpaid founder time doesn't.

**Timing and shape**
- [ ] Each cost starts at its real trigger on the timeline (build, readiness, launch).
- [ ] Fixed costs are absolute amounts; variable costs scale with a real driver.
- [ ] Early-year losses are explained by costs that would genuinely be spent that early.

**Itemisation**
- [ ] Every sub-line is sampled on its own; aggregates are derived from parts.
- [ ] The number of sub-lines matches the number of real components.
- [ ] The mean-only additivity note is present wherever sub-lines are shown.

**Distributions**
- [ ] The change was made in the data project and regenerated, not only in a displayed percentile.
- [ ] No unclamped compounding multiplier; no output in scientific notation or absurd magnitude.

**Metric and golden**
- [ ] The headline is the configured one (revenue, averaged over the configured years), in the right currency.
- [ ] An accounting-only change left golden unchanged; a node-set change moved only the intended venture.

**Simulation build**
- [ ] The new or changed value appears in the output, traced end to end.
- [ ] The full chain ran in order.

## Procedure

1. Read the numbers from the running system, not a built page: `npx forecaster status --json` and
   `npx forecaster coverage --json` for the ventures that changed.
2. Go through every check above for those ventures, tracing anything surprising to its formula.
3. Compare each venture's median with its reference class (`refP90` / `refNote` on the project), and explain a
   gap rather than tuning it away.
4. Fix what fails and re-run `build-simulation`, or state each unresolved failure in what you report.
