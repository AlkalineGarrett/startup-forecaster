// Money layer: realisation (the collected fraction of list price, by channel), the after-tax hooks (the
// portfolio supplies its jurisdiction's personal schedule + business rate), expansion gating, discounting
// and terminal-value helpers. Netting is applied UNIFORMLY here so the ranking doesn't bake in an
// accounting artefact.

/** Collected fraction of list price by sales channel, before fixed per-transaction fees. */
export const REALISATION: Record<string, number> = {
  euConsumerVAT: 0.73, // EU consumer, VAT-inclusive pricing
  usStripe: 0.87, // US customer, card via Stripe
  appStoreSBP: 0.85, // app store, Small Business Program
  eeaB2B: 0.91, // EEA-domestic card, business buyer (VAT reverse-charged)
  usB2B: 0.97, // US enterprise, annual invoice via ACH (0.8% capped) + Stripe Billing 0.7% + minor collection slip
  none: 1.0, // already-netted (e.g. a game portal that pays net) or a salary
};

/** Realisation including fixed per-transaction fees, which dominate at low ticket sizes:
 * ~€0.70 (processor + tax handling) per charge is 7% of a €10 charge before % rates. Annual
 * billing amortises the fixed fee ~12× — a fee-side argument for annual plans. */
export function realise(channel: string, monthlyPrice: number, annualBilled = false): number {
  const pct = REALISATION[channel] ?? 1;
  const charge = annualBilled ? monthlyPrice * 12 : monthlyPrice;
  const fixed = 0.7;
  const drag = charge > 0 ? Math.min(0.5, fixed / charge) : 0;
  return Math.max(0, pct - drag);
}

/** Plan-mix realisation: blend monthly-billed and annual-billed collected fractions by `annualShare`.
 * Annual billing amortises the fixed per-charge fee across twelve months, so a higher annual share
 * raises realisation — and by more at low ticket prices, where the fixed fee dominates. */
export function realiseMix(channel: string, monthlyPrice: number, annualShare: number): number {
  const w = Math.max(0, Math.min(1, annualShare));
  return w * realise(channel, monthlyPrice, true) + (1 - w) * realise(channel, monthlyPrice, false);
}

/** Annual net-retention (expansion) multiplier — available only to B2B priced above ~$50/mo. */
export function expansionFor(monthlyArpaUsd: number): number {
  if (monthlyArpaUsd < 50) return 1.0;
  if (monthlyArpaUsd < 100) return 1.03;
  if (monthlyArpaUsd < 500) return 1.08;
  return 1.15;
}

/** Annual discount rate for NPV (solo-operator opportunity cost). */
export const DISCOUNT_ANNUAL = 0.15;

/** NPV of a monthly trajectory, discounting at DISCOUNT_ANNUAL. Linear in the values, so the
 * engine may pass a pre-fx trajectory and scale the result by fx afterwards. */
export function npvOf(out: Float64Array): number {
  const dm = Math.pow(1 + DISCOUNT_ANNUAL, 1 / 12);
  let v = 0;
  let d = dm;
  for (let t = 0; t < out.length; t++) {
    v += out[t] / d;
    d *= dm;
  }
  return v;
}

/** Annualised run-rate at month 60 (mean of the last three months × 12). */
export function runRate60(out: Float64Array): number {
  const n = out.length;
  return ((out[n - 1] + out[n - 2] + out[n - 3]) / 3) * 12;
}
