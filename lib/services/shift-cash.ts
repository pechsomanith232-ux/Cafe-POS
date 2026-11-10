import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { cashMovements, customerPayments, paymentMethods, payments, shiftCash } from "@/db/schema";
import { dec, toMoneyString } from "@/lib/domain/money";

/**
 * Expected cash per currency in a shift's drawer (plan §4.8):
 * float + cash tendered − change given − cash refunds + pay-ins − pay-outs + cash customer payments.
 */
export async function expectedCash(tx: Executor, shiftId: string) {
  const floats = await tx.select().from(shiftCash).where(eq(shiftCash.shiftId, shiftId)).orderBy(asc(shiftCash.currencyCode));
  const tendered = await tx.select({ code: payments.currencyCode, refund: payments.isRefund, amount: sql<string>`sum(${payments.amountTendered})::text` })
    .from(payments).where(and(eq(payments.shiftId, shiftId), eq(payments.methodType, "cash"))).groupBy(payments.currencyCode, payments.isRefund);
  const change = await tx.select({ code: payments.changeCurrency, amount: sql<string>`sum(${payments.changeAmount})::text` })
    .from(payments).where(and(eq(payments.shiftId, shiftId), eq(payments.isRefund, false))).groupBy(payments.changeCurrency);
  const moves = await tx.select({ code: cashMovements.currencyCode, type: cashMovements.type, amount: sql<string>`sum(${cashMovements.amount})::text` })
    .from(cashMovements).where(eq(cashMovements.shiftId, shiftId)).groupBy(cashMovements.currencyCode, cashMovements.type);
  const ar = await tx.select({ code: customerPayments.currencyCode, amount: sql<string>`sum(${customerPayments.amount})::text` })
    .from(customerPayments).innerJoin(paymentMethods, eq(paymentMethods.id, customerPayments.methodId))
    .where(and(eq(customerPayments.shiftId, shiftId), eq(paymentMethods.type, "cash"))).groupBy(customerPayments.currencyCode);
  return floats.map((f) => {
    const c = f.currencyCode;
    const get = <T extends { code: string | null; amount: string }>(rows: T[], pred: (r: T) => boolean = () => true) => dec(rows.find((r) => r.code === c && pred(r))?.amount ?? "0");
    const expected = dec(f.openingFloat)
      .plus(get(tendered, (r) => !r.refund)).minus(get(change)).minus(get(tendered, (r) => r.refund))
      .plus(get(moves, (r) => r.type === "pay_in")).minus(get(moves, (r) => r.type === "pay_out"))
      .plus(get(ar));
    return { currencyCode: c, openingFloat: f.openingFloat, expected: toMoneyString(expected), counted: f.counted, variance: f.variance };
  });
}
