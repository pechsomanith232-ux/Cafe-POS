import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  currencies,
  goodsReceiptExtraCosts,
  goodsReceiptLines,
  cashMovements,
  goodsReceipts,
  items,
  paymentMethods,
  supplierPaymentAllocations,
  supplierPayments,
  supplierReturnLines,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { addDays } from "@/lib/dates";
import { autoAllocate } from "@/lib/domain/allocation";
import { allocateExtraCosts } from "@/lib/domain/landed";
import { dec, sum, toCostString, toMoneyString, toQtyString } from "@/lib/domain/money";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, ForbiddenError, hasPermission, requirePermission, type AppContext } from "@/lib/permissions";
import {
  allocationsInput,
  paymentDetailsInput,
  receiptInput,
  supplierInput,
  supplierPaymentInput,
  supplierReturnInput,
  type PaymentDetails,
  type ReceiptInput,
  type SupplierInput,
  type SupplierPaymentInput,
  type SupplierReturnInput,
} from "@/lib/validators/purchasing";
import { writeAudit } from "./audit";
import { currencyAt } from "./currency-rates";
import { requireOpenShift } from "./shifts";
import { itemUnitOptions } from "./inventory";
import { applyStockMovements } from "./stock";
import { inTransaction } from "./tx";

type Receipt = typeof goodsReceipts.$inferSelect;
export const receiptLabel = (n: number) => `GR-${String(n).padStart(6, "0")}`;

// ---------- permissions ----------

/** Credit receipts need purchasing.receive, direct ones purchasing.direct, at the receipt's branch. */
function requireReceiptPermission(ctx: AppContext, branchId: string, type: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, type === "direct" ? "purchasing.direct" : "purchasing.receive");
}

function requireSupplierAdmin(ctx: AppContext) {
  if (!hasPermission(ctx, ctx.branchId, "purchasing.receive") && !hasPermission(ctx, ctx.branchId, "purchasing.pay")) {
    throw new ForbiddenError("Missing permission purchasing.receive or purchasing.pay at this branch.");
  }
}

// ---------- suppliers ----------

async function assertSupplierNameFree(tx: Executor, orgId: string, name: string, exceptId?: string) {
  const [dupe] = await tx.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.orgId, orgId), sql`lower(${suppliers.name}) = lower(${name})`, exceptId ? ne(suppliers.id, exceptId) : undefined));
  if (dupe) throw new ConflictError(`A supplier named "${name}" already exists.`);
}

export async function createSupplier(ctx: AppContext, input: SupplierInput) {
  requireSupplierAdmin(ctx);
  const data = parseInput(supplierInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    await assertSupplierNameFree(tx, ctx.orgId, data.name);
    const [s] = await tx.insert(suppliers).values({ ...data, orgId: ctx.orgId }).returning();
    await writeAudit(tx, ctx, { action: "supplier.create", entity: "supplier", entityId: s.id, after: data });
    return s;
  });
}

export async function updateSupplier(ctx: AppContext, id: string, input: SupplierInput & { isActive?: boolean }) {
  requireSupplierAdmin(ctx);
  const data = parseInput(supplierInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const [before] = await tx.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId))).for("update");
    if (!before) throw new NotFoundError("Supplier not found.");
    await assertSupplierNameFree(tx, ctx.orgId, data.name, id);
    const isActive = input.isActive ?? before.isActive;
    await tx.update(suppliers).set({ ...data, isActive }).where(eq(suppliers.id, id));
    const { createdAt: _c, updatedAt: _u, orgId: _o, id: _i, ...snap } = before;
    void _c; void _u; void _o; void _i;
    await writeAudit(tx, ctx, { action: "supplier.update", entity: "supplier", entityId: id, before: snap, after: { ...data, isActive } });
  });
}

async function loadSupplier(tx: Executor, ctx: AppContext, id: string) {
  const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId)));
  if (!s) throw new ValidationError("Unknown supplier.");
  return s;
}

// ---------- payment details ----------

/** Validate method + currency and convert an amount to base currency (USD). */
async function resolvePayment(tx: Executor, ctx: AppContext, details: PaymentDetails, branchId: string) {
  const d = parseInput(paymentDetailsInput, details);
  const [method] = await tx.select().from(paymentMethods)
    .where(and(eq(paymentMethods.id, d.methodId), eq(paymentMethods.branchId, branchId), eq(paymentMethods.isActive, true)));
  if (!method) throw new ValidationError("Choose a payment method.");
  const [currency] = await tx.select().from(currencies).where(eq(currencies.code, d.currencyCode));
  if (!currency) throw new ValidationError("Unknown currency.");
  const isBase = currency.code === "USD";
  // A typed rate wins; otherwise the branch's current rate (Settings → POS settings).
  const rate = isBase ? "1" : d.rate ?? (await currencyAt(tx, branchId, currency.code)).rate;
  return { method, currency, rate, reference: d.reference, paidFromDrawer: d.paidFromDrawer ?? null };
}

// ---------- goods receipts ----------

async function loadReceipt(tx: Executor, ctx: AppContext, id: string, lock = false): Promise<Receipt> {
  const q = tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r || !ctx.branchIds.includes(r.branchId)) {
    // Another branch's receipt: don't reveal it exists, but refuse as forbidden.
    if (r) throw new ForbiddenError("You don't have access to that branch.");
    throw new NotFoundError("Receipt not found.");
  }
  return r;
}

/** Build lines (units → base, line totals) and totals for a receipt draft. */
async function buildReceipt(tx: Executor, ctx: AppContext, data: ReturnType<typeof receiptInput.parse>) {
  const lines = [];
  for (const [i, l] of data.lines.entries()) {
    const [item] = await tx.select().from(items).where(and(eq(items.id, l.itemId), eq(items.orgId, ctx.orgId)));
    if (!item) throw new ValidationError("Unknown item.");
    const unit = (await itemUnitOptions(tx, item)).find((u) => u.key === l.unitKey);
    if (!unit) throw new ValidationError(`Unknown unit for ${item.name}.`);
    const qtyBase = toQtyString(dec(l.qty).times(unit.factor));
    if (dec(qtyBase).isZero()) throw new ValidationError(`Quantity for ${item.name} is too small.`);
    lines.push({
      itemId: item.id, unitLabel: unit.label, unitFactor: unit.factor, qtyEntered: l.qty, qtyBase,
      unitCostEntered: l.unitCost, lineTotal: toMoneyString(dec(l.qty).times(l.unitCost)), sortOrder: i,
    });
  }
  const subtotal = sum(lines.map((l) => l.lineTotal));
  const extra = sum(data.extraCosts.map((e) => e.amount));
  return { lines, subtotal: toMoneyString(subtotal), extraCosts: toMoneyString(extra), total: toMoneyString(subtotal.plus(extra)) };
}

/** Create (id = null) or update a draft goods receipt. */
export async function saveReceipt(ctx: AppContext, id: string | null, input: ReceiptInput): Promise<Receipt> {
  const data = parseInput(receiptInput, input);
  requireReceiptPermission(ctx, data.branchId, data.purchaseType);
  return inTransaction(ctx, async (tx, ctx) => {
    const supplier = data.supplierId ? await loadSupplier(tx, ctx, data.supplierId) : null;
    const terms = data.purchaseType === "credit" ? (data.paymentTermsDays ?? supplier?.paymentTermsDays ?? 0) : null;
    const built = await buildReceipt(tx, ctx, data);
    const header = {
      branchId: data.branchId, purchaseType: data.purchaseType, supplierId: supplier?.id ?? null,
      supplierNameText: supplier ? null : data.supplierNameText, supplierInvoiceNo: data.supplierInvoiceNo,
      receiptDate: data.receiptDate, paymentTermsDays: terms, dueDate: terms === null ? null : addDays(data.receiptDate, terms),
      note: data.note, subtotal: built.subtotal, extraCosts: built.extraCosts, total: built.total, amountDue: built.total,
    };
    let receipt: Receipt;
    if (id) {
      const existing = await loadReceipt(tx, ctx, id, true);
      requireReceiptPermission(ctx, existing.branchId, existing.purchaseType);
      if (existing.status !== "draft") throw new ValidationError("Only draft receipts can be edited. Use a supplier return instead.");
      if (existing.branchId !== data.branchId || existing.purchaseType !== data.purchaseType) {
        throw new ValidationError("A draft can't change branch or purchase type.");
      }
      [receipt] = await tx.update(goodsReceipts).set(header).where(eq(goodsReceipts.id, id)).returning();
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, id));
      await tx.delete(goodsReceiptExtraCosts).where(eq(goodsReceiptExtraCosts.receiptId, id));
    } else {
      [receipt] = await tx.insert(goodsReceipts).values({ ...header, createdBy: ctx.userId }).returning();
    }
    await tx.insert(goodsReceiptLines).values(built.lines.map((l) => ({ ...l, receiptId: receipt.id })));
    if (data.extraCosts.length) {
      await tx.insert(goodsReceiptExtraCosts).values(data.extraCosts.map((e) => ({ ...e, receiptId: receipt.id })));
    }
    return receipt;
  });
}

export async function deleteReceipt(ctx: AppContext, id: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const r = await loadReceipt(tx, ctx, id, true);
    requireReceiptPermission(ctx, r.branchId, r.purchaseType);
    if (r.status !== "draft") throw new ValidationError("Posted receipts can't be deleted. Use a supplier return instead.");
    await tx.delete(goodsReceipts).where(eq(goodsReceipts.id, id));
  });
}

/** Below this, a balance left by currency conversion is written off (less than one cent). */
export const ROUNDING_TOLERANCE = "0.01";

/**
 * Recompute paid / due / status of a receipt from its allocations. A balance
 * under one cent left after a payment (riel at an uneven rate) is written off
 * to `rounding_base` so the invoice closes.
 */
async function refreshReceiptPayment(tx: Executor, receiptId: string) {
  const [r] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, receiptId));
  const [{ paid }] = await tx
    .select({ paid: sql<string>`coalesce(sum(${supplierPaymentAllocations.amountBase}), 0)::text` })
    .from(supplierPaymentAllocations)
    .where(eq(supplierPaymentAllocations.receiptId, receiptId));
  let due = dec(r.total).minus(paid);
  let rounding = dec(0);
  if (due.gt(0) && due.lt(ROUNDING_TOLERANCE) && dec(paid).gt(0)) {
    rounding = due;
    due = dec(0);
  }
  const status = due.lte(0) ? "paid" : dec(paid).gt(0) ? "partial" : "unpaid";
  await tx.update(goodsReceipts).set({
    amountPaid: toMoneyString(paid), amountDue: toMoneyString(due.lt(0) ? 0 : due), roundingBase: toMoneyString(rounding), paymentStatus: status,
  }).where(eq(goodsReceipts.id, receiptId));
}

/**
 * Post a draft (plan §5.8): allocate extra costs by value, write `purchase`
 * movements at landed cost (WAC), and either open the AP balance (credit) or
 * record the full payment at once (direct, `payment` required).
 */
export async function postGoodsReceipt(ctx: AppContext, id: string, payment?: PaymentDetails | null) {
  await inTransaction(ctx, async (tx, ctx) => {
    const r = await loadReceipt(tx, ctx, id, true);
    requireReceiptPermission(ctx, r.branchId, r.purchaseType);
    if (r.status !== "draft") throw new ValidationError("This receipt is already posted.");
    if (r.purchaseType === "direct" && !payment) throw new ValidationError("Choose how the purchase was paid (payment method).");
    const pay = r.purchaseType === "direct" ? await resolvePayment(tx, ctx, payment!, r.branchId) : null;

    const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, id)).orderBy(asc(goodsReceiptLines.sortOrder));
    if (!lines.length) throw new ValidationError("This receipt has no lines.");
    const landed = allocateExtraCosts(lines, r.extraCosts);
    for (const [i, l] of lines.entries()) {
      await tx.update(goodsReceiptLines).set({
        allocatedExtra: landed[i].allocated,
        landedTotal: landed[i].landedTotal,
        landedUnitCostBase: toCostString(dec(landed[i].landedTotal).div(l.qtyBase)),
      }).where(eq(goodsReceiptLines.id, l.id));
    }
    const label = receiptLabel(r.number);
    await applyStockMovements(tx, lines.map((l, i) => ({
      branchId: r.branchId, itemId: l.itemId, type: "purchase" as const, qtyBase: l.qtyBase,
      totalCost: landed[i].landedTotal, unitCost: toCostString(dec(landed[i].landedTotal).div(l.qtyBase)),
      enteredUnitLabel: l.unitLabel, enteredQty: l.qtyEntered,
      refType: "goods_receipt", refId: id, reason: label, createdBy: ctx.userId,
    })));

    await tx.update(goodsReceipts).set({ status: "posted", postedAt: new Date(), postedBy: ctx.userId }).where(eq(goodsReceipts.id, id));

    let paymentId: string | null = null;
    if (pay) {
      // Cash is rounded to the currency's cash step (riel: 100) so the drawer can actually pay it.
      const exact = dec(r.total).times(pay.rate);
      const step = dec(pay.currency.cashRounding);
      const amount = pay.method.type === "cash" && step.gt(0) ? exact.div(step).toDecimalPlaces(0, 4).times(step) : exact.toDecimalPlaces(pay.currency.decimals);
      // Paid from the cash drawer (plan §4.9): needs an open shift; the pay-out keeps expected cash right.
      if (pay.paidFromDrawer) {
        if (pay.method.type !== "cash") throw new ValidationError("Only cash can be paid from the drawer.");
        const shift = await requireOpenShift(tx, r.branchId, pay.paidFromDrawer.registerId);
        await tx.insert(cashMovements).values({
          shiftId: shift.id, branchId: r.branchId, type: "pay_out", currencyCode: pay.currency.code, amount: toMoneyString(amount),
          reason: `Direct purchase ${label}`, refType: "goods_receipt", refId: r.id, createdBy: ctx.userId,
        });
        await tx.update(goodsReceipts).set({ paidFromShiftId: shift.id }).where(eq(goodsReceipts.id, r.id));
      }
      const [p] = await tx.insert(supplierPayments).values({
        supplierId: r.supplierId, branchId: r.branchId, kind: "payment", paymentDate: r.receiptDate, methodId: pay.method.id,
        currencyCode: pay.currency.code, amount: toMoneyString(amount), rateUsed: pay.rate, amountBase: r.total, unallocatedBase: "0",
        reference: pay.reference, note: `Direct purchase ${label}`, createdBy: ctx.userId,
      }).returning();
      paymentId = p.id;
      await tx.insert(supplierPaymentAllocations).values({ paymentId: p.id, receiptId: id, amountBase: r.total, createdBy: ctx.userId });
    }
    await refreshReceiptPayment(tx, id);
    await writeAudit(tx, ctx, {
      action: "goods_receipt.post", entity: "goods_receipt", entityId: id, branchId: r.branchId,
      after: { number: label, type: r.purchaseType, supplierId: r.supplierId, supplierName: r.supplierNameText, total: r.total, paymentId },
    });
  });
}

/** Save the draft and post it in ONE transaction, so a failed post leaves no draft behind. */
export async function saveAndPostReceipt(ctx: AppContext, id: string | null, input: ReceiptInput, payment?: PaymentDetails | null) {
  return inTransaction(ctx, async (_tx, ctx) => {
    const r = await saveReceipt(ctx, id, input);
    await postGoodsReceipt(ctx, r.id, payment);
    return r;
  });
}

// ---------- supplier payments ----------

/** Lock receipts in id order and apply allocations from a payment. */
async function applyAllocations(
  tx: Executor,
  ctx: AppContext,
  payment: { id: string; supplierId: string | null; branchId: string },
  allocations: { receiptId: string; amount: string }[],
) {
  const ids = [...new Set(allocations.map((a) => a.receiptId))].sort();
  if (ids.length !== allocations.length) throw new ValidationError("Each receipt can only appear once.");
  const rows = ids.length ? await tx.select().from(goodsReceipts).where(inArray(goodsReceipts.id, ids)).orderBy(asc(goodsReceipts.id)).for("update") : [];
  for (const a of allocations) {
    const r = rows.find((x) => x.id === a.receiptId);
    if (!r || r.supplierId !== payment.supplierId || r.branchId !== payment.branchId || r.purchaseType !== "credit" || r.status !== "posted") {
      throw new ValidationError("Payments can only be allocated to this supplier's posted credit receipts at the same branch.");
    }
    if (dec(a.amount).gt(r.amountDue)) {
      throw new ValidationError(`Allocation of $${dec(a.amount).toFixed(2)} to ${receiptLabel(r.number)} is more than its amount due ($${dec(r.amountDue).toFixed(2)}).`);
    }
    await tx.insert(supplierPaymentAllocations).values({ paymentId: payment.id, receiptId: a.receiptId, amountBase: toMoneyString(a.amount), createdBy: ctx.userId });
    await refreshReceiptPayment(tx, a.receiptId);
  }
}

async function openReceiptsOldestFirst(tx: Executor, supplierId: string, branchId: string) {
  return tx.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.supplierId, supplierId), eq(goodsReceipts.branchId, branchId), eq(goodsReceipts.purchaseType, "credit"),
      eq(goodsReceipts.status, "posted"), sql`${goodsReceipts.amountDue} > 0`))
    .orderBy(sql`${goodsReceipts.dueDate} asc nulls last`, asc(goodsReceipts.receiptDate), asc(goodsReceipts.number));
}

/** Record a payment to a supplier and allocate it (oldest first unless `allocations` is given). */
export async function recordSupplierPayment(ctx: AppContext, input: SupplierPaymentInput) {
  const data = parseInput(supplierPaymentInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "purchasing.pay");
  return inTransaction(ctx, async (tx, ctx) => {
    await loadSupplier(tx, ctx, data.supplierId);
    const pay = await resolvePayment(tx, ctx, data, data.branchId);
    const amountBase = toMoneyString(dec(data.amount).div(pay.rate));
    const allocations = data.allocations ?? autoAllocate(amountBase, (await openReceiptsOldestFirst(tx, data.supplierId, data.branchId)).map((r) => ({ receiptId: r.id, amountDue: r.amountDue }))).allocations;
    const allocated = sum(allocations.map((a) => a.amount));
    if (allocated.gt(amountBase)) throw new ValidationError("Allocations add up to more than the payment.");
    const [p] = await tx.insert(supplierPayments).values({
      supplierId: data.supplierId, branchId: data.branchId, kind: "payment", paymentDate: data.paymentDate, methodId: pay.method.id,
      currencyCode: pay.currency.code, amount: data.amount, rateUsed: pay.rate, amountBase, unallocatedBase: toMoneyString(dec(amountBase).minus(allocated)),
      reference: pay.reference, note: data.note, createdBy: ctx.userId,
    }).returning();
    await applyAllocations(tx, ctx, p, allocations);
    await writeAudit(tx, ctx, {
      action: "supplier_payment.create", entity: "supplier_payment", entityId: p.id, branchId: data.branchId,
      after: { supplierId: data.supplierId, amount: data.amount, currency: pay.currency.code, rate: pay.rate, amountBase, allocations },
    });
    return p;
  });
}

/** Apply a payment's unallocated balance (supplier credit) to open receipts. */
export async function allocateSupplierCredit(ctx: AppContext, paymentId: string, input: { receiptId: string; amount: string }[]) {
  const allocations = parseInput(allocationsInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, paymentId)).for("update");
    if (!p || !ctx.branchIds.includes(p.branchId)) throw new NotFoundError("Payment not found.");
    requirePermission(ctx, p.branchId, "purchasing.pay");
    const total = sum(allocations.map((a) => a.amount));
    if (total.gt(p.unallocatedBase)) throw new ValidationError(`Only $${dec(p.unallocatedBase).toFixed(2)} of this payment is unallocated.`);
    await applyAllocations(tx, ctx, p, allocations);
    await tx.update(supplierPayments).set({ unallocatedBase: toMoneyString(dec(p.unallocatedBase).minus(total)) }).where(eq(supplierPayments.id, paymentId));
    await writeAudit(tx, ctx, { action: "supplier_payment.allocate", entity: "supplier_payment", entityId: paymentId, branchId: p.branchId, after: { allocations } });
  });
}

// ---------- supplier returns ----------

/**
 * Return goods from a posted receipt (plan §4.9): `purchase_return` movements
 * at the line's landed cost (exact share of the landed line), then either a
 * supplier credit applied to the receipt (credit) or a refund (direct).
 */
export async function createSupplierReturn(ctx: AppContext, input: SupplierReturnInput) {
  const data = parseInput(supplierReturnInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const r = await loadReceipt(tx, ctx, data.receiptId, true);
    requireReceiptPermission(ctx, r.branchId, r.purchaseType);
    if (r.status !== "posted") throw new ValidationError("Only posted receipts can have returns.");
    if (r.purchaseType === "direct" && !data.refund) throw new ValidationError("Choose how the refund was received.");
    const refund = r.purchaseType === "direct" ? await resolvePayment(tx, ctx, data.refund!, r.branchId) : null;

    const receiptLines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, r.id));
    const already = await tx
      .select({
        lineId: supplierReturnLines.receiptLineId,
        qty: sql<string>`sum(${supplierReturnLines.qtyEntered})::text`,
        value: sql<string>`sum(${supplierReturnLines.lineTotal})::text`,
      })
      .from(supplierReturnLines)
      .innerJoin(supplierReturns, eq(supplierReturns.id, supplierReturnLines.returnId))
      .where(eq(supplierReturns.receiptId, r.id))
      .groupBy(supplierReturnLines.receiptLineId);

    const lines = data.lines.map((l) => {
      const rl = receiptLines.find((x) => x.id === l.receiptLineId);
      if (!rl) throw new ValidationError("That line isn't on this receipt.");
      const prev = already.find((a) => a.lineId === rl.id);
      const left = dec(rl.qtyEntered).minus(prev?.qty ?? "0");
      if (dec(l.qty).gt(left)) throw new ValidationError(`You can't return more than was received (${left.toString()} ${rl.unitLabel} left).`);
      // Value at the landed line's exact share; the return that empties the line
      // takes whatever value is left, so rounding never credits more than the line cost.
      const valueLeft = dec(rl.landedTotal).minus(prev?.value ?? "0");
      const share = dec(rl.landedTotal).times(l.qty).div(rl.qtyEntered).toDecimalPlaces(4);
      const value = dec(l.qty).eq(left) || share.gt(valueLeft) ? valueLeft : share;
      return {
        receiptLineId: rl.id, itemId: rl.itemId, unitLabel: rl.unitLabel, qtyEntered: l.qty,
        qtyBase: toQtyString(dec(l.qty).times(rl.unitFactor)), unitCostBase: rl.landedUnitCostBase,
        lineTotal: toMoneyString(value),
      };
    });
    const total = toMoneyString(sum(lines.map((l) => l.lineTotal)));

    const [ret] = await tx.insert(supplierReturns).values({
      branchId: r.branchId, receiptId: r.id, supplierId: r.supplierId, returnDate: data.returnDate, reason: data.reason, total,
      refundMethodId: refund?.method.id ?? null, refundCurrency: refund?.currency.code ?? null,
      refundAmount: refund ? toMoneyString(dec(total).times(refund.rate).toDecimalPlaces(refund.currency.decimals)) : null,
      refundRate: refund?.rate ?? null, createdBy: ctx.userId,
    }).returning();
    await tx.insert(supplierReturnLines).values(lines.map((l) => ({ ...l, returnId: ret.id })));

    await applyStockMovements(tx, lines.map((l) => ({
      branchId: r.branchId, itemId: l.itemId, type: "purchase_return" as const, qtyBase: `-${l.qtyBase}`,
      totalCost: l.lineTotal, enteredUnitLabel: l.unitLabel, enteredQty: `-${l.qtyEntered}`,
      refType: "supplier_return", refId: ret.id, reason: `Return to supplier: ${data.reason}`, createdBy: ctx.userId,
    })));

    await tx.update(goodsReceipts).set({ returnedTotal: toMoneyString(dec(r.returnedTotal).plus(total)) }).where(eq(goodsReceipts.id, r.id));

    let creditPaymentId: string | null = null;
    if (r.purchaseType === "credit") {
      // The credit pays down this receipt first; anything left is supplier credit.
      const applyNow = dec(total).lt(r.amountDue) ? dec(total) : dec(r.amountDue);
      const [credit] = await tx.insert(supplierPayments).values({
        supplierId: r.supplierId, branchId: r.branchId, kind: "return_credit", paymentDate: data.returnDate, currencyCode: "USD",
        amount: total, rateUsed: "1", amountBase: total, unallocatedBase: toMoneyString(dec(total).minus(applyNow)),
        note: `Return #${ret.number} on ${receiptLabel(r.number)}`, createdBy: ctx.userId,
      }).returning();
      creditPaymentId = credit.id;
      if (applyNow.gt(0)) await applyAllocations(tx, ctx, credit, [{ receiptId: r.id, amount: toMoneyString(applyNow) }]);
      await tx.update(supplierReturns).set({ creditPaymentId }).where(eq(supplierReturns.id, ret.id));
    }
    await writeAudit(tx, ctx, {
      action: "supplier_return.create", entity: "supplier_return", entityId: ret.id, branchId: r.branchId, reason: data.reason,
      after: { receipt: receiptLabel(r.number), total, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qtyEntered, unit: l.unitLabel })), creditPaymentId, refund: ret.refundAmount },
    });
    return { ...ret, creditPaymentId };
  });
}
