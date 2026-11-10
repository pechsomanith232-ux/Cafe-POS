import { dec, toMoneyString, type DecInput } from "./money";

/** Whole calendar days from `from` to `to` (yyyy-mm-dd strings). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export type AgingBuckets = { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string };

/**
 * AP aging as of a date (plan §4.9): not yet overdue (incl. due today or no
 * due date) is Current; otherwise by days overdue 1–30, 31–60, 61–90, 90+.
 */
export function agingBuckets(open: { dueDate: string | null; amountDue: DecInput }[], asOf: string): AgingBuckets {
  const b = { current: dec(0), d1_30: dec(0), d31_60: dec(0), d61_90: dec(0), d90_plus: dec(0) };
  for (const r of open) {
    const amt = dec(r.amountDue);
    const overdue = r.dueDate ? daysBetween(r.dueDate, asOf) : 0;
    if (overdue <= 0) b.current = b.current.plus(amt);
    else if (overdue <= 30) b.d1_30 = b.d1_30.plus(amt);
    else if (overdue <= 60) b.d31_60 = b.d31_60.plus(amt);
    else if (overdue <= 90) b.d61_90 = b.d61_90.plus(amt);
    else b.d90_plus = b.d90_plus.plus(amt);
  }
  const total = b.current.plus(b.d1_30).plus(b.d31_60).plus(b.d61_90).plus(b.d90_plus);
  return {
    current: toMoneyString(b.current), d1_30: toMoneyString(b.d1_30), d31_60: toMoneyString(b.d31_60),
    d61_90: toMoneyString(b.d61_90), d90_plus: toMoneyString(b.d90_plus), total: toMoneyString(total),
  };
}
