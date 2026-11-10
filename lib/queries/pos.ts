import { and, asc, desc, eq, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import {
  branchVariantPrices,
  currencies,
  diningTables,
  exchangeRates,
  menuCategories,
  modifierGroups,
  modifiers,
  orderLineModifiers,
  orderLines,
  orders,
  productModifierGroups,
  products,
  productVariants,
  registers,
  shiftCash,
  shifts,
  user,
} from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";

/** Latest effective rate (units of `code` per 1 USD) at a branch, or null. */
export async function currentRate(ctx: AppContext, branchId: string, code: string): Promise<string | null> {
  assertBranchAccess(ctx, branchId);
  const [r] = await ctx.db.select({ rate: exchangeRates.rateToBase }).from(exchangeRates)
    .where(and(eq(exchangeRates.branchId, branchId), eq(exchangeRates.currencyCode, code), lte(exchangeRates.effectiveFrom, sql`now()`)))
    .orderBy(desc(exchangeRates.effectiveFrom), desc(exchangeRates.createdAt)).limit(1);
  return r?.rate ?? null;
}

export async function listCurrencies(ctx: AppContext) {
  void ctx;
  return ctx.db.select().from(currencies).orderBy(desc(sql`${currencies.code} = 'USD'`), asc(currencies.code));
}

export async function listRegisters(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  return ctx.db.select().from(registers).where(and(eq(registers.branchId, branchId), eq(registers.isActive, true))).orderBy(asc(registers.name));
}

/** The register's open shift with its floats, or null. */
export async function getOpenShift(ctx: AppContext, branchId: string, registerId: string) {
  assertBranchAccess(ctx, branchId);
  const [s] = await ctx.db.select({ s: shifts, openedByName: user.name }).from(shifts).innerJoin(user, eq(user.id, shifts.openedBy))
    .where(and(eq(shifts.branchId, branchId), eq(shifts.registerId, registerId), eq(shifts.status, "open")));
  if (!s) return null;
  const cash = await ctx.db.select().from(shiftCash).where(eq(shiftCash.shiftId, s.s.id)).orderBy(asc(shiftCash.currencyCode));
  return { ...s.s, openedByName: s.openedByName, cash };
}
export type OpenShift = NonNullable<Awaited<ReturnType<typeof getOpenShift>>>;

export async function listDiningTables(ctx: AppContext, branchId: string, opts: { includeInactive?: boolean } = {}) {
  assertBranchAccess(ctx, branchId);
  return ctx.db.select().from(diningTables)
    .where(and(eq(diningTables.branchId, branchId), opts.includeInactive ? undefined : eq(diningTables.isActive, true)))
    .orderBy(asc(diningTables.sortOrder), asc(diningTables.name));
}
export type DiningTableRow = Awaited<ReturnType<typeof listDiningTables>>[number];

/** Everything the POS grid needs at the active branch: categories, products with branch prices, modifier groups. */
export async function getPosMenu(ctx: AppContext) {
  requirePermission(ctx, ctx.branchId, "pos.sell");
  const categories = await ctx.db.select({ id: menuCategories.id, name: menuCategories.name, color: menuCategories.color }).from(menuCategories)
    .where(and(eq(menuCategories.orgId, ctx.orgId), eq(menuCategories.isActive, true))).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
  const prods = await ctx.db.select().from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.isActive, true))).orderBy(asc(products.sortOrder), asc(products.name));
  const ids = prods.map((p) => p.id);
  const variants = ids.length
    ? await ctx.db.select({ v: productVariants, branchPrice: branchVariantPrices.price, isAvailable: branchVariantPrices.isAvailable }).from(productVariants)
      .leftJoin(branchVariantPrices, and(eq(branchVariantPrices.variantId, productVariants.id), eq(branchVariantPrices.branchId, ctx.branchId)))
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true))).orderBy(asc(productVariants.sortOrder))
    : [];
  const links = ids.length
    ? await ctx.db.select({ productId: productModifierGroups.productId, groupId: productModifierGroups.groupId }).from(productModifierGroups)
      .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
      .where(and(inArray(productModifierGroups.productId, ids), eq(modifierGroups.isActive, true))).orderBy(asc(productModifierGroups.sortOrder))
    : [];
  const groupIds = [...new Set(links.map((l) => l.groupId))];
  const groups = groupIds.length ? await ctx.db.select().from(modifierGroups).where(inArray(modifierGroups.id, groupIds)) : [];
  const mods = groupIds.length
    ? await ctx.db.select().from(modifiers).where(and(inArray(modifiers.groupId, groupIds), eq(modifiers.isActive, true))).orderBy(asc(modifiers.sortOrder))
    : [];
  return {
    categories,
    products: prods
      .map((p) => ({
        id: p.id, name: p.name, categoryId: p.categoryId, imageKey: p.imageKey, kitchenStation: p.kitchenStation,
        groupIds: links.filter((l) => l.productId === p.id).map((l) => l.groupId),
        variants: variants.filter((v) => v.v.productId === p.id).map((v) => ({
          id: v.v.id, name: v.v.name, price: v.branchPrice ?? v.v.price, isDefault: v.v.isDefault, isAvailable: v.isAvailable ?? true,
        })),
      }))
      .filter((p) => p.variants.length > 0),
    groups: groups.map((g) => ({
      id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
      modifiers: mods.filter((m) => m.groupId === g.id).map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta })),
    })),
  };
}
export type PosMenu = Awaited<ReturnType<typeof getPosMenu>>;

/** One order with lines and modifiers (for the cart, held bills and the receipt). */
export async function getOrder(ctx: AppContext, id: string) {
  const [row] = await ctx.db.select({ o: orders, tableName: diningTables.name }).from(orders)
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId)).where(eq(orders.id, id));
  if (!row) throw new NotFoundError("Order not found.");
  assertBranchAccess(ctx, row.o.branchId);
  requirePermission(ctx, row.o.branchId, "pos.sell");
  const lines = await ctx.db.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.sortOrder));
  const mods = lines.length ? await ctx.db.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, lines.map((l) => l.id))) : [];
  return {
    ...row.o,
    tableName: row.tableName,
    lines: lines.map((l) => ({
      id: l.id, variantId: l.variantId, productId: l.productId, productName: l.productNameSnapshot, variantName: l.variantNameSnapshot,
      qty: l.qty, unitPrice: l.unitPrice, modifiersTotal: l.modifiersTotal, note: l.note,
      discount: l.lineDiscountType ? { type: l.lineDiscountType as "percent" | "amount", value: l.lineDiscountValue!, reason: l.lineDiscountReason } : null,
      lineDiscountAmount: l.lineDiscountAmount, discountAlloc: l.discountAlloc, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
      deductStock: l.deductStock, kitchenStation: l.kitchenStation, kitchenStatus: l.kitchenStatus, sent: l.sentToKitchenAt !== null,
      modifiers: mods.filter((m) => m.orderLineId === l.id).map((m) => ({ modifierId: m.modifierId, groupId: m.groupId, name: m.nameSnapshot, priceDelta: m.priceDelta })),
    })),
  };
}
export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

export async function listHeldOrders(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "pos.hold");
  return ctx.db
    .select({
      id: orders.id, orderNo: orders.orderNo, queueNo: orders.queueNo, orderType: orders.orderType, tableName: diningTables.name,
      total: orders.total, heldAt: orders.heldAt, note: orders.note, createdByName: user.name,
      itemCount: sql<number>`(select coalesce(sum(ol.qty), 0)::int from order_lines ol where ol.order_id = ${orders.id})`,
    })
    .from(orders)
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
    .innerJoin(user, eq(user.id, orders.createdBy))
    .where(and(eq(orders.branchId, branchId), eq(orders.status, "held")))
    .orderBy(asc(orders.heldAt));
}
export type HeldOrderRow = Awaited<ReturnType<typeof listHeldOrders>>[number];

/** Kitchen screen: sent, not-yet-served lines grouped by order, oldest first (plan §6). */
export async function listKitchenTickets(ctx: AppContext, opts: { branchId: string; station?: string | null }) {
  assertBranchAccess(ctx, opts.branchId);
  requirePermission(ctx, opts.branchId, "pos.sell");
  const rows = await ctx.db
    .select({ l: orderLines, o: orders, tableName: diningTables.name })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
    .where(and(
      eq(orders.branchId, opts.branchId),
      isNotNull(orderLines.sentToKitchenAt),
      ne(orderLines.kitchenStatus, "served"),
      ne(orderLines.kitchenStation, "none"),
      or(eq(orders.status, "open"), eq(orders.status, "held"), eq(orders.status, "paid")),
      opts.station ? eq(orderLines.kitchenStation, opts.station) : undefined,
    ))
    .orderBy(asc(orderLines.sentToKitchenAt), asc(orderLines.sortOrder));
  const mods = rows.length ? await ctx.db.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, rows.map((r) => r.l.id))) : [];
  const tickets = new Map<string, {
    orderId: string; orderNo: string; queueNo: number; orderType: string; tableName: string | null; sentAt: Date; note: string | null;
    lines: { id: string; productName: string; variantName: string; qty: number; station: string; status: string; note: string | null; modifiers: string[]; sentAt: Date }[];
  }>();
  for (const r of rows) {
    const t = tickets.get(r.o.id) ?? { orderId: r.o.id, orderNo: r.o.orderNo, queueNo: r.o.queueNo, orderType: r.o.orderType, tableName: r.tableName, sentAt: r.l.sentToKitchenAt!, note: r.o.note, lines: [] };
    t.lines.push({
      id: r.l.id, productName: r.l.productNameSnapshot, variantName: r.l.variantNameSnapshot, qty: r.l.qty, station: r.l.kitchenStation,
      status: r.l.kitchenStatus, note: r.l.note, modifiers: mods.filter((m) => m.orderLineId === r.l.id).map((m) => m.nameSnapshot), sentAt: r.l.sentToKitchenAt!,
    });
    tickets.set(r.o.id, t);
  }
  return [...tickets.values()];
}
export type KitchenTicket = Awaited<ReturnType<typeof listKitchenTickets>>[number];

export async function listDiscountReasons(ctx: AppContext) {
  const { discountReasons } = await import("@/db/schema");
  return ctx.db.select({ id: discountReasons.id, name: discountReasons.name }).from(discountReasons)
    .where(and(eq(discountReasons.orgId, ctx.orgId), eq(discountReasons.isActive, true))).orderBy(asc(discountReasons.name));
}

/**
 * Unpaid orders at a branch — open and held — so an order is never lost when
 * the cashier starts a new one or the tablet's cart is cleared.
 */
export async function listOpenOrders(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "pos.sell");
  return ctx.db
    .select({
      id: orders.id, orderNo: orders.orderNo, queueNo: orders.queueNo, status: orders.status, orderType: orders.orderType, tableName: diningTables.name,
      total: orders.total, heldAt: orders.heldAt, updatedAt: orders.updatedAt, createdByName: user.name,
      itemCount: sql<number>`(select coalesce(sum(ol.qty), 0)::int from order_lines ol where ol.order_id = ${orders.id})`,
    })
    .from(orders)
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
    .innerJoin(user, eq(user.id, orders.createdBy))
    .where(and(eq(orders.branchId, branchId), or(eq(orders.status, "open"), eq(orders.status, "held"))))
    .orderBy(asc(orders.createdAt), asc(orders.orderNo));
}
export type OpenOrderRow = Awaited<ReturnType<typeof listOpenOrders>>[number];

/**
 * X report (shift open) / Z report (closed) (plan §4.8): sales, discounts, tax,
 * refunds, voids, payments by method and currency, cash movements and the cash
 * expected per currency (plus counted/variance once closed).
 */
export async function getShiftReport(ctx: AppContext, shiftId: string) {
  const { cashMovements, payments, paymentMethods, refunds } = await import("@/db/schema");
  const { expectedCash } = await import("@/lib/services/shift-cash");
  const [row] = await ctx.db.select({ s: shifts, register: registers.name, openedByName: user.name }).from(shifts)
    .innerJoin(registers, eq(registers.id, shifts.registerId)).innerJoin(user, eq(user.id, shifts.openedBy)).where(eq(shifts.id, shiftId));
  if (!row) throw new NotFoundError("Shift not found.");
  assertBranchAccess(ctx, row.s.branchId);
  requirePermission(ctx, row.s.branchId, "pos.sell");
  const paidStatuses = ["paid", "refunded", "partially_refunded"];
  const [sales] = await ctx.db.select({
    orderCount: sql<number>`count(*)::int`,
    salesTotal: sql<string>`coalesce(sum(${orders.total}), 0)::numeric(18,4)::text`,
    discountTotal: sql<string>`coalesce(sum(${orders.discountTotal}), 0)::numeric(18,4)::text`,
    taxTotal: sql<string>`coalesce(sum(${orders.taxTotal}), 0)::numeric(18,4)::text`,
  }).from(orders).where(and(eq(orders.shiftId, shiftId), inArray(orders.status, paidStatuses)));
  const [voids] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shiftId, shiftId), eq(orders.status, "voided")));
  const [ref] = await ctx.db.select({ total: sql<string>`coalesce(sum(${refunds.totalBase}), 0)::numeric(18,4)::text`, n: sql<number>`count(*)::int` }).from(refunds).where(eq(refunds.shiftId, shiftId));
  const byMethod = await ctx.db.select({
    method: paymentMethods.name, currencyCode: payments.currencyCode, isRefund: payments.isRefund,
    amount: sql<string>`sum(${payments.amountTendered})::numeric(18,4)::text`, base: sql<string>`sum(${payments.amountBase} - ${payments.changeBase})::numeric(18,4)::text`,
  }).from(payments).innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId)).where(eq(payments.shiftId, shiftId))
    .groupBy(paymentMethods.name, payments.currencyCode, payments.isRefund).orderBy(paymentMethods.name, payments.currencyCode);
  const change = await ctx.db.select({ currencyCode: payments.changeCurrency, amount: sql<string>`sum(${payments.changeAmount})::numeric(18,4)::text` })
    .from(payments).where(and(eq(payments.shiftId, shiftId), eq(payments.isRefund, false), sql`${payments.changeAmount} > 0`)).groupBy(payments.changeCurrency);
  const { customerPayments } = await import("@/db/schema");
  const arCash = await ctx.db.select({ currencyCode: customerPayments.currencyCode, amount: sql<string>`sum(${customerPayments.amount})::numeric(18,4)::text` })
    .from(customerPayments).innerJoin(paymentMethods, eq(paymentMethods.id, customerPayments.methodId))
    .where(and(eq(customerPayments.shiftId, shiftId), eq(paymentMethods.type, "cash"))).groupBy(customerPayments.currencyCode);
  const moves = await ctx.db.select({ m: cashMovements, by: user.name }).from(cashMovements).innerJoin(user, eq(user.id, cashMovements.createdBy))
    .where(eq(cashMovements.shiftId, shiftId)).orderBy(asc(cashMovements.createdAt));
  return {
    shift: { ...row.s, register: row.register, openedByName: row.openedByName },
    orderCount: sales.orderCount, salesTotal: sales.salesTotal, discountTotal: sales.discountTotal, taxTotal: sales.taxTotal,
    voidCount: voids.n, refundCount: ref.n, refundTotal: ref.total,
    byMethod: byMethod.filter((m) => !m.isRefund).map((m) => ({ method: m.method, currencyCode: m.currencyCode, amount: m.amount, base: m.base })),
    refundsByMethod: byMethod.filter((m) => m.isRefund).map((m) => ({ method: m.method, currencyCode: m.currencyCode, amount: m.amount, base: m.base })),
    /** Change handed back, per currency — tendered − change = what was kept (review M1). */
    changeGiven: change.map((c) => ({ currencyCode: c.currencyCode!, amount: c.amount })),
    customerCash: arCash,
    cashMovements: moves.map((x) => ({ ...x.m, byName: x.by })),
    cash: await expectedCash(ctx.db, shiftId),
  };
}
export type ShiftReport = Awaited<ReturnType<typeof getShiftReport>>;

/** Recent orders at a branch (paid, refunded, voided) for reprints, refunds and voids. */
export async function listRecentOrders(ctx: AppContext, branchId: string, opts: { limit?: number } = {}) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "pos.sell");
  return ctx.db.select({
    id: orders.id, orderNo: orders.orderNo, queueNo: orders.queueNo, status: orders.status, total: orders.total, refundedTotal: orders.refundedTotal,
    paidAt: orders.paidAt, voidedAt: orders.voidedAt, orderType: orders.orderType, createdByName: user.name,
  }).from(orders).innerJoin(user, eq(user.id, orders.createdBy))
    .where(and(eq(orders.branchId, branchId), inArray(orders.status, ["paid", "partially_refunded", "refunded", "voided"])))
    .orderBy(desc(sql`coalesce(${orders.paidAt}, ${orders.voidedAt})`), desc(orders.orderNo)).limit(opts.limit ?? 50);
}
export type RecentOrderRow = Awaited<ReturnType<typeof listRecentOrders>>[number];

/**
 * An order for the refund screen: each line's remaining quantity and the default
 * restock choice (owner's Q3: yes for resale items — a deducting line whose
 * recipe is a single item and no options — no for prepared drinks).
 */
export async function getRefundable(ctx: AppContext, orderId: string) {
  const { recipeLines } = await import("@/db/schema");
  const o = await getOrder(ctx, orderId);
  const lines = await ctx.db.select({ id: orderLines.id, refundedQty: orderLines.refundedQty }).from(orderLines).where(eq(orderLines.orderId, orderId));
  const variantIds = [...new Set(o.lines.map((l) => l.variantId))];
  const counts = variantIds.length
    ? await ctx.db.select({ variantId: recipeLines.variantId, n: sql<number>`count(*)::int` }).from(recipeLines).where(inArray(recipeLines.variantId, variantIds)).groupBy(recipeLines.variantId)
    : [];
  return {
    ...o,
    lines: o.lines.map((l) => {
      const refunded = lines.find((x) => x.id === l.id)?.refundedQty ?? 0;
      const single = (counts.find((c) => c.variantId === l.variantId)?.n ?? 0) === 1;
      return { ...l, refundedQty: refunded, remainingQty: l.qty - refunded, defaultRestock: l.deductStock && single && l.modifiers.length === 0 };
    }),
  };
}
export type RefundableOrder = Awaited<ReturnType<typeof getRefundable>>;

/** Everything the 80 mm receipt needs (plan §6): branch header, lines, totals in USD + KHR, payments, change, cashier. */
export async function getReceiptData(ctx: AppContext, orderId: string, opts: { refundId?: string | null } = {}) {
  const { branches, payments, paymentMethods, refundLines, refunds } = await import("@/db/schema");
  const order = await getOrder(ctx, orderId);
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, order.branchId));
  const [cashier] = await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, order.createdBy));
  const pays = await ctx.db.select({ p: payments, method: paymentMethods.name }).from(payments).innerJoin(paymentMethods, eq(paymentMethods.id, payments.methodId))
    .where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt));
  const khrRate = pays.find((x) => x.p.currencyCode === "KHR" && !x.p.isRefund)?.p.rateUsed ?? (await currentRate(ctx, order.branchId, "KHR"));
  let refund = null;
  if (opts.refundId) {
    const [r] = await ctx.db.select().from(refunds).where(and(eq(refunds.id, opts.refundId), eq(refunds.orderId, orderId)));
    if (r) {
      const rl = await ctx.db.select().from(refundLines).where(eq(refundLines.refundId, r.id));
      refund = { ...r, lines: rl.map((l) => ({ ...l, name: order.lines.find((x) => x.id === l.orderLineId)?.productName ?? "" })), payment: pays.find((x) => x.p.refundId === r.id) ?? null };
    }
  }
  return {
    order, cashierName: cashier?.name ?? "",
    branch: { name: branch.name, address: branch.address, phone: branch.phone, header: branch.receiptHeader, footer: branch.receiptFooter },
    payments: pays.filter((x) => !x.p.isRefund).map((x) => ({ ...x.p, method: x.method })),
    khrRate, refund,
  };
}
export type ReceiptData = Awaited<ReturnType<typeof getReceiptData>>;

export async function listExchangeRateHistory(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  return ctx.db.select({ id: exchangeRates.id, currencyCode: exchangeRates.currencyCode, rate: exchangeRates.rateToBase, effectiveFrom: exchangeRates.effectiveFrom, byName: user.name })
    .from(exchangeRates).leftJoin(user, eq(user.id, exchangeRates.createdBy))
    .where(eq(exchangeRates.branchId, branchId)).orderBy(desc(exchangeRates.effectiveFrom)).limit(20);
}

export async function listAllPaymentMethods(ctx: AppContext) {
  const { paymentMethods } = await import("@/db/schema");
  return ctx.db.select().from(paymentMethods).where(eq(paymentMethods.branchId, ctx.branchId)).orderBy(asc(paymentMethods.name));
}
