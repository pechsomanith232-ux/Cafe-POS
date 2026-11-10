import { dec, toMoneyString } from "./money";

// Order totals (plan §4.5, §4.6). ONE function used by the POS screen and by
// saveOrder on the server, so the two always agree. Every amount is rounded
// to whole cents (USD is the base currency).

type D = ReturnType<typeof dec>;
export type Discount = { type: "percent" | "amount"; value: string } | null;
export type CartLine = { unitPrice: string; qty: number; modifiers: string[]; discount: Discount };
export type TaxSetting = { rate: string; inclusive: boolean };

const cents = (d: D) => d.toDecimalPlaces(2, 4 /* ROUND_HALF_UP */);

/** Discount amount on `base`: percent rounded to the cent, a fixed amount capped at `base`. */
function discountAmount(d: Discount, base: D): D {
  if (!d || base.lte(0)) return dec(0);
  const v = dec(d.value);
  if (v.lte(0)) return dec(0);
  const amt = d.type === "percent" ? cents(base.times(v.gt(100) ? 100 : v).div(100)) : cents(v);
  return amt.gt(base) ? base : amt;
}

/** Any discount as a percent of what it applies to (for the role's max %). */
export function discountPct(d: Discount, base: string): number {
  if (!d) return 0;
  if (d.type === "percent") return Number(d.value);
  if (dec(base).lte(0)) return 0;
  return Math.min(100, dec(d.value).div(base).times(100).toNumber());
}

/** Split `total` cents across `weights` in proportion, largest remainder first, summing exactly. */
function allocate(total: D, weights: D[]): D[] {
  const sumW = weights.reduce((a, w) => a.plus(w), dec(0));
  if (total.lte(0) || sumW.lte(0)) return weights.map(() => dec(0));
  const totalCents = total.times(100).toNumber();
  const raw = weights.map((w) => w.div(sumW).times(totalCents));
  const floors = raw.map((r) => r.floor());
  let left = totalCents - floors.reduce((a, f) => a + f.toNumber(), 0);
  const order = raw.map((r, i) => ({ i, frac: r.minus(r.floor()) })).sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = floors[i].plus(1);
    left--;
  }
  return floors.map((f) => f.div(100));
}

export function computeOrder(lines: readonly CartLine[], orderDiscount: Discount, tax: TaxSetting) {
  const rate = dec(tax.rate || "0");
  const priced = lines.map((l) => {
    const unit = l.modifiers.reduce((a, m) => a.plus(m), dec(l.unitPrice));
    const gross = cents(unit.times(l.qty));
    const lineDiscount = discountAmount(l.discount, gross);
    return { gross, lineDiscount, net: gross.minus(lineDiscount) };
  });
  const subtotal = priced.reduce((a, p) => a.plus(p.net), dec(0));
  const od = discountAmount(orderDiscount, subtotal);
  const allocs = allocate(od, priced.map((p) => p.net));
  const out = priced.map((p, i) => {
    const after = p.net.minus(allocs[i]);
    const taxAmount = rate.isZero() ? dec(0) : tax.inclusive ? cents(after.times(rate).div(rate.plus(100))) : cents(after.times(rate).div(100));
    const lineTotal = tax.inclusive ? after : after.plus(taxAmount);
    return { gross: p.gross, lineDiscount: p.lineDiscount, net: p.net, discountAlloc: allocs[i], taxAmount, lineTotal };
  });
  const sum = (k: keyof (typeof out)[number]) => out.reduce((a, l) => a.plus(l[k]), dec(0));
  const s = (d: D) => toMoneyString(d);
  return {
    lines: out.map((l) => ({ gross: s(l.gross), lineDiscount: s(l.lineDiscount), net: s(l.net), discountAlloc: s(l.discountAlloc), taxAmount: s(l.taxAmount), lineTotal: s(l.lineTotal) })),
    subtotal: s(subtotal),
    orderDiscount: s(od),
    discountTotal: s(sum("lineDiscount").plus(od)),
    taxTotal: s(sum("taxAmount")),
    total: s(sum("lineTotal")),
  };
}
export type OrderTotals = ReturnType<typeof computeOrder>;
