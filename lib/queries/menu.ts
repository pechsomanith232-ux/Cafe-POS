import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  branchVariantPrices,
  items,
  menuCategories,
  modifierGroups,
  modifiers,
  productModifierGroups,
  products,
  productVariants,
  recipeLines,
  stockLevels,
  units,
} from "@/db/schema";
import { dec, sum, toMoneyString } from "@/lib/domain/money";
import { marginPct, theoreticalCost } from "@/lib/domain/recipe";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ForbiddenError, hasPermission, type AppContext } from "@/lib/permissions";
import { itemOptionsByIds, itemOptionsFor } from "./inventory";

/** Can see the menu: menu.view or menu.manage at the active branch. */
function requireMenuView(ctx: AppContext) {
  if (!hasPermission(ctx, ctx.branchId, "menu.view") && !hasPermission(ctx, ctx.branchId, "menu.manage")) {
    throw new ForbiddenError("Missing permission menu.view at this branch.");
  }
}

/** Costs and margins need inventory.view_cost (plan §6). */
export const canSeeCost = (ctx: AppContext) => hasPermission(ctx, ctx.branchId, "inventory.view_cost");

/**
 * Current average cost per base unit at a branch. Items never received at the
 * branch (no row, or no cost ever recorded) are left out, so they show as
 * "no cost yet" instead of silently costing 0.
 */
async function avgCosts(ctx: AppContext, branchId: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const rows = await ctx.db.select({ itemId: stockLevels.itemId, avg: stockLevels.avgCost, last: stockLevels.lastCost, qty: stockLevels.qtyOnHand })
    .from(stockLevels)
    .where(and(eq(stockLevels.branchId, branchId), inArray(stockLevels.itemId, [...new Set(itemIds)])));
  return new Map(rows.filter((r) => !(dec(r.avg).isZero() && r.last === null)).map((r) => [r.itemId, r.avg]));
}

type Owner = { variantIds?: string[]; modifierIds?: string[] };

async function loadRecipes(ctx: AppContext, owner: Owner) {
  const conds = [];
  if (owner.variantIds?.length) conds.push(inArray(recipeLines.variantId, owner.variantIds));
  if (owner.modifierIds?.length) conds.push(inArray(recipeLines.modifierId, owner.modifierIds));
  if (!conds.length) return [];
  return ctx.db
    .select({
      id: recipeLines.id, variantId: recipeLines.variantId, modifierId: recipeLines.modifierId, itemId: recipeLines.itemId,
      itemName: items.name, itemActive: items.isActive, baseUnit: units.code, qtyBase: recipeLines.qtyBase,
      unitLabel: recipeLines.unitLabel, unitFactor: recipeLines.unitFactor, qtyEntered: recipeLines.qtyEntered,
    })
    .from(recipeLines)
    .innerJoin(items, eq(items.id, recipeLines.itemId))
    .innerJoin(units, eq(units.id, items.baseUnitId))
    .where(or(...conds))
    .orderBy(asc(recipeLines.sortOrder));
}
type RecipeRow = Awaited<ReturnType<typeof loadRecipes>>[number];

/** Recipe lines with line cost, plus total cost and the names of items with no cost yet. Costs are null without view_cost. */
function costed(lines: RecipeRow[], avg: Map<string, string>, showCost: boolean) {
  const tc = theoreticalCost(lines, avg);
  return {
    recipe: lines.map((l) => ({
      id: l.id, itemId: l.itemId, itemName: l.itemName, itemActive: l.itemActive, baseUnit: l.baseUnit, qtyBase: l.qtyBase,
      unitLabel: l.unitLabel, unitFactor: l.unitFactor, qtyEntered: l.qtyEntered,
      lineCost: showCost && avg.has(l.itemId) ? toMoneyString(dec(l.qtyBase).times(avg.get(l.itemId)!)) : null,
    })),
    cost: showCost ? tc.cost : null,
    missingCostItems: showCost ? [...new Set(lines.filter((l) => tc.missingItemIds.includes(l.itemId)).map((l) => l.itemName))] : [],
  };
}

// ---------- categories ----------

export async function listMenuCategories(ctx: AppContext, opts: { includeInactive?: boolean } = {}) {
  requireMenuView(ctx);
  return ctx.db
    .select({
      id: menuCategories.id, name: menuCategories.name, color: menuCategories.color, sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive,
      productCount: sql<number>`(select count(*)::int from products p where p.category_id = "menu_categories"."id")`,
    })
    .from(menuCategories)
    .where(and(eq(menuCategories.orgId, ctx.orgId), opts.includeInactive ? undefined : eq(menuCategories.isActive, true)))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
}
export type MenuCategoryRow = Awaited<ReturnType<typeof listMenuCategories>>[number];

// ---------- products ----------

/** Product list with price range and the "No stock deduction" / "No recipe" badges. */
export async function listProducts(ctx: AppContext) {
  requireMenuView(ctx);
  const activeVariant = sql`${productVariants.productId} = ${products.id} and ${productVariants.isActive}`;
  return ctx.db
    .select({
      id: products.id, name: products.name, categoryId: products.categoryId, categoryName: menuCategories.name, imageKey: products.imageKey,
      kitchenStation: products.kitchenStation, isActive: products.isActive,
      noStockDeduction: sql<boolean>`not ${products.deductStock}`,
      variantCount: sql<number>`(select count(*)::int from ${productVariants} where ${activeVariant})`,
      minPrice: sql<string | null>`(select min(${productVariants.price})::text from ${productVariants} where ${activeVariant})`,
      maxPrice: sql<string | null>`(select max(${productVariants.price})::text from ${productVariants} where ${activeVariant})`,
      hasRecipe: sql<boolean>`exists (select 1 from ${recipeLines} join ${productVariants} on ${productVariants.id} = ${recipeLines.variantId} where ${activeVariant})`,
    })
    .from(products)
    .leftJoin(menuCategories, eq(menuCategories.id, products.categoryId))
    .where(eq(products.orgId, ctx.orgId))
    .orderBy(asc(products.name));
}
export type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];

/** One product: variants with recipe, theoretical cost and margin at the active branch, branch price, groups. */
export async function getProduct(ctx: AppContext, id: string) {
  requireMenuView(ctx);
  const [p] = await ctx.db.select().from(products).where(and(eq(products.id, id), eq(products.orgId, ctx.orgId)));
  if (!p) throw new NotFoundError("Product not found.");
  const variants = await ctx.db
    .select({ v: productVariants, branchPrice: branchVariantPrices.price, isAvailable: branchVariantPrices.isAvailable })
    .from(productVariants)
    .leftJoin(branchVariantPrices, and(eq(branchVariantPrices.variantId, productVariants.id), eq(branchVariantPrices.branchId, ctx.branchId)))
    .where(and(eq(productVariants.productId, id), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.sortOrder));
  const lines = await loadRecipes(ctx, { variantIds: variants.map((v) => v.v.id) });
  const showCost = canSeeCost(ctx);
  const avg = showCost ? await avgCosts(ctx, ctx.branchId, lines.map((l) => l.itemId)) : new Map<string, string>();
  const groups = await ctx.db.select({ groupId: productModifierGroups.groupId }).from(productModifierGroups)
    .where(eq(productModifierGroups.productId, id)).orderBy(asc(productModifierGroups.sortOrder));
  return {
    ...p,
    modifierGroupIds: groups.map((g) => g.groupId),
    variants: variants.map(({ v, branchPrice, isAvailable }) => {
      const c = costed(lines.filter((l) => l.variantId === v.id), avg, showCost);
      const effectivePrice = branchPrice ?? v.price;
      return {
        id: v.id, name: v.name, price: v.price, sku: v.sku, deductStock: v.deductStock, isDefault: v.isDefault,
        branchPrice, effectivePrice, isAvailable: isAvailable ?? true,
        ...c, margin: c.cost === null ? null : marginPct(effectivePrice, c.cost),
      };
    }),
  };
}
export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

/**
 * Theoretical cost and price of a variant with a set of modifiers at the active
 * branch (e.g. Latte Large + Oat milk + Extra shot). Cost/margin are null without view_cost.
 */
export async function comboCost(ctx: AppContext, input: { variantId: string; modifierIds: string[] }) {
  requireMenuView(ctx);
  const [row] = await ctx.db
    .select({ v: productVariants, branchPrice: branchVariantPrices.price })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(branchVariantPrices, and(eq(branchVariantPrices.variantId, productVariants.id), eq(branchVariantPrices.branchId, ctx.branchId)))
    .where(and(eq(productVariants.id, input.variantId), eq(products.orgId, ctx.orgId), eq(productVariants.isActive, true)));
  if (!row) throw new NotFoundError("Variant not found.");
  const ids = [...new Set(input.modifierIds)];
  const mods = ids.length
    ? await ctx.db.select({ id: modifiers.id, priceDelta: modifiers.priceDelta }).from(modifiers)
      .innerJoin(productModifierGroups, and(eq(productModifierGroups.groupId, modifiers.groupId), eq(productModifierGroups.productId, row.v.productId)))
      .where(and(inArray(modifiers.id, ids), eq(modifiers.isActive, true)))
    : [];
  if (mods.length !== ids.length) throw new ValidationError("Those options aren't available for this product.");
  const price = toMoneyString(dec(row.branchPrice ?? row.v.price).plus(sum(mods.map((m) => m.priceDelta))));
  if (!canSeeCost(ctx)) return { price, cost: null, margin: null, missingCostItems: [] as string[] };
  const lines = await loadRecipes(ctx, { variantIds: [row.v.id], modifierIds: ids });
  const avg = await avgCosts(ctx, ctx.branchId, lines.map((l) => l.itemId));
  const c = costed(lines, avg, true);
  return { price, cost: c.cost, margin: marginPct(price, c.cost!), missingCostItems: c.missingCostItems };
}

// ---------- modifier groups ----------

export async function listModifierGroups(ctx: AppContext, opts: { includeInactive?: boolean } = {}) {
  requireMenuView(ctx);
  return ctx.db
    .select({
      id: modifierGroups.id, name: modifierGroups.name, minSelect: modifierGroups.minSelect, maxSelect: modifierGroups.maxSelect,
      isRequired: modifierGroups.isRequired, isActive: modifierGroups.isActive,
      modifierCount: sql<number>`(select count(*)::int from modifiers m where m.group_id = "modifier_groups"."id" and m.is_active)`,
      productCount: sql<number>`(select count(*)::int from product_modifier_groups pmg where pmg.group_id = "modifier_groups"."id")`,
    })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.orgId, ctx.orgId), opts.includeInactive ? undefined : eq(modifierGroups.isActive, true)))
    .orderBy(asc(modifierGroups.name));
}
export type ModifierGroupRow = Awaited<ReturnType<typeof listModifierGroups>>[number];

export async function getModifierGroup(ctx: AppContext, id: string) {
  requireMenuView(ctx);
  const [g] = await ctx.db.select().from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, ctx.orgId)));
  if (!g) throw new NotFoundError("Modifier group not found.");
  const mods = await ctx.db.select().from(modifiers).where(and(eq(modifiers.groupId, id), eq(modifiers.isActive, true))).orderBy(asc(modifiers.sortOrder));
  const lines = await loadRecipes(ctx, { modifierIds: mods.map((m) => m.id) });
  const showCost = canSeeCost(ctx);
  const avg = showCost ? await avgCosts(ctx, ctx.branchId, lines.map((l) => l.itemId)) : new Map<string, string>();
  return {
    ...g,
    modifiers: mods.map((m) => ({
      id: m.id, name: m.name, priceDelta: m.priceDelta, deductStock: m.deductStock,
      ...costed(lines.filter((l) => l.modifierId === m.id), avg, showCost),
    })),
  };
}
export type ModifierGroupDetail = Awaited<ReturnType<typeof getModifierGroup>>;

/**
 * Items for the recipe editor: active items plus any `includeItemIds` already
 * used in the recipes being edited (even if retired, flagged isActive=false),
 * with the average cost per base unit at the active branch when the user may see costs.
 */
export async function listRecipeItems(ctx: AppContext, opts: { includeItemIds?: string[] } = {}) {
  requireMenuView(ctx);
  const active = await itemOptionsFor(ctx);
  const extraIds = [...new Set(opts.includeItemIds ?? [])].filter((id) => !active.some((a) => a.id === id));
  const extra = extraIds.length ? await itemOptionsByIds(ctx, extraIds) : [];
  const options = [...active.map((o) => ({ ...o, isActive: true })), ...extra.map((o) => ({ ...o, isActive: false }))];
  const avg = canSeeCost(ctx) ? await avgCosts(ctx, ctx.branchId, options.map((o) => o.id)) : new Map<string, string>();
  return options.map((o) => ({ ...o, avgCost: avg.get(o.id) ?? null }));
}
export type RecipeItem = Awaited<ReturnType<typeof listRecipeItems>>[number];

/** Recipe item ids of a product's variants or a group's options (for listRecipeItems). */
export const recipeItemIds = (rows: { recipe: { itemId: string }[] }[]) => rows.flatMap((r) => r.recipe.map((l) => l.itemId));
