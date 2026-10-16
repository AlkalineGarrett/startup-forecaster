# Build-plan template

Generates a **build-plan page** for a project sequence: an ordered list of steps
(each with a category definition, a feature/build table, and — where relevant — a
live competitive feature comparison), plus a sources section. Project-neutral: a
data-driven generator any project can use — see `example.mjs`.

The output is a single self-contained HTML document (doctype, charset, inline
styles, no external assets), ready to open in a browser, publish or share. Pass
`--fragment` to emit only `<title>` + `<style>` + the page content, for a host
that supplies its own `<html>/<head>/<body>`.

> **Doing this as a step?** Read its step doc first: [`plan-build.md`](plan-build.md) (step `plan-build`).
> A step doc holds the step's binding principles and procedure; this README describes the tool.

## Files

| File | Role |
|------|------|
| `render.mjs` | Project-neutral renderer (Node, ESM). Reads a spec, writes the HTML. |
| `build-plan.css` | Shared styles. Inlined into every page at render time. |
| `example.mjs` | The fictional worked example / starting point. |
| `test/` | Render tests (`npm test`). |

## Build

```sh
npx startup-forecaster build-plan example.mjs
# → writes example-build-plan.html next to the spec
# optional explicit output path, and a bare fragment instead of a full document:
npx startup-forecaster build-plan example.mjs /path/to/out.html --fragment
```

No dependencies — plain Node (tested on v22). Then open, publish or share the HTML.

## Add a new project

1. Copy `example.mjs` to `myproject.mjs`.
2. Edit its three exports (schema below). Replace the example content; keep the shape.
3. `npx startup-forecaster build-plan myproject.mjs` → `myproject-build-plan.html`.
4. Open, publish or share that HTML.

`build-plan.css` and `render.mjs` are shared — you never copy them per project.

## Data model

A spec module exports `META`, `STEPS`, and (optionally) `SOURCES`.

### `META`
```js
export const META = {
  productName: "HabitTracker",       // the "self" product: labels its edge/gap groups + own badge
  docTitle:    "… — Build Plan",  // the page <title>
  eyebrow:     "… · Roadmap …",   // small label above the H1 (optional)
  h1:          "Build plan — …",
  sequenceTag: "alpha → paid sync → teams",  // caption beside the "The sequence" heading (optional)
  sourcesIntro:"Key vendor and review URLs …",  // (optional)
  footerHtml:  "Built from …",    // raw HTML for the footer (optional)
};
```

### `STEPS` — ordered array, one per step
```js
{
  n: 1,                       // step number shown in the badge
  variant: "foundation" | "featured" | null,
                              // optional card styling: "foundation" = a muted base step the rest
                              // builds on; "featured" = an accented step worth drawing the eye to
  title: "Core tracker …",    // the H3
  size: "S" | "M" | "L" | "XL",
  tagHtml: "+2 capabilities", // optional raw HTML shown top-right of the step header, e.g. what the
                              // step adds ('<span class="none">…</span>' renders it faint)
  definition: {               // the category definition block (vendor-neutral; optional)
    type: "Habit tracker",
    summary: "a daily check-off app where each habit is a streak …",
    core:  "fast daily check-off, streak counting, …",
    moats: "the accumulating streak history, …",
  },
  featureGroups: [            // the build/feature table
    {
      label: "New · core loop",       // group header row (null = no header)
      mod: "extend" | null,           // "extend" renders the dimmer header for work that extends
                                      // something an earlier step built
      items: [
        {
          chip: "new" | "extend" | null,  // the code chip: "new" = a new capability (solid),
                                          // "extend" = extends an existing one (outlined); null → "—"
          code: "U1",                 // chip text: a short id for the capability
          name: "Daily check-off + streaks",
          bullets: ["One-tap complete", "…"],   // <li> contents (may contain inline HTML)
          size: "L" | "M" | "S" | "XL" | "—",
          row: "extend" | null,       // "extend" = the dimmer row styling for extension work
        },
      ],
    },
  ],
  noteHtml: "…" | null,       // optional "step-note" paragraph (raw HTML)
  competitive: null | {       // the competitive feature comparison (omit for non-market steps)
    ratingClass: "s" | "m" | "w",     // verdict pill color (strong/medium/weak)
    verdict: "Medium edge",
    competitors: ["StreakPro", "DoneList", …],   // the "vs" chips
    edge: "…",                // one-line differentiator (inline HTML ok)
    read: "…",                // honest assessment (inline HTML ok)
    features: [               // one row per atomic capability
      {
        group: "edge" | "shared" | "gap",
        importance: 1 | 2 | 3 | 4,          // 4 = "definitional" (core)
        feature: "One-tap daily check-off",
        products: ["HabitTracker", "StreakPro", …],  // who ships it; use productName for self
      },
    ],
    gapLater: { "Team dashboards": 3 },  // gap feature → step it closes at (→ becomes a Temporary gap)
    major: ["MegaSuite"],     // dominant players (rendered with a bold outline)
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
  { market: "Habit apps", items: [ { url: "https://…", label: "…" }, … ] },
];
```

## Notes

- Spec strings may contain inline HTML (`<b>`, `<code>`, `<i>`, `<br>`) — it is emitted
  verbatim, so keep it valid.
- The product named by `productName` gets the solid `self` badge in every comparison.
