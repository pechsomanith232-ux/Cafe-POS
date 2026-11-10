import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { items, stockMovements, units } from "@/db/schema";
import { closeTestDb, dbErrorMessage, testDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("inventory schema", () => {
  it("has the global units pcs, ml, L, g, kg with fixed factors (plan §4.1)", async () => {
    const rows = await testDb.select().from(units);
    const byCode = Object.fromEntries(rows.map((u) => [u.code, u]));
    expect(Object.keys(byCode).sort()).toEqual(["L", "g", "kg", "ml", "pcs"]);
    expect(byCode.L).toMatchObject({ dimension: "volume", factorToDimensionBase: "1000.000000" });
    expect(byCode.kg).toMatchObject({ dimension: "mass", factorToDimensionBase: "1000.000000" });
    expect(byCode.pcs.dimension).toBe("count");
  });

  it("stock_movements is append-only: UPDATE and DELETE fail (Phase 2 acceptance)", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const [ml] = await tx.select().from(units).where(eq(units.code, "ml"));
      const [item] = await tx.insert(items).values({ orgId: w.org.id, name: "Milk", baseUnitId: ml.id }).returning();
      const [mv] = await tx
        .insert(stockMovements)
        .values({ branchId: w.b1.id, itemId: item.id, movementType: "opening", qtyBase: "10", unitCost: "1", totalCost: "10", qtyAfter: "10", avgCostAfter: "1" })
        .returning();
      await tx.execute(sql`savepoint s1`);
      expect(await dbErrorMessage(tx.update(stockMovements).set({ qtyBase: "99" }).where(eq(stockMovements.id, mv.id)))).toMatch(/append-only/);
      await tx.execute(sql`rollback to savepoint s1`);
      expect(await dbErrorMessage(tx.delete(stockMovements).where(eq(stockMovements.id, mv.id)))).toMatch(/append-only/);
    });
  });
});
