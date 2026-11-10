import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
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
} from "@/db/schema";
import { dec, toQtyString } from "@/lib/domain/money";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import {
  branchPriceInput,
  menuCategoryInput,
  modifierGroupInput,
  productInput,
  type MenuCategoryInput,
  type ModifierGroupInput,
  type ProductInput,
} from "@/lib/validators/menu";
import { writeAudit } from "./audit";
import { itemUnitOptions } from "./inventory";
import { inTransaction } from "./tx";

export type { ModifierGroupInput, ProductInput } from "@/lib/validators/menu";

type Product = typeof products.$inferSelect;
type ModifierGroup = typeof modifierGroups.$inferSelect;
type RecipeInput = { itemId: string; unitKey: string; qty: string }[];

/** Menu definitions are organization-wide; editing needs menu.manage at the active branch. */
function requireMenuManage(ctx: AppContext) {
  requirePermission(ctx, ctx.branchId, "menu.manage");
}

const DEDUCT_CHANGE = "menu.deduct_stock.change";

// ---------- categories ----------

async function assertCategoryNameFree(tx: Executor, orgId: string, name: string, exceptId?: string) {
  const [dupe] = await tx.select({ id: menuCategories.id }).from(menuCategories)
    .where(and(eq(menuCategories.orgId, orgId), sql`lower(${menuCategories.name}) = lower(${name})`, exceptId ? ne(menuCategories.id, exceptId) : undefined));
  if (dupe) throw new ConflictError(`A menu category named "${name}" already exists.`);
}

export async function createMenuCategory(ctx: AppContext, input: MenuCategoryInput) {
  requireMenuManage(ctx);
  const data = parseInput(menuCategoryInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    await assertCategoryNameFree(tx, ctx.orgId, data.name);
    const [c] = await tx.insert(menuCategories).values({ ...data, orgId: ctx.orgId }).returning();
    await writeAudit(tx, ctx, { action: "menu_category.create", entity: "menu_category", entityId: c.id, after: data });
    return c;
  });
}

export async function updateMenuCategory(ctx: AppContext, id: string, input: MenuCategoryInput & { isActive?: boolean }) {
  requireMenuManage(ctx);
  const data = parseInput(menuCategoryInput, input);
  await inTransaction(ctx, async (tx, ctx) => {
    const [before] = await tx.select().from(menuCategories).where(and(eq(menuCategories.id, id), eq(menuCategories.orgId, ctx.orgId))).for("update");
    if (!before) throw new NotFoundError("Menu category not found.");
    await assertCategoryNameFree(tx, ctx.orgId, data.name, id);
    const isActive = input.isActive ?? before.isActive;
    await tx.update(menuCategories).set({ ...data, isActive }).where(eq(menuCategories.id, id));
    await writeAudit(tx, ctx, {
      action: "menu_category.update", entity: "menu_category", entityId: id,
      before: { name: before.name, color: before.color, sortOrder: before.sortOrder, isActive: before.isActive }, after: { ...data, isActive },
    });
  });
}

// ---------- recipes ----------

/**
 * Resolve entered recipe lines to base units. Items must belong to the org and
 * be active, unless the item is already in this recipe (so an old product can
 * still be saved after an ingredient is retired).
 */
async function buildRecipe(tx: Executor, ctx: AppContext, recipe: RecipeInput, existingItemIds: ReadonlySet<string>) {
  const ids = [...new Set(recipe.map((l) => l.itemId))];
  const rows = ids.length ? await tx.select().from(items).where(and(inArray(items.id, ids), eq(items.orgId, ctx.orgId))) : [];
  const out = [];
  for (const [i, l] of recipe.entries()) {
    const item = rows.find((r) => r.id === l.itemId);
    if (!item) throw new ValidationError("Unknown item in recipe.");
    if (!item.isActive && !existingItemIds.has(item.id)) throw new ValidationError(`${item.name} is inactive and can't be added to a recipe.`);
    const unit = (await itemUnitOptions(tx, item)).find((u) => u.key === l.unitKey);
    if (!unit) throw new ValidationError(`Unknown unit for ${item.name}.`);
    const qtyBase = toQtyString(dec(l.qty).times(unit.factor));
    if (dec(qtyBase).isZero()) throw new ValidationError(`Quantity of ${item.name} is too small.`);
    out.push({ itemId: item.id, qtyBase, unitLabel: unit.label, unitFactor: unit.factor, qtyEntered: l.qty, sortOrder: i });
  }
  return out;
}

async function recipeItemIds(tx: Executor, owner: { variantId: string } | { modifierId: string }) {
  const where = "variantId" in owner ? eq(recipeLines.variantId, owner.variantId) : eq(recipeLines.modifierId, owner.modifierId);
  return new Set((await tx.select({ itemId: recipeLines.itemId }).from(recipeLines).where(where)).map((r) => r.itemId));
}

async function replaceRecipe(tx: Executor, ctx: AppContext, owner: { variantId: string } | { modifierId: string }, recipe: RecipeInput) {
  const lines = await buildRecipe(tx, ctx, recipe, await recipeItemIds(tx, owner));
  await tx.delete(recipeLines).where("variantId" in owner ? eq(recipeLines.variantId, owner.variantId) : eq(recipeLines.modifierId, owner.modifierId));
  if (lines.length) await tx.insert(recipeLines).values(lines.map((l) => ({ ...l, ...owner })));
  return lines.map((l) => ({ itemId: l.itemId, qty: l.qtyEntered, unit: l.unitLabel }));
}

// ---------- products ----------

/**
 * Create (id = null) or update a product with its variants, recipes and
 * modifier groups, in one transaction (plan §4.3, §6). Variants missing from
 * the input are archived. Every deduct_stock change gets its own audit row.
 */
export async function saveProduct(ctx: AppContext, id: string | null, input: ProductInput): Promise<Product> {
  requireMenuManage(ctx);
  const data = parseInput(productInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const [dupe] = await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.orgId, ctx.orgId), sql`lower(${products.name}) = lower(${data.name})`, id ? ne(products.id, id) : undefined));
    if (dupe) throw new ConflictError(`A product named "${data.name}" already exists.`);
    if (data.categoryId) {
      const [c] = await tx.select({ id: menuCategories.id }).from(menuCategories).where(and(eq(menuCategories.id, data.categoryId), eq(menuCategories.orgId, ctx.orgId)));
      if (!c) throw new ValidationError("Unknown menu category.");
    }
    if (data.modifierGroupIds.length) {
      const found = await tx.select({ id: modifierGroups.id }).from(modifierGroups)
        .where(and(inArray(modifierGroups.id, data.modifierGroupIds), eq(modifierGroups.orgId, ctx.orgId)));
      if (found.length !== data.modifierGroupIds.length) throw new ValidationError("Unknown modifier group.");
    }

    const header = {
      name: data.name, description: data.description, categoryId: data.categoryId ?? null, kitchenStation: data.kitchenStation,
      deductStock: data.deductStock, sortOrder: data.sortOrder, isActive: data.isActive,
    };
    let product: Product;
    let before: Product | null = null;
    if (id) {
      [before] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.orgId, ctx.orgId))).for("update");
      if (!before) throw new NotFoundError("Product not found.");
      [product] = await tx.update(products).set(header).where(eq(products.id, id)).returning();
    } else {
      [product] = await tx.insert(products).values({ ...header, orgId: ctx.orgId }).returning();
    }

    // Variants: update by id, insert new, archive the rest.
    const existing = id ? await tx.select().from(productVariants).where(eq(productVariants.productId, product.id)).for("update") : [];
    for (const v of data.variants) {
      if (v.id && !existing.some((e) => e.id === v.id && e.isActive)) throw new ValidationError("That variant isn't part of this product.");
    }
    if (existing.length) await tx.update(productVariants).set({ isDefault: false }).where(eq(productVariants.productId, product.id));
    const keep = new Set(data.variants.map((v) => v.id).filter(Boolean));
    const archived = existing.filter((e) => e.isActive && !keep.has(e.id));
    if (archived.length) await tx.update(productVariants).set({ isActive: false }).where(inArray(productVariants.id, archived.map((a) => a.id)));

    const variantSnap = [];
    for (const [i, v] of data.variants.entries()) {
      const values = { name: v.name, price: v.price, sku: v.sku, deductStock: v.deductStock, isDefault: v.isDefault, sortOrder: i };
      let variantId: string;
      if (v.id) {
        const prev = existing.find((e) => e.id === v.id)!;
        await tx.update(productVariants).set(values).where(eq(productVariants.id, v.id));
        variantId = v.id;
        if (prev.deductStock !== v.deductStock) {
          await writeAudit(tx, ctx, { action: DEDUCT_CHANGE, entity: "product_variant", entityId: v.id, before: { deductStock: prev.deductStock }, after: { deductStock: v.deductStock } });
        }
      } else {
        [{ id: variantId }] = await tx.insert(productVariants).values({ ...values, productId: product.id }).returning({ id: productVariants.id });
      }
      variantSnap.push({ ...values, recipe: await replaceRecipe(tx, ctx, { variantId }, v.recipe) });
    }

    await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, product.id));
    if (data.modifierGroupIds.length) {
      await tx.insert(productModifierGroups).values(data.modifierGroupIds.map((groupId, i) => ({ productId: product.id, groupId, sortOrder: i })));
    }

    if (before && before.deductStock !== data.deductStock) {
      await writeAudit(tx, ctx, { action: DEDUCT_CHANGE, entity: "product", entityId: product.id, before: { deductStock: before.deductStock }, after: { deductStock: data.deductStock } });
    }
    await writeAudit(tx, ctx, {
      action: id ? "product.update" : "product.create", entity: "product", entityId: product.id,
      before: before ? { name: before.name, categoryId: before.categoryId, deductStock: before.deductStock, isActive: before.isActive } : undefined,
      after: { ...header, modifierGroupIds: data.modifierGroupIds, variants: variantSnap, archivedVariants: archived.map((a) => a.name) },
    });
    return product;
  });
}

/** Set or clear the product image key (the file itself is handled by lib/storage). Returns the old key. */
export async function setProductImageKey(ctx: AppContext, productId: string, imageKey: string | null): Promise<string | null> {
  requireMenuManage(ctx);
  return inTransaction(ctx, async (tx, ctx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId))).for("update");
    if (!p) throw new NotFoundError("Product not found.");
    // Keep updated_at: it versions the product form, which must not reset when only the image changes.
    await tx.update(products).set({ imageKey, updatedAt: p.updatedAt }).where(eq(products.id, productId));
    await writeAudit(tx, ctx, { action: "product.image", entity: "product", entityId: productId, before: { imageKey: p.imageKey }, after: { imageKey } });
    return p.imageKey;
  });
}

// ---------- branch prices ----------

/** Branch price override (null = use the variant price) and availability. */
export async function setBranchVariantPrice(ctx: AppContext, input: { branchId: string; variantId: string; price: string | null; isAvailable: boolean }) {
  const data = parseInput(branchPriceInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "menu.manage");
  await inTransaction(ctx, async (tx, ctx) => {
    const [v] = await tx.select({ id: productVariants.id, name: productVariants.name, product: products.name }).from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.id, data.variantId), eq(products.orgId, ctx.orgId), eq(productVariants.isActive, true)));
    if (!v) throw new NotFoundError("Variant not found.");
    const [prev] = await tx.select().from(branchVariantPrices)
      .where(and(eq(branchVariantPrices.branchId, data.branchId), eq(branchVariantPrices.variantId, data.variantId))).for("update");
    await tx.insert(branchVariantPrices).values({ branchId: data.branchId, variantId: data.variantId, price: data.price, isAvailable: data.isAvailable })
      .onConflictDoUpdate({ target: [branchVariantPrices.branchId, branchVariantPrices.variantId], set: { price: data.price, isAvailable: data.isAvailable } });
    await writeAudit(tx, ctx, {
      action: "menu.branch_price.set", entity: "product_variant", entityId: data.variantId, branchId: data.branchId,
      before: prev ? { price: prev.price, isAvailable: prev.isAvailable } : undefined,
      after: { variant: `${v.product} – ${v.name}`, price: data.price, isAvailable: data.isAvailable },
    });
  });
}

// ---------- modifier groups ----------

/** Create (id = null) or update a modifier group with its options and their recipes. Removed options are archived. */
export async function saveModifierGroup(ctx: AppContext, id: string | null, input: ModifierGroupInput): Promise<ModifierGroup> {
  requireMenuManage(ctx);
  const data = parseInput(modifierGroupInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const [dupe] = await tx.select({ id: modifierGroups.id }).from(modifierGroups)
      .where(and(eq(modifierGroups.orgId, ctx.orgId), sql`lower(${modifierGroups.name}) = lower(${data.name})`, id ? ne(modifierGroups.id, id) : undefined));
    if (dupe) throw new ConflictError(`A modifier group named "${data.name}" already exists.`);
    const header = { name: data.name, minSelect: data.minSelect, maxSelect: data.maxSelect, isRequired: data.minSelect >= 1, isActive: data.isActive };
    let group: ModifierGroup;
    let before: ModifierGroup | null = null;
    if (id) {
      [before] = await tx.select().from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.orgId, ctx.orgId))).for("update");
      if (!before) throw new NotFoundError("Modifier group not found.");
      [group] = await tx.update(modifierGroups).set(header).where(eq(modifierGroups.id, id)).returning();
    } else {
      [group] = await tx.insert(modifierGroups).values({ ...header, orgId: ctx.orgId }).returning();
    }

    const existing = id ? await tx.select().from(modifiers).where(eq(modifiers.groupId, group.id)).orderBy(asc(modifiers.sortOrder)).for("update") : [];
    for (const m of data.modifiers) {
      if (m.id && !existing.some((e) => e.id === m.id && e.isActive)) throw new ValidationError("That option isn't part of this group.");
    }
    const keep = new Set(data.modifiers.map((m) => m.id).filter(Boolean));
    const archived = existing.filter((e) => e.isActive && !keep.has(e.id));
    if (archived.length) await tx.update(modifiers).set({ isActive: false }).where(inArray(modifiers.id, archived.map((a) => a.id)));

    const snap = [];
    for (const [i, m] of data.modifiers.entries()) {
      const values = { name: m.name, priceDelta: m.priceDelta, deductStock: m.deductStock, sortOrder: i };
      let modifierId: string;
      if (m.id) {
        const prev = existing.find((e) => e.id === m.id)!;
        await tx.update(modifiers).set(values).where(eq(modifiers.id, m.id));
        modifierId = m.id;
        if (prev.deductStock !== m.deductStock) {
          await writeAudit(tx, ctx, { action: DEDUCT_CHANGE, entity: "modifier", entityId: m.id, before: { deductStock: prev.deductStock }, after: { deductStock: m.deductStock } });
        }
      } else {
        [{ id: modifierId }] = await tx.insert(modifiers).values({ ...values, groupId: group.id }).returning({ id: modifiers.id });
      }
      snap.push({ ...values, recipe: await replaceRecipe(tx, ctx, { modifierId }, m.recipe) });
    }
    await writeAudit(tx, ctx, {
      action: id ? "modifier_group.update" : "modifier_group.create", entity: "modifier_group", entityId: group.id,
      before: before ? { name: before.name, minSelect: before.minSelect, maxSelect: before.maxSelect, isActive: before.isActive } : undefined,
      after: { ...header, modifiers: snap, archivedModifiers: archived.map((a) => a.name) },
    });
    return group;
  });
}
