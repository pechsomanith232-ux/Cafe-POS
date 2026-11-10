import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  itemCategories,
  itemUnits,
  items,
  stockAdjustmentLines,
  stockAdjustments,
  stockCountLines,
  stockCounts,
  stockLevels,
  stockMovements,
  units,
} from "@/db/schema";
import { dec, toCostString, toMoneyString, toQtyString } from "@/lib/domain/money";
import { availableUnits, toBaseQty, type UnitOption } from "@/lib/domain/units";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import {
  adjustmentInput,
  categoryInput,
  countCreateInput,
  countLinesInput,
  itemInput,
  openingInput,
  reorderInput,
  type AdjustmentInput,
  type ItemInput,
} from "@/lib/validators/inventory";
import { writeAudit } from "./audit";
import { applyStockMovement, applyStockMovements, lockStockLevels } from "./stock";
import { inTransaction } from "./tx";

type Item = typeof items.$inferSelect;
type ItemUnitRow = typeof itemUnits.$inferSelect;

function requireAt(ctx: AppContext, branchId: string, key: Parameters<typeof requirePermission>[2]) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, key);
}

// ---------- helpers ----------

export async function loadItem(tx: Executor, ctx: AppContext, itemId: string, lock = false): Promise<Item> {
  const q = tx.select().from(items).where(and(eq(items.id, itemId), eq(items.orgId, ctx.orgId)));
  const [item] = lock ? await q.for("update") : await q;
  if (!item) throw new NotFoundError("Item not found.");
  return item;
}

/** Units an item can be entered in (base, compatible global units, packaging). */
export async function itemUnitOptions(tx: Executor, item: Item): Promise<UnitOption[]> {
  const globals = await tx.select().from(units);
  const base = globals.find((u) => u.id === item.baseUnitId)!;
  const packaging = await tx.select().from(itemUnits).where(eq(itemUnits.itemId, item.id)).orderBy(asc(itemUnits.factorToBase));
  return availableUnits(base, globals, packaging);
}

/** Resolve an entered quantity in `unitKey` to the base unit. */
export async function toBase(tx: Executor, item: Item, unitKey: string, qty: string) {
  const unit = (await itemUnitOptions(tx, item)).find((u) => u.key === unitKey);
  if (!unit) throw new ValidationError(`Unknown unit for ${item.name}.`);
  return { unit, qtyBase: toQtyString(toBaseQty(qty, unit.factor)) };
}

/** Cost per entered unit → cost per base unit. */
const costPerBase = (cost: string, factor: string) => toCostString(dec(cost).div(factor));

async function itemSnapshot(tx: Executor, item: Item) {
  const packaging = await tx.select().from(itemUnits).where(eq(itemUnits.itemId, item.id)).orderBy(asc(itemUnits.factorToBase));
  const [base] = await tx.select({ code: units.code }).from(units).where(eq(units.id, item.baseUnitId));
  return {
    name: item.name, sku: item.sku, categoryId: item.categoryId, itemType: item.itemType,
    baseUnit: base.code, isActive: item.isActive,
    units: packaging.map((u) => ({ name: u.name, factor: u.factorToBase, purchaseDefault: u.isPurchaseDefault, countDefault: u.isCountDefault })),
  };
}

// ---------- categories ----------

export async function createCategory(ctx: AppContext, input: { name: string }) {
  requirePermission(ctx, ctx.branchId, "inventory.manage_items");
  const data = parseInput(categoryInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const [dupe] = await tx.select({ id: itemCategories.id }).from(itemCategories)
      .where(and(eq(itemCategories.orgId, ctx.orgId), sql`lower(${itemCategories.name}) = lower(${data.name})`));
    if (dupe) throw new ConflictError(`Category "${data.name}" already exists.`);
    const [cat] = await tx.insert(itemCategories).values({ orgId: ctx.orgId, name: data.name }).returning();
    await writeAudit(tx, ctx, { action: "item_category.create", entity: "item_category", entityId: cat.id, after: { name: cat.name } });
    return cat;
  });
}

export async function updateCategory(ctx: AppContext, id: string, input: { name: string; isActive?: boolean }) {
  requirePermission(ctx, ctx.branchId, "inventory.manage_items");
  const data = parseInput(categoryInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const [before] = await tx.select().from(itemCategories).where(and(eq(itemCategories.id, id), eq(itemCategories.orgId, ctx.orgId)));
    if (!before) throw new NotFoundError("Category not found.");
    const [dupe] = await tx.select({ id: itemCategories.id }).from(itemCategories)
      .where(and(eq(itemCategories.orgId, ctx.orgId), sql`lower(${itemCategories.name}) = lower(${data.name})`, ne(itemCategories.id, id)));
    if (dupe) throw new ConflictError(`Category "${data.name}" already exists.`);
    const isActive = input.isActive ?? before.isActive;
    await tx.update(itemCategories).set({ name: data.name, isActive }).where(eq(itemCategories.id, id));
    await writeAudit(tx, ctx, { action: "item_category.update", entity: "item_category", entityId: id, before: { name: before.name, isActive: before.isActive }, after: { name: data.name, isActive } });
  });
}

// ---------- items ----------

async function assertSkuFree(tx: Executor, orgId: string, sku: string | null, exceptId?: string) {
  if (!sku) return;
  const [dupe] = await tx.select({ id: items.id }).from(items)
    .where(and(eq(items.orgId, orgId), sql`lower(${items.sku}) = lower(${sku})`, exceptId ? ne(items.id, exceptId) : undefined));
  if (dupe) throw new ConflictError(`SKU ${sku} is already used.`);
}

async function assertCategory(tx: Executor, orgId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [cat] = await tx.select({ id: itemCategories.id }).from(itemCategories).where(and(eq(itemCategories.id, categoryId), eq(itemCategories.orgId, orgId)));
  if (!cat) throw new ValidationError("Unknown category.");
}

async function baseUnitId(tx: Executor, code: string) {
  const [u] = await tx.select({ id: units.id }).from(units).where(eq(units.code, code));
  if (!u) throw new ValidationError("Unknown base unit.");
  return u.id;
}

export async function createItem(ctx: AppContext, input: ItemInput): Promise<Item & { units: ItemUnitRow[] }> {
  requirePermission(ctx, ctx.branchId, "inventory.manage_items");
  const data = parseInput(itemInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    await assertSkuFree(tx, ctx.orgId, data.sku);
    await assertCategory(tx, ctx.orgId, data.categoryId);
    const [item] = await tx.insert(items).values({
      orgId: ctx.orgId, name: data.name, sku: data.sku, categoryId: data.categoryId ?? null,
      baseUnitId: await baseUnitId(tx, data.baseUnitCode), itemType: data.itemType, createdBy: ctx.userId,
    }).returning();
    const rows = data.units.length
      ? await tx.insert(itemUnits).values(data.units.map((u) => ({
          itemId: item.id, name: u.name, factorToBase: u.factor, isPurchaseDefault: u.isPurchaseDefault, isCountDefault: u.isCountDefault,
        }))).returning()
      : [];
    await writeAudit(tx, ctx, { action: "item.create", entity: "item", entityId: item.id, after: await itemSnapshot(tx, item) });
    return { ...item, units: rows.sort((a, b) => dec(a.factorToBase).cmp(b.factorToBase)) };
  });
}

/** Edit an item and replace its packaging units. The base unit is fixed once stock has moved. */
export async function updateItem(ctx: AppContext, itemId: string, input: ItemInput & { isActive?: boolean }): Promise<void> {
  requirePermission(ctx, ctx.branchId, "inventory.manage_items");
  const data = parseInput(itemInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const item = await loadItem(tx, ctx, itemId, true);
    const before = await itemSnapshot(tx, item);
    const newBase = await baseUnitId(tx, data.baseUnitCode);
    if (newBase !== item.baseUnitId) {
      const [{ n }] = await tx.select({ n: count() }).from(stockMovements).where(eq(stockMovements.itemId, itemId));
      if (n > 0) throw new ValidationError("The base unit can't change after stock has moved. Create a new item instead.");
    }
    await assertSkuFree(tx, ctx.orgId, data.sku, itemId);
    await assertCategory(tx, ctx.orgId, data.categoryId);
    const [updated] = await tx.update(items).set({
      name: data.name, sku: data.sku, categoryId: data.categoryId ?? null, baseUnitId: newBase, itemType: data.itemType,
      isActive: input.isActive ?? item.isActive,
    }).where(eq(items.id, itemId)).returning();

    // Units: keep ids that were passed back (renames), drop the rest, add new ones.
    const existing = await tx.select().from(itemUnits).where(eq(itemUnits.itemId, itemId));
    const keep = new Set(data.units.filter((u) => u.id).map((u) => u.id!));
    const drop = existing.filter((u) => !keep.has(u.id)).map((u) => u.id);
    if (drop.length) await tx.delete(itemUnits).where(inArray(itemUnits.id, drop));
    for (const u of data.units) {
      const values = { name: u.name, factorToBase: u.factor, isPurchaseDefault: u.isPurchaseDefault, isCountDefault: u.isCountDefault };
      if (u.id && existing.some((e) => e.id === u.id)) await tx.update(itemUnits).set(values).where(eq(itemUnits.id, u.id));
      else await tx.insert(itemUnits).values({ ...values, itemId });
    }
    await writeAudit(tx, ctx, { action: "item.update", entity: "item", entityId: itemId, before, after: await itemSnapshot(tx, updated) });
  });
}

// ---------- per-branch settings and opening stock ----------

export async function setReorderLevel(ctx: AppContext, input: { branchId: string; itemId: string; unitKey: string; qty: string | null }) {
  const data = parseInput(reorderInput, input);
  requireAt(ctx, data.branchId, "inventory.manage_items");
  await inTransaction(ctx, async (tx, ctx) => {
    const item = await loadItem(tx, ctx, data.itemId);
    const reorderLevel = data.qty === null ? null : (await toBase(tx, item, data.unitKey, data.qty)).qtyBase;
    const [before] = await tx.select({ reorderLevel: stockLevels.reorderLevel }).from(stockLevels)
      .where(and(eq(stockLevels.branchId, data.branchId), eq(stockLevels.itemId, data.itemId)));
    await tx.insert(stockLevels).values({ branchId: data.branchId, itemId: data.itemId, reorderLevel })
      .onConflictDoUpdate({ target: [stockLevels.branchId, stockLevels.itemId], set: { reorderLevel } });
    await writeAudit(tx, ctx, {
      action: "stock.reorder_level", entity: "item", entityId: data.itemId, branchId: data.branchId,
      before: { reorderLevel: before?.reorderLevel ?? null }, after: { reorderLevel },
    });
  });
}

/** Opening balance for an item at a branch (plan Phase 2): an `opening` movement with cost. Only before any other movement. */
export async function setOpeningStock(
  ctx: AppContext,
  input: { branchId: string; itemId: string; unitKey: string; qty: string; unitCost: string },
) {
  const data = parseInput(openingInput, input);
  requireAt(ctx, data.branchId, "inventory.manage_items");
  await inTransaction(ctx, async (tx, ctx) => {
    const item = await loadItem(tx, ctx, data.itemId, true);
    // Lock the stock row first, so a movement posted at the same moment can't slip in before the check.
    await lockStockLevels(tx, data.branchId, [item.id]);
    const [{ n }] = await tx.select({ n: count() }).from(stockMovements)
      .where(and(eq(stockMovements.itemId, item.id), eq(stockMovements.branchId, data.branchId)));
    if (n > 0) throw new ValidationError("This item already has stock movements at this branch. Use a stock adjustment instead.");
    const { unit, qtyBase } = await toBase(tx, item, data.unitKey, data.qty);
    const r = await applyStockMovement(tx, {
      branchId: data.branchId, itemId: item.id, type: "opening", qtyBase,
      unitCost: costPerBase(data.unitCost, unit.factor), totalCost: toMoneyString(dec(data.qty).times(data.unitCost)),
      enteredUnitLabel: unit.label, enteredQty: data.qty,
      refType: "opening", createdBy: ctx.userId,
    });
    await writeAudit(tx, ctx, {
      action: "stock.opening", entity: "item", entityId: item.id, branchId: data.branchId,
      after: { qty: data.qty, unit: unit.label, qtyBase, unitCostBase: r.unitCost, movementId: r.movementId },
    });
  });
}

// ---------- adjustments ----------

async function buildAdjustmentLines(tx: Executor, ctx: AppContext, lines: ReturnType<typeof adjustmentInput.parse>["lines"]) {
  const out = [];
  for (const line of lines) {
    const item = await loadItem(tx, ctx, line.itemId);
    const { unit, qtyBase } = await toBase(tx, item, line.unitKey, line.qty);
    if (dec(qtyBase).isZero()) throw new ValidationError(`Quantity for ${item.name} is too small.`);
    const isIn = dec(line.qty).isPositive();
    const hasCost = isIn && line.unitCost != null && line.unitCost !== "";
    out.push({
      itemId: item.id, enteredUnitLabel: unit.label, enteredQty: line.qty, qtyBase,
      unitCost: hasCost ? costPerBase(line.unitCost!, unit.factor) : null,
      totalCost: hasCost ? toMoneyString(dec(line.qty).times(line.unitCost!)) : null,
    });
  }
  return out;
}

async function loadAdjustment(tx: Executor, ctx: AppContext, id: string) {
  const [adj] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update");
  if (!adj) throw new NotFoundError("Adjustment not found.");
  requireAt(ctx, adj.branchId, "inventory.adjust");
  return adj;
}

export async function createAdjustment(ctx: AppContext, input: AdjustmentInput) {
  const data = parseInput(adjustmentInput, input);
  requireAt(ctx, data.branchId, "inventory.adjust");
  return inTransaction(ctx, async (tx, ctx) => {
    const lines = await buildAdjustmentLines(tx, ctx, data.lines);
    const [adj] = await tx.insert(stockAdjustments).values({
      branchId: data.branchId, reasonCode: data.reasonCode, note: data.note, createdBy: ctx.userId,
    }).returning();
    await tx.insert(stockAdjustmentLines).values(lines.map((l) => ({ ...l, adjustmentId: adj.id })));
    return adj;
  });
}

export async function updateAdjustment(ctx: AppContext, id: string, input: AdjustmentInput) {
  const data = parseInput(adjustmentInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const adj = await loadAdjustment(tx, ctx, id);
    if (adj.status !== "draft") throw new ValidationError("Only draft adjustments can be edited.");
    if (data.branchId !== adj.branchId) throw new ValidationError("An adjustment can't move to another branch.");
    const lines = await buildAdjustmentLines(tx, ctx, data.lines);
    await tx.update(stockAdjustments).set({ reasonCode: data.reasonCode, note: data.note }).where(eq(stockAdjustments.id, id));
    await tx.delete(stockAdjustmentLines).where(eq(stockAdjustmentLines.adjustmentId, id));
    await tx.insert(stockAdjustmentLines).values(lines.map((l) => ({ ...l, adjustmentId: id })));
  });
}

export async function deleteAdjustment(ctx: AppContext, id: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const adj = await loadAdjustment(tx, ctx, id);
    if (adj.status !== "draft") throw new ValidationError("Posted adjustments can't be deleted. Post a new adjustment to correct them.");
    await tx.delete(stockAdjustments).where(eq(stockAdjustments.id, id));
  });
}

/** Post a draft: one stock movement per line (waste → `waste`, other removals → `adjustment_out`, additions → `adjustment_in`). */
export async function postAdjustment(ctx: AppContext, id: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const adj = await loadAdjustment(tx, ctx, id);
    if (adj.status !== "draft") throw new ValidationError("This adjustment is already posted.");
    const lines = await tx.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.adjustmentId, id));
    const reason = adj.note ? `${adj.reasonCode}: ${adj.note}` : adj.reasonCode;
    const movements = await applyStockMovements(
      tx,
      lines.map((line) => {
        const isIn = dec(line.qtyBase).isPositive();
        return {
          branchId: adj.branchId, itemId: line.itemId,
          type: isIn ? "adjustment_in" : adj.reasonCode === "waste" ? "waste" : "adjustment_out",
          qtyBase: line.qtyBase, unitCost: isIn ? line.unitCost : null, totalCost: isIn ? line.totalCost : null,
          enteredUnitLabel: line.enteredUnitLabel, enteredQty: line.enteredQty,
          refType: "stock_adjustment", refId: id, reason, createdBy: ctx.userId,
        } as const;
      }),
    );
    const results = lines.map((line, i) => ({ itemId: line.itemId, qtyBase: line.qtyBase, totalCost: movements[i].totalCost }));
    await tx.update(stockAdjustments).set({ status: "posted", postedAt: new Date(), postedBy: ctx.userId }).where(eq(stockAdjustments.id, id));
    await writeAudit(tx, ctx, {
      action: "stock_adjustment.post", entity: "stock_adjustment", entityId: id, branchId: adj.branchId,
      reason, after: { lines: results },
    });
  });
}

// ---------- stock counts ----------

async function loadCount(tx: Executor, ctx: AppContext, id: string) {
  const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for("update");
  if (!c) throw new NotFoundError("Stock count not found.");
  requireAt(ctx, c.branchId, "inventory.count");
  return c;
}

/** Start a count: snapshot the system quantity of every active item (or one category). */
export async function createCount(ctx: AppContext, input: { branchId: string; categoryId?: string | null; note?: string | null }) {
  const data = parseInput(countCreateInput, input);
  requireAt(ctx, data.branchId, "inventory.count");
  return inTransaction(ctx, async (tx, ctx) => {
    await assertCategory(tx, ctx.orgId, data.categoryId);
    // One count in progress per branch: two open counts could correct the same item twice.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stock_count:${data.branchId}`}, 0))`);
    const [open] = await tx.select({ id: stockCounts.id }).from(stockCounts)
      .where(and(eq(stockCounts.branchId, data.branchId), eq(stockCounts.status, "draft")));
    if (open) throw new ValidationError("A stock count is already in progress at this branch. Finish or cancel it first.");
    const [c] = await tx.insert(stockCounts).values({
      branchId: data.branchId, categoryId: data.categoryId ?? null, note: data.note, createdBy: ctx.userId,
    }).returning();
    const rows = await tx
      .select({ itemId: items.id, qty: stockLevels.qtyOnHand })
      .from(items)
      .leftJoin(stockLevels, and(eq(stockLevels.itemId, items.id), eq(stockLevels.branchId, data.branchId)))
      .where(and(eq(items.orgId, ctx.orgId), eq(items.isActive, true), data.categoryId ? eq(items.categoryId, data.categoryId) : undefined));
    const lines = rows.length
      ? await tx.insert(stockCountLines).values(rows.map((r) => ({ countId: c.id, itemId: r.itemId, systemQty: r.qty ?? "0" }))).returning()
      : [];
    return { ...c, lines };
  });
}

/** Enter counted quantities (any unit). `qty: null` clears an entry. */
export async function saveCountLines(ctx: AppContext, countId: string, input: { itemId: string; unitKey: string; qty: string | null }[]) {
  const lines = parseInput(countLinesInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const c = await loadCount(tx, ctx, countId);
    if (c.status !== "draft") throw new ValidationError("This count is not a draft any more.");
    for (const l of lines) {
      const [line] = await tx.select().from(stockCountLines).where(and(eq(stockCountLines.countId, countId), eq(stockCountLines.itemId, l.itemId)));
      if (!line) throw new ValidationError("That item isn't part of this count.");
      if (l.qty === null) {
        await tx.update(stockCountLines).set({ countedQtyBase: null, diff: null, enteredQty: null, enteredUnitLabel: null }).where(eq(stockCountLines.id, line.id));
        continue;
      }
      const item = await loadItem(tx, ctx, l.itemId);
      const { unit, qtyBase } = await toBase(tx, item, l.unitKey, l.qty);
      await tx.update(stockCountLines).set({
        countedQtyBase: qtyBase, diff: toQtyString(dec(qtyBase).minus(line.systemQty)), enteredQty: l.qty, enteredUnitLabel: unit.label,
      }).where(eq(stockCountLines.id, line.id));
    }
  });
}

/**
 * Post: set stock to the counted amount for every counted line. The movement
 * is the difference between the count and the stock RIGHT NOW (locked), so
 * sales after the count started aren't counted twice and a second post can't
 * double-apply. `system_qty` stays as the snapshot for reference.
 */
export async function postCount(ctx: AppContext, countId: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const c = await loadCount(tx, ctx, countId);
    if (c.status !== "draft") throw new ValidationError("This count is already posted or cancelled.");
    const lines = (await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, countId)))
      .filter((l) => l.countedQtyBase !== null);
    const levels = await lockStockLevels(tx, c.branchId, lines.map((l) => l.itemId));
    const changes = [];
    const inputs = [];
    for (const line of lines) {
      const current = levels.get(line.itemId)!.qtyOnHand;
      const diff = toQtyString(dec(line.countedQtyBase!).minus(current));
      await tx.update(stockCountLines).set({ diff }).where(eq(stockCountLines.id, line.id));
      if (dec(diff).isZero()) continue;
      changes.push({ itemId: line.itemId, systemQtyAtStart: line.systemQty, qtyAtPost: current, counted: line.countedQtyBase, diff });
      inputs.push({
        branchId: c.branchId, itemId: line.itemId, type: "count_adjustment" as const, qtyBase: diff,
        enteredUnitLabel: line.enteredUnitLabel, enteredQty: line.enteredQty,
        refType: "stock_count", refId: countId, reason: "Stock count", createdBy: ctx.userId,
      });
    }
    const results = await applyStockMovements(tx, inputs);
    await tx.update(stockCounts).set({ status: "posted", postedAt: new Date(), postedBy: ctx.userId }).where(eq(stockCounts.id, countId));
    await writeAudit(tx, ctx, {
      action: "stock_count.post", entity: "stock_count", entityId: countId, branchId: c.branchId,
      reason: "Stock count",
      after: { counted: lines.length, changes: changes.map((ch, i) => ({ ...ch, totalCost: results[i].totalCost })) },
    });
  });
}

export async function cancelCount(ctx: AppContext, countId: string) {
  await inTransaction(ctx, async (tx, ctx) => {
    const c = await loadCount(tx, ctx, countId);
    if (c.status !== "draft") throw new ValidationError("Only draft counts can be cancelled.");
    await tx.update(stockCounts).set({ status: "cancelled" }).where(eq(stockCounts.id, countId));
    await writeAudit(tx, ctx, { action: "stock_count.cancel", entity: "stock_count", entityId: countId, branchId: c.branchId });
  });
}
