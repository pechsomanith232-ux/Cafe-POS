import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  currencies,
  goodsReceiptExtraCosts,
  goodsReceiptLines,
  goodsReceipts,
  itemUnits,
  items,
  paymentMethods,
  supplierPaymentAllocations,
  supplierPayments,
  supplierReturns,
  suppliers,
  units,
  user,
} from "@/db/schema";
import { agingBuckets } from "@/lib/domain/aging";
import { dec, sum, toMoneyString } from "@/lib/domain/money";
import { NotFoundError } from "@/lib/errors";
import { ROUNDING_TOLERANCE } from "@/lib/services/purchasing";
import { itemOptionsFor } from "./inventory";
import { assertBranchAccess, ForbiddenError, hasPermission, requirePermission, type AppContext } from "@/lib/permissions";

const CREDIT_KEYS = ["purchasing.view", "purchasing.receive", "purchasing.pay"] as const;

/** Can see credit purchasing (invoices, balances owed) at this branch. */
export function canSeeCredit(ctx: AppContext, branchId: string) {
  return CREDIT_KEYS.some((k) => hasPermission(ctx, branchId, k));
}

/** Can see purchasing at this branch: view, receive, pay, or direct-purchase entry. */
function requirePurchasingView(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  if (!canSeeCredit(ctx, branchId) && !hasPermission(ctx, branchId, "purchasing.direct")) {
    throw new ForbiddenError("Missing permission purchasing.view at this branch.");
  }
}

/** Credit invoices and balances: not for users who may only enter direct purchases. */
function requireCreditView(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  if (!canSeeCredit(ctx, branchId)) throw new ForbiddenError("Missing permission purchasing.view at this branch.");
}

/** A branch's own methods (payment methods are per branch); defaults to the active branch. */
export async function listPaymentMethods(ctx: AppContext, branchId = ctx.branchId) {
  assertBranchAccess(ctx, branchId);
  return ctx.db.select().from(paymentMethods).where(and(eq(paymentMethods.branchId, branchId), eq(paymentMethods.isActive, true))).orderBy(asc(paymentMethods.name));
}

export async function listCurrencies(ctx: AppContext) {
  return ctx.db.select().from(currencies).orderBy(asc(currencies.code));
}

/** Suppliers with what is owed and any credit at the active branch. */
export async function listSuppliers(ctx: AppContext, opts: { includeInactive?: boolean } = {}) {
  requireCreditView(ctx, ctx.branchId);
  const b = ctx.branchId;
  return ctx.db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      address: suppliers.address,
      paymentTermsDays: suppliers.paymentTermsDays,
      note: suppliers.note,
      isActive: suppliers.isActive,
      owed: sql<string>`coalesce((select sum(${goodsReceipts.amountDue}) from ${goodsReceipts} where ${goodsReceipts.supplierId} = ${suppliers.id} and ${goodsReceipts.branchId} = ${b} and ${goodsReceipts.status} = 'posted' and ${goodsReceipts.purchaseType} = 'credit'), 0)::numeric(18,4)::text`,
      credit: sql<string>`coalesce((select sum(${supplierPayments.unallocatedBase}) from ${supplierPayments} where ${supplierPayments.supplierId} = ${suppliers.id} and ${supplierPayments.branchId} = ${b}), 0)::numeric(18,4)::text`,
    })
    .from(suppliers)
    .where(and(eq(suppliers.orgId, ctx.orgId), opts.includeInactive ? undefined : eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name));
}

export type SupplierRow = Awaited<ReturnType<typeof listSuppliers>>[number];

/** Active suppliers for pickers; `owed` is null for users who can't see credit balances. */
export async function listSupplierOptions(ctx: AppContext) {
  requirePurchasingView(ctx, ctx.branchId);
  const showOwed = canSeeCredit(ctx, ctx.branchId);
  const rows = await ctx.db
    .select({
      id: suppliers.id, name: suppliers.name, paymentTermsDays: suppliers.paymentTermsDays,
      owed: sql<string>`coalesce((select sum(${goodsReceipts.amountDue}) from ${goodsReceipts} where ${goodsReceipts.supplierId} = ${suppliers.id} and ${goodsReceipts.branchId} = ${ctx.branchId} and ${goodsReceipts.status} = 'posted' and ${goodsReceipts.purchaseType} = 'credit'), 0)::numeric(18,4)::text`,
    })
    .from(suppliers)
    .where(and(eq(suppliers.orgId, ctx.orgId), eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name));
  return rows.map((r) => ({ ...r, owed: showOwed ? r.owed : null }));
}

export type SupplierOption = Awaited<ReturnType<typeof listSupplierOptions>>[number];

/** Posted credit receipts with something still due, oldest first (payment form). */
export async function listOpenReceipts(ctx: AppContext, supplierId: string, branchId: string) {
  requireCreditView(ctx, branchId);
  return ctx.db
    .select({
      id: goodsReceipts.id, number: goodsReceipts.number, supplierInvoiceNo: goodsReceipts.supplierInvoiceNo,
      receiptDate: goodsReceipts.receiptDate, dueDate: goodsReceipts.dueDate, total: goodsReceipts.total,
      amountPaid: goodsReceipts.amountPaid, amountDue: goodsReceipts.amountDue, paymentStatus: goodsReceipts.paymentStatus,
    })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.supplierId, supplierId), eq(goodsReceipts.branchId, branchId), eq(goodsReceipts.purchaseType, "credit"),
      eq(goodsReceipts.status, "posted"), sql`${goodsReceipts.amountDue} > 0`))
    .orderBy(sql`${goodsReceipts.dueDate} asc nulls last`, asc(goodsReceipts.receiptDate), asc(goodsReceipts.number));
}

export type OpenReceipt = Awaited<ReturnType<typeof listOpenReceipts>>[number];

/** Supplier page: details, open invoices, payments with credit, balance and aging at the active branch. */
export async function getSupplier(ctx: AppContext, id: string, asOf?: string) {
  requireCreditView(ctx, ctx.branchId);
  const [s] = await ctx.db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId)));
  if (!s) throw new NotFoundError("Supplier not found.");
  const open = await listOpenReceipts(ctx, id, ctx.branchId);
  const payments = await ctx.db
    .select({
      id: supplierPayments.id, number: supplierPayments.number, kind: supplierPayments.kind, paymentDate: supplierPayments.paymentDate,
      method: paymentMethods.name, currencyCode: supplierPayments.currencyCode, amount: supplierPayments.amount,
      amountBase: supplierPayments.amountBase, unallocatedBase: supplierPayments.unallocatedBase, reference: supplierPayments.reference,
    })
    .from(supplierPayments)
    .leftJoin(paymentMethods, eq(paymentMethods.id, supplierPayments.methodId))
    .where(and(eq(supplierPayments.supplierId, id), eq(supplierPayments.branchId, ctx.branchId)))
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.number))
    .limit(100);
  // All payments, not just the 100 listed.
  const [{ credit }] = await ctx.db
    .select({ credit: sql<string>`coalesce(sum(${supplierPayments.unallocatedBase}), 0)::text` })
    .from(supplierPayments)
    .where(and(eq(supplierPayments.supplierId, id), eq(supplierPayments.branchId, ctx.branchId)));
  const creditBalance = toMoneyString(credit);
  const owed = toMoneyString(sum(open.map((r) => r.amountDue)));
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  return { ...s, openReceipts: open, payments, creditBalance, owed, aging: agingBuckets(open, today) };
}

export async function listReceipts(ctx: AppContext, opts: { branchId: string; type?: "credit" | "direct"; status?: string }) {
  requirePurchasingView(ctx, opts.branchId);
  if (!canSeeCredit(ctx, opts.branchId)) opts = { ...opts, type: "direct" };
  return ctx.db
    .select({
      id: goodsReceipts.id, number: goodsReceipts.number, purchaseType: goodsReceipts.purchaseType, status: goodsReceipts.status,
      receiptDate: goodsReceipts.receiptDate, dueDate: goodsReceipts.dueDate, supplierName: sql<string | null>`coalesce(${suppliers.name}, ${goodsReceipts.supplierNameText})`,
      supplierInvoiceNo: goodsReceipts.supplierInvoiceNo, total: goodsReceipts.total, amountDue: goodsReceipts.amountDue,
      paymentStatus: goodsReceipts.paymentStatus, createdByName: user.name,
    })
    .from(goodsReceipts)
    .leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(user, eq(user.id, goodsReceipts.createdBy))
    .where(and(
      eq(goodsReceipts.branchId, opts.branchId),
      opts.type ? eq(goodsReceipts.purchaseType, opts.type) : undefined,
      opts.status ? eq(goodsReceipts.status, opts.status) : undefined,
    ))
    .orderBy(desc(goodsReceipts.receiptDate), desc(goodsReceipts.number))
    .limit(500);
}

export type ReceiptRow = Awaited<ReturnType<typeof listReceipts>>[number];

/** One receipt with lines, extra costs, allocations and returns. */
export async function getReceipt(ctx: AppContext, id: string) {
  const [r] = await ctx.db
    .select({ receipt: goodsReceipts, supplierName: suppliers.name })
    .from(goodsReceipts)
    .leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .where(eq(goodsReceipts.id, id));
  if (!r) throw new NotFoundError("Receipt not found.");
  if (r.receipt.purchaseType === "credit") requireCreditView(ctx, r.receipt.branchId);
  else requirePurchasingView(ctx, r.receipt.branchId);
  const lines = await ctx.db
    .select({
      id: goodsReceiptLines.id, itemId: goodsReceiptLines.itemId, itemName: items.name, baseUnit: units.code,
      unitLabel: goodsReceiptLines.unitLabel, unitFactor: goodsReceiptLines.unitFactor, qtyEntered: goodsReceiptLines.qtyEntered,
      qtyBase: goodsReceiptLines.qtyBase, unitCostEntered: goodsReceiptLines.unitCostEntered, lineTotal: goodsReceiptLines.lineTotal,
      allocatedExtra: goodsReceiptLines.allocatedExtra, landedTotal: goodsReceiptLines.landedTotal, landedUnitCostBase: goodsReceiptLines.landedUnitCostBase,
      returnedQty: sql<string>`coalesce((select sum(qty_entered) from supplier_return_lines where receipt_line_id = ${goodsReceiptLines.id}), 0)::numeric(18,4)::text`,
    })
    .from(goodsReceiptLines)
    .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .where(eq(goodsReceiptLines.receiptId, id))
    .orderBy(asc(goodsReceiptLines.sortOrder));
  const extraCosts = await ctx.db.select().from(goodsReceiptExtraCosts).where(eq(goodsReceiptExtraCosts.receiptId, id));
  const allocations = await ctx.db
    .select({ id: supplierPaymentAllocations.id, amountBase: supplierPaymentAllocations.amountBase, paymentNumber: supplierPayments.number,
      paymentDate: supplierPayments.paymentDate, kind: supplierPayments.kind, method: paymentMethods.name, currencyCode: supplierPayments.currencyCode, amount: supplierPayments.amount })
    .from(supplierPaymentAllocations)
    .innerJoin(supplierPayments, eq(supplierPayments.id, supplierPaymentAllocations.paymentId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, supplierPayments.methodId))
    .where(eq(supplierPaymentAllocations.receiptId, id))
    .orderBy(asc(supplierPaymentAllocations.createdAt));
  const returns = await ctx.db.select().from(supplierReturns).where(eq(supplierReturns.receiptId, id)).orderBy(asc(supplierReturns.number));
  return { ...r.receipt, supplierName: r.supplierName, lines, extraCosts, allocations, returns };
}

export type ReceiptDetail = Awaited<ReturnType<typeof getReceipt>>;

export async function listPayments(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  if (!hasPermission(ctx, branchId, "purchasing.view") && !hasPermission(ctx, branchId, "purchasing.pay")) {
    throw new ForbiddenError("Missing permission purchasing.view at this branch.");
  }
  return ctx.db
    .select({
      id: supplierPayments.id, number: supplierPayments.number, kind: supplierPayments.kind, paymentDate: supplierPayments.paymentDate,
      supplierId: supplierPayments.supplierId, supplierName: suppliers.name, method: paymentMethods.name, currencyCode: supplierPayments.currencyCode,
      amount: supplierPayments.amount, amountBase: supplierPayments.amountBase, unallocatedBase: supplierPayments.unallocatedBase,
      reference: supplierPayments.reference, note: supplierPayments.note,
    })
    .from(supplierPayments)
    .leftJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, supplierPayments.methodId))
    .where(eq(supplierPayments.branchId, branchId))
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.number))
    .limit(500);
}

export type PaymentRow = Awaited<ReturnType<typeof listPayments>>[number];

export type StatementRow = {
  date: string;
  kind: "receipt" | "payment" | "return_credit" | "return" | "refund";
  ref: string;
  description: string;
  debit: string | null;
  credit: string | null;
  balance: string;
};

/**
 * Supplier statement at a branch (plan §7): receipts (debit), payments and
 * return credits (credit), with a running balance owed. Direct purchases show
 * both their receipt and payment, so they net to zero.
 */
export async function supplierStatement(ctx: AppContext, opts: { supplierId: string; branchId: string }) {
  assertBranchAccess(ctx, opts.branchId);
  requirePermission(ctx, opts.branchId, "purchasing.view");
  return buildSupplierStatement(ctx, opts);
}

/** The statement itself; callers check permissions (purchasing.view or reports.ap). */
export async function buildSupplierStatement(ctx: AppContext, opts: { supplierId: string; branchId: string }) {
  const [s] = await ctx.db.select().from(suppliers).where(and(eq(suppliers.id, opts.supplierId), eq(suppliers.orgId, ctx.orgId)));
  if (!s) throw new NotFoundError("Supplier not found.");
  const receipts = await ctx.db.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.supplierId, s.id), eq(goodsReceipts.branchId, opts.branchId), eq(goodsReceipts.status, "posted")));
  const payments = await ctx.db.select().from(supplierPayments)
    .where(and(eq(supplierPayments.supplierId, s.id), eq(supplierPayments.branchId, opts.branchId)));
  const directIds = receipts.filter((r) => r.purchaseType === "direct").map((r) => r.id);
  const directReturns = directIds.length ? await ctx.db.select().from(supplierReturns).where(inArray(supplierReturns.receiptId, directIds)) : [];

  type Entry = Omit<StatementRow, "balance"> & { at: number; seq: number };
  const entries: Entry[] = [
    ...receipts.map((r) => ({
      date: r.receiptDate, at: r.postedAt?.getTime() ?? 0, seq: 0, kind: "receipt" as const,
      ref: `GR-${String(r.number).padStart(6, "0")}`, description: `${r.purchaseType === "direct" ? "Direct purchase" : "Invoice"}${r.supplierInvoiceNo ? ` ${r.supplierInvoiceNo}` : ""}`,
      debit: r.total, credit: null,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate, at: p.createdAt.getTime(), seq: 1, kind: p.kind === "return_credit" ? ("return_credit" as const) : ("payment" as const),
      ref: `PAY-${String(p.number).padStart(6, "0")}`, description: p.note ?? (p.kind === "return_credit" ? "Return credit" : "Payment"),
      debit: null, credit: p.amountBase,
    })),
    ...directReturns.flatMap((r) => [
      { date: r.returnDate, at: r.createdAt.getTime(), seq: 2, kind: "return" as const, ref: `RET-${r.number}`, description: `Return: ${r.reason}`, debit: null, credit: r.total },
      { date: r.returnDate, at: r.createdAt.getTime(), seq: 3, kind: "refund" as const, ref: `RET-${r.number}`, description: "Refund received", debit: r.total, credit: null },
    ]),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at || a.seq - b.seq);

  let balance = dec(0);
  const rows: StatementRow[] = entries.map(({ at: _a, seq: _s, ...e }) => {
    void _a; void _s;
    balance = balance.plus(e.debit ?? 0).minus(e.credit ?? 0);
    return { ...e, balance: toMoneyString(balance) };
  });
  return { supplier: s, rows, balance: toMoneyString(balance) };
}

/**
 * AP aging at a branch as of a date (plan §4.9): posted CREDIT receipts dated
 * on or before `asOf` (direct purchases never appear), with the balance owed
 * ON that date — total minus payments and return credits dated on or before
 * it — bucketed by days overdue. Balances under one cent count as settled.
 */
export async function apAging(ctx: AppContext, opts: { branchId: string; asOf: string }) {
  assertBranchAccess(ctx, opts.branchId);
  requirePermission(ctx, opts.branchId, "reports.ap");
  const paidAsOf = sql<string>`coalesce((select sum(a.amount_base) from ${supplierPaymentAllocations} a join ${supplierPayments} p on p.id = a.payment_id
    where a.receipt_id = ${goodsReceipts.id} and p.payment_date <= ${opts.asOf}), 0)`;
  const rows = await ctx.db
    .select({
      supplierId: suppliers.id, supplierName: suppliers.name, dueDate: goodsReceipts.dueDate,
      receiptId: goodsReceipts.id, number: goodsReceipts.number, invoiceNo: goodsReceipts.supplierInvoiceNo, receiptDate: goodsReceipts.receiptDate, total: goodsReceipts.total,
      amountDue: sql<string>`(${goodsReceipts.total} - ${paidAsOf})::numeric(18,4)::text`,
    })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .where(and(eq(goodsReceipts.branchId, opts.branchId), eq(goodsReceipts.purchaseType, "credit"), eq(goodsReceipts.status, "posted"),
      sql`${goodsReceipts.receiptDate} <= ${opts.asOf}`));
  const open = rows.filter((r) => dec(r.amountDue).gte(ROUNDING_TOLERANCE));
  const bySupplier = new Map<string, { supplierId: string; supplierName: string; open: typeof open }>();
  for (const r of open) {
    const e = bySupplier.get(r.supplierId) ?? { supplierId: r.supplierId, supplierName: r.supplierName, open: [] };
    e.open.push(r);
    bySupplier.set(r.supplierId, e);
  }
  const out = [...bySupplier.values()]
    .map((e) => ({
      supplierId: e.supplierId, supplierName: e.supplierName, ...agingBuckets(e.open, opts.asOf),
      // Drill-down: the open invoices behind the buckets, oldest first.
      invoices: e.open
        .map((r) => ({ receiptId: r.receiptId, ref: `GR-${String(r.number).padStart(6, "0")}`, invoiceNo: r.invoiceNo, receiptDate: r.receiptDate, dueDate: r.dueDate, total: r.total, amountDue: r.amountDue }))
        .sort((a, b) => a.receiptDate.localeCompare(b.receiptDate)),
    }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  return { asOf: opts.asOf, rows: out, totals: agingBuckets(open, opts.asOf) };
}

/** Items for the receipt form (purchasing permission instead of inventory.view). */
export async function listPurchasableItems(ctx: AppContext) {
  requirePurchasingView(ctx, ctx.branchId);
  const options = await itemOptionsFor(ctx);
  const ids = options.map((o) => o.id);
  const packs = ids.length ? await ctx.db.select().from(itemUnits).where(inArray(itemUnits.itemId, ids)) : [];
  return options.map((o) => {
    const def = packs.find((p) => p.itemId === o.id && p.isPurchaseDefault);
    const largest = [...o.unitOptions].filter((u) => u.key.startsWith("iu:")).sort((a, b) => Number(b.factor) - Number(a.factor))[0];
    return { ...o, purchaseUnitKey: def ? `iu:${def.id}` : (largest?.key ?? "base") };
  });
}

export type PurchasableItem = Awaited<ReturnType<typeof listPurchasableItems>>[number];
