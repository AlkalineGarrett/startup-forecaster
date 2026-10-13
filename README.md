# startup-forecaster

Take a startup idea from a pitch to a **researched, simulated revenue forecast** — every number traced to
evidence, every uncertainty a distribution, the whole portfolio simulated together.

| folder | what it does |
|---|---|
| [`forecaster/`](forecaster) | the entry point: scaffold a venture from a business-model preset, report what is grounded and what to research next (`forecaster new` / `status`) |
| [`agentic-fetcher/`](agentic-fetcher) | find, archive and quote sources (the sourcing ladder, fetch queue, OCR, search) |
| [`distribution-compiler/`](distribution-compiler) | build each assumption's distribution from the evidence; the node format spec |
| [`montecarlo-engine/`](montecarlo-engine) | simulate the portfolio (business-model templates, correlated draws, cohort accounting), report, publish static pages; the data → model `pipeline/` |
| [`build-plan-generator/`](build-plan-generator) · [`exec-plan-generator/`](exec-plan-generator) | build-plan and execution-plan pages |

[`SKILL.md`](SKILL.md) is the agent playbook that drives the loop (frame → preset → scaffold → research the
most influential assumptions first → audit → write up). Install it as a Claude Code skill by linking this
folder into a skills directory, e.g. `ln -s "$PWD" ~/.claude/skills/startup-forecaster`.

## Your data lives in a workspace

These are tools only. Your forecasts live in one **workspace** folder next to this checkout:

```sh
node startup-forecaster/forecaster/bin/forecaster.mjs init my-forecasts
```

```
my-forecasts/
  portfolio.config.mjs   where everything lives; every tool finds the workspace through it
  src/                   the ventures as code (the engine simulates these)
  distributions/         each assumption's distribution and the evidence behind it
  sources/               the source archive: fetched pages and documents, their text, the fetch queue
  dossiers/<venture>/    description, research brief, outcomes
  plans/                 build and execution plans
```

[`montecarlo-engine/examples/`](montecarlo-engine/examples) holds a small fictional portfolio.

## Test

```sh
npm test     # engine + compiler + fetcher + forecaster end to end
```

Requires Node ≥ 22.6 (no npm dependencies). The OCR of scanned sources uses macOS Vision (`swiftc`, `pdftoppm`), and
`pdftotext` extracts text PDFs.

MIT licensed.
