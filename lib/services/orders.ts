import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  branches,
  branchVariantPrices,
  diningTables,
  modifierGroups,
  modifiers,
  orderCounters,
  orderLineModifiers,
  orderLines,
  orders,
  productModifierGroups,
  products,
  productVariants,
} from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { todayLocal } from "@/lib/dates";
import { checkModifierSelection } from "@/lib/domain/modifiers";
import { dec, sum, toMoneyString } from "@/lib/domain/money";
import { computeOrder, discountPct, type Discount } from "@/lib/domain/pricing";
import { effectiveDeduct } from "@/lib/domain/recipe";
import { ApprovalRequiredError, ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, permissionLimit, requirePermission, type AppContext } from "@/lib/permissions";
import { kitchenStatusInput, saveOrderInput, type SaveOrderInput } from "@/lib/validators/pos";
import { writeAudit } from "./audit";
import { verifyManagerPin } from "./pin";
import { requireOpenShift } from "./shifts";
import { inTransaction } from "./tx";

export type { SaveOrderInput } from "@/lib/validators/pos";

type Order = typeof orders.$inferSelect;

/** Next order number for the branch's business day: B1-20261108-0042 (counter row locked by the upsert). */
async function nextOrderNumber(tx: Executor, branch: { id: string; code: string }, businessDate: string) {
  const [{ lastNo }] = await tx.insert(orderCounters).values({ branchId: branch.id, businessDate, lastNo: 1 })
    .onConflictDoUpdate({ target: [orderCounters.branchId, orderCounters.businessDate], set: { lastNo: sql`${orderCounters.lastNo} + 1` } })
    .returning({ lastNo: orderCounters.lastNo });
  return { orderNo: `${branch.code}-${businessDate.replaceAll("-", "")}-${String(lastNo).padStart(4, "0")}`, queueNo: lastNo };
}

/** Lock an order for change and check the user may act on it at its branch. */
export async function lockOrder(tx: Executor, ctx: AppContext, id: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!o) throw new NotFoundError("Order not found.");
  assertBranchAccess(ctx, o.branchId); // also hides other orgs' orders (their branches aren't ours)
  return o;
}

const sameDiscount = (a: { type: string | null; value: string | null }, b: Discount) =>
  (a.type === null && b === null) || (a.type !== null && b !== null && a.type === b.type && Number(a.value) === Number(b.value));

/**
 * Create or update an OPEN order and recalculate everything on the server
 * (plan §5.8). Prices, modifier rules, availability, tax and discount limits
 * are all checked here; the client's numbers are never trusted. Lines already
 * sent to the kitchen can't be changed or removed. `then` holds the order or
 * sends it to the kitchen in the same transaction.
 */
export async function saveOrder(ctx: AppContext, input: SaveOrderInput): Promise<Order> {
  const data = parseInput(saveOrderInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "pos.sell");
  if (data.then === "hold") requirePermission(ctx, data.branchId, "pos.hold");
  // PIN first, outside the order transaction, so failed tries always count (see verifyManagerPin).
  const approverId = data.approval
    ? await verifyManagerPin(ctx, { branchId: data.branchId, approverId: data.approval.approverId, pin: data.approval.pin, permission: "pos.discount.override" })
    : null;

  return inTransaction(ctx, async (tx, ctx) => {
    const shift = await requireOpenShift(tx, data.branchId, data.registerId);
    const [branch] = await tx.select().from(branches).where(eq(branches.id, data.branchId));

    let existing: Order | null = null;
    let oldLines: (typeof orderLines.$inferSelect)[] = [];
    let oldMods: (typeof orderLineModifiers.$inferSelect)[] = [];
    if (data.id) {
      existing = await lockOrder(tx, ctx, data.id);
      if (existing.branchId !== data.branchId) throw new ValidationError("That order belongs to another branch.");
      if (existing.status === "held") throw new ValidationError("This bill is held — resume it first.");
      if (existing.status !== "open") throw new ConflictError("This order can't be changed any more.");
      oldLines = await tx.select().from(orderLines).where(eq(orderLines.orderId, existing.id));
      oldMods = oldLines.length ? await tx.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, oldLines.map((l) => l.id))) : [];
    }

    // Table: dine-in only, and only this branch's active tables.
    let tableId: string | null = null;
    if (data.orderType === "dine_in" && data.tableId) {
      const [t] = await tx.select({ id: diningTables.id }).from(diningTables)
        .where(and(eq(diningTables.id, data.tableId), eq(diningTables.branchId, data.branchId), eq(diningTables.isActive, true)));
      if (!t) throw new ValidationError("That table isn't at this branch.");
      tableId = t.id;
    }

    // Lines already sent to the kitchen are locked and keep their snapshot (price,
    // options): they are NOT re-checked against today's menu (plan §2.8).
    const sentOld = new Map(oldLines.filter((l) => l.sentToKitchenAt).map((l) => [l.id, l]));
    const lineLabel = (product: string, variant: string) => (variant === product ? product : `${product} – ${variant}`);
    for (const old of sentOld.values()) {
      const now = data.lines.find((l) => l.id === old.id);
      const label = lineLabel(old.productNameSnapshot, old.variantNameSnapshot);
      if (!now) throw new ValidationError(`${label} was already sent to the kitchen and can't be removed.`);
      const oldModIds = oldMods.filter((m) => m.orderLineId === old.id).map((m) => m.modifierId).sort().join();
      const changed = now.variantId !== old.variantId || now.qty !== old.qty || [...now.modifierIds].sort().join() !== oldModIds
        || !sameDiscount({ type: old.lineDiscountType, value: old.lineDiscountValue }, now.discount) || (now.note ?? null) !== old.note;
      if (changed) throw new ValidationError(`${label} was already sent to the kitchen and can't be changed.`);
    }
    for (const l of data.lines) {
      if (l.id && !oldLines.some((o) => o.id === l.id)) throw new ValidationError("That line isn't part of this order.");
    }
    if (new Set(data.lines.map((l) => l.id).filter(Boolean)).size !== data.lines.filter((l) => l.id).length) {
      throw new ValidationError("A line appears twice in this order.");
    }
    const live = data.lines.filter((l) => !(l.id && sentOld.has(l.id)));

    // Variants with their effective branch price and availability (unsent lines only).
    const variantIds = [...new Set(live.map((l) => l.variantId))];
    const vrows = variantIds.length
      ? await tx
        .select({ v: productVariants, p: products, branchPrice: branchVariantPrices.price, isAvailable: branchVariantPrices.isAvailable })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(branchVariantPrices, and(eq(branchVariantPrices.variantId, productVariants.id), eq(branchVariantPrices.branchId, data.branchId)))
        .where(and(inArray(productVariants.id, variantIds), eq(products.orgId, ctx.orgId), eq(productVariants.isActive, true), eq(products.isActive, true)))
      : [];

    // Modifiers and the active groups attached to each product.
    const modIds = [...new Set(live.flatMap((l) => l.modifierIds))];
    const mrows = modIds.length
      ? await tx.select({ m: modifiers, g: modifierGroups }).from(modifiers).innerJoin(modifierGroups, eq(modifierGroups.id, modifiers.groupId))
        .where(and(inArray(modifiers.id, modIds), eq(modifierGroups.orgId, ctx.orgId), eq(modifiers.isActive, true), eq(modifierGroups.isActive, true)))
      : [];
    const productIds = [...new Set(vrows.map((r) => r.p.id))];
    const attached = productIds.length
      ? await tx.select({ productId: productModifierGroups.productId, g: modifierGroups }).from(productModifierGroups)
        .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
        .where(and(inArray(productModifierGroups.productId, productIds), eq(modifierGroups.isActive, true)))
      : [];

    type Resolved = {
      input: (typeof data.lines)[number]; label: string; unitPrice: string; deltas: string[];
      sent: (typeof oldLines)[number] | null;
      row: (typeof vrows)[number] | null; mods: (typeof mrows)[number][];
    };
    const resolved: Resolved[] = data.lines.map((l) => {
      const old = l.id ? sentOld.get(l.id) : undefined;
      if (old) {
        const snap = oldMods.filter((m) => m.orderLineId === old.id);
        return { input: l, label: lineLabel(old.productNameSnapshot, old.variantNameSnapshot), unitPrice: old.unitPrice, deltas: snap.map((m) => m.priceDelta), sent: old, row: null, mods: [] };
      }
      const row = vrows.find((r) => r.v.id === l.variantId);
      if (!row) throw new ValidationError("An item in this order is no longer on the menu.");
      const label = lineLabel(row.p.name, row.v.name);
      if (row.isAvailable === false) throw new ValidationError(`${label} isn't available at this branch.`);
      if (new Set(l.modifierIds).size !== l.modifierIds.length) throw new ValidationError(`An option is chosen twice for ${label}.`);
      const groups = attached.filter((a) => a.productId === row.p.id).map((a) => a.g);
      const mods = l.modifierIds.map((id) => {
        const m = mrows.find((x) => x.m.id === id);
        if (!m || !groups.some((g) => g.id === m.g.id)) throw new ValidationError(`Those options aren't available for ${label}.`);
        return m;
      });
      for (const g of groups) {
        const msg = checkModifierSelection(g, mods.filter((m) => m.g.id === g.id).length);
        if (msg) throw new ValidationError(msg);
      }
      return { input: l, label, unitPrice: row.branchPrice ?? row.v.price, deltas: mods.map((m) => m.m.priceDelta), sent: null, row, mods };
    });

    // Totals — the same function the POS screen uses, fed the same prices it shows.
    const tax = { rate: branch.taxRate, inclusive: branch.taxInclusive };
    const totals = computeOrder(resolved.map((r) => ({ unitPrice: r.unitPrice, qty: r.input.qty, modifiers: r.deltas, discount: r.input.discount })), data.orderDiscount, tax);

    // Discount limits (plan §4.5). A discount needs a manager when it is above the
    // role's max % — unless it is the same discount as last saved AND its effective
    // % hasn't gone up (a fixed amount on a smaller order is a bigger discount).
    const limit = permissionLimit(ctx, data.branchId, "pos.discount.apply");
    const over = (pct: number) => limit === undefined || (limit !== null && pct > Number(limit) + 1e-9);
    const pctOf = (amount: string, base: string) => (dec(base).gt(0) ? dec(amount).div(base).times(100).toNumber() : 0);
    const needs: { label: string; reason: string | null | undefined }[] = [];
    resolved.forEach((r, i) => {
      const d = r.input.discount;
      if (!d) return;
      const pct = discountPct(d, totals.lines[i].gross);
      if (!over(pct)) return;
      const old = oldLines.find((o) => o.id === r.input.id);
      if (old && sameDiscount({ type: old.lineDiscountType, value: old.lineDiscountValue }, d)) {
        const oldGross = dec(old.unitPrice).plus(old.modifiersTotal).times(old.qty).toDecimalPlaces(2).toString();
        if (pct <= pctOf(old.lineDiscountAmount, oldGross) + 1e-9) return;
      }
      needs.push({ label: r.label, reason: d.reason });
    });
    if (data.orderDiscount) {
      const pct = discountPct(data.orderDiscount, totals.subtotal);
      const unchanged = existing && sameDiscount({ type: existing.discountType, value: existing.discountValue }, data.orderDiscount)
        && pct <= pctOf(existing.orderDiscountAmount, existing.subtotal) + 1e-9;
      if (over(pct) && !unchanged) needs.push({ label: "order", reason: data.orderDiscount.reason });
    }
    // Plan §2 rule 10: a discount above the limit needs a reason.
    if (needs.some((n) => !n.reason)) throw new ValidationError("Choose a reason for discounts above the limit.");
    if (needs.length && !approverId) {
      const what = limit === undefined ? "Discounts need" : `Discounts above ${Number(limit)}% need`;
      throw new ApprovalRequiredError(`${what} a manager's PIN.`, "pos.discount.override");
    }

    const header = {
      shiftId: shift.id, orderType: data.orderType, tableId, note: data.note,
      subtotal: totals.subtotal, discountType: data.orderDiscount?.type ?? null, discountValue: data.orderDiscount?.value ?? null,
      discountReason: data.orderDiscount?.reason ?? null, discountTotal: totals.discountTotal, orderDiscountAmount: totals.orderDiscount,
      taxTotal: totals.taxTotal, total: totals.total, taxRate: branch.taxRate, taxInclusive: branch.taxInclusive,
      ...(needs.length ? { approvedBy: approverId } : {}),
    };
    let order: Order;
    if (existing) {
      [order] = await tx.update(orders).set(header).where(eq(orders.id, existing.id)).returning();
    } else {
      const businessDate = todayLocal();
      const no = await nextOrderNumber(tx, branch, businessDate);
      [order] = await tx.insert(orders).values({ ...header, ...no, businessDate, branchId: data.branchId, createdBy: ctx.userId }).returning();
    }

    // Lines keep their ids: sent lines only get refreshed amounts, other kept lines are
    // rewritten in place, removed lines are deleted, new lines inserted.
    const keptIds = new Set(resolved.map((r) => r.input.id).filter(Boolean));
    const removed = oldLines.filter((l) => !keptIds.has(l.id)).map((l) => l.id);
    if (removed.length) await tx.delete(orderLines).where(inArray(orderLines.id, removed));
    for (const [i, r] of resolved.entries()) {
      const t = totals.lines[i];
      const amounts = { lineDiscountAmount: t.lineDiscount, discountAlloc: t.discountAlloc, taxAmount: t.taxAmount, lineTotal: t.lineTotal, sortOrder: i };
      if (r.sent) {
        await tx.update(orderLines).set(amounts).where(eq(orderLines.id, r.sent.id));
        continue;
      }
      const old = oldLines.find((o) => o.id === r.input.id);
      const row = r.row!;
      const values = {
        variantId: row.v.id, productId: row.p.id, productNameSnapshot: row.p.name, variantNameSnapshot: row.v.name,
        qty: r.input.qty, unitPrice: r.unitPrice, modifiersTotal: toMoneyString(sum(r.mods.map((m) => m.m.priceDelta))),
        lineDiscountType: r.input.discount?.type ?? null, lineDiscountValue: r.input.discount?.value ?? null, lineDiscountReason: r.input.discount?.reason ?? null,
        deductStock: effectiveDeduct(row.p.deductStock, row.v.deductStock), note: r.input.note, kitchenStation: row.p.kitchenStation, ...amounts,
      };
      let lineId: string;
      if (old) {
        await tx.update(orderLines).set(values).where(eq(orderLines.id, old.id));
        await tx.delete(orderLineModifiers).where(eq(orderLineModifiers.orderLineId, old.id));
        lineId = old.id;
      } else {
        [{ id: lineId }] = await tx.insert(orderLines).values({ ...values, orderId: order.id }).returning({ id: orderLines.id });
      }
      if (r.mods.length) {
        await tx.insert(orderLineModifiers).values(r.mods.map((m) => ({
          orderLineId: lineId, modifierId: m.m.id, groupId: m.g.id, nameSnapshot: m.m.name, priceDelta: m.m.priceDelta, deductStock: m.m.deductStock,
        })));
      }
    }

    await writeAudit(tx, ctx, {
      action: existing ? "order.update" : "order.create", entity: "order", entityId: order.id, branchId: data.branchId,
      before: existing ? { total: existing.total, discountTotal: existing.discountTotal } : undefined,
      after: { orderNo: order.orderNo, lines: resolved.length, subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total },
    });
    if (needs.length) {
      await writeAudit(tx, ctx, {
        action: "order.discount_approved", entity: "order", entityId: order.id, branchId: data.branchId, approvedBy: approverId,
        after: { discounts: needs.map((n) => ({ on: n.label, reason: n.reason })), discountTotal: totals.discountTotal },
      });
    }
    if (data.then === "hold") order = await holdOrder(ctx, order.id);
    if (data.then === "send") await sendToKitchen(ctx, order.id);
    return order;
  });
}

export async function holdOrder(ctx: AppContext, orderId: string): Promise<Order> {
  return inTransaction(ctx, async (tx, ctx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, o.branchId, "pos.hold");
    if (o.status !== "open") throw new ConflictError("Only an open order can be held.");
    const [held] = await tx.update(orders).set({ status: "held", heldAt: new Date() }).where(eq(orders.id, orderId)).returning();
    await writeAudit(tx, ctx, { action: "order.hold", entity: "order", entityId: orderId, branchId: o.branchId, after: { orderNo: o.orderNo, total: o.total } });
    return held;
  });
}

/** Resume a held bill on a register; it moves to that register's open shift. */
export async function resumeOrder(ctx: AppContext, orderId: string, registerId: string): Promise<Order> {
  return inTransaction(ctx, async (tx, ctx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, o.branchId, "pos.hold");
    if (o.status !== "held") throw new ConflictError("This bill isn't held.");
    const shift = await requireOpenShift(tx, o.branchId, registerId);
    const [open] = await tx.update(orders).set({ status: "open", heldAt: null, shiftId: shift.id }).where(eq(orders.id, orderId)).returning();
    await writeAudit(tx, ctx, { action: "order.resume", entity: "order", entityId: orderId, branchId: o.branchId, after: { orderNo: o.orderNo } });
    return open;
  });
}

/** Mark the order's unsent lines as sent; kitchen-station lines then show on /kitchen. */
export async function sendToKitchen(ctx: AppContext, orderId: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requirePermission(ctx, o.branchId, "pos.sell");
    if (o.status !== "open") throw new ConflictError("Only an open order can be sent to the kitchen.");
    const [b] = await tx.select({ settings: branches.settings }).from(branches).where(eq(branches.id, o.branchId));
    if (!readBranchSettings(b.settings).kitchenEnabled) throw new ValidationError("The kitchen screen is turned off for this branch.");
    const sent = await tx.update(orderLines).set({ sentToKitchenAt: new Date(), kitchenStatus: "pending" })
      .where(and(eq(orderLines.orderId, orderId), isNull(orderLines.sentToKitchenAt))).returning({ id: orderLines.id });
    if (sent.length) await writeAudit(tx, ctx, { action: "order.send_kitchen", entity: "order", entityId: orderId, branchId: o.branchId, after: { orderNo: o.orderNo, lines: sent.length } });
  });
}

/** Kitchen screen: move a sent line to pending / preparing / ready / served. */
export async function setKitchenStatus(ctx: AppContext, lineId: string, status: string) {
  const next = parseInput(kitchenStatusInput, status);
  await inTransaction(ctx, async (tx, ctx) => {
    const [row] = await tx.select({ line: orderLines, branchId: orders.branchId, orderStatus: orders.status }).from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId)).where(eq(orderLines.id, lineId)).for("update", { of: orderLines });
    if (!row) throw new NotFoundError("Kitchen item not found.");
    assertBranchAccess(ctx, row.branchId);
    requirePermission(ctx, row.branchId, "pos.sell");
    if (!row.line.sentToKitchenAt) throw new ValidationError("This item hasn't been sent to the kitchen.");
    if (row.orderStatus === "voided") throw new ConflictError("This order was voided.");
    await tx.update(orderLines).set({ kitchenStatus: next, kitchenUpdatedAt: new Date() }).where(eq(orderLines.id, lineId));
  });
}
