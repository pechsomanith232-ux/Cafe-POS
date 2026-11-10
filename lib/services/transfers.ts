import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, items, stockTransferLines, stockTransfers, units } from "@/db/schema";
import { dec, toMoneyString } from "@/lib/domain/money";
import { NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import { receiveTransferInput, transferInput, type ReceiveTransferInput, type TransferInput } from "@/lib/validators/inventory";
import { writeAudit } from "./audit";
import { loadItem, toBase } from "./inventory";
import { applyStockMovements, lockStockLevels } from "./stock";
import { inTransaction } from "./tx";

const at = (ctx: AppContext, branchId: string) => {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "inventory.transfer");
};

async function loadTransfer(tx: Executor, ctx: AppContext, id: string) {
  const [t] = await tx.select().from(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.orgId, ctx.orgId))).for("update");
  if (!t) throw new NotFoundError("Transfer not found.");
  return t;
}

/** Draft a transfer (inventory.transfer at the sending branch), optionally sending it at once. */
export async function createTransfer(ctx: AppContext, input: TransferInput, opts: { send?: boolean } = {}) {
  const data = parseInput(transferInput, input);
  at(ctx, data.fromBranchId);
  return inTransaction(ctx, async (tx, ctx) => {
    const [to] = await tx.select().from(branches).where(and(eq(branches.id, data.toBranchId), eq(branches.orgId, ctx.orgId)));
    if (!to || !to.isActive) throw new ValidationError("Choose an active branch to send to.");
    const lines = [];
    for (const l of data.lines) {
      const item = await loadItem(tx, ctx, l.itemId);
      const { unit, qtyBase } = await toBase(tx, item, l.unitKey, l.qty);
      if (dec(qtyBase).lte(0)) throw new ValidationError(`Quantity for ${item.name} is too small.`);
      lines.push({ itemId: item.id, enteredUnitLabel: unit.label, enteredQty: l.qty, qtySent: qtyBase });
    }
    const [t] = await tx.insert(stockTransfers).values({ orgId: ctx.orgId, fromBranchId: data.fromBranchId, toBranchId: data.toBranchId, note: data.note, createdBy: ctx.userId }).returning();
    await tx.insert(stockTransferLines).values(lines.map((l) => ({ ...l, transferId: t.id })));
    await writeAudit(tx, ctx, { action: "stock_transfer.create", entity: "stock_transfer", entityId: t.id, branchId: t.fromBranchId, after: { to: t.toBranchId, lines: lines.length } });
    // "Save & send" is one transaction: if sending fails, no draft is left behind.
    return opts.send ? sendInTx(tx, ctx, t) : t;
  });
}

/** Cancel a draft (sent transfers can only be received). */
export async function cancelTransfer(ctx: AppContext, id: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const t = await loadTransfer(tx, ctx, id);
    at(ctx, t.fromBranchId);
    if (t.status !== "draft") throw new ValidationError("Only a draft transfer can be cancelled.");
    await tx.update(stockTransfers).set({ status: "cancelled" }).where(eq(stockTransfers.id, id));
    await writeAudit(tx, ctx, { action: "stock_transfer.cancel", entity: "stock_transfer", entityId: id, branchId: t.fromBranchId });
  });
}

/** Send: stock leaves the sender at its current average cost (transfer_out). */
export async function sendTransfer(ctx: AppContext, id: string) {
  await inTransaction(ctx, async (tx, ctx) => sendInTx(tx, ctx, await loadTransfer(tx, ctx, id)));
}

async function sendInTx(tx: Executor, ctx: AppContext, t: typeof stockTransfers.$inferSelect) {
  const id = t.id;
  at(ctx, t.fromBranchId);
  if (t.status !== "draft") throw new ValidationError("This transfer was already sent.");
  const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
  // Stock can't be sent that isn't there (unlike sales, there's no customer waiting).
  const levels = await lockStockLevels(tx, t.fromBranchId, lines.map((l) => l.itemId));
  const need = new Map<string, ReturnType<typeof dec>>();
  for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? dec(0)).plus(l.qtySent));
  for (const [itemId, q] of need) {
    const have = dec(levels.get(itemId)!.qtyOnHand);
    if (have.lt(q)) {
      const [i] = await tx.select({ name: items.name, unit: units.code }).from(items).innerJoin(units, eq(units.id, items.baseUnitId)).where(eq(items.id, itemId));
      throw new ValidationError(`Only ${have.toNumber().toLocaleString("en-US")} ${i.unit} of ${i.name} in stock — can't send ${q.toNumber().toLocaleString("en-US")}.`);
    }
  }
  const moved = await applyStockMovements(tx, lines.map((l) => ({
    branchId: t.fromBranchId, itemId: l.itemId, type: "transfer_out" as const, qtyBase: dec(l.qtySent).neg().toFixed(4),
    enteredUnitLabel: l.enteredUnitLabel, enteredQty: dec(l.enteredQty).neg().toFixed(4),
    refType: "stock_transfer", refId: id, reason: "Transfer out", createdBy: ctx.userId,
  })));
  for (const [i, l] of lines.entries()) {
    await tx.update(stockTransferLines).set({ unitCost: moved[i].unitCost, valueSent: toMoneyString(dec(moved[i].totalCost).abs()) }).where(eq(stockTransferLines.id, l.id));
  }
  await tx.update(stockTransfers).set({ status: "sent", sentBy: ctx.userId, sentAt: new Date() }).where(eq(stockTransfers.id, id));
  await writeAudit(tx, ctx, { action: "stock_transfer.send", entity: "stock_transfer", entityId: id, branchId: t.fromBranchId, after: { to: t.toBranchId, lines: lines.length } });
  return { ...t, status: "sent" };
}

/**
 * Receive at the destination (inventory.transfer there). Every line needs a
 * received quantity, at most what was sent. Stock comes in at the sender's cost;
 * a shortfall is recorded as loss, so value_sent = value_received + loss_value.
 */
export async function receiveTransfer(ctx: AppContext, id: string, input: ReceiveTransferInput) {
  const data = parseInput(receiveTransferInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const t = await loadTransfer(tx, ctx, id);
    at(ctx, t.toBranchId);
    if (t.status !== "sent") throw new ValidationError(t.status === "received" ? "This transfer was already received." : "Only a sent transfer can be received.");
    const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
    const got = new Map(data.lines.map((l) => [l.lineId, l.qtyReceived]));
    if (lines.some((l) => !got.has(l.id)) || got.size !== lines.length) throw new ValidationError("Enter the received quantity for every line.");
    const done = lines.map((l) => {
      const q = dec(got.get(l.id)!);
      if (q.gt(l.qtySent)) throw new ValidationError("You can't receive more than was sent. Record extra stock as an adjustment.");
      const valueReceived = q.eq(l.qtySent) ? dec(l.valueSent!) : dec(l.valueSent!).times(q).div(l.qtySent).toDecimalPlaces(4, 4);
      return { l, q, valueReceived, loss: dec(l.valueSent!).minus(valueReceived) };
    });
    await applyStockMovements(tx, done.filter((d) => d.q.gt(0)).map((d) => ({
      branchId: t.toBranchId, itemId: d.l.itemId, type: "transfer_in" as const, qtyBase: d.q.toFixed(4), totalCost: toMoneyString(d.valueReceived),
      refType: "stock_transfer", refId: id, reason: "Transfer in", createdBy: ctx.userId,
    })));
    for (const d of done) {
      await tx.update(stockTransferLines).set({ qtyReceived: d.q.toFixed(4), valueReceived: toMoneyString(d.valueReceived), lossValue: toMoneyString(d.loss) }).where(eq(stockTransferLines.id, d.l.id));
    }
    await tx.update(stockTransfers).set({ status: "received", receivedBy: ctx.userId, receivedAt: new Date() }).where(eq(stockTransfers.id, id));
    const losses = done.filter((d) => d.loss.gt(0));
    await writeAudit(tx, ctx, {
      action: "stock_transfer.receive", entity: "stock_transfer", entityId: id, branchId: t.toBranchId,
      after: { lossValue: toMoneyString(losses.reduce((a, d) => a.plus(d.loss), dec(0))), shortLines: losses.map((d) => ({ itemId: d.l.itemId, sent: d.l.qtySent, received: d.q.toFixed(4) })) },
    });
  });
}
