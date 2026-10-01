// Example plan data for the exec-plan generator — entirely fictional ("Habit Tracker launch").
// A new plan = a copy of this file with your own meta / scale / columns / rows / details.
// Run:  node build.mjs data-example.mjs   ->   execution-plan-example.html
//
// Shape:
//   meta:    [label, text][]                      — masthead key/value spans
//   scale:   { lv, label }[]                      — the effort/priority legend (lv drives the glyph)
//   columns: { key, head, sub }[]                 — the phase columns of the calendar
//   rows:    { label, dates, cells: { <key>: task[] } }  — a week row (cells keyed by column key)
//            | { type:'gate', id, label }         — a decision gate spanning the row
//     task:  { id, label, lv, deps?: id[] }       — a cell task; deps draw dependency lines
//   details: { id, cls, meta, title, body: block[] }  — the detail pane content for a task/gate id
//     block: { p } | { term, text } | { ul:[] } | { ol:[] }

export default {
  titleTag: "Habit Tracker — Launch Plan (example)",
  eyebrow: "Habit Tracker · example execution plan",
  h1: "Launch plan — 4 weeks to paid",
  meta: [
    ["Window", "Wk 1 → Wk 4"],
    ["Team", "solo"],
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
    { id: "b1", cls: "det edge-b", meta: "Wk 1 · Build", title: "Daily check-off + streaks", body: [
      { term: "The core loop", text: "one-tap complete, streak counter, longest-streak." },
      { ul: ["Local storage first", "Streak resets at local midnight"] },
    ] },
    { id: "b2", cls: "det edge-b", meta: "Wk 2 · Build", title: "Account sync", body: [
      { p: "Cross-device sync — the first thing worth paying for." },
    ] },
    { id: "o1", cls: "det edge-o", meta: "Wk 1 · Distribution", title: "Landing page", body: [
      { p: "One page: promise, screenshot, email capture." },
    ] },
    { id: "o2", cls: "det edge-o", meta: "Wk 2 · Distribution", title: "Waitlist emails", body: [
      { p: "Two emails: welcome + launch-day nudge." },
    ] },
    { id: "b3", cls: "det edge-b", meta: "Wks 3–4 · Build", title: "Paywall + billing", body: [
      { p: "Gate sync behind a subscription; wire the store billing." },
    ] },
    { id: "o3", cls: "det edge-o", meta: "Wks 3–4 · Distribution", title: "Launch post", body: [
      { p: "Ship the launch post once billing works end-to-end." },
    ] },
    { id: "g1", cls: "det gate", meta: "Gate", title: "Alpha works end-to-end?", body: [
      { p: "If the core loop + sync are solid, proceed to paid. If not, fix before the paywall." },
    ] },
  ],
};
