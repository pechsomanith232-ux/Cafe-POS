import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, items, stockLevels, stockMovements } from "@/db/schema";
import { dec, toQtyString } from "@/lib/domain/money";
import { computeMovement, type MovementType } from "@/lib/domain/wac";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type StockMovementInput = {
  branchId: string;
  itemId: string;
  type: MovementType;
  /** Signed quantity in the item's base unit. */
  qtyBase: string;
  /** Cost per base unit; required for opening/purchase/transfer_in/refund_restock/purchase_return. */
  unitCost?: string | null;
  /** Exact inbound value (entered qty × entered cost); preferred over unitCost when known. */
  totalCost?: string | null;
  enteredUnitLabel?: string | null;
  enteredQty?: string | null;
  refType?: string | null;
  refId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
  /** Refuse to go below zero (branch setting block_negative_stock, plan §4.2). */
  blockNegative?: boolean;
};

export type StockMovementResult = {
  movementId: string;
  qtyAfter: string;
  avgAfter: string;
  unitCost: string;
  totalCost: string;
};

const LAST_COST_TYPES: MovementType[] = ["opening", "purchase"];

/**
 * The ONLY way stock changes (plan §5.8). Must run inside the caller's
 * transaction: locks the stock_levels row (creating it if missing) with
 * SELECT … FOR UPDATE, applies weighted average cost, updates the level and
 * appends the movement. Callers (services) do the permission check and audit.
 */
export async function applyStockMovement(tx: Executor, rawInput: StockMovementInput): Promise<StockMovementResult> {
  // Round the quantity to the column's 4 dp first, so the stored qty_base and
  // the running balance always agree.
  let qtyBase: string;
  try {
    qtyBase = toQtyString(rawInput.qtyBase);
  } catch {
    throw new ValidationError("Invalid quantity.");
  }
  const input = { ...rawInput, qtyBase };
  // The item and branch must belong to the same organization.
  const [ok] = await tx
    .select({ id: items.id })
    .from(items)
    .innerJoin(branches, eq(branches.orgId, items.orgId))
    .where(and(eq(items.id, input.itemId), eq(branches.id, input.branchId)));
  if (!ok) throw new NotFoundError("Item not found for this branch.");

  await tx.insert(stockLevels).values({ branchId: input.branchId, itemId: input.itemId }).onConflictDoNothing();
  const [level] = await tx
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.branchId, input.branchId), eq(stockLevels.itemId, input.itemId)))
    .for("update");

  let result;
  try {
    result = computeMovement({ qty: level.qtyOnHand, avg: level.avgCost }, input);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  if (input.blockNegative && dec(input.qtyBase).isNegative() && dec(result.qtyAfter).isNegative()) {
    throw new ValidationError("Not enough stock (negative stock is blocked at this branch).");
  }

  await tx
    .update(stockLevels)
    .set({
      qtyOnHand: result.qtyAfter,
      avgCost: result.avgAfter,
      ...(LAST_COST_TYPES.includes(input.type) ? { lastCost: result.unitCost } : {}),
    })
    .where(eq(stockLevels.id, level.id));

  const [mv] = await tx
    .insert(stockMovements)
    .values({
      branchId: input.branchId,
      itemId: input.itemId,
      movementType: input.type,
      qtyBase: input.qtyBase,
      unitCost: result.unitCost,
      totalCost: result.totalCost,
      qtyAfter: result.qtyAfter,
      avgCostAfter: result.avgAfter,
      enteredUnitLabel: input.enteredUnitLabel ?? null,
      enteredQty: input.enteredQty ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: stockMovements.id });

  return { movementId: mv.id, ...result };
}

/**
 * Apply several movements in ONE fixed order (by branch, then item id). Every
 * multi-item caller (adjustments, counts, goods receipts, orders, transfers)
 * must use this, so concurrent transactions always lock stock rows in the
 * same order and can't deadlock.
 */
export async function applyStockMovements(tx: Executor, inputs: StockMovementInput[]): Promise<StockMovementResult[]> {
  const order = inputs
    .map((input, index) => ({ input, index }))
    .sort((a, b) => a.input.branchId.localeCompare(b.input.branchId) || a.input.itemId.localeCompare(b.input.itemId) || a.index - b.index);
  const results: StockMovementResult[] = new Array(inputs.length);
  for (const { input, index } of order) results[index] = await applyStockMovement(tx, input);
  return results;
}

/** Lock (creating if missing) the stock rows of several items at a branch, in the fixed order, and return them. */
export async function lockStockLevels(tx: Executor, branchId: string, itemIds: string[]) {
  const ids = [...new Set(itemIds)].sort();
  const out = new Map<string, typeof stockLevels.$inferSelect>();
  for (const itemId of ids) {
    await tx.insert(stockLevels).values({ branchId, itemId }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.itemId, itemId)))
      .for("update");
    out.set(itemId, row);
  }
  return out;
}
