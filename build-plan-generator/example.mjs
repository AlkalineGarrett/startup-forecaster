// Example spec for the build-plan generator — entirely fictional ("Habit Tracker").
// A new project = a copy of this file with its own META / STEPS / SOURCES.
// Run:  node render.mjs example.mjs   →   example-build-plan.html

export const META = {
  productName: "HabitTracker",
  docTitle: "Habit Tracker — Build Plan (example)",
  eyebrow: "Habit Tracker · example roadmap",
  h1: "Build plan — every feature, in order",
  sequenceTag: "alpha → paid sync → teams",
  sourcesIntro: "Fictional example links.",
  footerHtml: "Fictional example data for the <code>build-plan-generator</code> tool. Not a real product.",
};

export const STEPS = [
  {
    n: 1,
    variant: "foundation",
    title: "Core tracker (web · mobile; alpha)",
    size: "L",
    tagHtml: "+2 capabilities",
    definition: {
      type: "Habit tracker",
      summary: "a daily check-off app where each habit is a streak you keep alive.",
      core: "fast daily check-off, streak counting, reminders, and cross-device sync.",
      moats: "the accumulating streak history and the daily habit of opening the app.",
    },
    featureGroups: [
      {
        label: "New · core loop",
        mod: null,
        items: [
          { chip: "new", code: "U1", name: "Daily check-off + streaks", bullets: ["One-tap complete", "Streak + longest-streak counters"], size: "M" },
          { chip: "new", code: "U2", name: "Local reminders", bullets: ["Per-habit time-of-day nudge"], size: "S" },
        ],
      },
    ],
    noteHtml: "The alpha is local-only; sync lands in step 2.",
  },
  {
    n: 2,
    variant: "featured",
    title: "Paid cross-device sync",
    size: "M",
    definition: {
      type: "Subscription",
      summary: "cross-device sync + history, the first paid tier.",
      core: "account sync, unlimited history, and data export.",
      moats: "lock-in from multi-device history once habits accumulate.",
    },
    featureGroups: [
      { label: "New · sync", items: [{ chip: "new", code: "U3", name: "Account sync", bullets: ["End-to-end device sync", "Unlimited history"], size: "M" }] },
      {
        label: "Extend · core loop",
        mod: "extend",
        items: [
          { chip: "extend", code: "U1", name: "Streaks across devices", bullets: ["Merge check-offs from every device"], size: "S", row: "extend" },
        ],
      },
    ],
    competitive: {
      verdict: "Defensible on simplicity",
      ratingClass: "m",
      competitors: ["StreakPro", "DoneList", "MegaSuite"],
      edge: "fastest daily check-off; no setup tax",
      read: "win on speed + price, not feature breadth",
      major: ["MegaSuite"],
      gapLater: { "Team dashboards": 3 },
      features: [
        { feature: "One-tap daily check-off", importance: 4, group: "edge", products: ["HabitTracker", "StreakPro"] },
        { feature: "Streaks + history", importance: 3, group: "shared", products: ["HabitTracker", "StreakPro", "DoneList", "MegaSuite"] },
        { feature: "Cross-device sync", importance: 3, group: "shared", products: ["HabitTracker", "DoneList", "MegaSuite"] },
        { feature: "Team dashboards", importance: 2, group: "gap", products: ["MegaSuite"] },
      ],
    },
  },
];

export const SOURCES = [
  { market: "Habit apps", items: [{ url: "https://example.com/streakpro", label: "StreakPro pricing (fictional)" }, { url: "https://example.com/donelist", label: "DoneList features (fictional)" }] },
];
