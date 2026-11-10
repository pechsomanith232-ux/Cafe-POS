import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { customerPaymentAllocations, customerPayments, customers, orders, paymentMethods, payments } from "@/db/schema";
import { agingBuckets } from "@/lib/domain/aging";
import { dec, toMoneyString } from "@/lib/domain/money";
import { NotFoundError } from "@/lib/errors";
import { ForbiddenError, hasPermission, requirePermission, type AppContext } from "@/lib/permissions";

/** Customers are visible to anyone who sells, manages customers or takes AR payments. */
function requireCustomerView(ctx: AppContext) {
  if (!["pos.sell", "customers.manage", "ar.receive_payment", "reports.ar"].some((k) => hasPermission(ctx, ctx.branchId, k as never))) {
    throw new ForbiddenError("Missing permission customers.manage at this branch.");
  }
}

const balanceSql = sql<string>`coalesce((select sum(o.account_due) from orders o where o.customer_id = "customers"."id"), 0)::numeric(18,4)::text`;
const creditSql = sql<string>`coalesce((select sum(p.unallocated_base) from customer_payments p where p.customer_id = "customers"."id"), 0)::numeric(18,4)::text`;

export async function listCustomers(ctx: AppContext, opts: { includeInactive?: boolean } = {}) {
  requireCustomerView(ctx);
  return ctx.db.select({
    id: customers.id, name: customers.name, phone: customers.phone, creditLimit: customers.creditLimit, isActive: customers.isActive, note: customers.note,
    balance: balanceSql, credit: creditSql,
  }).from(customers).where(and(eq(customers.orgId, ctx.orgId), opts.includeInactive ? undefined : eq(customers.isActive, true))).orderBy(asc(customers.name));
}
export type CustomerRow = Awaited<ReturnType<typeof listCustomers>>[number];

export async function getCustomer(ctx: AppContext, id: string) {
  requireCustomerView(ctx);
  const [c] = await ctx.db.select({ c: customers, balance: balanceSql, credit: creditSql }).from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)));
  if (!c) throw new NotFoundError("Customer not found.");
  const openOrders = await ctx.db.select({ id: orders.id, orderNo: orders.orderNo, paidAt: orders.paidAt, total: orders.total, accountDue: orders.accountDue, branchId: orders.branchId })
    .from(orders).where(and(eq(orders.customerId, id), gt(orders.accountDue, "0"))).orderBy(asc(orders.paidAt));
  const pays = await ctx.db.select({ p: customerPayments, method: paymentMethods.name }).from(customerPayments)
    .innerJoin(paymentMethods, eq(paymentMethods.id, customerPayments.methodId)).where(eq(customerPayments.customerId, id))
    .orderBy(desc(customerPayments.createdAt)).limit(100);
  return { ...c.c, balance: c.balance, credit: c.credit, openOrders, payments: pays.map((x) => ({ ...x.p, method: x.method })) };
}
export type CustomerDetail = Awaited<ReturnType<typeof getCustomer>>;

/**
 * AR aging as of a date (plan §4.10, same buckets as AP): per customer, the
 * account balance of each charged order ON that date (charged − payments dated
 * on/before it), aged from the charge date. Under one cent counts as settled.
 */
export async function arAging(ctx: AppContext, opts: { asOf: string }) {
  requirePermission(ctx, ctx.branchId, "reports.ar");
  const charged = await ctx.db.select({
    orderId: orders.id, customerId: customers.id, customerName: customers.name,
    chargeDate: sql<string>`((${orders.paidAt} at time zone 'Asia/Phnom_Penh')::date)::text`,
    charged: sql<string>`sum(case when ${payments.isRefund} then -${payments.amountBase} else ${payments.amountBase} end)::text`,
  }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(payments.methodType, "account"), eq(customers.orgId, ctx.orgId), lte(sql`(${orders.paidAt} at time zone 'Asia/Phnom_Penh')::date`, opts.asOf)))
    .groupBy(orders.id, customers.id, customers.name, orders.paidAt);
  const ids = charged.map((c) => c.orderId);
  const paid = ids.length
    ? await ctx.db.select({ orderId: customerPaymentAllocations.orderId, amount: sql<string>`sum(${customerPaymentAllocations.amountBase})::text` })
      .from(customerPaymentAllocations).innerJoin(customerPayments, eq(customerPayments.id, customerPaymentAllocations.paymentId))
      .where(and(inArray(customerPaymentAllocations.orderId, ids), lte(customerPayments.paymentDate, opts.asOf))).groupBy(customerPaymentAllocations.orderId)
    : [];
  const open = charged
    .map((c) => ({ ...c, amountDue: toMoneyString(dec(c.charged).minus(paid.find((p) => p.orderId === c.orderId)?.amount ?? "0")), dueDate: c.chargeDate }))
    .filter((c) => dec(c.amountDue).gte("0.01"));
  const by = new Map<string, { customerId: string; customerName: string; open: typeof open }>();
  for (const o of open) {
    const e = by.get(o.customerId) ?? { customerId: o.customerId, customerName: o.customerName, open: [] };
    e.open.push(o);
    by.set(o.customerId, e);
  }
  const rows = [...by.values()].map((e) => ({ customerId: e.customerId, customerName: e.customerName, ...agingBuckets(e.open, opts.asOf) })).sort((a, b) => a.customerName.localeCompare(b.customerName));
  return { asOf: opts.asOf, rows, totals: agingBuckets(open, opts.asOf) };
}
