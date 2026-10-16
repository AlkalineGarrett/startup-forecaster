// Money layer: realisation (the collected fraction of list price, by channel), expansion gating, discounting
// and terminal-value helpers. Netting is applied UNIFORMLY here so the ranking doesn't bake in an accounting
// artefact. (The tax hooks, channel overrides and discount rate are portfolio settings: portfolio-context.ts.)

import { CHANNEL_OVERRIDES, DISCOUNT_RATE, type ChannelSpec } from "./portfolio-context.ts";
import { BUILTIN_CHANNELS } from "./settings.mjs";

/** A channel's spec: workspace overrides first, then the built-ins (settings.mjs BUILTIN_CHANNELS: the collected
 *  fraction of list price and the fixed fee per charge, in the venture's own currency). An unknown channel throws,
 *  listing the valid names. */
export function channelSpec(channel: string): ChannelSpec {
  const c = CHANNEL_OVERRIDES[channel] ?? BUILTIN_CHANNELS[channel];
  if (!c) throw new Error(`unknown payment channel "${channel}" — one of: ${[...new Set([...Object.keys(BUILTIN_CHANNELS), ...Object.keys(CHANNEL_OVERRIDES)])].join(", ")} (or add it with configurePortfolio({ channels }))`);
  return c;
}

/** Realisation including the channel's fixed per-charge fee, which dominates at low ticket sizes. Annual
 * billing amortises the fixed fee ~12× — a fee-side argument for annual plans. */
export function realise(channel: string, monthlyPrice: number, annualBilled = false): number {
  const { realisation: pct, fixedFee: fixed } = channelSpec(channel);
  const charge = annualBilled ? monthlyPrice * 12 : monthlyPrice;
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

/** Annual net-retention (expansion) multiplier for B2B — none below a monthly ARPA of 50. The thresholds
 *  (50 / 100 / 500 per month) are in the venture's own price currency. */
export function expansionFor(monthlyArpa: number): number {
  if (monthlyArpa < 50) return 1.0;
  if (monthlyArpa < 100) return 1.03;
  if (monthlyArpa < 500) return 1.08;
  return 1.15;
}

/** NPV of a monthly trajectory, discounting at the portfolio's `discountRate` (default 0.10). Linear in the
 * values, so the engine may pass a pre-fx trajectory and scale the result by fx afterwards. */
export function npvOf(out: Float64Array): number {
  const dm = Math.pow(1 + DISCOUNT_RATE, 1 / 12);
  let v = 0;
  let d = dm;
  for (let t = 0; t < out.length; t++) {
    v += out[t] / d;
    d *= dm;
  }
  return v;
}

/** Annualised run-rate at the horizon's end (mean of the last three months × 12). */
export function runRateAtHorizon(out: Float64Array): number {
  const n = out.length;
  return ((out[n - 1] + out[n - 2] + out[n - 3]) / 3) * 12;
}
