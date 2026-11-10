import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { stockLevels, stockMovements, stockTransferLines, userBranchRoles } from "@/db/schema";
import { ForbiddenError, } from "@/lib/permissions";
import { ValidationError } from "@/lib/errors";
import { getTransfer, listTransfers } from "@/lib/queries/inventory";
import { setOpeningStock } from "@/lib/services/inventory";
import { cancelTransfer, createTransfer, receiveTransfer, sendTransfer } from "@/lib/services/transfers";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  // Owner works at both branches.
  await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
  const atB1 = await w.ctxFor(w.users.owner, w.b1.id);
  const atB2 = await w.ctxFor(w.users.owner, w.b2.id);
  const milk = await createItem(tx, w.org.id, { name: "Milk", base: "ml" });
  const beans = await createItem(tx, w.org.id, { name: "Beans", base: "g" });
  await setOpeningStock(atB1, { branchId: w.b1.id, itemId: milk.id, unitKey: "base", qty: "3000", unitCost: "0.0015" });
  await setOpeningStock(atB1, { branchId: w.b1.id, itemId: beans.id, unitKey: "base", qty: "1000", unitCost: "0.0333" });
  await setOpeningStock(atB2, { branchId: w.b2.id, itemId: beans.id, unitKey: "base", qty: "1000", unitCost: "0.05" });
  return { ...w, tx, atB1, atB2, milk, beans };
}
const level = async (tx: TestTx, branchId: string, itemId: string) =>
  (await tx.select().from(stockLevels).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.itemId, itemId))))[0];

describe("stock transfers", () => {
  it("Phase 8 acceptance: value is conserved — sender value out = receiver value in + loss", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const t = await createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, note: "Weekly", lines: [
        { itemId: w.milk.id, unitKey: "base", qty: "2000" },
        { itemId: w.beans.id, unitKey: "base", qty: "300" },
      ] });
      // A draft moves nothing.
      expect((await level(tx, w.b1.id, w.milk.id)).qtyOnHand).toBe("3000.0000");
      await sendTransfer(w.atB1, t.id);
      expect((await level(tx, w.b1.id, w.milk.id)).qtyOnHand).toBe("1000.0000");
      // 50 ml spilled on the way; beans arrive in full.
      const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
      const milkLine = lines.find((l) => l.itemId === w.milk.id)!;
      const beanLine = lines.find((l) => l.itemId === w.beans.id)!;
      await receiveTransfer(w.atB2, t.id, { lines: [{ lineId: milkLine.id, qtyReceived: "1950" }, { lineId: beanLine.id, qtyReceived: "300" }] });

      const done = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
      for (const l of done) expect(Number(l.valueSent)).toBeCloseTo(Number(l.valueReceived) + Number(l.lossValue), 10);
      const m = done.find((l) => l.itemId === w.milk.id)!;
      expect([m.valueSent, m.valueReceived, m.lossValue]).toEqual(["3.0000", "2.9250", "0.0750"]);

      // Ledger: out of B1 = into B2 + loss, in money.
      const [ledger] = await tx.execute<{ out: string; inn: string }>(sql`
        select (-sum(total_cost) filter (where movement_type = 'transfer_out'))::numeric(18,4)::text as out,
               (sum(total_cost) filter (where movement_type = 'transfer_in'))::numeric(18,4)::text as inn
        from stock_movements where ref_type = 'stock_transfer' and ref_id = ${t.id}`);
      const loss = done.reduce((a, l) => a + Number(l.lossValue), 0);
      expect(Number(ledger.out)).toBeCloseTo(Number(ledger.inn) + loss, 10);

      // B2 got the milk at B1's cost; its bean average blends B1's cost in.
      expect(await level(tx, w.b2.id, w.milk.id)).toMatchObject({ qtyOnHand: "1950.0000", avgCost: "0.001500" });
      expect((await level(tx, w.b2.id, w.beans.id)).qtyOnHand).toBe("1300.0000");
      const ins = await tx.select().from(stockMovements).where(and(eq(stockMovements.refId, t.id), eq(stockMovements.movementType, "transfer_in")));
      expect(ins).toHaveLength(2);
      expect((await listTransfers(w.atB2)).find((x) => x.id === t.id)).toMatchObject({ status: "received", fromBranch: w.b1.name, toBranch: w.b2.name, lossValue: "0.0750" });
    });
  });

  it("guards: same branch, receiving more than sent, sending more than on hand, wrong side, twice", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b1.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1" }] })).rejects.toThrow(ValidationError);
      const big = await createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "5000" }] });
      await expect(sendTransfer(w.atB1, big.id)).rejects.toThrow(/only 3,?000/i);
      await cancelTransfer(w.atB1, big.id);

      const t = await createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "100" }] });
      await expect(receiveTransfer(w.atB2, t.id, { lines: [] })).rejects.toThrow(ValidationError); // not sent yet
      await sendTransfer(w.atB1, t.id);
      await expect(sendTransfer(w.atB1, t.id)).rejects.toThrow(ValidationError);
      await expect(cancelTransfer(w.atB1, t.id)).rejects.toThrow(ValidationError);
      const [l] = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
      await expect(receiveTransfer(w.atB2, t.id, { lines: [{ lineId: l.id, qtyReceived: "101" }] })).rejects.toThrow(ValidationError);
      // The sender can't receive its own transfer unless it works at the receiving branch.
      const b1only = await w.ctxFor(w.users.manager);
      await expect(receiveTransfer(b1only, t.id, { lines: [{ lineId: l.id, qtyReceived: "100" }] })).rejects.toThrow(ForbiddenError);
      // A user who can't see the sending branch can't create from it.
      await expect(createTransfer(await w.ctxFor(w.users.b2user), { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1" }] })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("review fixes", () => {
  it("'save & send' that can't send leaves no stray draft", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "5000" }] }, { send: true })).rejects.toThrow(ValidationError);
      expect(await listTransfers(w.atB1)).toHaveLength(0);
      const t = await createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "100" }] }, { send: true });
      expect(t.status).toBe("sent");
    });
  });

  it("a transfer opens by id even when it's not among the latest", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const t = await createTransfer(w.atB1, { fromBranchId: w.b1.id, toBranchId: w.b2.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1" }] });
      await tx.execute(sql`update stock_transfers set created_at = now() - interval '5 years' where id = ${t.id}`);
      expect((await getTransfer(w.atB2, t.id)).id).toBe(t.id);
      await expect(getTransfer(w.atB1, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
    });
  });
});
