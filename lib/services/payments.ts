import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  branches,
  cashMovements,
  customerPaymentAllocations,
  customerPayments,
  customers,
  items,
  orderLineModifiers,
  orderLines,
  orders,
  paymentMethods,
  payments,
  recipeLines,
  refundLines,
  refunds,
  stockLevels,
  stockMovements,
  units,
} from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { settlePayment, type SettleCurrency } from "@/lib/domain/currency";
import { dec, toMoneyString } from "@/lib/domain/money";
import { saleDeductions } from "@/lib/domain/recipe";
import { ConflictError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import {
  cashMovementInput,
  payOrderInput,
  refundOrderInput,
  voidOrderInput,
  type CashMovementInput,
  type PayOrderInput,
  type RefundOrderInput,
  type SaveOrderInput,
} from "@/lib/validators/pos";
import { writeAudit } from "./audit";
import { currencyAt } from "./currency-rates";
import { lockOrder, saveOrder } from "./orders";
import { verifyManagerPin } from "./pin";
import { requireOpenShift } from "./shifts";
import { applyStockMovements } from "./stock";
import { inTransaction } from "./tx";

const usd = (v: string) => `$${dec(v).toFixed(2)}`;

/** Average cost per base unit at a branch (0 when the item has never been costed there). */
async function avgCosts(tx: Executor, branchId: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const rows = await tx.select({ itemId: stockLevels.itemId, avg: stockLevels.avgCost }).from(stockLevels)
    .where(and(eq(stockLevels.branchId, branchId), inArray(stockLevels.itemId, itemIds)));
  return new Map(rows.map((r) => [r.itemId, r.avg]));
}

/**
 * Take payment for an OPEN order (plan §5.8): settle tenders (multi-currency,
 * change, cash rounding), record payments on the register's open shift, mark
 * the order paid, deduct recipes (plan §4.3) and fill COGS per line.
 */
export async function payOrder(ctx: AppContext, orderId: string, input: PayOrderInput) {
  const data = parseInput(payOrderInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const order = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, order.branchId, "pos.sell");
    if (order.status === "paid" || order.status === "refunded" || order.status === "partially_refunded") throw new ConflictError("This order is already paid.");
    if (order.status === "held") throw new ValidationError("This bill is held — resume it first.");
    if (order.status !== "open") throw new ConflictError("This order can't be paid.");
    const shift = await requireOpenShift(tx, order.branchId, data.registerId);
    const [branch] = await tx.select().from(branches).where(eq(branches.id, order.branchId));
    const settings = readBranchSettings(branch.settings);
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    if (!lines.length) throw new ValidationError("This order has no items.");

    // Methods and currencies.
    const methodIds = [...new Set(data.tenders.map((t) => t.methodId))];
    const methods = await tx.select().from(paymentMethods).where(and(inArray(paymentMethods.id, methodIds), eq(paymentMethods.branchId, order.branchId), eq(paymentMethods.isActive, true)));
    const cur = new Map<string, SettleCurrency>();
    for (const code of new Set([...data.tenders.map((t) => t.currencyCode), data.changeCurrency])) cur.set(code, await currencyAt(tx, order.branchId, code));
    const tenders = data.tenders.map((t) => {
      const m = methods.find((x) => x.id === t.methodId);
      if (!m) throw new ValidationError("Choose a payment method.");
      return { ...t, method: m };
    });

    // Charge to account (plan §4.10): permission, a customer with a credit limit, within it, in USD.
    const account = tenders.filter((t) => t.method.type === "account");
    let customerId = order.customerId;
    let accountBase = dec(0);
    if (account.length) {
      requirePermission(ctx, order.branchId, "pos.charge_account");
      customerId = data.customerId ?? order.customerId;
      if (!customerId) throw new ValidationError("Choose the customer to charge.");
      const [c] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, ctx.orgId))).for("update");
      if (!c || !c.isActive) throw new ValidationError("That customer can't be charged.");
      if (c.creditLimit === null) throw new ValidationError(`${c.name} doesn't have a credit account.`);
      if (account.some((t) => t.currencyCode !== "USD")) throw new ValidationError("Charge to account in USD.");
      accountBase = account.reduce((a, t) => a.plus(t.amount), dec(0));
      const [{ owed }] = await tx.select({ owed: sql<string>`coalesce(sum(${orders.accountDue}), 0)::text` }).from(orders).where(eq(orders.customerId, c.id));
      const [{ credit }] = await tx.select({ credit: sql<string>`coalesce(sum(${customerPayments.unallocatedBase}), 0)::text` }).from(customerPayments).where(eq(customerPayments.customerId, c.id));
      // The limit applies to what would still be owed after using the customer's credit.
      const after = dec(owed).plus(accountBase).minus(credit);
      if (after.gt(c.creditLimit)) {
        throw new ValidationError(`Over ${c.name}'s credit limit (${usd(c.creditLimit)}; owes ${usd(owed)}${dec(credit).gt(0) ? `, credit ${usd(credit)}` : ""}).`);
      }
    }

    if (!tenders.length && dec(order.total).gt(0)) throw new ValidationError(`Still ${usd(order.total)} to pay.`);
    let s;
    try {
      s = settlePayment(order.total, tenders.map((t) => ({ cash: t.method.type === "cash", currency: cur.get(t.currencyCode)!, amount: t.amount })), cur.get(data.changeCurrency)!);
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
    if (!s.paid) throw new ValidationError(`Still ${usd(s.remainingBase)} to pay.`);

    // Change and rounding go on the last cash tender (the drawer it came from).
    const lastCash = tenders.map((t) => t.method.type).lastIndexOf("cash");
    const carrier = lastCash >= 0 ? lastCash : tenders.length - 1;
    if (tenders.length) await tx.insert(payments).values(tenders.map((t, i) => ({
      orderId, branchId: order.branchId, shiftId: shift.id, methodId: t.methodId, methodType: t.method.type, currencyCode: t.currencyCode,
      amountTendered: t.amount, rateUsed: s.tenders[i].rateUsed, amountBase: s.tenders[i].amountBase, reference: t.reference, createdBy: ctx.userId,
      ...(i === carrier
        ? { changeCurrency: s.change.currency, changeAmount: s.change.amount, changeBase: s.change.base, roundingBase: toMoneyString(dec(s.change.roundingBase).minus(s.writeOffBase)) }
        : {}),
    })));

    // Stock and COGS per line (plan §4.3).
    const lineMods = await tx.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, lines.map((l) => l.id)));
    const recipes = await tx.select().from(recipeLines).where(sql`${recipeLines.variantId} in ${lines.map((l) => l.variantId)} or ${recipeLines.modifierId} in ${lineMods.length ? lineMods.map((m) => m.modifierId) : [sql`null`]}`);
    const allItems = [...new Set(recipes.map((r) => r.itemId))];
    const avg = await avgCosts(tx, order.branchId, allItems);
    const theory = (rs: { itemId: string; qtyBase: string }[], qty: number) => rs.reduce((a, r) => a.plus(dec(r.qtyBase).times(qty).times(avg.get(r.itemId) ?? "0")), dec(0));
    // Build every line's movements first, then apply them in ONE sorted batch so two
    // registers paying overlapping items lock stock rows in the same order (no deadlock).
    type Plan = { line: (typeof lines)[number]; source: "actual" | "theoretical" | "none"; cost: ReturnType<typeof dec>; moveIdx: number[] };
    const plans: Plan[] = [];
    const inputs: Parameters<typeof applyStockMovements>[1] = [];
    for (const l of lines) {
      const vRecipe = recipes.filter((r) => r.variantId === l.variantId);
      const mods = lineMods.filter((m) => m.orderLineId === l.id).map((m) => ({ deductStock: m.deductStock, recipe: recipes.filter((r) => r.modifierId === m.modifierId) }));
      const hasRecipe = vRecipe.length > 0 || mods.some((m) => m.recipe.length > 0);
      if (!hasRecipe) { plans.push({ line: l, source: "none", cost: dec(0), moveIdx: [] }); continue; }
      if (!l.deductStock) { plans.push({ line: l, source: "theoretical", cost: theory([...vRecipe, ...mods.flatMap((m) => m.recipe)], l.qty), moveIdx: [] }); continue; }
      const d = saleDeductions({ productDeduct: true, variant: { deductStock: true, recipe: vRecipe }, modifiers: mods }, String(l.qty));
      const moveIdx: number[] = [];
      for (const [itemId, q] of d.lines) {
        // A net negative (a substitution bigger than the recipe) never adds stock: skip it (review #4).
        if (dec(q).lte(0)) continue;
        moveIdx.push(inputs.length);
        inputs.push({ branchId: order.branchId, itemId, type: "sale", qtyBase: dec(q).neg().toString(), refType: "order_line", refId: l.id, blockNegative: !settings.allowNegativeStock });
      }
      // Ruling: a skipped (deduct off) modifier's recipe still counts toward cost, as theoretical.
      plans.push({ line: l, source: "actual", cost: theory(mods.filter((m) => !m.deductStock).flatMap((m) => m.recipe), l.qty), moveIdx });
    }
    const results = await applyStockMovements(tx, inputs);
    const warnings: string[] = [];
    for (const pl of plans) {
      const cost = pl.moveIdx.reduce((a, i) => a.minus(results[i].totalCost), pl.cost);
      for (const i of pl.moveIdx) if (dec(results[i].qtyAfter).lt(0)) warnings.push(inputs[i].itemId);
      await tx.update(orderLines).set({ costTotal: toMoneyString(cost), costSource: pl.source }).where(eq(orderLines.id, pl.line.id));
    }
    // Paying sends anything not yet sent to the kitchen (review #2) — takeaway orders often skip "Kitchen".
    if (settings.kitchenEnabled) await tx.update(orderLines).set({ sentToKitchenAt: new Date(), kitchenStatus: "pending" })
      .where(and(eq(orderLines.orderId, orderId), isNull(orderLines.sentToKitchenAt)));
    const warningText = warnings.length
      ? (await tx.select({ id: items.id, name: items.name, unit: units.code, qty: stockLevels.qtyOnHand }).from(items)
        .innerJoin(units, eq(units.id, items.baseUnitId))
        .innerJoin(stockLevels, and(eq(stockLevels.itemId, items.id), eq(stockLevels.branchId, order.branchId)))
        .where(inArray(items.id, [...new Set(warnings)])))
        .map((r) => `${r.name} is now below zero (−${dec(r.qty).abs().toString()} ${r.unit}).`)
      : [];

    // Use the customer's credit (earlier overpayments), oldest first, for this charge (review #3).
    let accountDue = accountBase;
    if (accountBase.gt(0) && customerId) {
      const credits = await tx.select().from(customerPayments)
        .where(and(eq(customerPayments.customerId, customerId), gt(customerPayments.unallocatedBase, "0"))).orderBy(asc(customerPayments.createdAt)).for("update");
      for (const cp of credits) {
        if (accountDue.lte(0)) break;
        const take = accountDue.lt(cp.unallocatedBase) ? accountDue : dec(cp.unallocatedBase);
        await tx.insert(customerPaymentAllocations).values({ paymentId: cp.id, orderId, amountBase: toMoneyString(take) });
        await tx.update(customerPayments).set({ unallocatedBase: toMoneyString(dec(cp.unallocatedBase).minus(take)) }).where(eq(customerPayments.id, cp.id));
        accountDue = accountDue.minus(take);
      }
    }
    await tx.update(orders).set({
      status: "paid", paidAt: new Date(), paidTotal: order.total, shiftId: shift.id, customerId,
      accountDue: toMoneyString(accountDue),
    }).where(eq(orders.id, orderId));
    await writeAudit(tx, ctx, {
      action: "order.pay", entity: "order", entityId: orderId, branchId: order.branchId,
      after: { orderNo: order.orderNo, total: order.total, tenders: tenders.map((t) => `${t.method.name} ${t.amount} ${t.currencyCode}`), change: s.change, writeOff: s.writeOffBase, accountBase: toMoneyString(accountBase) },
    });
    return { orderId, change: s.change, warnings: warningText };
  });
}

/** Save the cart and take payment in ONE transaction: a failed payment leaves nothing saved. */
export async function saveAndPayOrder(ctx: AppContext, cart: SaveOrderInput, pay: PayOrderInput) {
  return inTransaction(ctx, async (_tx, ctx) => {
    const o = await saveOrder(ctx, cart);
    return payOrder(ctx, o.id, pay);
  });
}

/** Cancel an unpaid order (plan §4.7): manager PIN with pos.void and a reason; no stock effect. */
export async function voidOrder(ctx: AppContext, orderId: string, input: { reason: string; approval: { approverId: string; pin: string } }) {
  const data = parseInput(voidOrderInput, input);
  const [o0] = await ctx.db.select({ branchId: orders.branchId }).from(orders).where(eq(orders.id, orderId));
  if (o0) assertBranchAccess(ctx, o0.branchId);
  const approverId = o0 ? await verifyManagerPin(ctx, { branchId: o0.branchId, ...data.approval, permission: "pos.void" }) : "";
  await inTransaction(ctx, async (tx, ctx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, o.branchId, "pos.sell");
    if (o.status !== "open" && o.status !== "held") throw new ConflictError("This order can't be voided (only unpaid orders can).");
    await tx.update(orders).set({ status: "voided", voidedAt: new Date(), voidReason: data.reason, voidedBy: ctx.userId }).where(eq(orders.id, orderId));
    await writeAudit(tx, ctx, { action: "order.void", entity: "order", entityId: orderId, branchId: o.branchId, reason: data.reason, approvedBy: approverId, after: { orderNo: o.orderNo, total: o.total } });
  });
}

/**
 * Refund paid lines (plan §4.7): manager PIN with pos.refund and a reason. Pays
 * the money back in the chosen method/currency (cash rounded to its step) on
 * the open shift; restocked lines go back at the ORIGINAL sale cost.
 */
export async function refundOrder(ctx: AppContext, orderId: string, input: RefundOrderInput) {
  const data = parseInput(refundOrderInput, input);
  const [o0] = await ctx.db.select({ branchId: orders.branchId }).from(orders).where(eq(orders.id, orderId));
  if (o0) assertBranchAccess(ctx, o0.branchId);
  const approverId = o0 ? await verifyManagerPin(ctx, { branchId: o0.branchId, ...data.approval, permission: "pos.refund" }) : "";
  return inTransaction(ctx, async (tx, ctx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, o.branchId, "pos.sell");
    if (o.status !== "paid" && o.status !== "partially_refunded") throw new ConflictError("Only paid orders can be refunded.");
    const shift = await requireOpenShift(tx, o.branchId, data.registerId);
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId)).for("update");
    const prior = await tx.select({ lineId: refundLines.orderLineId, amount: sql<string>`sum(${refundLines.amount})::text` }).from(refundLines)
      .innerJoin(refunds, eq(refunds.id, refundLines.refundId)).where(eq(refunds.orderId, orderId)).groupBy(refundLines.orderLineId);

    const picked = data.lines.map((r) => {
      const l = lines.find((x) => x.id === r.orderLineId);
      if (!l) throw new ValidationError("That line isn't part of this order.");
      const left = l.qty - l.refundedQty;
      if (r.qty > left) throw new ValidationError(`${l.productNameSnapshot}: only ${left} left to refund.`);
      // The refund that empties a line takes exactly what's left of its total.
      const already = dec(prior.find((p) => p.lineId === l.id)?.amount ?? "0");
      const amount = r.qty === left ? dec(l.lineTotal).minus(already) : dec(l.lineTotal).times(r.qty).div(l.qty).toDecimalPlaces(2, 4);
      return { ...r, line: l, amount };
    });
    if (new Set(picked.map((p) => p.orderLineId)).size !== picked.length) throw new ValidationError("A line appears twice.");
    const totalBase = picked.reduce((a, p) => a.plus(p.amount), dec(0));

    const [method] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, data.method.methodId), eq(paymentMethods.branchId, o.branchId)));
    if (!method) throw new ValidationError("Choose how to pay the money back.");
    const c = await currencyAt(tx, o.branchId, data.method.currencyCode);
    let amountOut = totalBase.times(c.rate);
    if (method.type === "cash" && dec(c.cashRounding).gt(0)) amountOut = amountOut.div(c.cashRounding).toDecimalPlaces(0, 4).times(c.cashRounding);
    else amountOut = amountOut.toDecimalPlaces(c.decimals, 4);
    const outBase = amountOut.div(c.rate).toDecimalPlaces(4, 4);
    if (method.type === "account") {
      if (dec(o.accountDue).lt(totalBase)) throw new ValidationError("Refund to account is more than this order's account balance.");
    }

    const [refund] = await tx.insert(refunds).values({ orderId, branchId: o.branchId, shiftId: shift.id, reason: data.reason, approvedBy: approverId, totalBase: toMoneyString(totalBase), createdBy: ctx.userId }).returning();
    const rLines = await tx.insert(refundLines).values(picked.map((p) => ({ refundId: refund.id, orderLineId: p.orderLineId, qty: p.qty, amount: toMoneyString(p.amount), restock: p.restock && p.line.deductStock }))).returning();
    await tx.insert(payments).values({
      orderId, branchId: o.branchId, shiftId: shift.id, methodId: method.id, methodType: method.type, currencyCode: c.code, amountTendered: amountOut.toFixed(Math.max(c.decimals, 0)),
      rateUsed: c.rate, amountBase: toMoneyString(outBase), roundingBase: toMoneyString(totalBase.minus(outBase)), isRefund: true, refundId: refund.id, createdBy: ctx.userId,
    });

    // Restock at the original sale cost (only lines that deducted stock).
    const restock = picked.filter((p) => p.restock && p.line.deductStock);
    if (restock.length) {
      const sold = await tx.select().from(stockMovements).where(and(eq(stockMovements.refType, "order_line"), inArray(stockMovements.refId, restock.map((p) => p.orderLineId))));
      const inputs = restock.flatMap((p) => sold.filter((m) => m.refId === p.orderLineId).map((m) => ({
        branchId: o.branchId, itemId: m.itemId,
        type: dec(m.qtyBase).isNegative() ? "refund_restock" as const : "sale" as const,
        qtyBase: dec(m.qtyBase).neg().times(p.qty).div(p.line.qty).toString(),
        ...(dec(m.qtyBase).isNegative() ? { unitCost: m.unitCost } : {}),
        // Point at the refund LINE so reports can attribute the restock to its product.
        refType: "refund_line", refId: rLines.find((x) => x.orderLineId === p.orderLineId)!.id,
      })));
      await applyStockMovements(tx, inputs);
    }

    for (const p of picked) await tx.update(orderLines).set({ refundedQty: p.line.refundedQty + p.qty }).where(eq(orderLines.id, p.orderLineId));
    const remaining = lines.reduce((a, l) => a + l.qty - l.refundedQty, 0) - picked.reduce((a, p) => a + p.qty, 0);
    await tx.update(orders).set({
      refundedTotal: toMoneyString(dec(o.refundedTotal).plus(totalBase)), status: remaining === 0 ? "refunded" : "partially_refunded",
      ...(method.type === "account" ? { accountDue: toMoneyString(dec(o.accountDue).minus(totalBase)) } : {}),
    }).where(eq(orders.id, orderId));
    await writeAudit(tx, ctx, {
      action: "order.refund", entity: "order", entityId: orderId, branchId: o.branchId, reason: data.reason, approvedBy: approverId,
      after: { orderNo: o.orderNo, totalBase: toMoneyString(totalBase), paidOut: `${amountOut.toString()} ${c.code}`, lines: picked.map((p) => ({ item: p.line.productNameSnapshot, qty: p.qty, restock: p.restock })) },
    });
    return { refundId: refund.id, totalBase: toMoneyString(totalBase), paidOut: { currency: c.code, amount: amountOut.toFixed(c.decimals) } };
  });
}

/** Cash pay-in / pay-out on the register's open shift (plan §4.8). */
export async function addCashMovement(ctx: AppContext, input: CashMovementInput, ref?: { refType: string; refId: string }) {
  const data = parseInput(cashMovementInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "shift.cash_movement");
  return inTransaction(ctx, async (tx, ctx) => {
    const shift = await requireOpenShift(tx, data.branchId, data.registerId);
    await currencyAt(tx, data.branchId, data.currencyCode);
    const [m] = await tx.insert(cashMovements).values({
      shiftId: shift.id, branchId: data.branchId, type: data.type, currencyCode: data.currencyCode, amount: data.amount, reason: data.reason,
      refType: ref?.refType ?? null, refId: ref?.refId ?? null, createdBy: ctx.userId,
    }).returning();
    await writeAudit(tx, ctx, { action: `cash.${data.type}`, entity: "cash_movement", entityId: m.id, branchId: data.branchId, reason: data.reason, after: { currency: data.currencyCode, amount: data.amount } });
    return m;
  });
}
