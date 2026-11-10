import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import {
  branches,
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
  user,
} from "@/db/schema";
import { dec } from "@/lib/domain/money";
import { availableUnits } from "@/lib/domain/units";
import { NotFoundError } from "@/lib/errors";
import { assertBranchAccess, hasPermission, requirePermission, type AppContext } from "@/lib/permissions";

const canSeeCost = (ctx: AppContext, branchId: string) => hasPermission(ctx, branchId, "inventory.view_cost");

function requireView(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "inventory.view");
}

export async function listUnits(ctx: AppContext) {
  return ctx.db.select().from(units).orderBy(asc(units.dimension), asc(units.factorToDimensionBase));
}

export async function listCategories(ctx: AppContext) {
  return ctx.db.select().from(itemCategories).where(eq(itemCategories.orgId, ctx.orgId)).orderBy(asc(itemCategories.name));
}

async function packagingFor(ctx: AppContext, itemIds: string[]) {
  if (!itemIds.length) return [];
  return ctx.db.select().from(itemUnits).where(inArray(itemUnits.itemId, itemIds)).orderBy(asc(itemUnits.factorToBase));
}

const isLowSql = and(isNotNull(stockLevels.reorderLevel), lte(sql`coalesce(${stockLevels.qtyOnHand}, 0)`, stockLevels.reorderLevel));

/** Items with their stock at one branch. Costs only with inventory.view_cost. */
export async function listItems(
  ctx: AppContext,
  opts: { branchId: string; q?: string; categoryId?: string; lowOnly?: boolean; includeInactive?: boolean },
) {
  requireView(ctx, opts.branchId);
  const showCost = canSeeCost(ctx, opts.branchId);
  const like = opts.q ? `%${opts.q}%` : null;
  const rows = await ctx.db
    .select({
      id: items.id,
      sku: items.sku,
      name: items.name,
      itemType: items.itemType,
      isActive: items.isActive,
      categoryId: items.categoryId,
      categoryName: itemCategories.name,
      baseUnit: units.code,
      qtyOnHand: sql<string>`coalesce(${stockLevels.qtyOnHand}, 0.0000)::numeric(18,4)::text`,
      avgCost: stockLevels.avgCost,
      lastCost: stockLevels.lastCost,
      reorderLevel: stockLevels.reorderLevel,
    })
    .from(items)
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .leftJoin(stockLevels, and(eq(stockLevels.itemId, items.id), eq(stockLevels.branchId, opts.branchId)))
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        opts.includeInactive ? undefined : eq(items.isActive, true),
        opts.categoryId ? eq(items.categoryId, opts.categoryId) : undefined,
        like ? or(ilike(items.name, like), ilike(items.sku, like)) : undefined,
        opts.lowOnly ? isLowSql : undefined,
      ),
    )
    .orderBy(asc(items.name));
  const packaging = await packagingFor(ctx, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    avgCost: showCost ? (r.avgCost ?? "0.000000") : null,
    lastCost: showCost ? r.lastCost : null,
    stockValue: showCost ? dec(r.qtyOnHand).times(r.avgCost ?? "0").toFixed(2) : null,
    isLow: r.reorderLevel !== null && dec(r.qtyOnHand).lte(r.reorderLevel),
    packaging: packaging.filter((p) => p.itemId === r.id),
  }));
}

export type ItemListRow = Awaited<ReturnType<typeof listItems>>[number];

/** One item with its units and stock at each of the viewer's branches where they have inventory.view. */
export async function getItem(ctx: AppContext, itemId: string) {
  requirePermission(ctx, ctx.branchId, "inventory.view");
  const [item] = await ctx.db.select().from(items).where(and(eq(items.id, itemId), eq(items.orgId, ctx.orgId)));
  if (!item) throw new NotFoundError("Item not found.");
  const globals = await ctx.db.select().from(units);
  const base = globals.find((u) => u.id === item.baseUnitId)!;
  const packaging = await packagingFor(ctx, [item.id]);
  const visible = ctx.branchIds.filter((b) => hasPermission(ctx, b, "inventory.view"));
  const levels = visible.length
    ? await ctx.db
        .select({
          branchId: branches.id,
          branchCode: branches.code,
          branchName: branches.name,
          qtyOnHand: stockLevels.qtyOnHand,
          avgCost: stockLevels.avgCost,
          reorderLevel: stockLevels.reorderLevel,
          movements: sql<number>`(select count(*)::int from ${stockMovements} where ${stockMovements.itemId} = ${item.id} and ${stockMovements.branchId} = ${branches.id})`,
        })
        .from(branches)
        .leftJoin(stockLevels, and(eq(stockLevels.branchId, branches.id), eq(stockLevels.itemId, item.id)))
        .where(inArray(branches.id, visible))
        .orderBy(asc(branches.code))
    : [];
  const [{ anyMovement }] = await ctx.db
    .select({ anyMovement: sql<boolean>`exists (select 1 from ${stockMovements} where ${stockMovements.itemId} = ${item.id})` })
    .from(items)
    .where(eq(items.id, item.id));
  return {
    ...item,
    baseUnit: base.code,
    /** Any branch, not only those the viewer sees: the base unit is then fixed. */
    hasMovements: anyMovement,
    units: packaging,
    unitOptions: availableUnits(base, globals, packaging),
    levels: levels.map((l) => ({
      ...l,
      qtyOnHand: l.qtyOnHand ?? "0.0000",
      avgCost: canSeeCost(ctx, l.branchId) ? (l.avgCost ?? "0.000000") : null,
      stockValue: canSeeCost(ctx, l.branchId) ? dec(l.qtyOnHand ?? "0").times(l.avgCost ?? "0").toFixed(2) : null,
      canManage: hasPermission(ctx, l.branchId, "inventory.manage_items"),
    })),
  };
}

export type ItemDetail = Awaited<ReturnType<typeof getItem>>;

export const MOVEMENTS_PAGE_SIZE = 100;

/** Stock movement history at one branch, newest first. `qtyAfter` is the running balance. */
export async function listMovements(
  ctx: AppContext,
  opts: { branchId: string; itemId?: string; type?: string; from?: string; to?: string; page?: number },
) {
  requireView(ctx, opts.branchId);
  const showCost = canSeeCost(ctx, opts.branchId);
  const page = Math.max(1, opts.page ?? 1);
  const conditions = [eq(stockMovements.branchId, opts.branchId)];
  if (opts.itemId) conditions.push(eq(stockMovements.itemId, opts.itemId));
  if (opts.type) conditions.push(eq(stockMovements.movementType, opts.type));
  if (opts.from) conditions.push(gte(stockMovements.createdAt, new Date(`${opts.from}T00:00:00+07:00`)));
  if (opts.to) {
    const end = new Date(`${opts.to}T00:00:00+07:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lt(stockMovements.createdAt, end));
  }
  const rows = await ctx.db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      itemId: stockMovements.itemId,
      itemName: items.name,
      baseUnit: units.code,
      movementType: stockMovements.movementType,
      qtyBase: stockMovements.qtyBase,
      qtyAfter: stockMovements.qtyAfter,
      unitCost: stockMovements.unitCost,
      totalCost: stockMovements.totalCost,
      avgCostAfter: stockMovements.avgCostAfter,
      enteredUnitLabel: stockMovements.enteredUnitLabel,
      enteredQty: stockMovements.enteredQty,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      reason: stockMovements.reason,
      userName: user.name,
    })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .leftJoin(user, eq(user.id, stockMovements.createdBy))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.seq))
    .limit(MOVEMENTS_PAGE_SIZE + 1)
    .offset((page - 1) * MOVEMENTS_PAGE_SIZE);
  return {
    rows: rows.slice(0, MOVEMENTS_PAGE_SIZE).map((r) => ({
      ...r,
      unitCost: showCost ? r.unitCost : null,
      totalCost: showCost ? r.totalCost : null,
      avgCostAfter: showCost ? r.avgCostAfter : null,
    })),
    page,
    hasMore: rows.length > MOVEMENTS_PAGE_SIZE,
  };
}

export type MovementRow = Awaited<ReturnType<typeof listMovements>>["rows"][number];

/** Items at or below their reorder level at a branch (dashboard widget, sidebar badge, list filter). */
export async function lowStock(ctx: AppContext, branchId: string) {
  requireView(ctx, branchId);
  const rows = await ctx.db
    .select({
      itemId: items.id,
      name: items.name,
      baseUnit: units.code,
      qtyOnHand: stockLevels.qtyOnHand,
      reorderLevel: stockLevels.reorderLevel,
    })
    .from(stockLevels)
    .innerJoin(items, eq(items.id, stockLevels.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .where(and(eq(stockLevels.branchId, branchId), eq(items.isActive, true), isLowSql))
    .orderBy(asc(items.name));
  return { count: rows.length, items: rows };
}

export async function listAdjustments(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "inventory.adjust");
  return ctx.db
    .select({
      id: stockAdjustments.id,
      createdAt: stockAdjustments.createdAt,
      reasonCode: stockAdjustments.reasonCode,
      note: stockAdjustments.note,
      status: stockAdjustments.status,
      postedAt: stockAdjustments.postedAt,
      createdByName: user.name,
      lineCount: sql<number>`(select count(*)::int from ${stockAdjustmentLines} where ${stockAdjustmentLines.adjustmentId} = ${stockAdjustments.id})`,
    })
    .from(stockAdjustments)
    .leftJoin(user, eq(user.id, stockAdjustments.createdBy))
    .where(eq(stockAdjustments.branchId, branchId))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(200);
}

export async function getAdjustment(ctx: AppContext, id: string) {
  const [adj] = await ctx.db.select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
  if (!adj || !ctx.branchIds.includes(adj.branchId)) throw new NotFoundError("Adjustment not found.");
  requirePermission(ctx, adj.branchId, "inventory.adjust");
  const lines = await ctx.db
    .select({
      id: stockAdjustmentLines.id,
      itemId: stockAdjustmentLines.itemId,
      itemName: items.name,
      baseUnit: units.code,
      enteredUnitLabel: stockAdjustmentLines.enteredUnitLabel,
      enteredQty: stockAdjustmentLines.enteredQty,
      qtyBase: stockAdjustmentLines.qtyBase,
      unitCost: stockAdjustmentLines.unitCost,
      totalCost: stockAdjustmentLines.totalCost,
    })
    .from(stockAdjustmentLines)
    .innerJoin(items, eq(items.id, stockAdjustmentLines.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .where(eq(stockAdjustmentLines.adjustmentId, id));
  return { ...adj, lines };
}

export async function listCounts(ctx: AppContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  requirePermission(ctx, branchId, "inventory.count");
  return ctx.db
    .select({
      id: stockCounts.id,
      createdAt: stockCounts.createdAt,
      status: stockCounts.status,
      note: stockCounts.note,
      categoryName: itemCategories.name,
      postedAt: stockCounts.postedAt,
      createdByName: user.name,
      lines: count(stockCountLines.id),
      counted: sql<number>`count(${stockCountLines.countedQtyBase})::int`,
    })
    .from(stockCounts)
    .leftJoin(itemCategories, eq(itemCategories.id, stockCounts.categoryId))
    .leftJoin(user, eq(user.id, stockCounts.createdBy))
    .leftJoin(stockCountLines, eq(stockCountLines.countId, stockCounts.id))
    .where(eq(stockCounts.branchId, branchId))
    .groupBy(stockCounts.id, itemCategories.name, user.name)
    .orderBy(desc(stockCounts.createdAt))
    .limit(100);
}

export async function getCount(ctx: AppContext, id: string) {
  const [c] = await ctx.db.select().from(stockCounts).where(eq(stockCounts.id, id));
  if (!c || !ctx.branchIds.includes(c.branchId)) throw new NotFoundError("Stock count not found.");
  requirePermission(ctx, c.branchId, "inventory.count");
  const showCost = canSeeCost(ctx, c.branchId);
  const lines = await ctx.db
    .select({
      itemId: stockCountLines.itemId,
      itemName: items.name,
      baseUnitId: items.baseUnitId,
      baseUnit: units.code,
      systemQty: stockCountLines.systemQty,
      countedQtyBase: stockCountLines.countedQtyBase,
      enteredQty: stockCountLines.enteredQty,
      enteredUnitLabel: stockCountLines.enteredUnitLabel,
      diff: stockCountLines.diff,
      avgCost: stockLevels.avgCost,
    })
    .from(stockCountLines)
    .innerJoin(items, eq(items.id, stockCountLines.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .leftJoin(stockLevels, and(eq(stockLevels.itemId, items.id), eq(stockLevels.branchId, c.branchId)))
    .where(eq(stockCountLines.countId, id))
    .orderBy(asc(items.name));
  const globals = await ctx.db.select().from(units);
  const packaging = await packagingFor(ctx, lines.map((l) => l.itemId));
  return {
    ...c,
    lines: lines.map((l) => {
      const base = globals.find((u) => u.id === l.baseUnitId)!;
      const pk = packaging.filter((p) => p.itemId === l.itemId);
      return {
        ...l,
        avgCost: showCost ? l.avgCost : null,
        unitOptions: availableUnits(base, globals, pk),
        // Count default unit, else the smallest pack (people count bottles, not ml), else the base unit.
        countDefaultKey: (() => {
          const u = pk.find((p) => p.isCountDefault) ?? pk[0];
          return u ? `iu:${u.id}` : "base";
        })(),
      };
    }),
  };
}

/** Active items with the units they can be entered in (for adjustment and count forms). */
export async function listItemOptions(ctx: AppContext) {
  requirePermission(ctx, ctx.branchId, "inventory.view");
  return itemOptionsFor(ctx);
}

/** Same list without a permission check: callers must check their own permission first. */
export async function itemOptionsFor(ctx: AppContext) {
  const rows = await ctx.db.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.isActive, true))).orderBy(asc(items.name));
  const globals = await ctx.db.select().from(units);
  const packaging = await packagingFor(ctx, rows.map((r) => r.id));
  return rows.map((r) => {
    const base = globals.find((u) => u.id === r.baseUnitId)!;
    const pk = packaging.filter((p) => p.itemId === r.id);
    return { id: r.id, name: r.name, baseUnit: base.code, unitOptions: availableUnits(base, globals, pk) };
  });
}

export type ItemOption = Awaited<ReturnType<typeof listItemOptions>>[number];

/** Unit options for specific items of the org, active or not (no permission check). */
export async function itemOptionsByIds(ctx: AppContext, ids: string[]) {
  const rows = await ctx.db.select().from(items).where(and(eq(items.orgId, ctx.orgId), inArray(items.id, ids))).orderBy(asc(items.name));
  const globals = await ctx.db.select().from(units);
  const packaging = await packagingFor(ctx, rows.map((r) => r.id));
  return rows.map((r) => {
    const base = globals.find((u) => u.id === r.baseUnitId)!;
    return { id: r.id, name: r.name, baseUnit: base.code, unitOptions: availableUnits(base, globals, packaging.filter((p) => p.itemId === r.id)) };
  });
}

// ---------- stock transfers ----------

/** Transfers in or out of the branches the user holds inventory.transfer or inventory.view at, newest first. */
export async function listTransfers(ctx: AppContext, opts: { id?: string } = {}) {
  const ids = ctx.branchIds.filter((b) => hasPermission(ctx, b, "inventory.transfer") || hasPermission(ctx, b, "inventory.view"));
  if (!ids.length) return [];
  const rows = await ctx.db.execute(sql`
    select t.id::text as id, t.number::int as number, t.status, t.from_branch_id::text as "fromBranchId", t.to_branch_id::text as "toBranchId",
      fb.name as "fromBranch", tb.name as "toBranch", t.note, t.created_at as "createdAt", t.sent_at as "sentAt", t.received_at as "receivedAt",
      (select count(*) from stock_transfer_lines l where l.transfer_id = t.id)::int as lines,
      (select coalesce(sum(l.value_sent), 0)::numeric(18,4)::text from stock_transfer_lines l where l.transfer_id = t.id) as "valueSent",
      (select coalesce(sum(l.loss_value), 0)::numeric(18,4)::text from stock_transfer_lines l where l.transfer_id = t.id) as "lossValue"
    from stock_transfers t join branches fb on fb.id = t.from_branch_id join branches tb on tb.id = t.to_branch_id
    where t.org_id = ${ctx.orgId} and (t.from_branch_id in ${ids} or t.to_branch_id in ${ids}) ${opts.id ? sql`and t.id = ${opts.id}` : sql``}
    order by t.created_at desc limit 500`);
  return (rows as unknown as { id: string; number: number; status: string; fromBranchId: string; toBranchId: string; fromBranch: string; toBranch: string; note: string | null; createdAt: Date | string; sentAt: Date | string | null; receivedAt: Date | string | null; lines: number; valueSent: string; lossValue: string }[])
    .map((r) => ({ ...r, ref: `TR-${String(r.number).padStart(6, "0")}`, createdAt: new Date(r.createdAt).toISOString(), sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null, receivedAt: r.receivedAt ? new Date(r.receivedAt).toISOString() : null }));
}
export type TransferRow = Awaited<ReturnType<typeof listTransfers>>[number];

/** One transfer with its lines; visible from either branch. */
export async function getTransfer(ctx: AppContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Transfer not found.");
  const [t] = await listTransfers(ctx, { id });
  if (!t) throw new NotFoundError("Transfer not found.");
  const lines = await ctx.db.execute(sql`
    select l.id::text as id, l.item_id::text as "itemId", i.name as item, u.code as unit, l.entered_unit_label as "enteredUnitLabel", l.entered_qty::text as "enteredQty",
      l.qty_sent::text as "qtySent", l.qty_received::text as "qtyReceived", l.unit_cost::text as "unitCost",
      l.value_sent::text as "valueSent", l.value_received::text as "valueReceived", l.loss_value::text as "lossValue"
    from stock_transfer_lines l join items i on i.id = l.item_id join units u on u.id = i.base_unit_id
    where l.transfer_id = ${id} order by i.name`);
  return { ...t, lines: lines as unknown as { id: string; itemId: string; item: string; unit: string; enteredUnitLabel: string; enteredQty: string; qtySent: string; qtyReceived: string | null; unitCost: string | null; valueSent: string | null; valueReceived: string | null; lossValue: string | null }[] };
}
