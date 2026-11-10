import { count, countDistinct, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { branches, items, orders, products, shifts, stockMovements } from "@/db/schema";
import { seedDemo } from "@/db/demo-data";
import { seedDatabase } from "@/db/seed-data";
import { closeTestDb, withRollback } from "./helpers/db";

afterAll(closeTestDb);

describe("demo seed", () => {
  it("builds 2 branches, 60 items, 40 products and back-dated trading days", async () => {
    await withRollback(async (tx) => {
      await seedDatabase(tx, { orgName: "Demo", branch: { code: "B1", name: "Main" }, owner: { email: "owner@demo.local", password: "owner-pass-1", name: "Owner" } });
      const result = await seedDemo(tx, { days: 3, password: "demo-pass-1" });

      const n = async (t: typeof items | typeof products | typeof branches) =>
        (await tx.select({ n: count() }).from(t))[0].n;
      expect(await n(branches)).toBe(2);
      expect(await n(items)).toBe(60);
      expect(await n(products)).toBe(40);

      // Orders land on 4 different business days (3 back-dated + today), numbered per day.
      const [o] = await tx.select({ n: count(), days: countDistinct(orders.businessDate) }).from(orders);
      expect(o.n).toBe(result.orders);
      expect(o.days).toBe(4);
      const mismatched = await tx.select({ n: count() }).from(orders).where(sql`${orders.orderNo} not like '%-' || to_char(${orders.businessDate}, 'YYYYMMDD') || '-%'`);
      expect(mismatched[0].n).toBe(0);

      // Sale movements carry their order's paid time, not the seed's run time.
      const [late] = await tx.select({ n: count() }).from(stockMovements)
        .where(sql`${stockMovements.movementType} = 'sale' and ${stockMovements.createdAt} > now() - interval '1 hour' and ${stockMovements.refId} in (
          select l.id::text from order_lines l join orders o on o.id = l.order_id where o.business_date < (now() at time zone 'Asia/Phnom_Penh')::date)`);
      expect(late.n).toBe(0);

      // Past shifts are closed; only today's stay open (one per branch).
      expect((await tx.select({ n: count() }).from(shifts).where(eq(shifts.status, "open")))[0].n).toBe(2);
      // Nothing old is left on the kitchen screen.
      const [stuck] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from order_lines l join orders o on o.id = l.order_id
        where l.kitchen_status <> 'served' and o.business_date < (now() at time zone 'Asia/Phnom_Penh')::date`);
      expect(stuck.n).toBe(0);

      await expect(seedDemo(tx, { days: 1, password: "demo-pass-1" })).rejects.toThrow(/already has products/);
    });
  }, 300_000);
});
