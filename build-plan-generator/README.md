# Build-plan template

Generates a **build-plan page** for a project sequence: an ordered list of steps
(each with a category definition, a feature/build table, and — where relevant — a
live competitive feature comparison), plus a sources section. Project-neutral: a
data-driven generator any project can use — see `example.mjs`.

The output is a single self-contained HTML page, ready to publish as a claude.ai
Artifact (it renders the page content only — `<title>` + inline `<style>` + body —
because the Artifact wrapper supplies `<html>/<head>/<body>`). It also opens fine
directly in a browser.

## Files

| File | Role |
|------|------|
| `render.mjs` | Project-neutral renderer (Node, ESM). Reads a spec, writes the HTML. |
| `build-plan.css` | Shared styles. Inlined into every page at render time. |
| `example.mjs` | The fictional worked example / starting point. |
| `example-build-plan.html` | Generated output for the example. |

## Build

```sh
node render.mjs example.mjs
# → writes example-build-plan.html next to the spec
# optional explicit output path:
node render.mjs example.mjs /path/to/out.html
```

No dependencies — plain Node (tested on v22). Then publish the HTML as an Artifact.

## Add a new project

1. Copy `example.mjs` to `myproject.mjs`.
2. Edit its three exports (schema below). Replace the example content; keep the shape.
3. `node render.mjs myproject.mjs` → `myproject-build-plan.html`.
4. Publish that HTML as an Artifact.

`build-plan.css` and `render.mjs` are shared — you never copy them per project.

## Data model

A spec module exports `META`, `STEPS`, and (optionally) `SOURCES`.

### `META`
```js
export const META = {
  productName: "HabitTracker",       // the "self" product: labels its edge/gap groups + own badge
  docTitle:    "… — Build Plan",  // browser tab / Artifact title
  eyebrow:     "… · Roadmap …",   // small label above the H1 (optional)
  h1:          "Build plan — …",
  sequenceTag: "alpha → … → 10 verticals",  // caption beside the "The sequence" heading (optional)
  sourcesIntro:"Key vendor and review URLs …",  // (optional)
  footerHtml:  "Built from …",    // raw HTML for the footer (optional)
};
```

### `STEPS` — ordered array, one per step
```js
{
  n: 1,                       // step number shown in the badge
  variant: "found" | "hot" | null,   // optional highlight styling on the card
  title: "Outliner …",        // the H3; also the key that must match a competitive market
  size: "S" | "M" | "L" | "XL",
  unlockersHtml: "+U3",       // raw HTML shown top-right (e.g. '<span class="none">+0 unlockers</span>')
  definition: {               // the category definition block (vendor-neutral; optional)
    type: "Outliner",
    summary: "a note-taking app whose basic unit is …",
    core:  "fast hierarchical text entry, …",
    moats: "capture speed and reliability, …",
  },
  featureGroups: [            // the build/feature table
    {
      label: "New · native client",   // group header row (null = no header)
      mod: "ev" | null,               // "ev" renders the dimmer "Evolve" header
      items: [
        {
          chip: "new" | "ev" | null,  // the U-code chip style (null → "—")
          code: "U3",                 // chip text
          name: "Native outliner editor",
          bullets: ["Outline rendering — …", "…"],   // <li> contents (may contain inline HTML)
          size: "L" | "M" | "S" | "XL" | "—",
          row: "ftev" | null,         // "ftev" = evolve (dimmer) row styling
        },
      ],
    },
  ],
  noteHtml: "…" | null,       // optional "step-note" paragraph (raw HTML)
  competitive: null | {       // the competitive feature comparison (omit for non-market steps)
    ratingClass: "s" | "m" | "w",     // verdict pill color (strong/medium/weak)
    verdict: "Medium edge",
    competitors: ["Notion", "Obsidian", …],   // the "vs" chips
    edge: "…",                // one-line differentiator (inline HTML ok)
    read: "…",                // honest assessment (inline HTML ok)
    features: [               // one row per atomic capability
      {
        group: "edge" | "shared" | "gap",
        importance: 1 | 2 | 3 | 4,          // 4 = "definitional" (core)
        feature: "Rich-text editing",
        products: ["HabitTracker", "Notion", …],  // who ships it; use productName for self
      },
    ],
    gapLater: { "Real-time co-editing": 4 },  // gap feature → step it closes at (→ becomes a Temporary gap)
    major: ["Notion", "Obsidian", "Apple Notes"],  // dominant players (rendered with a bold outline)
  },
}
```

Rendering rules the engine applies automatically:

- **Groups** sort **edge → shared → temporary gap → permanent gap**; within a group,
  by importance (definitional first). `gapLater` moves a gap into the amber
  "Temporary gap" section with a `→ step N` tag.
- **Competitor colors** (`c1…c8`) are assigned per card by first appearance (max 8).
- **Definitional** rows (importance 4) get the violet 4-bar glyph and a `core` tag.
- **Adjacent substitute**: a competitor that lacks any definitional feature of the card
  is auto-detected and hatched everywhere on that card.
- **Major players** (`major`) get a bold outline; everyone else reads as niche.
- Group labels use `META.productName` (e.g. "HabitTracker edge" / "HabitTracker gap").

### `SOURCES` — optional, ordered
```js
export const SOURCES = [
  { market: "Notes and outliner", items: [ { url: "https://…", label: "…" }, … ] },
];
```

## Notes

- Spec strings may contain inline HTML (`<b>`, `<code>`, `<i>`, `<br>`) — it is emitted
  verbatim, so keep it valid.
- `example.mjs` was generated once from the original hand-built page and is now edited
  directly; there is no build step that regenerates it.
