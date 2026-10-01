# Build-plan & competitive-analysis principles

The working principles established while building and refining the build-plan artifact
and its per-step competitive feature comparisons. The
[README](README.md) covers the template's mechanics; this covers the **judgment** behind
the data it renders — how to decide what a feature is, how to classify it, and how the
page should read. They are meant to carry to any project that reuses the template.

## 1. What a "feature" is

- **Atomic, buyer-evaluable capabilities.** Each comparison row is one thing a buyer can
  evaluate on its own. Decompose compound items ("network effects · community · templates"
  is three rows, not one) and combine near-duplicates. Half-decomposed lists hide both
  real edges and real gaps.
- **Section sizes are emergent, never balanced.** Don't bias toward equal
  edge / shared / gap counts. The real distribution is the finding — a card that is mostly
  gaps should look mostly gaps.
- **Edge means advantage over the _mainstream_.** An "edge" row is one no mainstream
  competitor ships. A genuinely niche player (e.g. org-mode) may have it; that's still an
  edge, shown as a badge on the edge row — not demoted to "shared" because one fringe tool
  qualifies.

## 2. Sequence-aware classification

- **Judge against what's built by that step, cumulatively.** Edge / shared / gap is
  relative to the base substrate _plus_ every capability added in that step and all prior
  steps — not the base app. A capability earned in an earlier vertical is "shared" by a
  later one, not a fresh gap.
- **A gap counts only if it's still absent after that step.** If the same step ships it,
  it isn't a gap there.
- **Two kinds of gap, kept visually distinct.** A _temporary_ gap is one the roadmap
  closes later (tag it with the step); a _permanent_ gap is one nothing in the plan closes.
  Temporary gaps are "not yet," not weaknesses — don't let them read as the same thing.
- **The "is it actually hard on our substrate?" test.** Before logging a gap, ask whether
  it's an easy win given what's already built. Easy wins (postmortems, dedup, status pages)
  get folded into the plan, not recorded as gaps.
- **Not every difference is a feature gap.** Brand, market position, pricing, distribution,
  and self-definitional traits are not feature rows. Collaborative editing that is
  save-synced is _shared_, not a gap.

## 3. Importance and the definitional tier

- **Four tiers: Low / Medium / High / Definitional.**
- **Gap importance is the higher of two signals** — breadth of adoption (lacking what
  _all_ rivals ship = High) _or_ dominance-explanation (a one-vendor feature is High if
  that vendor wins on it in the segment this card targets). It's Low only when both are
  weak. This answers "if it's so important, why does only one competitor have it?" — because
  that feature can be _why_ the leader wins.
- **Definitional = the category doesn't exist without it** (telephony escalation for
  on-call; formula fields for a database). A definitional feature landing on a _gap_ means
  you are not really in that category yet — the most important signal on the page.
- **Definitional features are universal across genuine peers**, so a definitional row lists
  the whole competitor set. A listed rival that lacks one is an **adjacent substitute**
  (hatched), not a full peer — and the feature _stays_ definitional. Don't downgrade a
  category-defining feature just because a substitute skips it.
- **Mark dominant players; leave niche ones unmarked.** A gap every leader ships reads
  very differently from one only a fringe tool has — the outline on major players makes that
  difference legible at a glance, and keeps importance honest.

## 4. Honesty and grounding

- **Live-verify, then re-derive — even when it hurts.** One research pass per market, and
  let the evidence move the verdict (FP&A dropped Strong → Medium; "inline compute" turned
  out not to be unique). Treat any single competitor claim as ~90% confident and
  pressure-test it before betting on it.
- **Name the permanent ceiling.** For a solo dev it is almost always integration / connector
  breadth. Say so plainly rather than hand-waving past it.
- **Critique the result; don't half-ass it.** Every pass ends by attacking its own output —
  that critique is the next pass's work-list.

## 5. Editorial — how the page reads

- **Present tense, conclusion-first.** State what is true now. Strip every trace of prior
  versions and of the process that produced them ("reframed", "the live pass corrected the
  old read", "downgrades from Strong", "thinner after grounding"). The reader gets one
  grounded interpretation, not its history.
- **No explanatory scaffolding in the artifact.** Cut deks, how-to-read legends, and
  methodology notes. If an encoding needs a legend to be understood, simplify the encoding
  instead.
- **One representative term, not slashes.** Collapse descriptive "X / Y / Z" lists to a
  single word or a short "and" list. Slashes survive only _inside_ product names
  (Strong / Hevy, Vector / memory stores).
- **Category definitions are vendor-neutral and structured.** Define what the app _type_ is,
  what is _core_ to it, and what the _moats_ are — without naming your own product. Put
  type / core / moats on their own lines; don't bury them in a paragraph.

## 6. Template and tooling

- **Separate template from data.** Structure, styles, and rendering logic are
  project-neutral; each project is a data spec. Parameterize anything product-specific
  (group labels derive from `productName`, not a hard-coded string).
- **Match the codebase's language and organization.** The generator is Node ESM to match
  the surrounding app, not a bolted-on second-language pipeline, and it lives under the
  existing `templates/` convention.
- **Verify refactors by fidelity, not faith.** When turning a hand-built page into a
  generator, diff the regenerated output against the original until it is byte-identical
  (modulo intended drops). Structural counts — badges, rows, class names — catch silent
  losses that a glance would miss (the `ftev` evolve-row styling nearly vanished this way).
- **Prune what you no longer render.** Remove CSS and markup for cut sections; a template
  should not ship rules for things it never emits.
