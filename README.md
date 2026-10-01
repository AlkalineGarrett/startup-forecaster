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

## Your data lives elsewhere

These are tools only. A **portfolio** is your own repo with a `portfolio.config.mjs` (see
[`montecarlo-engine/config.mjs`](montecarlo-engine/config.mjs)), next to a **distribution-data** project and a
**source archive**. Point them at this checkout (e.g. the portfolio's `package.json` depends on
`"montecarlo-engine": "file:../startup-forecaster/montecarlo-engine"`, and its config's `compiler` at
`../startup-forecaster/distribution-compiler`). [`montecarlo-engine/examples/`](montecarlo-engine/examples) holds
a fictional portfolio to start from.

## Test

```sh
npm test     # engine (node) + compiler + fetcher (python3 · pytest · numpy/scipy) + forecaster end to end
```

Requires Node ≥ 22.6 and Python 3 with `pytest`, `numpy`, `scipy`, `jsonschema`.

MIT licensed.
