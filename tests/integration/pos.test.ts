import fc from "fast-check";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, branches, orders, registers } from "@/db/schema";
import { computeOrder } from "@/lib/domain/pricing";
import { ApprovalRequiredError, ConflictError, PinError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { currentRate, getOpenShift, getOrder, getPosMenu, listHeldOrders, listKitchenTickets } from "@/lib/queries/pos";
import { saveModifierGroup, saveProduct, setBranchVariantPrice } from "@/lib/services/menu";
import { holdOrder, resumeOrder, saveOrder, sendToKitchen, setKitchenStatus, type SaveOrderInput } from "@/lib/services/orders";
import { saveDiningTable, setExchangeRate } from "@/lib/services/pos-settings";
import { closeShift, openShift } from "@/lib/services/shifts";
import { setUserPin } from "@/lib/services/users";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const [reg1] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
  const [reg2] = await tx.select().from(registers).where(eq(registers.branchId, w.b2.id));
  const milk = await saveModifierGroup(owner, null, { name: "Milk", minSelect: 0, maxSelect: 1, modifiers: [{ name: "Oat milk", priceDelta: "0.50", deductStock: true, recipe: [] }, { name: "Soy milk", priceDelta: "0.40", deductStock: false, recipe: [] }] });
  const extras = await saveModifierGroup(owner, null, { name: "Extras", minSelect: 0, maxSelect: 3, modifiers: [{ name: "Extra shot", priceDelta: "0.50", deductStock: true, recipe: [] }, { name: "Syrup", priceDelta: "0.30", deductStock: true, recipe: [] }] });
  const sugar = await saveModifierGroup(owner, null, { name: "Sugar", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Normal", priceDelta: "0", deductStock: true, recipe: [] }, { name: "Less", priceDelta: "0", deductStock: true, recipe: [] }] });
  const latte = await saveProduct(owner, null, {
    name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [milk.id, extras.id],
    variants: [{ name: "Regular", price: "2.80", deductStock: null, isDefault: true, recipe: [] }, { name: "Large", price: "3.50", deductStock: false, isDefault: false, recipe: [] }],
  });
  const tea = await saveProduct(owner, null, { name: "Iced tea", kitchenStation: "bar", deductStock: true, modifierGroupIds: [sugar.id], variants: [{ name: "Cup", price: "1.75", deductStock: null, isDefault: true, recipe: [] }] });
  const croissant = await saveProduct(owner, null, { name: "Croissant", kitchenStation: "kitchen", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "2.25", deductStock: null, isDefault: true, recipe: [] }] });
  const water = await saveProduct(owner, null, { name: "Water", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Bottle", price: "0.75", deductStock: null, isDefault: true, recipe: [] }] });
  const menu = await getPosMenu(owner);
  const p = (name: string) => menu.products.find((x) => x.name === name)!;
  const v = (product: string, variant: string) => p(product).variants.find((x) => x.name === variant)!.id;
  const mods = Object.fromEntries(menu.groups.flatMap((g) => g.modifiers.map((m) => [m.name, m.id])));
  await setUserPin(owner, w.users.manager, "4321");
  const shift = await openShift(owner, { branchId: w.b1.id, registerId: reg1.id, floats: [{ currencyCode: "USD", amount: "50" }, { currencyCode: "KHR", amount: "100000" }] });
  const base = (lines: SaveOrderInput["lines"], extra: Partial<SaveOrderInput> = {}): SaveOrderInput => ({ branchId: w.b1.id, registerId: reg1.id, orderType: "takeaway", lines, orderDiscount: null, ...extra });
  return { ...w, owner, reg1, reg2, shift, latte, tea, croissant, water, menu, v, mods, base, groups: { milk, extras, sugar } };
}

describe("Phase 5 acceptance: server totals match client totals", () => {
  it("20 random carts (property test)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const variants = [
        { id: w.v("Latte", "Regular"), price: "2.80", modifiers: [[], [w.mods["Oat milk"]], [w.mods["Oat milk"], w.mods["Extra shot"]], [w.mods["Soy milk"], w.mods["Extra shot"], w.mods["Syrup"]]] },
        { id: w.v("Latte", "Large"), price: "3.50", modifiers: [[], [w.mods["Syrup"]]] },
        { id: w.v("Iced tea", "Cup"), price: "1.75", modifiers: [[w.mods.Normal], [w.mods.Less]] },
        { id: w.v("Croissant", "Each"), price: "2.25", modifiers: [[]] },
      ];
      const delta: Record<string, string> = { [w.mods["Oat milk"]]: "0.50", [w.mods["Soy milk"]]: "0.40", [w.mods["Extra shot"]]: "0.50", [w.mods.Syrup]: "0.30", [w.mods.Normal]: "0", [w.mods.Less]: "0" };
      const disc = fc.option(fc.oneof(
        fc.record({ type: fc.constant("percent" as const), value: fc.integer({ min: 1, max: 10 }).map(String) }),
        fc.record({ type: fc.constant("amount" as const), value: fc.integer({ min: 1, max: 20 }).map((c) => (c / 100).toFixed(2)) }),
      ), { nil: null });
      const cart = fc.array(fc.record({ v: fc.integer({ min: 0, max: 3 }), m: fc.nat(), qty: fc.integer({ min: 1, max: 5 }), discount: disc }), { minLength: 1, maxLength: 8 });
      const tax = fc.record({ rate: fc.constantFrom("0", "10"), inclusive: fc.boolean() });
      const samples = fc.sample(fc.tuple(cart, disc, tax), { numRuns: 20, seed: 20261109 });
      for (const [lines, od, t] of samples) {
        await tx.update(branches).set({ taxRate: t.rate, taxInclusive: t.inclusive }).where(eq(branches.id, w.b1.id));
        const ctx = await w.ctxFor(w.users.owner);
        const chosen = lines.map((l) => { const vv = variants[l.v]; return { vv, mods: vv.modifiers[l.m % vv.modifiers.length], qty: l.qty, discount: l.discount }; });
        const client = computeOrder(chosen.map((c) => ({ unitPrice: c.vv.price, qty: c.qty, modifiers: c.mods.map((id) => delta[id]), discount: c.discount })), od, t);
        const saved = await saveOrder(ctx, w.base(chosen.map((c) => ({ variantId: c.vv.id, qty: c.qty, modifierIds: c.mods, discount: c.discount })), { orderDiscount: od }));
        const server = await getOrder(ctx, saved.id);
        expect({ subtotal: server.subtotal, discountTotal: server.discountTotal, taxTotal: server.taxTotal, total: server.total }).toEqual({ subtotal: client.subtotal, discountTotal: client.discountTotal, taxTotal: client.taxTotal, total: client.total });
        expect(server.lines.map((l) => l.lineTotal)).toEqual(client.lines.map((l) => l.lineTotal));
      }
    });
  }, 120_000);
});

describe("shifts", () => {
  it("one open shift per register; selling needs one; closing records counted cash", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(openShift(w.owner, { branchId: w.b1.id, registerId: w.reg1.id, floats: [] })).rejects.toThrow(ConflictError);
      expect((await getOpenShift(w.owner, w.b1.id, w.reg1.id))?.id).toBe(w.shift.id);
      const order = await saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }]));
      await holdOrder(w.owner, order.id);
      const closed = await closeShift(w.owner, w.shift.id, { counted: [{ currencyCode: "USD", amount: "49.50" }, { currencyCode: "KHR", amount: "100000" }] });
      expect(closed.cash.map((c) => [c.currencyCode, c.expected, c.counted, c.variance])).toEqual([["KHR", "100000.0000", "100000.0000", "0.0000"], ["USD", "50.0000", "49.5000", "-0.5000"]]);
      await expect(saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }]))).rejects.toThrow(/open a shift/i);
      // A held bill carries over to the register's next shift when resumed.
      const next = await openShift(w.owner, { branchId: w.b1.id, registerId: w.reg1.id, floats: [{ currencyCode: "USD", amount: "20" }] });
      const resumed = await resumeOrder(w.owner, order.id, w.reg1.id);
      expect(resumed).toMatchObject({ status: "open", shiftId: next.id });
      const actions = (await tx.select().from(auditLog)).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["shift.open", "shift.close", "order.create", "order.hold", "order.resume"]));
    });
  });

  it("refuses shifts for cashiers without shift.open, at other branches, or with another branch's register", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const noShift = await createRole(w.owner, { name: "Seller", permissions: [{ key: "pos.sell" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: noShift.id });
      const seller = await w.ctxFor(w.users.cashier);
      await expect(openShift(seller, { branchId: w.b1.id, registerId: w.reg1.id, floats: [] })).rejects.toThrow(ForbiddenError);
      await expect(openShift(w.owner, { branchId: w.b2.id, registerId: w.reg2.id, floats: [] })).rejects.toThrow(ForbiddenError);
      const b2 = await w.ctxFor(w.users.b2user);
      await expect(openShift(b2, { branchId: w.b2.id, registerId: w.reg1.id, floats: [] })).rejects.toThrow(ValidationError);
      await expect(closeShift(b2, w.shift.id, { counted: [] })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("saveOrder", () => {
  it("numbers orders per branch per day, snapshots names, deduct setting, station and tax", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.update(branches).set({ taxRate: "10", taxInclusive: false }).where(eq(branches.id, w.b1.id));
      const ctx = await w.ctxFor(w.users.owner);
      const a = await saveOrder(ctx, w.base([{ variantId: w.v("Latte", "Large"), qty: 2, modifierIds: [w.mods.Syrup], discount: null, note: "extra hot" }]));
      const b = await saveOrder(ctx, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }]));
      expect(a.orderNo).toMatch(/^B1-\d{8}-0001$/);
      expect(b.orderNo).toMatch(/^B1-\d{8}-0002$/);
      expect(b.queueNo).toBe(2);
      const o = await getOrder(ctx, a.id);
      expect(o).toMatchObject({ subtotal: "7.6000", taxTotal: "0.7600", total: "8.3600", taxRate: "10.00", taxInclusive: false });
      expect(o.lines[0]).toMatchObject({ productName: "Latte", variantName: "Large", deductStock: false, kitchenStation: "bar", note: "extra hot", modifiers: [{ name: "Syrup", priceDelta: "0.3000" }] });
    });
  });

  it("uses the branch price and refuses unavailable variants", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: w.v("Croissant", "Each"), price: "2.50", isAvailable: true });
      const o = await saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 2, modifierIds: [], discount: null }]));
      expect((await getOrder(w.owner, o.id)).total).toBe("5.0000");
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: w.v("Croissant", "Each"), price: null, isAvailable: false });
      await expect(saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }]))).rejects.toThrow(/isn't available/);
    });
  });

  it("enforces modifier rules: required groups, max, options not on the product", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const tea = w.v("Iced tea", "Cup");
      await expect(saveOrder(w.owner, w.base([{ variantId: tea, qty: 1, modifierIds: [], discount: null }]))).rejects.toThrow(/Choose 1 option for Sugar/);
      await expect(saveOrder(w.owner, w.base([{ variantId: tea, qty: 1, modifierIds: [w.mods.Normal, w.mods.Less], discount: null }]))).rejects.toThrow(/Sugar/);
      await expect(saveOrder(w.owner, w.base([{ variantId: tea, qty: 1, modifierIds: [w.mods.Normal, w.mods["Oat milk"]], discount: null }]))).rejects.toThrow(/aren't available/);
      await expect(saveOrder(w.owner, w.base([{ variantId: w.v("Latte", "Regular"), qty: 1, modifierIds: [w.mods["Oat milk"], w.mods["Soy milk"]], discount: null }]))).rejects.toThrow(/Milk/);
      await expect(saveOrder(w.owner, w.base([]))).rejects.toThrow(ValidationError);
    });
  });

  it("dine-in with a table of this branch only", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const t1 = await saveDiningTable(w.owner, null, { branchId: w.b1.id, name: "T1", area: "Inside", seats: 4 });
      const { diningTables } = await import("@/db/schema");
      const [t9] = await tx.insert(diningTables).values({ branchId: w.b2.id, name: "T9" }).returning();
      const line = [{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }];
      const o = await saveOrder(w.owner, w.base(line, { orderType: "dine_in", tableId: t1.id }));
      expect((await getOrder(w.owner, o.id))).toMatchObject({ orderType: "dine_in", tableName: "T1" });
      await expect(saveOrder(w.owner, w.base(line, { orderType: "dine_in", tableId: t9.id }))).rejects.toThrow(ValidationError);
      await expect(saveDiningTable(await w.ctxFor(w.users.cashier), null, { branchId: w.b1.id, name: "T2" })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("discounts (plan §4.5)", () => {
  it("cashier up to 10% alone; above needs a manager PIN once; a wrong PIN is refused", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      const line = (d: { type: "percent" | "amount"; value: string; reason?: string } | null) => [{ variantId: w.v("Croissant", "Each"), qty: 2, modifierIds: [], discount: d }];
      await saveOrder(cashier, w.base(line({ type: "percent", value: "10" })));
      await expect(saveOrder(cashier, w.base(line({ type: "percent", value: "15", reason: "Staff" })))).rejects.toThrow(ApprovalRequiredError);
      // $1.00 off $4.50 is 22% → also above the limit.
      await expect(saveOrder(cashier, w.base(line(null), { orderDiscount: { type: "amount", value: "1", reason: "Staff" } }))).rejects.toThrow(ApprovalRequiredError);
      await expect(saveOrder(cashier, w.base(line({ type: "percent", value: "15", reason: "Staff" }), { approval: { approverId: w.users.manager, pin: "0000" } }))).rejects.toThrow(PinError);
      const ok = await saveOrder(cashier, w.base(line({ type: "percent", value: "15", reason: "Staff" }), { approval: { approverId: w.users.manager, pin: "4321" } }));
      const o = await getOrder(cashier, ok.id);
      expect(o).toMatchObject({ approvedBy: w.users.manager, discountTotal: "0.6800" });
      // Saving again with the same discount doesn't ask again; raising it does.
      const again = { ...w.base(line({ type: "percent", value: "15", reason: "Staff" })), id: ok.id };
      again.lines = [{ ...again.lines[0], id: o.lines[0].id }];
      await saveOrder(cashier, again);
      again.lines = [{ ...again.lines[0], discount: { type: "percent", value: "20", reason: "Staff" } }];
      await expect(saveOrder(cashier, again)).rejects.toThrow(ApprovalRequiredError);
      const logs = await tx.select().from(auditLog).where(eq(auditLog.action, "order.discount_approved"));
      expect(logs).toHaveLength(1);
    });
  });

  it("a role without pos.discount.apply needs approval for any discount", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const seller = await createRole(w.owner, { name: "Seller", permissions: [{ key: "pos.sell" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: seller.id });
      const ctx = await w.ctxFor(w.users.cashier);
      await expect(saveOrder(ctx, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: { type: "percent", value: "1", reason: "Staff" } }]))).rejects.toThrow(ApprovalRequiredError);
    });
  });
});

describe("hold / resume / held bills", () => {
  it("holds and resumes; held list shows held orders; needs pos.hold", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }], { then: "hold" }));
      expect((await getOrder(w.owner, o.id)).status).toBe("held");
      expect((await listHeldOrders(w.owner, w.b1.id)).map((h) => [h.id, h.total])).toEqual([[o.id, "2.2500"]]);
      await expect(saveOrder(w.owner, { ...w.base([{ variantId: w.v("Croissant", "Each"), qty: 2, modifierIds: [], discount: null }]), id: o.id })).rejects.toThrow(/held/);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const seller = await createRole(w.owner, { name: "Seller", permissions: [{ key: "pos.sell" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: seller.id });
      const ctx = await w.ctxFor(w.users.cashier);
      await expect(resumeOrder(ctx, o.id, w.reg1.id)).rejects.toThrow(ForbiddenError);
      await expect(listHeldOrders(await w.ctxFor(w.users.b2user), w.b1.id)).rejects.toThrow(ForbiddenError);
      await resumeOrder(w.owner, o.id, w.reg1.id);
      expect(await listHeldOrders(w.owner, w.b1.id)).toHaveLength(0);
    });
  });
});

describe("kitchen", () => {
  it("send to kitchen shows lines by station; status moves; sent lines are locked", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const lines = [
        { variantId: w.v("Latte", "Regular"), qty: 1, modifierIds: [w.mods["Oat milk"]], discount: null, note: "less ice" },
        { variantId: w.v("Croissant", "Each"), qty: 2, modifierIds: [], discount: null },
        { variantId: w.v("Water", "Bottle"), qty: 1, modifierIds: [], discount: null },
      ];
      const o = await saveOrder(w.owner, w.base(lines, { orderType: "dine_in", then: "send" }));
      const tickets = await listKitchenTickets(w.owner, { branchId: w.b1.id });
      expect(tickets).toHaveLength(1);
      expect(tickets[0]).toMatchObject({ orderNo: o.orderNo, queueNo: 1, orderType: "dine_in" });
      expect(tickets[0].lines.map((l) => [l.productName, l.station, l.status, l.modifiers, l.note])).toEqual([
        ["Latte", "bar", "pending", ["Oat milk"], "less ice"],
        ["Croissant", "kitchen", "pending", [], null],
      ]);
      const bar = await listKitchenTickets(w.owner, { branchId: w.b1.id, station: "bar" });
      expect(bar[0].lines.map((l) => l.productName)).toEqual(["Latte"]);
      const latteLine = tickets[0].lines[0].id;
      await setKitchenStatus(w.owner, latteLine, "ready");
      await setKitchenStatus(w.owner, tickets[0].lines[1].id, "served");
      expect((await listKitchenTickets(w.owner, { branchId: w.b1.id }))[0].lines.map((l) => [l.productName, l.status])).toEqual([["Latte", "ready"]]);

      const order = await getOrder(w.owner, o.id);
      const keep = order.lines.map((l) => ({ id: l.id, variantId: l.variantId, qty: l.qty, modifierIds: l.modifiers.map((m) => m.modifierId), discount: null, note: l.note }));
      // Adding a line is fine; changing or removing a sent line is not.
      await saveOrder(w.owner, { ...w.base([...keep, { variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }], { orderType: "dine_in" }), id: o.id });
      await expect(saveOrder(w.owner, { ...w.base([{ ...keep[0], qty: 3 }, ...keep.slice(1)], { orderType: "dine_in" }), id: o.id })).rejects.toThrow(/sent to the kitchen/);
      await expect(saveOrder(w.owner, { ...w.base(keep.slice(1), { orderType: "dine_in" }), id: o.id })).rejects.toThrow(/sent to the kitchen/);
      await sendToKitchen(w.owner, o.id);
      expect((await listKitchenTickets(w.owner, { branchId: w.b1.id, station: "kitchen" }))[0].lines.map((l) => [l.productName, l.qty])).toEqual([["Croissant", 1]]);
    });
  });

  it("kitchen needs pos.sell at the branch", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }], { then: "send" }));
      const b2 = await w.ctxFor(w.users.b2user);
      await expect(listKitchenTickets(b2, { branchId: w.b1.id })).rejects.toThrow(ForbiddenError);
      const line = (await getOrder(w.owner, o.id)).lines[0].id;
      await expect(setKitchenStatus(b2, line, "ready")).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("permissions and branches", () => {
  it("refuses selling without pos.sell, at another branch, or on another branch's register", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { createRole } = await import("@/lib/services/roles");
      const { assignBranchRole } = await import("@/lib/services/users");
      const stock = await createRole(w.owner, { name: "Stock only", permissions: [{ key: "inventory.view" }, { key: "menu.view" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: stock.id });
      const line = [{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }];
      await expect(saveOrder(await w.ctxFor(w.users.cashier), w.base(line))).rejects.toThrow(ForbiddenError);
      const b2 = await w.ctxFor(w.users.b2user);
      await expect(saveOrder(b2, w.base(line))).rejects.toThrow(ForbiddenError);
      await expect(saveOrder(w.owner, w.base(line, { registerId: w.reg2.id }))).rejects.toThrow(ValidationError);
      const o = await saveOrder(w.owner, w.base(line));
      await expect(getOrder(b2, o.id)).rejects.toThrow(ForbiddenError);
      await expect(holdOrder(b2, o.id)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("exchange rate", () => {
  it("defaults to 4,100 riel; a new rate is kept with history; settings.manage only", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      expect(await currentRate(w.owner, w.b1.id, "KHR")).toBe("4100.000000");
      await setExchangeRate(w.owner, { branchId: w.b1.id, currencyCode: "KHR", rate: "4120" });
      expect(await currentRate(w.owner, w.b1.id, "KHR")).toBe("4120.000000");
      await expect(setExchangeRate(await w.ctxFor(w.users.cashier), { branchId: w.b1.id, currencyCode: "KHR", rate: "1" })).rejects.toThrow(ForbiddenError);
      await expect(setExchangeRate(w.owner, { branchId: w.b2.id, currencyCode: "KHR", rate: "4000" })).rejects.toThrow(ForbiddenError);
      void orders;
    });
  });
});

describe("line ids", () => {
  it("stay the same across saves, so the cart on screen keeps working", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([{ variantId: w.v("Croissant", "Each"), qty: 1, modifierIds: [], discount: null }]));
      const [line] = (await getOrder(w.owner, o.id)).lines;
      await saveOrder(w.owner, { ...w.base([{ id: line.id, variantId: w.v("Latte", "Regular"), qty: 2, modifierIds: [w.mods["Oat milk"]], discount: null }]), id: o.id });
      const after = await getOrder(w.owner, o.id);
      expect(after.lines.map((l) => [l.id, l.productName, l.qty, l.modifiers.map((m) => m.name)])).toEqual([[line.id, "Latte", 2, ["Oat milk"]]]);
      expect(after.total).toBe("6.6000");
    });
  });
});

describe("review fixes", () => {
  const croissants = (w: Awaited<ReturnType<typeof setup>>, qty: number, extra: Record<string, unknown> = {}) => ({ variantId: w.v("Croissant", "Each"), qty, modifierIds: [] as string[], discount: null as null | { type: "percent" | "amount"; value: string; reason?: string }, ...extra });

  it("#1 a fixed discount kept 'unchanged' while the order shrinks is re-checked against the limit", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      // $2 off $22.50 (8.9%) is within 10%.
      const o = await saveOrder(cashier, w.base([croissants(w, 10)], { orderDiscount: { type: "amount", value: "2" } }));
      const line = (await getOrder(cashier, o.id)).lines[0];
      // Same $2 on $2.25 is 89% → needs approval.
      await expect(saveOrder(cashier, { ...w.base([croissants(w, 1, { id: line.id })], { orderDiscount: { type: "amount", value: "2", reason: "Staff" } }), id: o.id })).rejects.toThrow(ApprovalRequiredError);
      // Same trick with a line discount.
      const o2 = await saveOrder(cashier, w.base([croissants(w, 10, { discount: { type: "amount", value: "2.20" } })]));
      const l2 = (await getOrder(cashier, o2.id)).lines[0];
      await expect(saveOrder(cashier, { ...w.base([croissants(w, 1, { id: l2.id, discount: { type: "amount", value: "2.20", reason: "Staff" } })]), id: o2.id })).rejects.toThrow(ApprovalRequiredError);
    });
  });

  it("#2 lines sent to the kitchen keep the price they were sent at", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([croissants(w, 1)], { then: "send" }));
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: w.v("Croissant", "Each"), price: "3.00", isAvailable: true });
      const sent = (await getOrder(w.owner, o.id)).lines[0];
      await saveOrder(w.owner, { ...w.base([croissants(w, 1, { id: sent.id }), { variantId: w.v("Water", "Bottle"), qty: 1, modifierIds: [], discount: null }]), id: o.id });
      const after = await getOrder(w.owner, o.id);
      expect(after.lines.map((l) => [l.productName, l.unitPrice, l.lineTotal])).toEqual([["Croissant", "2.2500", "2.2500"], ["Water", "0.7500", "0.7500"]]);
      expect(after.total).toBe("3.0000");
      // The client recomputing from the saved order gets the same total.
      expect(computeOrder(after.lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, modifiers: l.modifiers.map((m) => m.priceDelta), discount: l.discount })), null, { rate: "0", inclusive: true }).total).toBe(after.total);
    });
  });

  it("#3 an order with a sent line can still be saved and held after the item is made unavailable", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([{ variantId: w.v("Latte", "Regular"), qty: 1, modifierIds: [w.mods["Oat milk"]], discount: null }], { then: "send" }));
      await setBranchVariantPrice(w.owner, { branchId: w.b1.id, variantId: w.v("Latte", "Regular"), price: null, isAvailable: false });
      const sent = (await getOrder(w.owner, o.id)).lines[0];
      const keep = { id: sent.id, variantId: sent.variantId, qty: 1, modifierIds: sent.modifiers.map((m) => m.modifierId), discount: null };
      await saveOrder(w.owner, { ...w.base([keep, croissants(w, 1)], { then: "hold" }), id: o.id });
      expect((await getOrder(w.owner, o.id)).status).toBe("held");
    });
  });

  it("#4 open (not held) orders can be listed and reopened", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { listOpenOrders } = await import("@/lib/queries/pos");
      const a = await saveOrder(w.owner, w.base([croissants(w, 1)], { then: "send" }));
      const b = await saveOrder(w.owner, w.base([croissants(w, 2)], { then: "hold" }));
      expect((await listOpenOrders(w.owner, w.b1.id)).map((r) => [r.id, r.status])).toEqual([[a.id, "open"], [b.id, "held"]]);
      await expect(listOpenOrders(await w.ctxFor(w.users.b2user), w.b1.id)).rejects.toThrow(ForbiddenError);
    });
  });

  it("#5 a shift can't close while orders are open on it", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await saveOrder(w.owner, w.base([croissants(w, 1)]));
      await expect(closeShift(w.owner, w.shift.id, { counted: [] })).rejects.toThrow(/1 order is still open/);
      await holdOrder(w.owner, o.id);
      await closeShift(w.owner, w.shift.id, { counted: [{ currencyCode: "USD", amount: "50" }, { currencyCode: "KHR", amount: "100000" }] });
    });
  });

  it("#6 an over-limit discount needs a reason", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      const approval = { approverId: w.users.manager, pin: "4321" };
      await expect(saveOrder(cashier, w.base([croissants(w, 2, { discount: { type: "percent", value: "15" } })], { approval }))).rejects.toThrow(/reason/);
      await saveOrder(cashier, w.base([croissants(w, 2, { discount: { type: "percent", value: "15", reason: "Complaint" } })], { approval }));
      // Within the limit, no reason needed.
      await saveOrder(cashier, w.base([croissants(w, 2, { discount: { type: "percent", value: "10" } })]));
    });
  });
});
