// Example plan data for the exec-plan generator — entirely fictional ("Habit Tracker launch").
// A new plan = a copy of this file with your own meta / scale / columns / rows / details.
// Run:  npx startup-forecaster exec-plan data-example.mjs   ->   execution-plan-example.html
//
// Shape:
//   meta:    [label, text][]                      — masthead key/value spans
//   scale:   { lv, label }[]                      — the priority legend (lv "1"–"5" drives the colored glyph; "0" = ·)
//   columns: { key, head, sub }[]                 — the calendar's columns (at most 3; keys are free-form,
//                                                   tinted by position: 1st, 2nd, 3rd palette color)
//   rows:    { label, dates, cells: { <key>: task[] } }  — a week row (cells keyed by column key)
//            | { type:'gate', id, label }         — a decision gate spanning the row
//     task:  { id, label, lv, deps?: id[] }       — a cell task; deps draw dependency lines
//   details: { id, column | gate:true, meta, title, body: block[] }  — the detail pane for a task/gate id;
//            column = the task's column key (colors its edge), gate:true for a decision gate
//     block: { p } | { term, text } | { ul:[] } | { ol:[] }

export default {
  titleTag: "Habit Tracker — Launch Plan (example)",
  eyebrow: "Habit Tracker · example execution plan",
  h1: "Launch plan — 4 weeks to paid",
  meta: [
    ["Window", "Wk 1 → Wk 4"],
    ["Goal", "first paying users"],
    ["Hover", "a task for its dependencies · <b>click</b> for detail →"],
  ],
  footer: "Fictional example data for the <code>exec-plan-generator</code> tool. Not a real plan.",
  tailHtml: "",
  defaultHint: "Hover a task to see what it depends on; click it for detail.",
  themeCSS: "",
  scale: [
    { lv: "5", label: "critical path" },
    { lv: "3", label: "important" },
    { lv: "1", label: "nice to have" },
  ],
  columns: [
    { key: "build", head: "Build", sub: "the app" },
    { key: "ops", head: "Distribution", sub: "get users" },
  ],
  rows: [
    {
      label: "Week 1", dates: "core loop",
      cells: {
        build: [{ id: "b1", label: "Daily check-off + streaks", lv: "5" }],
        ops: [{ id: "o1", label: "Landing page", lv: "3" }],
      },
    },
    {
      label: "Week 2", dates: "sync",
      cells: {
        build: [{ id: "b2", label: "Account sync", lv: "5", deps: ["b1"] }],
        ops: [{ id: "o2", label: "Waitlist emails", lv: "3", deps: ["o1"] }],
      },
    },
    { type: "gate", id: "g1", label: "Alpha works end-to-end?" },
    {
      label: "Weeks 3–4", dates: "paid",
      cells: {
        build: [{ id: "b3", label: "Paywall + billing", lv: "5", deps: ["b2"] }],
        ops: [{ id: "o3", label: "Launch post", lv: "5", deps: ["o2", "b3"] }],
      },
    },
  ],
  details: [
    { id: "b1", column: "build", meta: "Wk 1 · Build", title: "Daily check-off + streaks", body: [
      { term: "The core loop", text: "one-tap complete, streak counter, longest-streak." },
      { ul: ["Local storage first", "Streak resets at local midnight"] },
    ] },
    { id: "b2", column: "build", meta: "Wk 2 · Build", title: "Account sync", body: [
      { p: "Cross-device sync — the first thing worth paying for." },
    ] },
    { id: "o1", column: "ops", meta: "Wk 1 · Distribution", title: "Landing page", body: [
      { p: "One page: promise, screenshot, email capture." },
    ] },
    { id: "o2", column: "ops", meta: "Wk 2 · Distribution", title: "Waitlist emails", body: [
      { p: "Two emails: welcome + launch-day nudge." },
    ] },
    { id: "b3", column: "build", meta: "Wks 3–4 · Build", title: "Paywall + billing", body: [
      { p: "Gate sync behind a subscription; wire the store billing." },
    ] },
    { id: "o3", column: "ops", meta: "Wks 3–4 · Distribution", title: "Launch post", body: [
      { p: "Ship the launch post once billing works end-to-end." },
    ] },
    { id: "g1", gate: true, meta: "Gate", title: "Alpha works end-to-end?", body: [
      { p: "If the core loop + sync are solid, proceed to paid. If not, fix before the paywall." },
    ] },
  ],
};
