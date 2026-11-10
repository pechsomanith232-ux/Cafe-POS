import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, branches, cashMovements, goodsReceipts, paymentMethods, registers } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { arAging, getCustomer, listCustomers } from "@/lib/queries/customers";
import { getOrder, getPosMenu, getShiftReport } from "@/lib/queries/pos";
import { recordCustomerPayment, saveCustomer } from "@/lib/services/customers";
import { saveProduct } from "@/lib/services/menu";
import { saveOrder } from "@/lib/services/orders";
import { payOrder } from "@/lib/services/payments";
import { saveBranchPosSettings, savePaymentMethod } from "@/lib/services/pos-settings";
import { saveAndPostReceipt } from "@/lib/services/purchasing";
import { openShift } from "@/lib/services/shifts";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const [reg] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
  await saveProduct(owner, null, { name: "Cookie", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1.00", deductStock: null, isDefault: true, recipe: [] }] });
  const menu = await getPosMenu(owner);
  const cookie = menu.products[0].variants[0].id;
  const methods = Object.fromEntries((await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id))).map((m) => [m.type, m.id]));
  const shift = await openShift(owner, { branchId: w.b1.id, registerId: reg.id, floats: [{ currencyCode: "USD", amount: "50" }] });
  const sell = async (qty: number, tenders: { methodId: string; currencyCode: string; amount: string }[], customerId?: string, ctx = owner) => {
    const o = await saveOrder(ctx, { branchId: w.b1.id, registerId: reg.id, orderType: "takeaway", orderDiscount: null, lines: [{ variantId: cookie, qty, modifierIds: [], discount: null }] });
    await payOrder(ctx, o.id, { registerId: reg.id, tenders, changeCurrency: "USD", customerId });
    return o;
  };
  return { ...w, owner, reg, shift, cookie, methods, sell };
}

describe("customers and charge to account (plan §4.10)", () => {
  it("charges within the credit limit, blocks over it; customer payments settle oldest first", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const sok = await saveCustomer(w.owner, null, { name: "Sok Dara", phone: "012 345 678", creditLimit: "10" });
      const acct = (amount: string) => [{ methodId: w.methods.account, currencyCode: "USD", amount }];
      const a = await w.sell(4, acct("4"), sok.id);
      const b = await w.sell(5, acct("5"), sok.id);
      expect((await getOrder(w.owner, a.id))).toMatchObject({ status: "paid", accountDue: "4.0000", customerId: sok.id });
      await expect(w.sell(2, acct("2"), sok.id)).rejects.toThrow(/credit limit/);
      expect((await listCustomers(w.owner)).map((c) => [c.name, c.balance])).toEqual([["Sok Dara", "9.0000"]]);

      // $6 cash → order a (4) fully, order b 2 of 5; goes into this shift's drawer.
      await recordCustomerPayment(w.owner, { customerId: sok.id, branchId: w.b1.id, registerId: w.reg.id, methodId: w.methods.cash, currencyCode: "USD", amount: "6" });
      expect((await getOrder(w.owner, a.id)).accountDue).toBe("0.0000");
      expect((await getOrder(w.owner, b.id)).accountDue).toBe("3.0000");
      const c = await getCustomer(w.owner, sok.id);
      expect(c).toMatchObject({ balance: "3.0000", credit: "0.0000" });
      expect(c.openOrders.map((o) => [o.orderNo, o.accountDue])).toEqual([[b.orderNo, "3.0000"]]);
      expect((await getShiftReport(w.owner, w.shift.id)).cash.find((x) => x.currencyCode === "USD")?.expected).toBe("56.0000");

      // AR aging (same buckets as AP).
      const aging = await arAging(w.owner, { asOf: "2099-01-01" });
      expect(aging.rows).toEqual([expect.objectContaining({ customerName: "Sok Dara", total: "3.0000", d90_plus: "3.0000" })]);
    });
  });

  it("needs pos.charge_account, a customer, and a credit account", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const noCredit = await saveCustomer(w.owner, null, { name: "Walk-in Vanna", creditLimit: null });
      const acct = [{ methodId: w.methods.account, currencyCode: "USD", amount: "1" }];
      await expect(w.sell(1, acct)).rejects.toThrow(/customer/);
      await expect(w.sell(1, acct, noCredit.id)).rejects.toThrow(/credit account/);
      const ok = await saveCustomer(w.owner, null, { name: "Chan", creditLimit: "50" });
      // Cashier role has no pos.charge_account.
      await expect(w.sell(1, acct, ok.id, await w.ctxFor(w.users.cashier))).rejects.toThrow(ForbiddenError);
    });
  });

  it("customers.manage to edit, ar.receive_payment to take payments, branch checked", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      await expect(saveCustomer(cashier, null, { name: "X" })).rejects.toThrow(ForbiddenError);
      const c = await saveCustomer(w.owner, null, { name: "Lina", creditLimit: "20" });
      await saveCustomer(w.owner, c.id, { name: "Lina K.", creditLimit: "25" });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "customer.update"));
      expect(log.after).toMatchObject({ name: "Lina K.", creditLimit: "25" });
      await expect(recordCustomerPayment(cashier, { customerId: c.id, branchId: w.b1.id, registerId: w.reg.id, methodId: w.methods.cash, currencyCode: "USD", amount: "1" })).rejects.toThrow(ForbiddenError);
      await expect(recordCustomerPayment(await w.ctxFor(w.users.b2user), { customerId: c.id, branchId: w.b1.id, methodId: w.methods.card, currencyCode: "USD", amount: "1" })).rejects.toThrow(ForbiddenError);
      await expect(recordCustomerPayment(w.owner, { customerId: c.id, branchId: w.b1.id, methodId: w.methods.cash, currencyCode: "USD", amount: "1" })).rejects.toThrow(/register/);
    });
  });
});

describe("direct purchase paid from the drawer (plan §4.9)", () => {
  it("needs an open shift, writes a pay-out, and uses the branch rate for riel", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const ice = await createItem(tx, w.org.id, { name: "Ice", base: "kg" });
      const input = { branchId: w.b1.id, purchaseType: "direct" as const, receiptDate: "2026-11-09", supplierNameText: "Central Market", lines: [{ itemId: ice.id, unitKey: "base", qty: "10", unitCost: "0.50" }], extraCosts: [] };
      const r = await saveAndPostReceipt(w.owner, null, input, { methodId: w.methods.cash, currencyCode: "KHR", paidFromDrawer: { registerId: w.reg.id } });
      const [mv] = await tx.select().from(cashMovements).where(and(eq(cashMovements.refType, "goods_receipt"), eq(cashMovements.refId, r.id)));
      expect(mv).toMatchObject({ type: "pay_out", currencyCode: "KHR", amount: "20500.0000" });
      const [gr] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, r.id));
      expect(gr.paidFromShiftId).toBe(w.shift.id);
      // Card can't come from the drawer.
      await expect(saveAndPostReceipt(w.owner, null, input, { methodId: w.methods.card, currencyCode: "USD", paidFromDrawer: { registerId: w.reg.id } })).rejects.toThrow(ValidationError);
    });
  });
});

describe("POS settings", () => {
  it("payment methods and branch variance / negative-stock settings (settings.manage)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const m = await savePaymentMethod(w.owner, null, { name: "ABA Pay", type: "khqr" });
      await savePaymentMethod(w.owner, m.id, { name: "ABA Pay", type: "khqr", isActive: false });
      await expect(savePaymentMethod(await w.ctxFor(w.users.cashier), null, { name: "X", type: "other" })).rejects.toThrow(ForbiddenError);
      await saveBranchPosSettings(w.owner, { branchId: w.b1.id, varianceThreshold: "2.50", variancePinRequired: false, allowNegativeStock: false });
      const [b] = await tx.select().from(branches).where(eq(branches.id, w.b1.id));
      expect(b.settings).toMatchObject({ varianceThreshold: "2.50", variancePinRequired: false, allowNegativeStock: false });
      await expect(saveBranchPosSettings(w.owner, { branchId: w.b2.id, varianceThreshold: "1", variancePinRequired: true, allowNegativeStock: true })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("Phase 6 review fixes (AR, drawer)", () => {
  it("#3 customer credit is used up by the next charges", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const c = await saveCustomer(w.owner, null, { name: "Prepaid Pich", creditLimit: "5" });
      await recordCustomerPayment(w.owner, { customerId: c.id, branchId: w.b1.id, methodId: w.methods.card, currencyCode: "USD", amount: "20" });
      expect((await getCustomer(w.owner, c.id)).credit).toBe("20.0000");
      // $8 charged: above the $5 limit on its own, but fully covered by the $20 credit.
      const o = await w.sell(8, [{ methodId: w.methods.account, currencyCode: "USD", amount: "8" }], c.id);
      expect((await getOrder(w.owner, o.id)).accountDue).toBe("0.0000");
      expect(await getCustomer(w.owner, c.id)).toMatchObject({ balance: "0.0000", credit: "12.0000" });
      // $15 more: $12 credit + $3 owed (within the $5 limit).
      const o2 = await w.sell(15, [{ methodId: w.methods.account, currencyCode: "USD", amount: "15" }], c.id);
      expect((await getOrder(w.owner, o2.id)).accountDue).toBe("3.0000");
      expect(await getCustomer(w.owner, c.id)).toMatchObject({ balance: "3.0000", credit: "0.0000" });
      expect((await arAging(w.owner, { asOf: "2099-01-01" })).totals.total).toBe("3.0000");
    });
  });

  it("M3 a riel pay-out from the drawer is rounded to 100 riel", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const ice = await createItem(tx, w.org.id, { name: "Ice", base: "kg" });
      // $3.70 × 4,100 = 15,170 → 15,200 riel.
      const r = await saveAndPostReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "direct", receiptDate: "2026-11-09", lines: [{ itemId: ice.id, unitKey: "base", qty: "10", unitCost: "0.37" }], extraCosts: [] }, { methodId: w.methods.cash, currencyCode: "KHR", paidFromDrawer: { registerId: w.reg.id } });
      const [mv] = await tx.select().from(cashMovements).where(and(eq(cashMovements.refType, "goods_receipt"), eq(cashMovements.refId, r.id)));
      expect(mv.amount).toBe("15200.0000");
    });
  });
});
