import { and, asc, eq, gt } from "drizzle-orm";
import { customerPaymentAllocations, customerPayments, customers, orders, paymentMethods } from "@/db/schema";
import { todayLocal } from "@/lib/dates";
import { dec, toMoneyString } from "@/lib/domain/money";
import { NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import { customerInput, customerPaymentInput, type CustomerInput, type CustomerPaymentInput } from "@/lib/validators/customers";
import { writeAudit } from "./audit";
import { currencyAt } from "./currency-rates";
import { requireOpenShift } from "./shifts";
import { inTransaction } from "./tx";

/** Create (id = null) or update a customer (customers.manage at the active branch). */
export async function saveCustomer(ctx: AppContext, id: string | null, input: CustomerInput) {
  requirePermission(ctx, ctx.branchId, "customers.manage");
  const data = parseInput(customerInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    if (id) {
      const [before] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId))).for("update");
      if (!before) throw new NotFoundError("Customer not found.");
      const [c] = await tx.update(customers).set(data).where(eq(customers.id, id)).returning();
      await writeAudit(tx, ctx, { action: "customer.update", entity: "customer", entityId: id, before: { name: before.name, creditLimit: before.creditLimit, isActive: before.isActive }, after: data });
      return c;
    }
    const [c] = await tx.insert(customers).values({ ...data, orgId: ctx.orgId }).returning();
    await writeAudit(tx, ctx, { action: "customer.create", entity: "customer", entityId: c.id, after: data });
    return c;
  });
}

/**
 * Customer payment (AR, plan §4.10): converted at the branch rate, allocated to
 * the customer's charged orders oldest first; any rest is customer credit. Cash
 * goes into the register's open shift so expected cash includes it.
 */
export async function recordCustomerPayment(ctx: AppContext, input: CustomerPaymentInput) {
  const data = parseInput(customerPaymentInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "ar.receive_payment");
  return inTransaction(ctx, async (tx, ctx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.id, data.customerId), eq(customers.orgId, ctx.orgId))).for("update");
    if (!c) throw new NotFoundError("Customer not found.");
    const [method] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, data.methodId), eq(paymentMethods.branchId, data.branchId), eq(paymentMethods.isActive, true)));
    if (!method || method.type === "account") throw new ValidationError("Choose how the customer paid.");
    let shiftId: string | null = null;
    if (method.type === "cash") {
      if (!data.registerId) throw new ValidationError("Choose the register whose drawer the cash goes into.");
      shiftId = (await requireOpenShift(tx, data.branchId, data.registerId)).id;
    }
    const cur = await currencyAt(tx, data.branchId, data.currencyCode);
    const base = dec(data.amount).div(cur.rate).toDecimalPlaces(4, 4);
    const open = await tx.select({ id: orders.id, due: orders.accountDue }).from(orders)
      .where(and(eq(orders.customerId, c.id), gt(orders.accountDue, "0"))).orderBy(asc(orders.paidAt), asc(orders.id)).for("update");
    let left = base;
    const allocs: { orderId: string; amountBase: string }[] = [];
    for (const o of open) {
      if (left.lte(0)) break;
      const take = left.lt(o.due) ? left : dec(o.due);
      allocs.push({ orderId: o.id, amountBase: toMoneyString(take) });
      await tx.update(orders).set({ accountDue: toMoneyString(dec(o.due).minus(take)) }).where(eq(orders.id, o.id));
      left = left.minus(take);
    }
    const [p] = await tx.insert(customerPayments).values({
      customerId: c.id, branchId: data.branchId, shiftId, paymentDate: data.paymentDate ?? todayLocal(), methodId: method.id, currencyCode: cur.code,
      amount: data.amount, rateUsed: cur.rate, amountBase: toMoneyString(base), unallocatedBase: toMoneyString(left), reference: data.reference, createdBy: ctx.userId,
    }).returning();
    if (allocs.length) await tx.insert(customerPaymentAllocations).values(allocs.map((a) => ({ ...a, paymentId: p.id })));
    await writeAudit(tx, ctx, {
      action: "customer.payment", entity: "customer_payment", entityId: p.id, branchId: data.branchId,
      after: { customer: c.name, method: method.name, amount: `${data.amount} ${cur.code}`, amountBase: toMoneyString(base), allocated: allocs.length, credit: toMoneyString(left) },
    });
    return p;
  });
}

