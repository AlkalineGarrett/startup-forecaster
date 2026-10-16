# Step `add-venture`: frame an idea and scaffold it into the model

> **Required reading before this step's first action:** this whole file. They are part of the step, not
> background: a venture scaffolded without it has not been framed.

**Input:** an idea, product or venture the person wants forecast.

**Done when:** `profile.json` holds the person's answers and this venture's (or records what they declined),
the venture is scaffolded, `npx forecaster simulate` runs, and `npx forecaster status <id>` lists every node
as a placeholder ranked by influence, with no "profile incomplete" line.

**Next:** `ground-evidence` (`agentic-fetcher/ground-evidence.md`) for the venture's most influential nodes.

## Principles (binding)

1. **Never assume what only the person can say.** Before any analysis starts, read `profile.json` and run
   the onboarding below for whatever it lacks. Offer a default only for what can be guessed, and give its
   basis. Ask for everything that can't be guessed, and never fill it with a default. Save every answer
   to `profile.json` so later ventures reuse it.
2. **Frame it in the person's terms, then check it.** Write down what they told you, and ask only about what
   is genuinely their call: their goals, constraints, the prices they intend to charge, what they will and
   won't do. Look everything else up.
3. **The model's shape must match how money actually arrives.** A preset is chosen for its mechanics, not for
   convenience. Never force a venture into a preset whose mechanics are wrong; say so plainly and propose the
   right shape instead.
4. **A placeholder is not a forecast.** Scaffolding fills every node with a wide generic prior so the model
   can run. Never present a placeholder-driven number as a forecast, to the person or on any page.

## Onboarding: the profile

`profile.json` at the workspace root holds the answers the model's settings come from: tax, currency,
thresholds, team and cost timing. `forecaster` turns it into `src/profile-data.ts` before every command, and
`src/projects.ts` passes those settings to the engine. `npx forecaster profile` shows what it answers, what
it still lacks, what was declined and what is due for re-confirming.

**1. Read the profile first.** Reuse every person-level answer already in it; don't ask again. Ask only for
what is missing (`null`), plus the venture-level answers for this new venture. Re-confirm an answer when
its `answeredAt` date is more than about 6 months old, or when the person says something changed.

**2. Ask in one message.** Put everything still needed into a single message with two parts:
- **Proposed defaults** for the guessable items: one line each, with the value you propose and its basis,
  for the person to confirm or change.
- **Questions** for the unguessable items. Never fill one with a default. If the person declines one,
  record `"declined"`: the dependent outputs then say so (with no tax answered, the after-tax views say no
  tax is configured).

**Unguessable, person-level** (`person.*`):
- tax residence (`country`);
- the legal structure they would sell through (`legalStructure`: sole trader, company, …);
- solo or team (`team`), and who is paid: the yearly payroll if a team is paid (`paidTeamCostPerYear`, in the
  reporting currency);
- founder hours per week (`founderHoursPerWeek`): the evidence for every node that rests on the founder's own
  time (build months, readiness, billable days, support or sales capacity), cited in those nodes' reasoning;
- the yearly revenue that would make a venture worth it (`meaningfulRevenuePerYear`, the success threshold);
- the minimum yearly revenue to keep going (`decisionFloorPerYear`, the decision floor).

**Unguessable, venture-level** (`ventures.<id>.*`):
- the market it sells into (`market`);
- who builds and runs it, if different from the person-level answer (`team`, and `paidTeamCostPerYear` in the
  venture's currency when that team is paid);
- anything the person intends that research can't settle, such as a price they have decided (write it in
  the venture's description, and research only what is left open).

**Guessable, and how to guess each:**
- reporting currency (`reportingCurrency`): from the tax residence;
- business tax (`businessTaxRate`, `taxNote`): an effective rate on business profit, researched for that
  country and legal structure and cited; `taxNote` says in a line what it covers ("PT company: IRC 21% +
  derrama");
- horizon 5 years (`horizonYears`), headline from year 2 (`headlineFromYear`), discount rate 10%
  (`discountRate`);
- when costs start (`costsStart`): a paid team → `"start"`, a solo unpaid founder → `"readiness"`;
- the pairwise split-attention haircut (`pairAttentionOverhead`): solo 0.15, team 0;
- per venture: the currency it reports in (`currency`) from the market; when its input prices are quoted in
  another currency (e.g. USD app-store prices in a EUR-reported venture), that one too (`priceCurrency`); the
  payment channel (`channel`) from the business model and market (`npx forecaster new` lists the valid ones
  when given a wrong one); and an exchange rate into the reporting currency for each currency that differs
  (`person.exchangeRates.<code> = { "rate": <value of 1 <code> in the reporting currency>, "source": "<url>",
  "asOf": "<date>" }`), researched with a source and date.

**3. Save the answers** to `profile.json`: person-level answers under `person`, this venture's under
`ventures.<id>`, and for every field answered, `answeredAt["person.<field>"]` or
`answeredAt["ventures.<id>.<field>"]` set to today's date (`YYYY-MM-DD`). A guessed default the person
confirmed counts as answered. Then re-run the simulation build (`npx forecaster simulate`) so the settings
apply, and check `npx forecaster profile` shows no gaps you didn't expect.

Shape (null = not yet answered):

```json
{
  "person": {
    "country": null, "reportingCurrency": null, "legalStructure": null,
    "taxNote": null, "businessTaxRate": null,
    "team": null, "paidTeamCostPerYear": null, "founderHoursPerWeek": null,
    "meaningfulRevenuePerYear": null, "decisionFloorPerYear": null,
    "discountRate": 0.1, "horizonYears": 5, "headlineFromYear": 2,
    "costsStart": "start", "pairAttentionOverhead": 0,
    "exchangeRates": {}
  },
  "ventures": {
    "<id>": { "market": null, "currency": null, "channel": null, "team": null }
  },
  "channels": {},
  "answeredAt": {}
}
```

`channels` adds payment channels beyond the engine's built-ins (`name: { "realisation": <collected share of
list price>, "fixedFee": <per charge, venture currency> }`), researched like any other number.

## Procedure

1. **Onboard.** Run the onboarding above: read `profile.json`, ask in one message for what is missing, save
   the answers.
2. **Frame it.** Write, in plain words, what it is, who pays and how (subscription, per seat, per
   organisation, one-off), the beachhead market, what already exists (code, audience, relationships), the
   real constraints of the people doing it (time, location, budget) and any price the person has decided.
   Save it as `dossiers/<id>/description.md`.
3. **Pick a preset.** `npx forecaster presets` lists them with their nodes. Choose the one whose mechanics
   match how money arrives. If none fits (marketplace take rate, usage-based, services capped by delivery
   hours, several revenue streams), use the closest preset only if the mismatch is minor, and note it in the
   description. Otherwise the venture needs a new engine template (`montecarlo-engine/src/templates.ts` in the
   package) or, as a last resort, a hand-written `sim()`: propose that to the person.
4. **Scaffold it.**
   ```sh
   npx forecaster new <id> --preset <preset> --name "<Name>"
   npx forecaster simulate
   npx forecaster status <id>
   ```
   `new` takes the venture's currency and channel from `profile.json` (`ventures.<id>`); `--currency <ISO>`
   and `--channel <name>` override them, and `new` records them there. The profile is the one record of a
   venture's currencies: the project file holds none, and the engine derives the symbol and the price
   conversion (`priceCurrency` → `currency`, from `person.exchangeRates`) from it. A paid team gets its payroll as a `team_cost_yr` operating cost. Anything `new` had to guess is listed
   under "To confirm" and dated as needing confirmation in the profile: confirm it with the person.

   `new` writes `src/projects/<id>.ts` (structure only), registers it, seeds a placeholder distribution per
   node in `distributions/projects/<id>.json` and writes `dossiers/<id>/research-brief.md`. Fill in the
   project's `one:` line in `src/projects/<id>.ts`.
