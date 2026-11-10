import { dec } from "./money";

// Currency conversion for display (plan §4.4). Phase 6 adds tendering, change and rounding records.

/** Base amount shown in another currency: amount × rate, rounded half-up to the cash rounding step (100 riel). */
export function cashDisplay(amountBase: string, rate: string, rounding: string): string {
  const step = dec(rounding);
  const raw = dec(amountBase).times(rate);
  if (step.lte(0)) return raw.toString();
  return raw.div(step).toDecimalPlaces(0, 4 /* ROUND_HALF_UP */).times(step).toFixed(0);
}

export type SettleCurrency = { code: string; decimals: number; cashRounding: string; /** units per 1 base (USD) */ rate: string };
export type Tender = { cash: boolean; currency: SettleCurrency; amount: string };

const toBase = (amount: string, rate: string) => dec(amount).div(rate).toDecimalPlaces(4, 4);
const m4 = (d: ReturnType<typeof dec>) => d.toFixed(4);

/**
 * Settle tenders against an order total in base currency (plan §4.4).
 * - Each tender converts to base at its rate (4 dp).
 * - Overpayment is given back as change in `changeCurrency`, rounded to its cash
 *   step (1,025 riel → 1,000); the difference is `roundingBase` (kept by the café).
 * - A shortfall too small to collect in cash (under half a cash step of a tendered
 *   cash currency, or under half a cent) counts as paid and is `writeOffBase`.
 * - Non-cash tenders can't produce change.
 * Identity: paidBase − change.base = total + roundingBase − writeOffBase.
 */
export function settlePayment(totalBase: string, tenders: Tender[], changeCurrency: SettleCurrency) {
  const lines = tenders.map((t) => ({ currency: t.currency.code, amountTendered: t.amount, rateUsed: t.currency.rate, amountBase: toBase(t.amount, t.currency.rate), cash: t.cash }));
  const paid = lines.reduce((a, l) => a.plus(l.amountBase), dec(0));
  const total = dec(totalBase);
  const remaining = total.minus(paid);
  const noChange = { currency: changeCurrency.code, amount: "0", base: m4(dec(0)), roundingBase: m4(dec(0)) };

  if (remaining.gt(0)) {
    const collectable = remaining.gte("0.005") && !tenders.some((t) => t.cash && remaining.times(t.currency.rate).lt(dec(t.currency.cashRounding).div(2)));
    return { tenders: lines.map((l) => ({ ...l, amountBase: m4(l.amountBase) })), paidBase: m4(paid), remainingBase: m4(remaining), paid: !collectable, writeOffBase: collectable ? m4(dec(0)) : m4(remaining), change: noChange };
  }
  const over = remaining.neg();
  const nonCash = lines.filter((l) => !l.cash).reduce((a, l) => a.plus(l.amountBase), dec(0));
  if (over.gt(0) && nonCash.gt(total)) throw new Error("Card, QR or transfer payments can't be more than what's due.");
  if (over.isZero()) return { tenders: lines.map((l) => ({ ...l, amountBase: m4(l.amountBase) })), paidBase: m4(paid), remainingBase: m4(dec(0)), paid: true, writeOffBase: m4(dec(0)), change: noChange };
  const step = dec(changeCurrency.cashRounding);
  const raw = over.times(changeCurrency.rate);
  const amount = step.gt(0) ? raw.div(step).toDecimalPlaces(0, 4).times(step) : raw;
  const base = toBase(amount.toString(), changeCurrency.rate);
  return {
    tenders: lines.map((l) => ({ ...l, amountBase: m4(l.amountBase) })),
    paidBase: m4(paid),
    remainingBase: m4(dec(0)),
    paid: true,
    writeOffBase: m4(dec(0)),
    change: { currency: changeCurrency.code, amount: amount.toFixed(changeCurrency.decimals), base: m4(base), roundingBase: m4(over.minus(base)) },
  };
}
export type Settlement = ReturnType<typeof settlePayment>;
