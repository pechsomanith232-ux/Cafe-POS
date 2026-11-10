import { dec, toMoneyString, type DecInput } from "./money";

/** Spread a payment over open receipts in the given order (oldest first). */
export function autoAllocate(amount: DecInput, open: { receiptId: string; amountDue: DecInput }[]) {
  let left = dec(amount);
  const allocations: { receiptId: string; amount: string }[] = [];
  for (const r of open) {
    if (left.lte(0)) break;
    const take = dec(r.amountDue).lt(left) ? dec(r.amountDue) : left;
    if (take.gt(0)) {
      allocations.push({ receiptId: r.receiptId, amount: toMoneyString(take) });
      left = left.minus(take);
    }
  }
  return { allocations, unallocated: toMoneyString(left) };
}
