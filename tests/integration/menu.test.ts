import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, itemUnits, items, modifierGroups, organizations, productVariants, recipeLines } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { comboCost, getModifierGroup, getProduct, listMenuCategories, listModifierGroups, listProducts } from "@/lib/queries/menu";
import { setOpeningStock } from "@/lib/services/inventory";
import {
  createMenuCategory, saveModifierGroup, saveProduct, setBranchVariantPrice, updateMenuCategory, type ProductInput,
} from "@/lib/services/menu";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

/** Latte world: beans (g, "shot" = 18 g), milk/oat (ml), cups (pcs) with average costs at B1. */
async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const beans = await createItem(tx, w.org.id, { name: "Coffee beans", base: "g", packaging: [{ name: "shot", factor: "18" }] });
  const milk = await createItem(tx, w.org.id, { name: "Fresh milk", base: "ml" });
  const oat = await createItem(tx, w.org.id, { name: "Oat milk", base: "ml" });
  const cup = await createItem(tx, w.org.id, { name: "Cup 16oz", base: "pcs" });
  const [shot] = await tx.select().from(itemUnits).where(eq(itemUnits.itemId, beans.id));
  // Average costs: beans 0.025/g, milk 0.0015/ml, oat 0.004/ml, cup 0.08.
  for (const [item, qty, cost] of [[beans, "1000", "0.025"], [milk, "10000", "0.0015"], [oat, "10000", "0.004"], [cup, "100", "0.08"]] as const) {
    await setOpeningStock(owner, { branchId: w.b1.id, itemId: item.id, unitKey: "base", qty, unitCost: cost });
  }
  const milkGroup = await saveModifierGroup(owner, null, {
    name: "Milk", minSelect: 0, maxSelect: 1,
    modifiers: [{ name: "Oat milk", priceDelta: "0.50", deductStock: true, recipe: [{ itemId: oat.id, unitKey: "base", qty: "300" }, { itemId: milk.id, unitKey: "base", qty: "-300" }] }],
  });
  const extras = await saveModifierGroup(owner, null, {
    name: "Extras", minSelect: 0, maxSelect: 3,
    modifiers: [{ name: "Extra shot", priceDelta: "0.50", deductStock: true, recipe: [{ itemId: beans.id, unitKey: `iu:${shot.id}`, qty: "1" }] }],
  });
  const cat = await createMenuCategory(owner, { name: "Coffee", color: "#7c3aed" });
  const latteInput: ProductInput = {
    name: "Latte", categoryId: cat.id, kitchenStation: "bar", deductStock: true, modifierGroupIds: [milkGroup.id, extras.id],
    variants: [
      { name: "Regular", price: "2.80", deductStock: null, isDefault: true, recipe: [{ itemId: beans.id, unitKey: "base", qty: "18" }, { itemId: milk.id, unitKey: "base", qty: "200" }, { itemId: cup.id, unitKey: "base", qty: "1" }] },
      { name: "Large", price: "3.50", deductStock: null, isDefault: false, recipe: [{ itemId: beans.id, unitKey: "base", qty: "18" }, { itemId: milk.id, unitKey: "base", qty: "300" }, { itemId: cup.id, unitKey: "base", qty: "1" }] },
    ],
  };
  const latte = await saveProduct(owner, null, latteInput);
  const groups = { milk: await getModifierGroup(owner, milkGroup.id), extras: await getModifierGroup(owner, extras.id) };
  return { ...w, owner, beans, milk, oat, cup, shot, cat, latte, latteInput, groups };
}

describe("Phase 4 acceptance", () => {
  it("Latte Large + Oat milk + Extra shot shows the correct theoretical cost", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const p = await getProduct(w.owner, w.latte.id);
      const large = p.variants.find((v) => v.name === "Large")!;
      expect(large).toMatchObject({ cost: "0.9800", margin: "72.0", missingCostItems: [] });
      const oat = w.groups.milk.modifiers[0], shot = w.groups.extras.modifiers[0];
      expect(oat.cost).toBe("0.7500"); // 1.20 − 0.45
      expect(shot.recipe[0]).toMatchObject({ unitLabel: "shot", qtyEntered: "1.0000", qtyBase: "18.0000" });
      const combo = await comboCost(w.owner, { variantId: large.id, modifierIds: [oat.id, shot.id] });
      expect(combo).toEqual({ price: "4.5000", cost: "2.1800", margin: "51.6", missingCostItems: [] });
    });
  });

  it("changing deduct_stock is audited (product, variant, modifier)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const p = await getProduct(w.owner, w.latte.id);
      await saveProduct(w.owner, w.latte.id, {
        ...w.latteInput, deductStock: false,
        variants: w.latteInput.variants.map((v, i) => ({ ...v, id: p.variants[i].id, deductStock: i === 1 ? true : null })),
      });
      const g = w.groups.milk;
      await saveModifierGroup(w.owner, g.id, { name: g.name, minSelect: 0, maxSelect: 1, modifiers: [{ id: g.modifiers[0].id, name: "Oat milk", priceDelta: "0.50", deductStock: false, recipe: [] }] });
      const logs = await tx.select().from(auditLog).where(eq(auditLog.action, "menu.deduct_stock.change"));
      expect(logs.map((l) => [l.entity, l.before, l.after]).sort()).toEqual([
        ["modifier", { deductStock: true }, { deductStock: false }],
        ["product", { deductStock: true }, { deductStock: false }],
        ["product_variant", { deductStock: null }, { deductStock: true }],
      ].sort());
      const after = await getProduct(w.owner, w.latte.id);
      expect(after.deductStock).toBe(false);
      expect(after.variants.map((v) => v.deductStock)).toEqual([null, true]);
      // The recipe is kept, so the cost still shows.
      expect(after.variants[1].cost).toBe("0.9800");
    });
  });
});

describe("products", () => {
  it("lists products with badges: no stock deduction, no recipe", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await saveProduct(w.owner, null, { name: "Hot water", kitchenStation: "none", deductStock: false, modifierGroupIds: [], variants: [{ name: "Cup", price: "0", deductStock: null, isDefault: true, recipe: [] }] });
      const rows = await listProducts(w.owner);
      expect(rows.map((r) => [r.name, r.noStockDeduction, r.hasRecipe, r.minPrice, r.maxPrice, r.variantCount])).toEqual([
        ["Hot water", true, false, "0.0000", "0.0000", 1],
        ["Latte", false, true, "2.8000", "3.5000", 2],
      ]);
      await createMenuCategory(w.owner, { name: "Tea", sortOrder: 2 });
      expect((await listMenuCategories(w.owner)).map((c) => [c.name, c.productCount])).toEqual([["Coffee", 1], ["Tea", 0]]);
    });
  });

  it("archives variants removed from the form and keeps exactly one default", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const p = await getProduct(w.owner, w.latte.id);
      await saveProduct(w.owner, w.latte.id, { ...w.latteInput, variants: [{ ...w.latteInput.variants[1], id: p.variants[1].id, isDefault: true }] });
      const after = await getProduct(w.owner, w.latte.id);
      expect(after.variants.map((v) => [v.name, v.isDefault])).toEqual([["Large", true]]);
      const [archived] = await tx.select().from(productVariants).where(eq(productVariants.id, p.variants[0].id));
      expect(archived.isActive).toBe(false);
      // Recipe of the kept variant was replaced, not duplicated.
      expect(await tx.select().from(recipeLines).where(eq(recipeLines.variantId, p.variants[1].id))).toHaveLength(3);
    });
  });

  it("validates variants, recipes and references", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const base = { ...w.latteInput, name: "Mocha" };
      const v = w.latteInput.variants[0];
      await expect(saveProduct(w.owner, null, { ...base, variants: [] })).rejects.toThrow(ValidationError);
      await expect(saveProduct(w.owner, null, { ...base, variants: [{ ...v, isDefault: false }] })).rejects.toThrow(/default/);
      await expect(saveProduct(w.owner, null, { ...base, variants: [v, { ...v, name: "Regular" }] })).rejects.toThrow(/default|different/);
      await expect(saveProduct(w.owner, null, { ...base, variants: [{ ...v, recipe: [{ itemId: w.milk.id, unitKey: "base", qty: "-5" }] }] })).rejects.toThrow(/greater than 0/);
      await expect(saveProduct(w.owner, null, { ...base, variants: [{ ...v, recipe: [{ itemId: w.milk.id, unitKey: "kg", qty: "1" }] }] })).rejects.toThrow(/unit/i);
      await expect(saveProduct(w.owner, null, { ...w.latteInput, name: "latte" })).rejects.toThrow(ConflictError);

      const [other] = await tx.insert(organizations).values({ name: "Other" }).returning();
      const foreignItem = await createItem(tx, other.id, { name: "Foreign", base: "g" });
      const [foreignGroup] = await tx.insert(modifierGroups).values({ orgId: other.id, name: "Foreign group" }).returning();
      await expect(saveProduct(w.owner, null, { ...base, variants: [{ ...v, recipe: [{ itemId: foreignItem.id, unitKey: "base", qty: "1" }] }] })).rejects.toThrow(ValidationError);
      await expect(saveProduct(w.owner, null, { ...base, modifierGroupIds: [foreignGroup.id] })).rejects.toThrow(ValidationError);
      const foreignCat = await tx.insert(organizations).values({ name: "x" }).returning().then(async ([o]) => {
        const { menuCategories } = await import("@/db/schema");
        return (await tx.insert(menuCategories).values({ orgId: o.id, name: "Theirs" }).returning())[0];
      });
      await expect(saveProduct(w.owner, null, { ...base, categoryId: foreignCat.id })).rejects.toThrow(ValidationError);
      // Another org's product id can't be edited.
      await expect(getProduct(w.owner, foreignGroup.id)).rejects.toThrow(/not found/i);
    });
  });

  it("inactive items can't go into a new recipe", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.update(items).set({ isActive: false }).where(eq(items.id, w.oat.id));
      await expect(saveProduct(w.owner, null, { ...w.latteInput, name: "Oat latte", variants: [{ ...w.latteInput.variants[0], recipe: [{ itemId: w.oat.id, unitKey: "base", qty: "200" }] }] })).rejects.toThrow(/inactive/i);
    });
  });
});

describe("modifier groups", () => {
  it("min/max rules: min ≤ max, max ≥ 1; required follows min", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(saveModifierGroup(w.owner, null, { name: "Bad", minSelect: 2, maxSelect: 1, modifiers: [] })).rejects.toThrow(ValidationError);
      await expect(saveModifierGroup(w.owner, null, { name: "Bad", minSelect: 0, maxSelect: 0, modifiers: [] })).rejects.toThrow(ValidationError);
      await expect(saveModifierGroup(w.owner, null, { name: "Bad", minSelect: 2, maxSelect: 3, modifiers: [{ name: "Only one", priceDelta: "0", deductStock: true, recipe: [] }] })).rejects.toThrow(/at least 2/);
      const size = await saveModifierGroup(w.owner, null, { name: "Sugar", minSelect: 1, maxSelect: 1, modifiers: [{ name: "No sugar", priceDelta: "0", deductStock: true, recipe: [] }, { name: "Normal", priceDelta: "0", deductStock: true, recipe: [] }] });
      expect(size.isRequired).toBe(true);
      const list = await listModifierGroups(w.owner);
      expect(list.map((g) => [g.name, g.modifierCount, g.productCount])).toEqual([["Extras", 1, 1], ["Milk", 1, 1], ["Sugar", 2, 0]]);
    });
  });

  it("removed modifiers are archived", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const g = w.groups.extras;
      await saveModifierGroup(w.owner, g.id, { name: "Extras", minSelect: 0, maxSelect: 3, modifiers: [{ name: "Syrup", priceDelta: "0.30", deductStock: true, recipe: [] }] });
      const after = await getModifierGroup(w.owner, g.id);
      expect(after.modifiers.map((m) => m.name)).toEqual(["Syrup"]);
    });
  });
});

describe("branch prices", () => {
  it("overrides price and availability at one branch only", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const large = (await getProduct(w.owner, w.latte.id)).variants[1];
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: large.id, price: "3.75", isAvailable: false });
      const p = await getProduct(w.owner, w.latte.id);
      expect(p.variants[1]).toMatchObject({ price: "3.5000", branchPrice: "3.7500", effectivePrice: "3.7500", isAvailable: false, margin: "73.9" });
      expect((await comboCost(w.owner, { variantId: large.id, modifierIds: [] })).price).toBe("3.7500");
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: large.id, price: null, isAvailable: true });
      expect((await getProduct(w.owner, w.latte.id)).variants[1]).toMatchObject({ branchPrice: null, effectivePrice: "3.5000", isAvailable: true });
      const [log] = await tx.select().from(auditLog).where(and(eq(auditLog.action, "menu.branch_price.set"), eq(auditLog.entityId, large.id)));
      expect(log.branchId).toBe(w.b1.id);
    });
  });
});

describe("permissions", () => {
  it("cashiers can view the menu without costs but can't change it", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      const p = await getProduct(cashier, w.latte.id);
      expect(p.variants[1]).toMatchObject({ cost: null, margin: null });
      expect((await comboCost(cashier, { variantId: p.variants[1].id, modifierIds: [] })).cost).toBeNull();
      await expect(saveProduct(cashier, w.latte.id, w.latteInput)).rejects.toThrow(ForbiddenError);
      await expect(saveModifierGroup(cashier, null, { name: "X", minSelect: 0, maxSelect: 1, modifiers: [] })).rejects.toThrow(ForbiddenError);
      await expect(createMenuCategory(cashier, { name: "Tea" })).rejects.toThrow(ForbiddenError);
      await expect(updateMenuCategory(cashier, w.cat.id, { name: "Tea" })).rejects.toThrow(ForbiddenError);
      await expect(setBranchVariantPrice(cashier, { branchId: w.b1.id, variantId: p.variants[1].id, price: "1", isAvailable: true })).rejects.toThrow(ForbiddenError);
    });
  });

  it("refuses branch prices at a branch the user isn't in, and users without menu.view", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const large = (await getProduct(w.owner, w.latte.id)).variants[1];
      await expect(setBranchVariantPrice(w.owner, { branchId: w.b2.id, variantId: large.id, price: "1", isAvailable: true })).rejects.toThrow(ForbiddenError);
      const b2 = await w.ctxFor(w.users.b2user);
      await expect(setBranchVariantPrice(b2, { branchId: w.b1.id, variantId: large.id, price: "1", isAvailable: true })).rejects.toThrow(ForbiddenError);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const noMenu = await createRole(w.owner, { name: "Stock only", permissions: [{ key: "inventory.view" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: noMenu.id });
      const stockOnly = await w.ctxFor(w.users.cashier);
      await expect(listProducts(stockOnly)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("review fixes", () => {
  it("re-saving a product after its ingredient is retired and its unit renamed keeps the quantities (#1)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { listRecipeItems } = await import("@/lib/queries/menu");
      const { rehydrateRecipeLine } = await import("@/lib/domain/recipe");
      // Extra shot = 1 "shot" (18 g). Retire beans and rename the unit.
      await tx.update(items).set({ isActive: false }).where(eq(items.id, w.beans.id));
      await tx.update(itemUnits).set({ name: "single shot" }).where(eq(itemUnits.id, w.shot.id));
      const g = await getModifierGroup(w.owner, w.groups.extras.id);
      const editorItems = await listRecipeItems(w.owner, { includeItemIds: g.modifiers.flatMap((m) => m.recipe.map((r) => r.itemId)) });
      expect(editorItems.find((i) => i.id === w.beans.id)).toMatchObject({ isActive: false });
      await saveModifierGroup(w.owner, g.id, {
        name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
        modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta, deductStock: m.deductStock, recipe: m.recipe.map((r) => rehydrateRecipeLine(r, editorItems)) })),
      });
      const [line] = await tx.select().from(recipeLines).where(eq(recipeLines.modifierId, g.modifiers[0].id));
      expect(line.qtyBase).toBe("18.0000");
    });
  });

  it("setting an image doesn't change the product's updated_at, so the open form isn't reset (#2)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { setProductImageKey } = await import("@/lib/services/menu");
      const before = (await getProduct(w.owner, w.latte.id)).updatedAt;
      await new Promise((r) => setTimeout(r, 10));
      await setProductImageKey(w.owner, w.latte.id, `products/${w.latte.id}/abc.png`);
      const after = await getProduct(w.owner, w.latte.id);
      expect(after.imageKey).toBe(`products/${w.latte.id}/abc.png`);
      expect(after.updatedAt.getTime()).toBe(before.getTime());
    });
  });
});
