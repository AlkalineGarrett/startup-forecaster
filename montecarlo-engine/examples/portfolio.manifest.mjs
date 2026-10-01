// Example portfolio bundle manifest. The engine's build.mjs owns the ENGINE module order; this says
// which PORTFOLIO data modules to splice in and after which engine "anchor" module. The fictional
// habit-tracker attaches (via configurePortfolio) after apply-distributions, mirroring where a real
// portfolio's bootstrap runs — before simulate/render/app read it. Swap this for your own portfolio.
export const TITLE = "Habit Tracker — Monte-Carlo (example)";

export const PORTFOLIO_MODULES = {
  "apply-distributions.ts": ["habit-tracker.ts"],
};
