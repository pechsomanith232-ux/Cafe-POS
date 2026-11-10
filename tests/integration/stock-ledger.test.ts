import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { branches, items, organizations, stockLevels, stockMovements } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { applyStockMovement } from "@/lib/services/stock";
import { cleanupCommitted, closeTestDb, testDb, withRollback } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("applyStockMovement", () => {
  it("reproduces the plan §4.2 table through the database", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const milk = await createItem(tx, w.org.id, { name: "Fresh Milk", base: "ml" });
      const base = { branchId: w.b1.id, itemId: milk.id, createdBy: w.users.owner };

      const r1 = await applyStockMovement(tx, { ...base, type: "purchase", qtyBase: "12000", unitCost: "0.0015", enteredUnitLabel: "case", enteredQty: "1" });
      const r2 = await applyStockMovement(tx, { ...base, type: "sale", qtyBase: "-200" });
      const r3 = await applyStockMovement(tx, { ...base, type: "purchase", qtyBase: "12000", unitCost: "0.00175" });
      const r4 = await applyStockMovement(tx, { ...base, type: "waste", qtyBase: "-800", reason: "spilled" });

      expect([r1, r2, r3, r4].map((r) => [r.qtyAfter, r.avgAfter])).toEqual([
        ["12000.0000", "0.001500"],
        ["11800.0000", "0.001500"],
        ["23800.0000", "0.001626"],
        ["23000.0000", "0.001626"],
      ]);
      const [level] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, milk.id));
      expect(level).toMatchObject({ qtyOnHand: "23000.0000", avgCost: "0.001626", lastCost: "0.001750" });

      const rows = await tx.select().from(stockMovements).where(eq(stockMovements.itemId, milk.id)).orderBy(asc(stockMovements.createdAt), asc(stockMovements.qtyAfter));
      expect(rows).toHaveLength(4);
      const waste = rows.find((r) => r.movementType === "waste")!;
      expect(waste).toMatchObject({ unitCost: "0.001626", totalCost: "-1.3008", reason: "spilled", createdBy: w.users.owner });
      expect(rows.find((r) => r.enteredUnitLabel === "case")?.enteredQty).toBe("1.0000");
    });
  });

  it("creates the stock level row on first movement, per branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const beans = await createItem(tx, w.org.id, { name: "Beans", base: "g" });
      await applyStockMovement(tx, { branchId: w.b2.id, itemId: beans.id, type: "opening", qtyBase: "1000", unitCost: "0.02" });
      const levels = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, beans.id));
      expect(levels).toHaveLength(1);
      expect(levels[0]).toMatchObject({ branchId: w.b2.id, qtyOnHand: "1000.0000" });
    });
  });

  it("allows negative stock by default but can block it", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const cups = await createItem(tx, w.org.id, { name: "Cups", base: "pcs" });
      const r = await applyStockMovement(tx, { branchId: w.b1.id, itemId: cups.id, type: "sale", qtyBase: "-3" });
      expect(r.qtyAfter).toBe("-3.0000");
      await expect(
        applyStockMovement(tx, { branchId: w.b1.id, itemId: cups.id, type: "sale", qtyBase: "-1", blockNegative: true }),
      ).rejects.toThrow(ValidationError);
    });
  });

  it("refuses an item from another organization's branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const [otherOrg] = await tx.insert(organizations).values({ name: "Other" }).returning();
      const foreign = await createItem(tx, otherOrg.id, { name: "Foreign", base: "pcs" });
      await expect(
        applyStockMovement(tx, { branchId: w.b1.id, itemId: foreign.id, type: "opening", qtyBase: "1", unitCost: "1" }),
      ).rejects.toThrow(/not found/i);
    });
  });
});

describe("applyStockMovement under concurrency (Phase 2 acceptance)", () => {
  it("20 parallel sales on the same item give the correct final quantity", async () => {
    const ids = { org: "", branch: "", item: "" };
    try {
      const [org] = await testDb.insert(organizations).values({ name: "Concurrency Org" }).returning();
      ids.org = org.id;
      const [branch] = await testDb.insert(branches).values({ orgId: org.id, code: "CC", name: "Concurrency" }).returning();
      ids.branch = branch.id;
      const item = await createItem(testDb, org.id, { name: "Milk", base: "ml" });
      ids.item = item.id;
      await testDb.transaction((tx) => applyStockMovement(tx, { branchId: branch.id, itemId: item.id, type: "opening", qtyBase: "10000", unitCost: "0.002" }));

      await Promise.all(
        Array.from({ length: 20 }, () =>
          testDb.transaction((tx) => applyStockMovement(tx, { branchId: branch.id, itemId: item.id, type: "sale", qtyBase: "-200" })),
        ),
      );

      const [level] = await testDb.select().from(stockLevels).where(and(eq(stockLevels.branchId, branch.id), eq(stockLevels.itemId, item.id)));
      expect(level.qtyOnHand).toBe("6000.0000");
      const sales = await testDb.select().from(stockMovements).where(and(eq(stockMovements.itemId, item.id), eq(stockMovements.movementType, "sale")));
      // Every movement saw a distinct running balance: no lost updates.
      expect(new Set(sales.map((s) => s.qtyAfter)).size).toBe(20);
      expect(sales.map((s) => Number(s.qtyAfter)).sort((a, b) => a - b)[0]).toBe(6000);
    } finally {
      await cleanupCommitted(async (tx) => {
        if (ids.item) {
          await tx.delete(stockMovements).where(eq(stockMovements.itemId, ids.item));
          await tx.delete(stockLevels).where(eq(stockLevels.itemId, ids.item));
          await tx.delete(items).where(inArray(items.id, [ids.item]));
        }
        if (ids.branch) await tx.delete(branches).where(eq(branches.id, ids.branch));
        if (ids.org) await tx.delete(organizations).where(eq(organizations.id, ids.org));
      });
    }
  });
});
