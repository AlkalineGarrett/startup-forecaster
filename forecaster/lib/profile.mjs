// The workspace profile: `profile.json` at the workspace root, the person's and each venture's answers that
// the model's settings come from. The agent writes it during onboarding (add-venture.md); `startup-forecaster init`
// scaffolds it with nulls for what only the person can say and the guessable defaults filled in.
//
// The engine never reads this file. `startup-forecaster` turns it into a generated module, `<dataRoot>/profile-data.ts`
// (PROFILE_SETTINGS: the configurePortfolio settings; PROFILE_GAPS: what is still unanswered), refreshed
// before every command, and the workspace's src/projects.ts passes PROFILE_SETTINGS to configurePortfolio.
//
// A null field is unanswered: it never silently becomes a default. `startup-forecaster status` lists it as
// "profile incomplete", and an unset tax shows as "no tax configured". A field the person chose not to
// answer holds "declined": it is answered, the engine keeps its neutral default, and the outputs say so.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeTax, symbolOf } from "../../montecarlo-engine/src/settings.mjs";

export const PROFILE_FILE = "profile.json";
export const PROFILE_MODULE = "profile-data.ts";
export const DECLINED = "declined";

/** A fresh profile: nulls for what only the person can say, the guessable defaults filled in. */
export function emptyProfile() {
  return {
    person: {
      country: null,                    // tax residence (ISO country or name); unguessable
      reportingCurrency: null,          // ISO code; guessable from the country, confirm
      legalStructure: null,             // e.g. "sole trader", "company"; unguessable
      taxNote: null,                    // e.g. "PT company: IRC 21% + derrama"; with the rate, cited
      businessTaxRate: null,            // effective rate on positive business profit; researched for country + structure
      team: null,                       // "solo" | "team"; unguessable
      paidTeamCostPerYear: null,        // if team: yearly payroll, reporting currency; unguessable
      founderHoursPerWeek: null,        // unguessable
      meaningfulRevenuePerYear: null,   // reporting currency: what makes a venture worth it (successThreshold)
      decisionFloorPerYear: null,       // reporting currency: the minimum to keep going (decisionFloor)
      discountRate: 0.1,                // guessable default
      horizonYears: 5,                  // guessable default
      headlineFromYear: 2,              // guessable default
      costsStart: "start",              // guessable from team: a paid team → "start", solo unpaid → "readiness"
      pairAttentionOverhead: 0,         // guessable from team: solo → 0.15, team → 0
      exchangeRates: {},                // code → { rate (1 code in the reporting currency), source, asOf }
    },
    ventures: {},                       // id → { market, currency, channel, team, … } (VENTURE_FIELDS)
    channels: {},                       // payment channels beyond the engine's built-ins: name → { realisation, fixedFee }
    answeredAt: {},                     // "person.country" / "ventures.<id>.market" → "YYYY-MM-DD[ note]"
  };
}

/** A venture's entry: what only the person can say (market, who builds it, decided prices) and what is
 *  guessed from the market (currency, channel). */
export function emptyVenture() {
  return {
    market: null,      // the country / region it sells into; unguessable
    currency: null,    // ISO code it reports in (and prices in, unless priceCurrency says otherwise); guessable from the market
    channel: null,     // payment channel (a name, or a list when the model uses several); guessable from model + market
    team: null,        // "solo" | "team" when it differs from person.team; null = same as the person
  };
}

export const profilePath = (root) => join(root, PROFILE_FILE);

/** The workspace's profile, or null when it has none. */
export function readProfile(root) {
  const f = profilePath(root);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`); }
}

export function writeProfile(root, profile) {
  writeFileSync(profilePath(root), JSON.stringify(profile, null, 2) + "\n");
}

/** True for an answered field: neither unanswered (null) nor declined. */
export const isSet = (v) => v != null && v !== DECLINED;
const rateOf = (r) => (r && typeof r === "object" ? r.rate : r);

/** Fields still unanswered (null), as "person.<field>" / "ventures.<id>.<field>". `ventureIds` limits the
 *  venture check to the ventures in the model (default: every venture in the profile). */
export function profileGaps(profile, ventureIds) {
  if (!profile) return [PROFILE_FILE];
  const p = profile.person || {};
  const gaps = [];
  for (const k of ["country", "reportingCurrency", "legalStructure", "businessTaxRate", "team", "founderHoursPerWeek", "meaningfulRevenuePerYear", "decisionFloorPerYear"])
    if (p[k] == null) gaps.push(`person.${k}`);
  if (p.team === "team" && p.paidTeamCostPerYear == null) gaps.push("person.paidTeamCostPerYear");
  if (typeof p.businessTaxRate === "number" && p.businessTaxRate > 0 && p.taxNote == null) gaps.push("person.taxNote");
  const ventures = profile.ventures || {};
  for (const id of ventureIds || Object.keys(ventures)) {
    const v = ventures[id];
    if (!v) { gaps.push(`ventures.${id}`); continue; }
    for (const k of ["market", "currency", "channel"]) if (v[k] == null) gaps.push(`ventures.${id}.${k}`);
  }
  return gaps;
}

/** Fields the person declined to answer. */
export function profileDeclined(profile) {
  if (!profile) return [];
  const out = Object.entries(profile.person || {}).filter(([, v]) => v === DECLINED).map(([k]) => `person.${k}`);
  for (const [id, v] of Object.entries(profile.ventures || {}))
    for (const [k, x] of Object.entries(v || {})) if (x === DECLINED) out.push(`ventures.${id}.${k}`);
  return out;
}

/** Answers older than `months` (by answeredAt's leading date), to re-confirm. */
export function staleAnswers(profile, { months = 6, today = new Date() } = {}) {
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - months);
  return Object.entries(profile?.answeredAt || {})
    .filter(([, at]) => { const d = new Date(String(at).slice(0, 10)); return !Number.isNaN(+d) && d < cutoff; })
    .map(([k]) => k);
}

/** The reporting currency the profile sets (default USD, as the engine's). */
export const reportingCode = (profile) => (isSet(profile?.person?.reportingCurrency) ? profile.person.reportingCurrency : "USD");

/** Value of 1 `from` in `to`, from the profile's exchange rates (each into the reporting currency); null
 *  when a rate is missing. */
export function rateBetween(profile, from, to) {
  if (from === to) return 1;
  const R = reportingCode(profile);
  const rates = profile?.person?.exchangeRates || {};
  const inR = (c) => (c === R ? 1 : rateOf(rates[c]));
  const a = inR(from), b = inR(to);
  return a > 0 && b > 0 ? a / b : null;
}

/** Text describing the tax the profile's settings configure: the engine's taxDescription wording (settings.mjs
 *  describeTax), from the same settings the engine receives. A personal tax schedule is code in the workspace
 *  (src/projects.ts), not in the profile, so it shows here only through the profile's tax note. */
export function taxSummary(profile) {
  const s = profileSettings(profile);
  return describeTax({ note: s.taxNote, businessTax: s.businessTax ?? 0 });
}

/** The configurePortfolio settings the profile sets. Only answered fields become settings; everything else
 *  keeps the engine's neutral default (and stays a gap in PROFILE_GAPS / `startup-forecaster status`). */
export function profileSettings(profile) {
  const p = profile?.person || {};
  const s = {};
  if (isSet(p.reportingCurrency)) s.reportingCurrency = { code: p.reportingCurrency, symbol: symbolOf(p.reportingCurrency) };
  const rates = Object.fromEntries(Object.entries(p.exchangeRates || {}).map(([k, r]) => [k, rateOf(r)]).filter(([, r]) => r != null));
  if (Object.keys(rates).length) s.exchangeRates = rates;
  if (typeof p.meaningfulRevenuePerYear === "number") s.successThreshold = p.meaningfulRevenuePerYear;
  if (typeof p.decisionFloorPerYear === "number") s.decisionFloor = p.decisionFloorPerYear;
  if (typeof p.discountRate === "number") s.discountRate = p.discountRate;
  if (typeof p.horizonYears === "number") s.horizonYears = p.horizonYears;
  if (typeof p.headlineFromYear === "number") s.headlineFromYear = p.headlineFromYear;
  if (isSet(p.costsStart)) s.costsStart = p.costsStart;
  if (typeof p.pairAttentionOverhead === "number") s.pairAttentionOverhead = p.pairAttentionOverhead;
  if (typeof p.businessTaxRate === "number") s.businessTax = p.businessTaxRate;
  if (isSet(p.taxNote)) s.taxNote = p.taxNote;
  else if (p.businessTaxRate === DECLINED) s.taxNote = "no tax configured (declined in the profile)";
  if (profile?.channels && Object.keys(profile.channels).length) s.channels = profile.channels;
  if (isSet(p.locale)) s.locale = p.locale;
  // Each venture's currency, and the currency its prices are quoted in when that differs (e.g. USD
  // app-store prices in a EUR-reported venture): ISO codes only; the engine derives the symbol and the fx.
  const ventures = {};
  for (const [id, v] of Object.entries(profile?.ventures || {})) {
    const o = {};
    if (isSet(v?.currency)) o.currency = v.currency;
    if (isSet(v?.priceCurrency)) o.priceCurrency = v.priceCurrency;
    if (Object.keys(o).length) ventures[id] = o;
  }
  if (Object.keys(ventures).length) s.ventures = ventures;
  return s;
}

/** The generated module's source. */
export function profileModuleSource(profile) {
  const lit = (v) => JSON.stringify(v, null, 2);
  return `// GENERATED from ${PROFILE_FILE} by startup-forecaster (forecaster/lib/profile.mjs) before every
// \`startup-forecaster\` command. Do not edit: change ${PROFILE_FILE} (the onboarding in add-venture.md writes it).
// PROFILE_SETTINGS are the configurePortfolio settings the profile sets; anything it leaves unanswered keeps the
// engine's neutral default and is listed in PROFILE_GAPS.
export const PROFILE_SETTINGS = ${lit(profileSettings(profile))} as const;

export const PROFILE_GAPS: string[] = ${lit(profileGaps(profile))};
`;
}

/** Refresh `<dataRoot>/profile-data.ts` from profile.json when it is out of date. Writes it when the profile
 *  exists, or when the module exists without one (so the bootstrap still loads). Returns the path written,
 *  or null. */
export function syncProfileModule(root, dataRoot) {
  if (!dataRoot) return null;
  const out = join(dataRoot, PROFILE_MODULE);
  const profile = readProfile(root);
  if (!profile && !existsSync(out)) return null;
  const src = profileModuleSource(profile);
  if (existsSync(out) && readFileSync(out, "utf8") === src) return null;
  writeFileSync(out, src);
  return out;
}

/** What the profile answers and lacks, for `startup-forecaster profile` / `status`. `ventureIds`: the ventures to
 *  check (default: every venture with a distributions file). */
export function profileReport(pf, ventureIds) {
  const profile = readProfile(pf.root);
  let ids = ventureIds;
  if (!ids) {
    const dir = pf.distributionData && join(pf.distributionData, "projects");
    ids = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, "")) : [];
  }
  const code = reportingCode(profile);
  return {
    file: profilePath(pf.root),
    exists: !!profile,
    gaps: profileGaps(profile, ids),
    declined: profileDeclined(profile),
    stale: staleAnswers(profile),
    tax: taxSummary(profile),
    reportingCurrency: { code, symbol: symbolOf(code), set: isSet(profile?.person?.reportingCurrency) },
    settings: profileSettings(profile),
  };
}

export function printProfileReport(rep, { full = false, stream = console.log } = {}) {
  if (!rep.exists) {
    stream(`profile incomplete: no ${PROFILE_FILE} — the settings are the engine's neutral defaults (USD, no tax, placeholder thresholds). The onboarding in add-venture.md writes it.`);
    return;
  }
  if (rep.gaps.length) stream(`profile incomplete: ${rep.gaps.join(", ")}\n  (run the onboarding in add-venture.md; until then each setting they drive keeps the engine's neutral default)`);
  else stream(`profile: complete (${PROFILE_FILE})`);
  if (rep.declined.length) stream(`declined: ${rep.declined.join(", ")} (the engine's neutral default is used, and said so)`);
  if (rep.stale.length) stream(`answered over 6 months ago, re-confirm: ${rep.stale.join(", ")}`);
  stream(`tax: ${rep.tax}`);
  stream(`reporting currency: ${rep.reportingCurrency.code} (${rep.reportingCurrency.symbol})${rep.reportingCurrency.set ? "" : " — the default, not answered"}`);
  if (full) stream(`settings passed to the engine:\n${JSON.stringify(rep.settings, null, 2).replace(/^/gm, "  ")}`);
}
