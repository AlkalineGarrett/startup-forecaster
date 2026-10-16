# Startup forecaster: the agent playbook

This is the process any coding agent follows when someone asks it to forecast, simulate, research or
visualize a venture with these tools. This file routes a request to its **steps**; each step's procedure and
principles live in its own doc, next to the tool that does it. Read all of this file before your first
action, then follow it end to end.
The tools do the mechanics. Your job is the research, the checking and the honesty: every number a person
sees must trace back to evidence or to a judgement that is labelled as one.

## Where things are

- **The tools** are the `startup-forecaster` npm package. Every tool runs as `npx forecaster <command>`
  (`npx forecaster help` lists them; each prints its usage with `-h`). Its documents are in
  `node_modules/startup-forecaster/`; below, `<pkg>` means that folder.
- **The data** lives in a **workspace**: the folder whose root holds `portfolio.config.mjs` and depends on
  the package. Every tool finds the workspace by walking up from the current directory, so run commands
  from inside it. If there is no workspace yet, create one with `npx startup-forecaster init <dir>`. If the
  workspace has no `node_modules/`, run `npm install` first.

```
<workspace>/
  portfolio.config.mjs   where every part lives (fields documented in <pkg>/montecarlo-engine/config.mjs)
  profile.json           the person's answers (tax, currency, team, thresholds) and each venture's (market,
                         currency, channel): the model's settings come from it
  package.json           depends on startup-forecaster; npm run simulate / serve / build / … run forecaster commands
  src/projects.ts        registers the ventures (`npx forecaster new` adds them at the `// forecaster:` markers)
  src/projects/<id>.ts   a venture's structure: node ids, labels, correlations, business-model template
  distributions/         projects/<id>.json (each node's distribution) · corpus/ (evidence) · build/ (compiled)
  sources/               the source archive: documents.json, cores/ (text of each source), MANIFEST.csv, fetch queue
  dossiers/<id>/         description, research brief, market notes
  plans/                 build plans and execution plans
  golden.json            the frozen model outputs; its diff shows what a change did to the forecast
```

Requirements: Node 22.13 or newer. The package has no dependencies.

## Start every task the same way

1. **Find the workspace.** Locate `portfolio.config.mjs`, then read it and the workspace's `AGENTS.md`.
2. **Read `profile.json`.** It holds what the person has already told you; reuse it, never re-ask. If
   analysis is starting (a new venture, a first forecast) and the profile is incomplete
   (`npx forecaster profile` lists the gaps), run the onboarding in `<pkg>/forecaster/add-venture.md` first.
   Never stand in a default for an answer only the person can give.
3. **See the current state.** Run `git status` (don't build on someone's half-finished change) and
   `npx forecaster status`, which shows every venture's headline and how well each node is grounded.
4. **Read what exists for the venture in question:** `dossiers/<id>/`, its `src/projects/<id>.ts`, its
   `distributions/projects/<id>.json`. Earlier work and decisions live there.
5. **Be sure which venture is meant.** A node can live in more than one place: a venture and its variants
   (keyed `<id>::<variant>::<node>`), or two similar ventures. Search the distributions for the node id
   before editing, and if the request could apply to more than one, ask which the person means.
6. **Find where the request enters the pipeline** (below), then run that step and every step after it.

Ask only about what is genuinely the person's call: their goals, constraints, prices they intend to charge,
what they will and won't do. Look everything else up.

## How to do a step

**Before a step's first action, open its doc and read it to the end, including its principles section and
every file it names as required reading.** Those principles are part of the step: a step done without them
has not been done, however good its output looks. Read the doc again for each new task rather than working
from memory of an earlier read, and never substitute this file's summary for the doc. When you report back,
name the steps you ran.

## Ending your reply: what the person must do

Some work only the person can do. The biggest is fetching the pages no agent can reach. Before you send your
final reply, run `npx forecaster fetch-request export --md`. If it lists any requests, **end your reply with
them**: the very last thing in the message, after your summary, never at the beginning or in the middle,
where it gets lost. Make it impossible to miss:

```
## ⚠ Your turn: N pages to fetch by hand

These hold evidence the forecast needs, and no agent can reach them (login, paywall, browser-only):

1. <url> — <what it holds> (for <venture::node>)
2. …

Run these in <workspace path>:
- `FIRECRAWL_API_KEY=<key> npx forecaster firecrawl` fetches all of them if you have a Firecrawl key
- otherwise save each page in your browser and run `npx forecaster install-source <file> --url <url>`

Tell me when they're in and I'll add them to the forecast.
```

List every pending `human_only` request, verbatim from the export, not just the ones from this task. Put any
other decisions you need from the person in the same closing block (an answer to confirm, a publish to
approve), after the fetch list. If nothing is pending, leave the block out.

| step | doc (in `<pkg>/`) | what it does |
|---|---|---|
| `add-venture` | `forecaster/add-venture.md` | frame an idea and scaffold it into the model |
| `ground-evidence` | `agentic-fetcher/ground-evidence.md` | find, archive and record the evidence for a venture's nodes |
| `audit-evidence` | `agentic-fetcher/audit-evidence.md` | audit the evidence before any distribution is built on it |
| `build-distributions` | `distribution-compiler/build-distributions.md` | build the nodes' distributions from their audited evidence |
| `audit-distributions` | `distribution-compiler/audit-distributions.md` | audit each distribution against its evidence |
| `build-simulation` | `montecarlo-engine/build-simulation.md` | change the model and re-run the simulation |
| `audit-simulation` | `montecarlo-engine/audit-simulation.md` | check the simulation is right before anyone relies on its numbers |
| `render-forecast` | `forecast-renderer/render-forecast.md` | render the forecast as pages people can explore and share |
| `plan-build` | `build-plan-generator/plan-build.md` | plan a product as a sequenced feature roadmap with competitor comparisons |
| `plan-execution` | `exec-plan-generator/plan-execution.md` | lay out the work as a calendar of tasks by phase, with dependencies |

## The pipeline

```
ground-evidence → audit-evidence → build-distributions → audit-distributions → build-simulation → audit-simulation → render-forecast
```

Each audit step checks the output of the build step before it, and the next build step starts only once it
has passed: evidence before distributions are built on it, distributions before the simulation uses them,
the simulation before anyone relies on its numbers. `render-forecast` is where the person sees the result.

`add-venture` comes before the pipeline for a new venture. `plan-build` and `plan-execution` sit outside it.

## Which steps a request needs

A request enters the pipeline at one step. **Run that step, then every step after it in the pipeline**, so
the change reaches the page the person looks at. Only if the person asks for just one step (or to stop
early) do you leave the later steps out.

| the person asks to… | enter at |
|---|---|
| evaluate, forecast or add an idea, product or venture | `add-venture`, then the pipeline from `ground-evidence` |
| run the whole pipeline for a venture | `ground-evidence` |
| research a number, ground an assumption, add evidence | `ground-evidence` |
| audit the sources or evidence | `audit-evidence` |
| change an assumption, a price, a market size | `build-distributions` |
| audit the distributions | `audit-distributions` |
| change the model's structure; re-simulate; refresh the numbers | `build-simulation` |
| check the model or simulation is right | `audit-simulation` |
| show, chart, visualize, serve or publish results; explain the forecast or what to test next | `render-forecast` |
| make a build plan | `plan-build` (outside the pipeline) |
| make an execution plan | `plan-execution` (outside the pipeline) |

## Rules that hold in every step

- Every number in the model traces to `distributions/`. Nothing numeric is typed into a project file.
- A placeholder, a guess or a proxy is labelled as one: in the data (support score, speculation) and in
  everything you tell the person.
- Show the person source figures verbatim; never paraphrase them into stronger claims.
- Never re-fetch or re-ask for a source that is already archived. Search first.
- Never drive an automated browser to fetch a source.
- Never hand-edit generated files; regenerate them.
- Confirm with the person before publishing or sharing anything outside their machine.
- Commit finished changes in the workspace in coherent steps if the person wants commits. Don't push unless
  the person says to.

## Reference

| topic | file (in `<pkg>/`) |
|---|---|
| the node format and its invariants | `distribution-compiler/schema/SCHEMA.md` |
| why the format is built this way | `distribution-compiler/PRINCIPLES.md` |
| workspace config fields | `montecarlo-engine/config.mjs` |
| engine, templates, pages | `montecarlo-engine/README.md` |
| the CLI and presets | `forecaster/README.md` |
