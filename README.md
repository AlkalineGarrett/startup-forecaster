# Startup Forecaster

The Startup Forecaster is an experimental project that lets you describe a startup idea to a coding agent,
which will then follow the directions contained in this tool to perform thorough web research and then
simulate revenue and net income for that idea.

## Quick start

```sh
npx startup-forecaster init my-forecasts
cd my-forecasts
```

Then open your coding agent in `my-forecasts/` and ask to forecast an idea:

```sh
> forecast a subscription app that helps landlords track repairs
```

It will then ask you questions for settings that only you can provide (such as where you pay tax, or
the minimum acceptable revenue, which is used for color coding the results).

## What you'll need to do yourself

The agent does the research and the modelling, but a few things only you can do:

- **Answer its setup questions.** Your settings are saved in `profile.json`, so you're only asked once.
  Later ventures reuse your answers and only ask what's specific to the new idea.
- **Confirm its guesses.** When the agent proposes a default (a tax rate, a currency, a payment channel), it
  says so and asks you to confirm or correct it.
- **Fetch the pages it can't reach.** Some sources sit behind a login, a paywall or a page that only works in
  a real browser. The agent doesn't open a browser for you, so it queues these and lists them at the end of
  its reply. To get them, run this in your workspace:
  - `npx forecaster fetch-request export --md` shows the list.
  - If you have a [Firecrawl](https://firecrawl.dev) API key, `FIRECRAWL_API_KEY=<key> npx forecaster firecrawl`
    fetches the whole list in one go. It uses your Firecrawl credits, so the agent never runs it for you.
  - For anything left, open the page in your browser, save it (or download the PDF), and run
    `npx forecaster install-source <saved file> --url <page url>`.

  Then tell the agent the pages are in, and it will use them.
- **Approve anything that leaves your machine.** The agent asks before publishing or sharing a page.
- **Open the interactive model.** `npx forecaster serve` runs it locally. If your agent's sandbox blocks
  local ports, run it yourself in a terminal.

## Requirements

Requires Node 22.13 or newer. The package has no dependencies. OCR of scanned PDFs uses macOS Vision
(`swiftc`, `pdftoppm`); text PDFs need `pdftotext`.

## Workspace structure

The `init` command of startup-forecaster creates one folder that holds all of your forecasting data:

```
my-forecasts/
  portfolio.config.mjs   where everything lives; every tool finds the workspace through it
  profile.json           Your settings: tax residence and rate, reporting currency,
                         team, thresholds, and each venture's market, currency and payment channel
  src/                   the ventures as code (the engine simulates these)
  distributions/         grounded evidence and distributions built from them
  sources/               the source archive: fetched pages and documents, their text, the fetch queue
  dossiers/<venture>/    description, research brief, market notes
  plans/                 build and execution plans
  AGENTS.md              what a coding agent reads first (CLAUDE.md and GEMINI.md import it)
```

## Using it with a coding agent

[`AGENTS.md`](AGENTS.md) is the playbook a coding agent follows for every kind of request: adding a
venture, researching evidence, changing an input, re-running the simulation, visualizing results, auditing the
model, rendering the results with a brief on what to test next, making plans. Each agent reaches it through its own file in the workspace:

| agent | reads |
|---|---|
| Codex | `AGENTS.md` |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`) |
| Gemini CLI | `GEMINI.md` (imports `AGENTS.md`) |

Claude Code can also load the playbook as a skill:
`ln -s "$(pwd)/node_modules/startup-forecaster" ~/.claude/skills/startup-forecaster`.

## What's inside

| folder | what it does |
|---|---|
| [`forecaster/`](forecaster) | the `forecaster` command: workspaces, business-model presets, scaffolding a venture, grounding status, and every tool below |
| [`agentic-fetcher/`](agentic-fetcher) | find, archive and quote sources (the sourcing ladder, fetch queue, OCR, search) |
| [`distribution-compiler/`](distribution-compiler) | build each assumption's distribution from the evidence; the node format spec |
| [`montecarlo-engine/`](montecarlo-engine) | simulate the portfolio (business-model templates, correlated draws, cohort accounting); the data → model simulation build |
| [`forecast-renderer/`](forecast-renderer) | render and serve the results: the interactive model, a self-contained page, static pages |
| [`build-plan-generator/`](build-plan-generator) · [`exec-plan-generator/`](exec-plan-generator) | build-plan and execution-plan pages |

## Working on the tools

```sh
git clone https://github.com/AlkalineGarrett/startup-forecaster.git
npm test --prefix startup-forecaster                       # engine, compiler, fetcher, forecaster end to end
node startup-forecaster/forecaster/bin/forecaster.mjs init my-forecasts --link   # a workspace linked to this checkout
```

MIT licensed.
