import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { paymentMethods, registers } from "@/db/schema";
import { getPosMenu } from "@/lib/queries/pos";
import { setOpeningStock } from "@/lib/services/inventory";
import { saveProduct } from "@/lib/services/menu";
import { saveOrder } from "@/lib/services/orders";
import { payOrder } from "@/lib/services/payments";
import { openShift } from "@/lib/services/shifts";
import { cleanupCommitted, closeTestDb, testDb } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

// Committed data (real concurrent transactions). Integration files run one at a
// time, and everything created here is removed with TRUNCATE … CASCADE.
async function cleanup() {
  // Replica mode pauses the append-only triggers for this cleanup only (test data).
  await cleanupCommitted(async (tx) => { await tx.execute(sql`truncate table organizations, "user" cascade`); });
}

describe("review #1: concurrent payments don't deadlock", () => {
  it("two registers paying [latte, water] and [water, latte] at once both succeed, repeatedly", async () => {
    await cleanup();
    try {
      const w = await createWorld(testDb);
      const owner = await w.ctxFor(w.users.owner);
      const regs = await testDb.select().from(registers);
      const reg1 = regs.find((r) => r.branchId === w.b1.id)!;
      const [reg2] = await testDb.insert(registers).values({ branchId: w.b1.id, name: "Register 2" }).returning();
      const beans = await createItem(testDb, w.org.id, { name: "Beans", base: "g" });
      const milk = await createItem(testDb, w.org.id, { name: "Milk", base: "ml" });
      const water = await createItem(testDb, w.org.id, { name: "Water", base: "pcs" });
      for (const [it, q] of [[beans, "100000"], [milk, "100000"], [water, "1000"]] as const) {
        await setOpeningStock(owner, { branchId: w.b1.id, itemId: it.id, unitKey: "base", qty: q, unitCost: "0.01" });
      }
      const r = (itemId: string, qty: string) => ({ itemId, unitKey: "base", qty });
      // Latte uses beans + milk, Bottled uses water: paying them in opposite order locks the rows in opposite order.
      await saveProduct(owner, null, { name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [], variants: [{ name: "Cup", price: "3", deductStock: null, isDefault: true, recipe: [r(beans.id, "18"), r(milk.id, "200")] }] });
      await saveProduct(owner, null, { name: "Bottled", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1", deductStock: null, isDefault: true, recipe: [r(water.id, "1")] }] });
      const menu = await getPosMenu(owner);
      const v = (n: string) => menu.products.find((p) => p.name === n)!.variants[0].id;
      const [cash] = (await testDb.select().from(paymentMethods)).filter((m) => m.type === "cash" && m.branchId === w.b1.id);
      await openShift(owner, { branchId: w.b1.id, registerId: reg1.id, floats: [] });
      await openShift(owner, { branchId: w.b1.id, registerId: reg2.id, floats: [] });
      const make = (regId: string, names: string[]) => saveOrder(owner, { branchId: w.b1.id, registerId: regId, orderType: "takeaway", orderDiscount: null, lines: names.map((n) => ({ variantId: v(n), qty: 1, modifierIds: [], discount: null })) });
      for (let i = 0; i < 10; i++) {
        const a = await make(reg1.id, ["Latte", "Bottled"]);
        const b = await make(reg2.id, ["Bottled", "Latte"]);
        const res = await Promise.allSettled([
          payOrder(owner, a.id, { registerId: reg1.id, tenders: [{ methodId: cash.id, currencyCode: "USD", amount: "4" }], changeCurrency: "USD" }),
          payOrder(owner, b.id, { registerId: reg2.id, tenders: [{ methodId: cash.id, currencyCode: "USD", amount: "4" }], changeCurrency: "USD" }),
        ]);
        expect(res.map((x) => (x.status === "rejected" ? String(x.reason) : "ok"))).toEqual(["ok", "ok"]);
      }
    } finally {
      await cleanup();
    }
  }, 60_000);
});
