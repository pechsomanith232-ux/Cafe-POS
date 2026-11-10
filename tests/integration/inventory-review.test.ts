import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, stockLevels, stockMovements } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getAdjustment, getCount, listItems, lowStock } from "@/lib/queries/inventory";
import {
  cancelCount,
  createAdjustment,
  createCategory,
  createCount,
  createItem,
  deleteAdjustment,
  postAdjustment,
  postCount,
  saveCountLines,
  setOpeningStock,
  setReorderLevel,
  updateAdjustment,
  updateCategory,
  updateItem,
} from "@/lib/services/inventory";
import { applyStockMovement, applyStockMovements } from "@/lib/services/stock";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem as createRawItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

const milkInput = { name: "Milk", baseUnitCode: "ml" as const, units: [{ name: "case", factor: "12000", isPurchaseDefault: true, isCountDefault: false }] };

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const milk = await createItem(owner, milkInput);
  const cups = await createItem(owner, { name: "Cups", baseUnitCode: "pcs", units: [] });
  return { ...w, owner, milk, cups, caseKey: `iu:${milk.units[0].id}` };
}

describe("review #1: multi-item movements lock in a fixed order (no deadlocks)", () => {
  it("applyStockMovements applies items sorted by id whatever the input order", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const ids = [w.milk.id, w.cups.id].sort();
      const inputs = [...ids].reverse().map((itemId) => ({ branchId: w.b1.id, itemId, type: "opening" as const, qtyBase: "10", unitCost: "1" }));
      await applyStockMovements(tx, inputs);
      const rows = await tx.select().from(stockMovements).where(inArray(stockMovements.itemId, ids)).orderBy(asc(stockMovements.seq));
      expect(rows.map((r) => r.itemId)).toEqual(ids);
    });
  });

  it("postAdjustment uses that order", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const ids = [w.milk.id, w.cups.id].sort();
      const adj = await createAdjustment(w.owner, {
        branchId: w.b1.id, reasonCode: "correction",
        lines: [...ids].reverse().map((itemId) => ({ itemId, unitKey: "base", qty: "5", unitCost: "1" })),
      });
      await postAdjustment(w.owner, adj.id);
      const rows = await tx.select().from(stockMovements).where(eq(stockMovements.refId, adj.id)).orderBy(asc(stockMovements.seq));
      expect(rows.map((r) => r.itemId)).toEqual(ids);
    });
  });
});

describe("review #2: counts can't double-apply corrections", () => {
  it("only one count can be in progress per branch", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await createCount(w.owner, { branchId: w.b1.id });
      await expect(createCount(w.owner, { branchId: w.b1.id })).rejects.toThrow(/already in progress/);
    });
  });

  it("posting sets stock to the counted amount even if stock moved after the count started", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await setOpeningStock(w.owner, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "12000", unitCost: "0.0015" });
      const count = await createCount(w.owner, { branchId: w.b1.id });
      // A sale during the day after the count started.
      await applyStockMovement(tx, { branchId: w.b1.id, itemId: w.milk.id, type: "sale", qtyBase: "-1000" });
      await saveCountLines(w.owner, count.id, [{ itemId: w.milk.id, unitKey: "base", qty: "11500" }]);
      await postCount(w.owner, count.id);
      const [lvl] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, w.milk.id));
      expect(lvl.qtyOnHand).toBe("11500.0000");
      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.refId, count.id));
      expect(mv.qtyBase).toBe("500.0000");
    });
  });
});

describe("review #5: exact inbound cost totals", () => {
  it("opening 10 cases at $20 records exactly $200", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await setOpeningStock(w.owner, { branchId: w.b1.id, itemId: w.milk.id, unitKey: w.caseKey, qty: "10", unitCost: "20" });
      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.itemId, w.milk.id));
      expect(mv.totalCost).toBe("200.0000");
    });
  });
});

describe("review minor: quantities are normalised to 4 dp before maths", () => {
  it("stored qty_base and running balance agree", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await applyStockMovement(tx, { branchId: w.b1.id, itemId: w.cups.id, type: "opening", qtyBase: "10", unitCost: "1" });
      const r = await applyStockMovement(tx, { branchId: w.b1.id, itemId: w.cups.id, type: "sale", qtyBase: "-0.33335" });
      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.id, r.movementId));
      expect(Number(mv.qtyAfter)).toBeCloseTo(10 + Number(mv.qtyBase), 10);
    });
  });
});

describe("review #6: permission-denied and wrong-branch cases", () => {
  it("rejects users without inventory.manage_items", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      const cat = await createCategory(w.owner, { name: "Dairy" });
      await expect(createCategory(cashier, { name: "X" })).rejects.toThrow(ForbiddenError);
      await expect(updateCategory(cashier, cat.id, { name: "Y" })).rejects.toThrow(ForbiddenError);
      await expect(updateItem(cashier, w.milk.id, milkInput)).rejects.toThrow(ForbiddenError);
      await expect(setReorderLevel(cashier, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "1" })).rejects.toThrow(ForbiddenError);
      await expect(setOpeningStock(cashier, { branchId: w.b1.id, itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" })).rejects.toThrow(ForbiddenError);
    });
  });

  it("rejects documents and settings at a branch the user isn't in", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const b2 = await w.ctxFor(w.users.b2user); // Manager at B2 only
      const adj = await createAdjustment(b2, { branchId: w.b2.id, reasonCode: "waste", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "-1" }] });
      const count = await createCount(b2, { branchId: w.b2.id });
      const owner = w.owner; // B1 only
      const line = { itemId: w.milk.id, unitKey: "base", qty: "-1" };
      await expect(setReorderLevel(owner, { branchId: w.b2.id, itemId: w.milk.id, unitKey: "base", qty: "1" })).rejects.toThrow(ForbiddenError);
      await expect(createAdjustment(owner, { branchId: w.b2.id, reasonCode: "waste", lines: [line] })).rejects.toThrow(ForbiddenError);
      await expect(updateAdjustment(owner, adj.id, { branchId: w.b2.id, reasonCode: "waste", lines: [line] })).rejects.toThrow(ForbiddenError);
      await expect(postAdjustment(owner, adj.id)).rejects.toThrow(ForbiddenError);
      await expect(deleteAdjustment(owner, adj.id)).rejects.toThrow(ForbiddenError);
      await expect(getAdjustment(owner, adj.id)).rejects.toThrow();
      await expect(createCount(owner, { branchId: w.b2.id })).rejects.toThrow(ForbiddenError);
      await expect(saveCountLines(owner, count.id, [])).rejects.toThrow(ForbiddenError);
      await expect(postCount(owner, count.id)).rejects.toThrow(ForbiddenError);
      await expect(cancelCount(owner, count.id)).rejects.toThrow(ForbiddenError);
      await expect(getCount(owner, count.id)).rejects.toThrow();
      await expect(listItems(owner, { branchId: w.b2.id })).rejects.toThrow(ForbiddenError);
      await expect(lowStock(owner, w.b2.id)).rejects.toThrow(ForbiddenError);
    });
  });

  it("rejects posting or counting without the right permission", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const adj = await createAdjustment(w.owner, { branchId: w.b1.id, reasonCode: "waste", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "-1" }] });
      const count = await createCount(w.owner, { branchId: w.b1.id });
      const cashier = await w.ctxFor(w.users.cashier);
      await expect(postAdjustment(cashier, adj.id)).rejects.toThrow(ForbiddenError);
      await expect(saveCountLines(cashier, count.id, [])).rejects.toThrow(ForbiddenError);
      await expect(postCount(cashier, count.id)).rejects.toThrow(ForbiddenError);
    });
  });

  it("rejects an adjustment line with another organization's item", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const [other] = await tx.insert(organizations).values({ name: "Other" }).returning();
      const foreign = await createRawItem(tx, other.id, { name: "Foreign", base: "pcs" });
      await expect(
        createAdjustment(w.owner, { branchId: w.b1.id, reasonCode: "waste", lines: [{ itemId: foreign.id, unitKey: "base", qty: "-1" }] }),
      ).rejects.toThrow(/not found/i);
    });
  });

  it("validates tiny quantities up front", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(
        createAdjustment(w.owner, { branchId: w.b1.id, reasonCode: "waste", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "-0.00001" }] }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
