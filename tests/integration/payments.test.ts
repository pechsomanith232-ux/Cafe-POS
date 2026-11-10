import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, branches, items, orderLines, paymentMethods, refundLines, registers, stockLevels, stockMovements } from "@/db/schema";
import { ApprovalRequiredError, PinError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getOrder, getPosMenu, getShiftReport } from "@/lib/queries/pos";
import { setOpeningStock } from "@/lib/services/inventory";
import { saveModifierGroup, saveProduct } from "@/lib/services/menu";
import { saveOrder, type SaveOrderInput } from "@/lib/services/orders";
import { addCashMovement, payOrder, refundOrder, saveAndPayOrder, voidOrder } from "@/lib/services/payments";
import { closeShift, openShift } from "@/lib/services/shifts";
import { setUserPin } from "@/lib/services/users";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const [reg] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
  const mk = async (name: string, base: "g" | "ml" | "pcs", qty: string, cost: string) => {
    const it = await createItem(tx, w.org.id, { name, base });
    await setOpeningStock(owner, { branchId: w.b1.id, itemId: it.id, unitKey: "base", qty, unitCost: cost });
    return it;
  };
  const beans = await mk("Beans", "g", "1000", "0.025");
  const milk = await mk("Milk", "ml", "10000", "0.0015");
  const oat = await mk("Oat", "ml", "5000", "0.004");
  const syrup = await mk("Syrup", "ml", "1000", "0.01");
  const tea = await mk("Tea leaves", "g", "500", "0.05");
  const water = await mk("Water bottle", "pcs", "24", "0.30");
  const r = (itemId: string, qty: string) => ({ itemId, unitKey: "base", qty });
  const milkGroup = await saveModifierGroup(owner, null, { name: "Milk", minSelect: 0, maxSelect: 1, modifiers: [{ name: "Oat milk", priceDelta: "0.50", deductStock: true, recipe: [r(oat.id, "200"), r(milk.id, "-200")] }] });
  const extras = await saveModifierGroup(owner, null, { name: "Extras", minSelect: 0, maxSelect: 2, modifiers: [{ name: "Syrup", priceDelta: "0.30", deductStock: false, recipe: [r(syrup.id, "15")] }] });
  await saveProduct(owner, null, { name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [milkGroup.id, extras.id], variants: [
    { name: "Regular", price: "2.80", deductStock: null, isDefault: true, recipe: [r(beans.id, "18"), r(milk.id, "200")] },
    { name: "Large", price: "3.50", deductStock: false, isDefault: false, recipe: [r(beans.id, "18"), r(milk.id, "300")] },
  ] });
  await saveProduct(owner, null, { name: "Tea", kitchenStation: "bar", deductStock: false, modifierGroupIds: [], variants: [
    { name: "Cup", price: "1.50", deductStock: null, isDefault: true, recipe: [r(tea.id, "5")] },
    { name: "Pot", price: "4.00", deductStock: true, isDefault: false, recipe: [r(tea.id, "15")] },
  ] });
  await saveProduct(owner, null, { name: "Water", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Bottle", price: "0.75", deductStock: null, isDefault: true, recipe: [r(water.id, "1")] }] });
  await saveProduct(owner, null, { name: "Cookie", kitchenStation: "kitchen", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1.00", deductStock: null, isDefault: true, recipe: [] }] });
  const menu = await getPosMenu(owner);
  const v = (p: string, n: string) => menu.products.find((x) => x.name === p)!.variants.find((x) => x.name === n)!.id;
  const mods = Object.fromEntries(menu.groups.flatMap((g) => g.modifiers.map((m) => [m.name, m.id])));
  const methods = Object.fromEntries((await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id))).map((m) => [m.type, m.id]));
  await setUserPin(owner, w.users.manager, "4321");
  const shift = await openShift(owner, { branchId: w.b1.id, registerId: reg.id, floats: [{ currencyCode: "USD", amount: "50" }, { currencyCode: "KHR", amount: "100000" }] });
  const order = (lines: SaveOrderInput["lines"]) => saveOrder(owner, { branchId: w.b1.id, registerId: reg.id, orderType: "takeaway", orderDiscount: null, lines });
  const cash = (currencyCode: string, amount: string) => ({ methodId: methods.cash, currencyCode, amount });
  const stock = async (itemId: string) => (await tx.select().from(stockLevels).where(and(eq(stockLevels.branchId, w.b1.id), eq(stockLevels.itemId, itemId))))[0];
  const moves = async (orderLineId: string) => tx.select().from(stockMovements).where(and(eq(stockMovements.refType, "order_line"), eq(stockMovements.refId, orderLineId)));
  const approval = { approverId: w.users.manager, pin: "4321" };
  return { ...w, owner, reg, shift, beans, milk, oat, syrup, tea, water, v, mods, methods, order, cash, stock, moves, approval };
}
type W = Awaited<ReturnType<typeof setup>>;
const line = (variantId: string, qty = 1, modifierIds: string[] = []) => ({ variantId, qty, modifierIds, discount: null });

describe("Phase 6 acceptance", () => {
  it("§4.4: $4.75 paid with $5, change in riel 1,000 with ≈$0.006 rounding; split $5 + 20,500 riel", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.update(branches).set({ taxRate: "0" }).where(eq(branches.id, w.b1.id));
      const o475 = await w.order([line(w.v("Cookie", "Each"), 4), line(w.v("Water", "Bottle"))]);
      expect((await getOrder(w.owner, o475.id)).total).toBe("4.7500");
      const r = await payOrder(w.owner, o475.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5")], changeCurrency: "KHR" });
      expect(r.change).toMatchObject({ currency: "KHR", amount: "1000", roundingBase: "0.0061" });
      const paid = await getOrder(w.owner, o475.id);
      expect(paid).toMatchObject({ status: "paid", paidTotal: "4.7500" });

      const o10 = await w.order([line(w.v("Cookie", "Each"), 10)]);
      const r2 = await payOrder(w.owner, o10.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5"), w.cash("KHR", "20500")], changeCurrency: "USD" });
      expect(r2.change.amount).toBe("0");
      expect((await getOrder(w.owner, o10.id)).status).toBe("paid");
    });
  });

  it("paying a latte deducts milk and beans with the correct COGS; oat milk replaces milk", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Latte", "Regular"), 2, [w.mods["Oat milk"]])]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "10")], changeCurrency: "USD" });
      const [l] = (await getOrder(w.owner, o.id)).lines;
      // ×2: beans 36 g, milk 400 − 400 = 0 (no movement), oat 400 ml.
      const mv = await w.moves(l.id);
      expect(mv.map((m) => [m.itemId, m.movementType, m.qtyBase]).sort()).toEqual([[w.beans.id, "sale", "-36.0000"], [w.oat.id, "sale", "-400.0000"]].sort());
      // COGS = 36 × 0.025 + 400 × 0.004 = 0.90 + 1.60
      const [row] = await tx.select().from(orderLines).where(eq(orderLines.id, l.id));
      expect(row).toMatchObject({ costTotal: "2.5000", costSource: "actual" });
      expect((await w.stock(w.beans.id)).qtyOnHand).toBe("964.0000");
    });
  });

  it("deduct_stock = false writes no movements and records theoretical cost; overrides work both ways; a modifier with deduct off is skipped", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([
        line(w.v("Tea", "Cup")), // product off → none written, theoretical 5 × 0.05 = 0.25
        line(w.v("Tea", "Pot")), // product off, variant ON → deducts 15 g tea
        line(w.v("Latte", "Large")), // product on, variant OFF → theoretical 18×0.025 + 300×0.0015 = 0.90
        line(w.v("Latte", "Regular"), 1, [w.mods.Syrup]), // syrup deduct off → only beans + milk
        line(w.v("Cookie", "Each")), // no recipe → cost 0, none
      ]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "20")], changeCurrency: "USD" });
      const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
      const by = (i: number) => lines.find((l) => l.sortOrder === i)!;
      expect(await w.moves(by(0).id)).toHaveLength(0);
      expect(by(0)).toMatchObject({ deductStock: false, costTotal: "0.2500", costSource: "theoretical" });
      expect((await w.moves(by(1).id)).map((m) => [m.itemId, m.qtyBase])).toEqual([[w.tea.id, "-15.0000"]]);
      expect(by(1)).toMatchObject({ deductStock: true, costTotal: "0.7500", costSource: "actual" });
      expect(await w.moves(by(2).id)).toHaveLength(0);
      expect(by(2)).toMatchObject({ deductStock: false, costTotal: "0.9000", costSource: "theoretical" });
      expect((await w.moves(by(3).id)).map((m) => m.itemId).sort()).toEqual([w.beans.id, w.milk.id].sort());
      // Actual 0.45 + 0.30; the skipped syrup's cost (15 × 0.01) is added as theoretical (ruling).
      expect(by(3)).toMatchObject({ costTotal: "0.9000", costSource: "actual" });
      expect(by(4)).toMatchObject({ costTotal: "0.0000", costSource: "none" });
      expect((await w.stock(w.syrup.id)).qtyOnHand).toBe("1000.0000");
    });
  });

  it("a partial refund with restock returns stock at the original cost", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Water", "Bottle"), 3), line(w.v("Latte", "Regular"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "10")], changeCurrency: "USD" });
      // A later purchase at a different cost moves the average…
      const { applyStockMovement } = await import("@/lib/services/stock");
      await applyStockMovement(tx, { branchId: w.b1.id, itemId: w.water.id, type: "purchase", qtyBase: "21", unitCost: "0.50" });
      const det = await getOrder(w.owner, o.id);
      const waterLine = det.lines.find((l) => l.productName === "Water")!;
      const r = await refundOrder(w.owner, o.id, {
        registerId: w.reg.id, reason: "Wrong item", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "USD" },
        lines: [{ orderLineId: waterLine.id, qty: 2, restock: true }],
      });
      expect(r.totalBase).toBe("1.5000");
      // Restock movements point at the refund LINE, so profit reports can attribute them to a product.
      const [rl] = await tx.select().from(refundLines).where(eq(refundLines.refundId, r.refundId));
      const back = (await tx.select().from(stockMovements).where(and(eq(stockMovements.refType, "refund_line"), eq(stockMovements.refId, rl.id))));
      expect(back.map((m) => [m.movementType, m.qtyBase, m.unitCost])).toEqual([["refund_restock", "2.0000", "0.300000"]]);
      const after = await getOrder(w.owner, o.id);
      expect(after).toMatchObject({ status: "partially_refunded", refundedTotal: "1.5000" });
      await expect(refundOrder(w.owner, o.id, { registerId: w.reg.id, reason: "x", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "USD" }, lines: [{ orderLineId: waterLine.id, qty: 2, restock: false }] })).rejects.toThrow(/only 1/);
    });
  });

  it("expected shift cash is correct after sales, refunds and pay-outs", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const a = await w.order([line(w.v("Cookie", "Each"), 4), line(w.v("Water", "Bottle"))]); // 4.75
      await payOrder(w.owner, a.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5")], changeCurrency: "KHR" }); // +5 USD, −1,000 KHR
      const b = await w.order([line(w.v("Cookie", "Each"), 2)]); // 2.00
      await payOrder(w.owner, b.id, { registerId: w.reg.id, tenders: [w.cash("KHR", "8200")], changeCurrency: "USD" }); // +8,200 KHR
      const c = await w.order([line(w.v("Cookie", "Each"), 3)]); // 3.00 by card: no cash
      await payOrder(w.owner, c.id, { registerId: w.reg.id, tenders: [{ methodId: w.methods.card, currencyCode: "USD", amount: "3" }], changeCurrency: "USD" });
      const bl = (await getOrder(w.owner, b.id)).lines[0];
      await refundOrder(w.owner, b.id, { registerId: w.reg.id, reason: "Burnt", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "KHR" }, lines: [{ orderLineId: bl.id, qty: 1, restock: false }] }); // −4,100 KHR
      await addCashMovement(w.owner, { registerId: w.reg.id, branchId: w.b1.id, type: "pay_out", currencyCode: "USD", amount: "2", reason: "Ice" });
      await addCashMovement(w.owner, { registerId: w.reg.id, branchId: w.b1.id, type: "pay_in", currencyCode: "KHR", amount: "10000", reason: "Change top-up" });
      const rep = await getShiftReport(w.owner, w.shift.id);
      expect(rep.cash.map((c) => [c.currencyCode, c.expected])).toEqual([["KHR", "113100.0000"], ["USD", "53.0000"]]);
      // KHR: 100,000 − 1,000 + 8,200 − 4,100 + 10,000; USD: 50 + 5 − 2
      expect(rep).toMatchObject({ orderCount: 3, salesTotal: "9.7500", refundTotal: "1.0000" });
      expect(rep.byMethod.map((m) => [m.method, m.currencyCode, m.amount])).toEqual(expect.arrayContaining([["Cash", "USD", "5.0000"], ["Cash", "KHR", "8200.0000"], ["Card", "USD", "3.0000"]]));
    });
  });
});

describe("payOrder rules", () => {
  it("refuses underpayment, held orders, paying twice; warns on negative stock; can refuse it by setting", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Water", "Bottle"), 30)]); // 30 bottles, only 24 in stock
      await expect(payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "10")], changeCurrency: "USD" })).rejects.toThrow(/Still \$12\.50 to pay/);
      await tx.update(branches).set({ settings: { allowNegativeStock: false } }).where(eq(branches.id, w.b1.id));
      await expect(payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "25")], changeCurrency: "USD" })).rejects.toThrow(/stock/i);
      await tx.update(branches).set({ settings: {} }).where(eq(branches.id, w.b1.id));
      const r = await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "25")], changeCurrency: "USD" });
      expect(r.warnings).toEqual(["Water bottle is now below zero (−6 pcs)."]);
      await expect(payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "25")], changeCurrency: "USD" })).rejects.toThrow(/already/i);
    });
  });

  it("save + pay is one transaction; a failed payment leaves the cart unsaved", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const input = { branchId: w.b1.id, registerId: w.reg.id, orderType: "takeaway" as const, orderDiscount: null, lines: [line(w.v("Cookie", "Each"), 2)] };
      await expect(saveAndPayOrder(w.owner, input, { registerId: w.reg.id, tenders: [w.cash("USD", "1")], changeCurrency: "USD" })).rejects.toThrow(ValidationError);
      const { orders } = await import("@/db/schema");
      expect(await tx.select().from(orders)).toHaveLength(0);
      const r = await saveAndPayOrder(w.owner, input, { registerId: w.reg.id, tenders: [w.cash("USD", "2")], changeCurrency: "USD" });
      expect((await getOrder(w.owner, r.orderId)).status).toBe("paid");
    });
  });

  it("refuses paying at another branch or without pos.sell", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Cookie", "Each"))]);
      await expect(payOrder(await w.ctxFor(w.users.b2user), o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "1")], changeCurrency: "USD" })).rejects.toThrow(ForbiddenError);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const role = await createRole(w.owner, { name: "Viewer", permissions: [{ key: "menu.view" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: role.id });
      await expect(payOrder(await w.ctxFor(w.users.cashier), o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "1")], changeCurrency: "USD" })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("void and refund", () => {
  it("void needs a manager PIN and a reason; it leaves stock alone and is audited", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Water", "Bottle"))]);
      const cashier = await w.ctxFor(w.users.cashier);
      await expect(voidOrder(cashier, o.id, { reason: "Customer left", approval: { approverId: w.users.manager, pin: "0000" } })).rejects.toThrow(PinError);
      await expect(voidOrder(cashier, o.id, { reason: "", approval: w.approval })).rejects.toThrow(ValidationError);
      await voidOrder(cashier, o.id, { reason: "Customer left", approval: w.approval });
      expect(await getOrder(w.owner, o.id)).toMatchObject({ status: "voided", voidReason: "Customer left", voidedBy: w.users.cashier });
      expect((await w.stock(w.water.id)).qtyOnHand).toBe("24.0000");
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "order.void"));
      expect(log).toMatchObject({ approvedBy: w.users.manager, reason: "Customer left" });
      await expect(voidOrder(cashier, o.id, { reason: "again", approval: w.approval })).rejects.toThrow(/can't be voided/);
    });
  });

  it("refund needs a PIN with pos.refund; full refund marks the order refunded", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Cookie", "Each"), 2)]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "2")], changeCurrency: "USD" });
      const l = (await getOrder(w.owner, o.id)).lines[0];
      const input = { registerId: w.reg.id, reason: "Stale", method: { methodId: w.methods.cash, currencyCode: "KHR" }, lines: [{ orderLineId: l.id, qty: 2, restock: false }] };
      await expect(refundOrder(w.owner, o.id, { ...input, approval: { approverId: w.users.cashier, pin: "1111" } })).rejects.toThrow(PinError);
      const r = await refundOrder(w.owner, o.id, { ...input, approval: w.approval });
      // $2.00 at 4,100 = 8,200 riel (already a 100 step).
      expect(r).toMatchObject({ totalBase: "2.0000", paidOut: { currency: "KHR", amount: "8200" } });
      expect((await getOrder(w.owner, o.id)).status).toBe("refunded");
      await expect(refundOrder(await w.ctxFor(w.users.b2user), o.id, { ...input, approval: w.approval })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("shift close with variance (Q6)", () => {
  it("over $1.00 needs a manager PIN unless the owner turned that off", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const counted = [{ currencyCode: "USD", amount: "48" }, { currencyCode: "KHR", amount: "100000" }];
      await expect(closeShift(w.owner, w.shift.id, { counted, notes: "Short" })).rejects.toThrow(ApprovalRequiredError);
      await tx.update(branches).set({ settings: { variancePinRequired: false } }).where(eq(branches.id, w.b1.id));
      const r = await closeShift(w.owner, w.shift.id, { counted, notes: "Short" });
      expect(r.cash.find((c) => c.currencyCode === "USD")?.variance).toBe("-2.0000");
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.close"));
      expect(log.after).toMatchObject({ varianceBase: "-2.0000", pinRequired: false });
    });
  });

  it("with a PIN the variance is approved", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await closeShift(w.owner, w.shift.id, { counted: [{ currencyCode: "USD", amount: "48" }, { currencyCode: "KHR", amount: "100000" }], notes: "Short", approval: w.approval });
      expect(r.shift.status).toBe("closed");
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.close"));
      expect(log.approvedBy).toBe(w.users.manager);
      void items;
    });
  });
});

void ({} as W);

describe("refund screen data", () => {
  it("lists recent paid orders and suggests restock only for resale items", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { getRefundable, listRecentOrders } = await import("@/lib/queries/pos");
      const o = await w.order([line(w.v("Water", "Bottle"), 2), line(w.v("Latte", "Regular")), line(w.v("Cookie", "Each"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "10")], changeCurrency: "USD" });
      expect((await listRecentOrders(w.owner, w.b1.id)).map((r) => [r.id, r.status])).toEqual([[o.id, "paid"]]);
      const r = await getRefundable(w.owner, o.id);
      expect(r.lines.map((l) => [l.productName, l.remainingQty, l.defaultRestock])).toEqual([["Water", 2, true], ["Latte", 1, false], ["Cookie", 1, false]]);
      await expect(listRecentOrders(await w.ctxFor(w.users.b2user), w.b1.id)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("Phase 6 review fixes", () => {
  it("#2 paying sends unsent kitchen lines to the kitchen", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { listKitchenTickets } = await import("@/lib/queries/pos");
      const input = { branchId: w.b1.id, registerId: w.reg.id, orderType: "takeaway" as const, orderDiscount: null, lines: [line(w.v("Latte", "Regular")), line(w.v("Water", "Bottle"))] };
      await saveAndPayOrder(w.owner, input, { registerId: w.reg.id, tenders: [w.cash("USD", "5")], changeCurrency: "USD" });
      const t = await listKitchenTickets(w.owner, { branchId: w.b1.id });
      expect(t[0].lines.map((l) => l.productName)).toEqual(["Latte"]);
    });
  });

  it("#4 a substitution bigger than the recipe never adds stock (net negative is skipped)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      // Oat milk = +200 oat −200 milk; a recipe with only 150 ml milk → net −50 milk.
      await saveProduct(w.owner, null, { name: "Small latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [(await tx.select().from((await import("@/db/schema")).modifierGroups)).find((g) => g.name === "Milk")!.id], variants: [{ name: "Cup", price: "2", deductStock: null, isDefault: true, recipe: [{ itemId: w.beans.id, unitKey: "base", qty: "18" }, { itemId: w.milk.id, unitKey: "base", qty: "150" }] }] });
      const menu = await getPosMenu(w.owner);
      const small = menu.products.find((p) => p.name === "Small latte")!.variants[0].id;
      const o = await w.order([line(small, 1, [w.mods["Oat milk"]])]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "3")], changeCurrency: "USD" });
      const l = (await getOrder(w.owner, o.id)).lines[0];
      const mv = await w.moves(l.id);
      expect(mv.map((m) => [m.itemId, m.movementType, m.qtyBase]).sort()).toEqual([[w.beans.id, "sale", "-18.0000"], [w.oat.id, "sale", "-200.0000"]].sort());
      expect((await w.stock(w.milk.id)).qtyOnHand).toBe("10000.0000");
    });
  });

  it("#5 a cash difference over the threshold needs a reason (PIN on or off)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.update(branches).set({ settings: { variancePinRequired: false } }).where(eq(branches.id, w.b1.id));
      const counted = [{ currencyCode: "USD", amount: "48" }, { currencyCode: "KHR", amount: "100000" }];
      await expect(closeShift(w.owner, w.shift.id, { counted })).rejects.toThrow(/reason/);
      await closeShift(w.owner, w.shift.id, { counted, notes: "Gave $2 too much change" });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "shift.close"));
      expect(log.reason).toBe("Gave $2 too much change");
    });
  });

  it("M1 the shift report shows change given, so payments reconcile with sales", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Cookie", "Each"), 4), line(w.v("Water", "Bottle"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5")], changeCurrency: "KHR" });
      const rep = await getShiftReport(w.owner, w.shift.id);
      expect(rep.changeGiven).toEqual([{ currencyCode: "KHR", amount: "1000.0000" }]);
      expect(rep.byMethod).toEqual([expect.objectContaining({ method: "Cash", currencyCode: "USD", amount: "5.0000", base: "4.7561" })]);
    });
  });

  it("M8 a $0 order (100% discount) can be completed with no payment", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, { branchId: w.b1.id, registerId: w.reg.id, orderType: "takeaway", orderDiscount: { type: "percent", value: "100", reason: "Staff" }, lines: [line(w.v("Cookie", "Each"))] });
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [], changeCurrency: "USD" });
      expect((await getOrder(w.owner, o.id))).toMatchObject({ status: "paid", total: "0.0000" });
      const o2 = await w.order([line(w.v("Cookie", "Each"))]);
      await expect(payOrder(w.owner, o2.id, { registerId: w.reg.id, tenders: [], changeCurrency: "USD" })).rejects.toThrow(/to pay/);
    });
  });
});
