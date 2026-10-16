// The settings vocabulary the engine and the startup-forecaster CLI share: currency symbols, the built-in payment
// channels and the wording of the tax description. Plain JavaScript with no imports and no side effects,
// because forecaster/lib/profile.mjs runs without the TypeScript loader. The engine's .ts modules import it
// like any other module (the page bundler lists it ahead of format.ts).

/** A currency's display symbol from its ISO code ("GBP" → "£", "USD" → "$"); the code itself when Intl has
 *  no narrow symbol for it. */
export function symbolOf(code) {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(1).find((x) => x.type === "currency");
    return part ? part.value : code;
  } catch { return code; }
}

/** The built-in payment channels: the collected fraction of list price before fixed fees, and the fixed fee
 *  per charge (processor + tax handling), in the VENTURE'S OWN currency (~0.70 is 7% of a 10.00 charge before
 *  % rates). A workspace adds or overrides channels with configurePortfolio({ channels }). */
export const BUILTIN_CHANNELS = {
  euConsumerVAT: { realisation: 0.73, fixedFee: 0.7 }, // EU consumer, VAT-inclusive pricing
  usStripe: { realisation: 0.87, fixedFee: 0.7 },      // US customer, card via Stripe
  appStoreSBP: { realisation: 0.85, fixedFee: 0.7 },   // app store, Small Business Program
  eeaB2B: { realisation: 0.91, fixedFee: 0.7 },        // EEA-domestic card, business buyer (VAT reverse-charged)
  usB2B: { realisation: 0.97, fixedFee: 0.7 },         // US enterprise, annual invoice via ACH (0.8% capped) + Stripe Billing 0.7% + minor collection slip
  none: { realisation: 1.0, fixedFee: 0.7 },           // revenue that arrives already netted (e.g. a platform that pays out net)
};

/** The built-in channel names. */
export const BUILTIN_CHANNEL_NAMES = Object.keys(BUILTIN_CHANNELS);

/** What the results say about tax: the configured note, else the flat business rate, else "no tax configured".
 *  `note` the tax note; `businessTax` the flat rate on positive pre-tax profit; `businessSchedule` whether a
 *  business tax schedule (a function) is set; `personalSchedule` whether a personal schedule is set. */
export function describeTax({ note, businessTax = 0, businessSchedule = false, personalSchedule = false } = {}) {
  if (note) return note;
  if (businessTax === 0 && !businessSchedule && !personalSchedule) return "no tax configured";
  if (businessSchedule) return "custom business tax schedule";
  return `business tax ${Math.round(businessTax * 1000) / 10}% on pre-tax profit` + (personalSchedule ? "; custom personal schedule" : "");
}
