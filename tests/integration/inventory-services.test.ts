import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, stockLevels, stockMovements } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getItem, listItems, listMovements, lowStock } from "@/lib/queries/inventory";
import {
  cancelCount,
  createAdjustment,
  createCategory,
  createCount,
  createItem,
  postAdjustment,
  postCount,
  saveCountLines,
  setOpeningStock,
  setReorderLevel,
  updateItem,
} from "@/lib/services/inventory";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

const milkInput = {
  name: "Fresh Milk",
  sku: "MILK-1",
  baseUnitCode: "ml" as const,
  itemType: "ingredient" as const,
  units: [
    { name: "bottle", factor: "1000", isPurchaseDefault: false, isCountDefault: true },
    { name: "case", factor: "12000", isPurchaseDefault: true, isCountDefault: false },
  ],
};

async function worldWithMilk(tx: TestTx) {
  const w = await createWorld(tx);
  const ownerCtx = await w.ctxFor(w.users.owner);
  const milk = await createItem(ownerCtx, milkInput);
  const unitKey = (name: string) => `iu:${milk.units.find((u) => u.name === name)!.id}`;
  return { ...w, ownerCtx, milk, unitKey };
}

describe("items", () => {
  it("creates an item with packaging units and audits it", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      expect(w.milk.units.map((u) => [u.name, u.factorToBase])).toEqual([["bottle", "1000.000000"], ["case", "12000.000000"]]);
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "item.create"))).toHaveLength(1);
    });
  });

  it("rejects a cashier, a duplicate SKU and a bad unit factor", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await expect(createItem(await w.ctxFor(w.users.cashier), { ...milkInput, sku: "X" })).rejects.toThrow(ForbiddenError);
      await expect(createItem(w.ownerCtx, { ...milkInput, name: "Other", sku: "milk-1" })).rejects.toThrow(ConflictError);
      await expect(createItem(w.ownerCtx, { ...milkInput, sku: "Y", units: [{ name: "box", factor: "0", isPurchaseDefault: false, isCountDefault: false }] })).rejects.toThrow(ValidationError);
    });
  });

  it("updates units, but the base unit is fixed once stock has moved", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      const bottle = w.milk.units.find((u) => u.name === "bottle")!;
      await updateItem(w.ownerCtx, w.milk.id, { ...milkInput, units: [{ id: bottle.id, name: "bottle 1L", factor: "1000", isPurchaseDefault: true, isCountDefault: true }] });
      const after = await getItem(w.ownerCtx, w.milk.id);
      expect(after.units.map((u) => u.name)).toEqual(["bottle 1L"]);
      expect(after.units[0].id).toBe(bottle.id);

      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "100", unitCost: "0.002" });
      await expect(updateItem(w.ownerCtx, w.milk.id, { ...milkInput, baseUnitCode: "L" })).rejects.toThrow(/base unit/);
    });
  });

  it("has a category list", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      const cat = await createCategory(w.ownerCtx, { name: "Dairy" });
      await updateItem(w.ownerCtx, w.milk.id, { ...milkInput, categoryId: cat.id });
      expect((await getItem(w.ownerCtx, w.milk.id)).categoryId).toBe(cat.id);
      await expect(createCategory(w.ownerCtx, { name: "dairy" })).rejects.toThrow(ConflictError);
    });
  });
});

describe("opening stock and reorder levels", () => {
  it("records opening stock entered in cases at a cost per case", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: w.unitKey("case"), qty: "2", unitCost: "18" });
      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.itemId, w.milk.id));
      expect(mv).toMatchObject({ movementType: "opening", qtyBase: "24000.0000", unitCost: "0.001500", enteredUnitLabel: "case", enteredQty: "2.0000" });
      await expect(
        setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }),
      ).rejects.toThrow(/already/);
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "stock.opening"))).toHaveLength(1);
    });
  });

  it("refuses opening stock at a branch the user doesn't belong to", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await expect(
        setOpeningStock(w.ownerCtx, { branchId: w.b2.id, itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("stores the reorder level in base units and lists low stock", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await setReorderLevel(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: w.unitKey("bottle"), qty: "5" });
      const [lvl] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, w.milk.id));
      expect(lvl.reorderLevel).toBe("5000.0000");
      // No stock yet → low.
      let low = await lowStock(w.ownerCtx, w.b1.id);
      expect(low.count).toBe(1);
      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "6000", unitCost: "0.002" });
      low = await lowStock(w.ownerCtx, w.b1.id);
      expect(low.count).toBe(0);
      expect((await listItems(w.ownerCtx, { branchId: w.b1.id, lowOnly: true })).length).toBe(0);
    });
  });
});

describe("stock adjustments", () => {
  it("draft → post: waste goes out at the average cost, with the reason", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "12000", unitCost: "0.0015" });
      const adj = await createAdjustment(w.ownerCtx, {
        branchId: w.b1.id, reasonCode: "waste", note: "spilled jug",
        lines: [{ itemId: w.milk.id, unitKey: "base", qty: "-800" }],
      });
      expect(await tx.select().from(stockMovements).where(eq(stockMovements.movementType, "waste"))).toHaveLength(0);
      await postAdjustment(w.ownerCtx, adj.id);
      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.movementType, "waste"));
      expect(mv).toMatchObject({ qtyBase: "-800.0000", unitCost: "0.001500", totalCost: "-1.2000", refType: "stock_adjustment", refId: adj.id });
      expect(mv.reason).toContain("spilled jug");
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "stock_adjustment.post"));
      expect(log.reason).toContain("waste");
      await expect(postAdjustment(w.ownerCtx, adj.id)).rejects.toThrow(/already posted/);
    });
  });

  it("adds stock with an optional cost per entered unit", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      const adj = await createAdjustment(w.ownerCtx, {
        branchId: w.b1.id, reasonCode: "correction",
        lines: [{ itemId: w.milk.id, unitKey: w.unitKey("bottle"), qty: "2", unitCost: "1.5" }],
      });
      await postAdjustment(w.ownerCtx, adj.id);
      const [lvl] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, w.milk.id));
      expect(lvl).toMatchObject({ qtyOnHand: "2000.0000", avgCost: "0.001500" });
    });
  });

  it("needs inventory.adjust, a note for 'other', and non-zero lines", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      const line = { itemId: w.milk.id, unitKey: "base", qty: "-1" };
      await expect(createAdjustment(await w.ctxFor(w.users.cashier), { branchId: w.b1.id, reasonCode: "waste", lines: [line] })).rejects.toThrow(ForbiddenError);
      await expect(createAdjustment(w.ownerCtx, { branchId: w.b1.id, reasonCode: "other", lines: [line] })).rejects.toThrow(ValidationError);
      await expect(createAdjustment(w.ownerCtx, { branchId: w.b1.id, reasonCode: "waste", lines: [{ ...line, qty: "0" }] })).rejects.toThrow(ValidationError);
    });
  });
});

describe("stock counts", () => {
  it("snapshot → enter counted (any unit) → post differences at average cost", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      const owner = w.ownerCtx;
      const cups = await createItem(owner, { name: "Cups", baseUnitCode: "pcs", itemType: "packaging", units: [] });
      await setOpeningStock(owner, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "12000", unitCost: "0.0015" });
      await setOpeningStock(owner, { branchId: w.b1.id, itemId: cups.id, unitKey: "base", qty: "100", unitCost: "0.05" });

      const count = await createCount(owner, { branchId: w.b1.id });
      expect(count.lines.find((l) => l.itemId === w.milk.id)?.systemQty).toBe("12000.0000");
      // A sale happens during the count; the diff is still against the snapshot.
      await saveCountLines(owner, count.id, [{ itemId: w.milk.id, unitKey: w.unitKey("bottle"), qty: "11.5" }]);
      await postCount(owner, count.id);

      const mvs = await tx.select().from(stockMovements).where(and(eq(stockMovements.movementType, "count_adjustment"), eq(stockMovements.refId, count.id)));
      expect(mvs).toHaveLength(1); // cups not counted → no change
      expect(mvs[0]).toMatchObject({ itemId: w.milk.id, qtyBase: "-500.0000", unitCost: "0.001500" });
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "stock_count.post"))).toHaveLength(1);
      await expect(postCount(owner, count.id)).rejects.toThrow(/already/);
    });
  });

  it("needs inventory.count and can be cancelled", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await expect(createCount(await w.ctxFor(w.users.cashier), { branchId: w.b1.id })).rejects.toThrow(ForbiddenError);
      const count = await createCount(w.ownerCtx, { branchId: w.b1.id });
      await cancelCount(w.ownerCtx, count.id);
      await expect(saveCountLines(w.ownerCtx, count.id, [])).rejects.toThrow(/not a draft/);
    });
  });
});

describe("inventory queries", () => {
  it("hides costs from roles without inventory.view_cost", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "1000", unitCost: "0.002" });
      const cashierCtx = await w.ctxFor(w.users.cashier);
      const [asCashier] = await listItems(cashierCtx, { branchId: w.b1.id });
      expect(asCashier.qtyOnHand).toBe("1000.0000");
      expect(asCashier.avgCost).toBeNull();
      const [asOwner] = await listItems(w.ownerCtx, { branchId: w.b1.id });
      expect(asOwner.avgCost).toBe("0.002000");
      const mv = await listMovements(cashierCtx, { branchId: w.b1.id });
      expect(mv.rows[0].unitCost).toBeNull();
    });
  });

  it("shows movement history with a running balance, scoped to the user's branches", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithMilk(tx);
      await setOpeningStock(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "1000", unitCost: "0.002" });
      const adj = await createAdjustment(w.ownerCtx, { branchId: w.b1.id, reasonCode: "waste", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "-100" }] });
      await postAdjustment(w.ownerCtx, adj.id);
      const { rows } = await listMovements(w.ownerCtx, { branchId: w.b1.id, itemId: w.milk.id });
      expect(rows.map((r) => [r.movementType, r.qtyAfter])).toEqual([["waste", "900.0000"], ["opening", "1000.0000"]]);
      await expect(listMovements(w.ownerCtx, { branchId: w.b2.id })).rejects.toThrow(ForbiddenError);
    });
  });
});
