// B2B SaaS sold as a flat per-organisation subscription.
import * as perSeat from "./b2b-per-seat.mjs";

export const name = "b2b-per-org";
export const description = "B2B SaaS at a flat monthly price per organisation (no seats): reachable customers × penetration, setup fee, support ceiling.";
export const defaults = perSeat.defaults;

export function build(opts) {
  const b = perSeat.build(opts);
  const nodes = b.nodes
    .filter((n) => n.id !== "seats_per_customer" && n.id !== "price_per_seat_mo")
    .flatMap((n) => (n.id === "setup_fee"
      ? [{ id: "price_per_customer_mo", label: "Price per customer ({cur}/mo, flat)", kind: "value", unit: "currency per month", loading: 0.2,
           placeholder: { p10: 60, p50: 200, p90: 600 },
           research: "Competitors' per-organisation plans; the budget line or manual process it replaces. A price the person has decided is their answer, not research." }, n]
      : [n]));
  const model = { ...b.model, price: ["price_per_customer_mo"], lines: { subscription: "Subscription (per-organisation SaaS)", setup: "Implementation fees" } };
  const revNote = b.revNote.replace("per-customer MRR = seats × price per seat", "a flat monthly price per customer");
  return { nodes, model, revNote, judgements: b.judgements, type: "B2B SaaS (per organisation)" };
}
