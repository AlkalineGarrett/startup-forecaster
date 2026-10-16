// Number, currency, and text formatting used by the renderers.

// Ambient money scope: the currency amounts are in (its symbol) and the value of 1 unit of it in the portfolio's
// reporting currency (its rate). Outside any scope it is the reporting currency (configurePortfolio sets the
// symbol; default "$", rate 1). A venture renders in its own currency: `withCur` (portfolio-context.ts) opens a
// scope for a venture and restores the previous one, so per-project (panel) and per-row (table) scopes compose
// without leaking across ventures. Inside a scope, `fmt` uses the symbol, and everything that compares ventures
// on one scale (heatVars colours, sort keys, spread strips) converts through the rate (`inReporting`).
let _cur = "$";
let _rate = 1;
/** Set the reporting symbol (configurePortfolio sets it to the reporting currency's symbol). */
export function setCurrency(cur: string): void { _cur = cur; }
/** Run `fn` with amounts in the currency of symbol `cur`, worth `rate` each in the reporting currency. */
export function withMoneyScope<T>(cur: string, rate: number, fn: () => T): T {
  const prev = _cur, prevRate = _rate;
  _cur = cur;
  _rate = rate;
  try { return fn(); } finally { _cur = prev; _rate = prevRate; }
}
/** The ambient currency symbol, for captions/labels that aren't a formatted number. */
export function curSym(): string { return _cur; }
/** An amount in the ambient currency, converted into the reporting currency. */
export function inReporting(v: number): number { return v * _rate; }

// Number grouping locale (configurePortfolio({ locale }); default en-US). Fixed rather than the runtime's
// locale so a build is reproducible on any machine.
let _locale = "en-US";
let _nf0 = new Intl.NumberFormat(_locale, { maximumFractionDigits: 0 });
let _nf1 = new Intl.NumberFormat(_locale, { maximumFractionDigits: 1 });
export function setNumberLocale(locale: string): void {
  _locale = locale;
  _nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  _nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
}

/** Format a currency amount, scaling the unit to the number: whole units below 1k ($640), thousands below 1M
 * ($235k), millions from there ($1.3M, $12M; whole millions from 100M). Negative values get a leading "−";
 * anything that rounds to zero is a plain $0. Uses `cur`, else the ambient symbol. */
export function fmt(v: number, cur?: string): string {
  const c = cur ?? _cur;
  const a = Math.abs(v);
  let body: string;
  if (a < 0.5) return c + "0";
  if (a < 999.5) body = _nf0.format(Math.round(a));
  else if (a < 999_500) body = _nf0.format(Math.round(a / 1000)) + "k";
  else body = (a < 99_950_000 ? _nf1 : _nf0).format(a / 1e6) + "M";
  return (v < 0 ? "−" : "") + c + body;
}

/** Format a bare quantity (no currency): 1.2k, 15k, 2.5M, 0.025. */
export function fmtShort(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1000) return (v / 1000).toFixed(v >= 1e4 ? 0 : 1) + "k";
  if (v >= 1) return String(Math.round(v));
  return String(Math.round(v * 1000) / 1000);
}

/** Format a fraction as a whole-number percentage: 0.9 → "90%". */
export function pct(v: number): string {
  return (v * 100).toFixed(0) + "%";
}

/** Escape a value for safe interpolation into HTML/SVG text. */
export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ConfLevel = "high" | "med" | "low";

/** Normalise a free-text confidence note to a level. */
export function confClass(c: string): ConfLevel {
  c = (c || "").toLowerCase();
  if (c.indexOf("high") >= 0) return "high";
  if (c.indexOf("med") >= 0) return "med";
  return "low";
}

export function confLabel(c: string): string {
  const cl = confClass(c);
  return cl === "high" ? "high conf" : cl === "med" ? "med conf" : "low conf / prior";
}

// Anchored colour scale for money cells: 0 red · b1 orange · b2 green · b3+ blue (default 50k / 100k / 200k;
// configurePortfolio({ moneyBands: [b1, b2, b3] }) sets the portfolio's scale), with a deeper red for a loss. Returned as CSS custom properties (--hbg background,
// --hfg text) so a stylesheet rule can apply them at normal specificity and row-hover still wins.
const _mix = (a: number[], b: number[], t: number): number[] => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const _hex = (c: number[]): string => "#" + c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("");
const RED = [191, 74, 62];
const ORANGE = [200, 128, 34];
const GREEN = [47, 125, 87];
const BLUE = [45, 106, 160];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

let _bands: [number, number, number] = [50000, 100000, 200000];
/** Set the money colour-scale anchors (orange, green, blue), ascending and positive. */
export function setMoneyBands(b: [number, number, number]): void {
  if (!(b.length === 3 && b[0] > 0 && b[1] > b[0] && b[2] > b[1])) throw new Error(`moneyBands must be 3 ascending positive numbers (got ${JSON.stringify(b)})`);
  _bands = [b[0], b[1], b[2]];
}
/** The current money colour-scale anchors. */
export function moneyBands(): [number, number, number] { return _bands; }

/** The colour of a money cell for amount `v` in the ambient currency (converted into the reporting currency, so
 *  every venture sits on one scale). */
export function heatVars(amount: number): string {
  const v = inReporting(amount);
  let base: number[];
  let bgt = 0.84; // how far toward white the background tint sits
  if (v < 0) {
    base = [150, 40, 34];
    bgt = 0.72; // a loss reads more saturated / alarming
  } else if (v <= _bands[0]) base = _mix(RED, ORANGE, v / _bands[0]);
  else if (v <= _bands[1]) base = _mix(ORANGE, GREEN, (v - _bands[0]) / (_bands[1] - _bands[0]));
  else if (v <= _bands[2]) base = _mix(GREEN, BLUE, (v - _bands[1]) / (_bands[2] - _bands[1]));
  else base = BLUE;
  return `--hbg:${_hex(_mix(base, WHITE, bgt))};--hfg:${_hex(_mix(base, BLACK, 0.12))}`;
}
