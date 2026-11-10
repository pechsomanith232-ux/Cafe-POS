import { dec, toMoneyString } from "./money";

export type StatementEntry = { date: string; debit: string | null; credit: string | null };

/**
 * Cut a date-sorted statement to a period: everything before `from` becomes the
 * opening balance; rows inside get a running balance (debit adds, credit subtracts).
 */
export function statementWindow<T extends StatementEntry>(entries: T[], from: string, to: string) {
  let balance = dec(0);
  for (const e of entries) if (e.date < from) balance = balance.plus(e.debit ?? 0).minus(e.credit ?? 0);
  const opening = toMoneyString(balance);
  const rows = entries
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => {
      balance = balance.plus(e.debit ?? 0).minus(e.credit ?? 0);
      return { ...e, balance: toMoneyString(balance) };
    });
  return { opening, rows, closing: toMoneyString(balance) };
}
