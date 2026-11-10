import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, paymentMethods, stockLevels, stockMovements, supplierPayments } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { apAging, getReceipt, getSupplier, supplierStatement } from "@/lib/queries/purchasing";
import { createItem } from "@/lib/services/inventory";
import {
  allocateSupplierCredit,
  createSupplier,
  createSupplierReturn,
  postGoodsReceipt,
  recordSupplierPayment,
  saveReceipt,
} from "@/lib/services/purchasing";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const milk = await createItem(owner, {
    name: "Fresh Milk", baseUnitCode: "ml",
    units: [{ name: "bottle", factor: "1000", isPurchaseDefault: false, isCountDefault: true }, { name: "case", factor: "12000", isPurchaseDefault: true, isCountDefault: false }],
  });
  const caseKey = `iu:${milk.units.find((u) => u.name === "case")!.id}`;
  const supplier = await createSupplier(owner, { name: "Dairy Co", paymentTermsDays: 30 });
  const methods = await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id));
  const cash = methods.find((m) => m.type === "cash")!;
  const bank = methods.find((m) => m.type === "bank_transfer")!;
  const creditReceipt = (lines: { qty: string; unitCost: string }[], extra: { description: string; amount: string }[] = [], date = "2026-11-01") =>
    saveReceipt(owner, null, {
      branchId: w.b1.id, purchaseType: "credit", supplierId: supplier.id, supplierInvoiceNo: "INV-1", receiptDate: date,
      lines: lines.map((l) => ({ itemId: milk.id, unitKey: caseKey, ...l })), extraCosts: extra,
    });
  return { ...w, owner, milk, caseKey, supplier, cash, bank, creditReceipt };
}

describe("goods receipts (credit)", () => {
  it("2 cases @ $18 + $2 delivery → landed cost and WAC (Phase 3 acceptance)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "2", unitCost: "18" }], [{ description: "Delivery", amount: "2" }]);
      expect(r).toMatchObject({ status: "draft", subtotal: "36.0000", extraCosts: "2.0000", total: "38.0000" });
      await postGoodsReceipt(w.owner, r.id);

      const [mv] = await tx.select().from(stockMovements).where(eq(stockMovements.refId, r.id));
      expect(mv).toMatchObject({ movementType: "purchase", qtyBase: "24000.0000", totalCost: "38.0000", unitCost: "0.001583", refType: "goods_receipt" });
      const [lvl] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, w.milk.id));
      expect(lvl).toMatchObject({ qtyOnHand: "24000.0000", avgCost: "0.001583" });
      const after = await getReceipt(w.owner, r.id);
      expect(after).toMatchObject({ status: "posted", amountDue: "38.0000", paymentStatus: "unpaid", dueDate: "2026-12-01" });
      expect(after.lines[0]).toMatchObject({ allocatedExtra: "2.0000", landedTotal: "38.0000", landedUnitCostBase: "0.001583" });
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "goods_receipt.post"))).toHaveLength(1);
    });
  });

  it("can't be posted twice or edited after posting", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "1", unitCost: "18" }]);
      await postGoodsReceipt(w.owner, r.id);
      await expect(postGoodsReceipt(w.owner, r.id)).rejects.toThrow(/already posted/);
      await expect(
        saveReceipt(w.owner, r.id, { branchId: w.b1.id, purchaseType: "credit", supplierId: w.supplier.id, receiptDate: "2026-11-01", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] }),
      ).rejects.toThrow(/draft/);
    });
  });

  it("needs a supplier and at least one line", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(saveReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "credit", receiptDate: "2026-11-01", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] })).rejects.toThrow(ValidationError);
      await expect(saveReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "credit", supplierId: w.supplier.id, receiptDate: "2026-11-01", lines: [], extraCosts: [] })).rejects.toThrow(ValidationError);
    });
  });
});

describe("supplier payments", () => {
  it("$50 invoice paid $20 then $30 goes partial → paid (Phase 3 acceptance)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "1", unitCost: "50" }]);
      await postGoodsReceipt(w.owner, r.id);
      const pay = (amount: string) =>
        recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount });
      await pay("20");
      expect(await getReceipt(w.owner, r.id)).toMatchObject({ amountPaid: "20.0000", amountDue: "30.0000", paymentStatus: "partial" });
      await pay("30");
      expect(await getReceipt(w.owner, r.id)).toMatchObject({ amountDue: "0.0000", paymentStatus: "paid" });
    });
  });

  it("allocates oldest first; an overpayment becomes supplier credit that can be applied later", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r1 = await w.creditReceipt([{ qty: "1", unitCost: "10" }], [], "2026-10-01");
      const r2 = await w.creditReceipt([{ qty: "1", unitCost: "20" }], [], "2026-10-15");
      await postGoodsReceipt(w.owner, r2.id);
      await postGoodsReceipt(w.owner, r1.id);
      const p = await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "40" });
      expect((await getReceipt(w.owner, r1.id)).paymentStatus).toBe("paid");
      expect((await getReceipt(w.owner, r2.id)).paymentStatus).toBe("paid");
      expect((await getSupplier(w.owner, w.supplier.id)).creditBalance).toBe("10.0000");

      const r3 = await w.creditReceipt([{ qty: "1", unitCost: "25" }], [], "2026-11-06");
      await postGoodsReceipt(w.owner, r3.id);
      await allocateSupplierCredit(w.owner, p.id, [{ receiptId: r3.id, amount: "10" }]);
      expect(await getReceipt(w.owner, r3.id)).toMatchObject({ amountDue: "15.0000", paymentStatus: "partial" });
      expect((await getSupplier(w.owner, w.supplier.id)).creditBalance).toBe("0.0000");
    });
  });

  it("converts KHR at the typed rate (else the branch rate) and refuses allocations above what's due or to another supplier", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "1", unitCost: "10" }]);
      await postGoodsReceipt(w.owner, r.id);
      // No typed rate → the branch's rate (4,100 by default): 4,100 riel = $1.
      const byBranch = await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.cash.id, currencyCode: "KHR", amount: "4100", allocations: [{ receiptId: r.id, amount: "1" }] });
      expect((await tx.select().from(supplierPayments).where(eq(supplierPayments.id, byBranch.id)))[0]).toMatchObject({ amountBase: "1.0000", rateUsed: "4100.000000" });
      const p = await recordSupplierPayment(w.owner, {
        branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.cash.id, currencyCode: "KHR", amount: "20500", rate: "4100",
        allocations: [{ receiptId: r.id, amount: "5" }],
      });
      const [row] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, p.id));
      expect(row).toMatchObject({ amountBase: "5.0000", rateUsed: "4100.000000", unallocatedBase: "0.0000" });
      await expect(
        recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "20", allocations: [{ receiptId: r.id, amount: "20" }] }),
      ).rejects.toThrow(/more than/);
      const other = await createSupplier(w.owner, { name: "Other Co" });
      await expect(
        recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: other.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "1", allocations: [{ receiptId: r.id, amount: "1" }] }),
      ).rejects.toThrow(ValidationError);
    });
  });
});

describe("direct purchases (pay now)", () => {
  it("updates stock and WAC, is paid immediately and never shows in AP aging (Phase 3 acceptance)", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await saveReceipt(w.owner, null, {
        branchId: w.b1.id, purchaseType: "direct", supplierNameText: "Central Market", receiptDate: "2026-11-08",
        lines: [{ itemId: w.milk.id, unitKey: "base", qty: "2000", unitCost: "0.002" }], extraCosts: [],
      });
      await postGoodsReceipt(w.owner, r.id, { methodId: w.cash.id, currencyCode: "KHR", rate: "4000" });
      const after = await getReceipt(w.owner, r.id);
      expect(after).toMatchObject({ status: "posted", purchaseType: "direct", amountDue: "0.0000", paymentStatus: "paid", dueDate: null, supplierNameText: "Central Market" });
      const [pay] = await tx.select().from(supplierPayments).where(eq(supplierPayments.branchId, w.b1.id));
      expect(pay).toMatchObject({ amountBase: "4.0000", amount: "16000.0000", currencyCode: "KHR", unallocatedBase: "0.0000" });
      const [lvl] = await tx.select().from(stockLevels).where(eq(stockLevels.itemId, w.milk.id));
      expect(lvl).toMatchObject({ qtyOnHand: "2000.0000", avgCost: "0.002000" });
      const aging = await apAging(w.owner, { branchId: w.b1.id, asOf: "2027-06-01" });
      expect(aging.rows).toHaveLength(0);
    });
  });

  it("needs a payment method to post, and purchasing.direct", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const input = { branchId: w.b1.id, purchaseType: "direct" as const, receiptDate: "2026-11-08", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] };
      const r = await saveReceipt(w.owner, null, input);
      await expect(postGoodsReceipt(w.owner, r.id)).rejects.toThrow(/payment/);
      await expect(saveReceipt(await w.ctxFor(w.users.cashier), null, input)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("supplier returns", () => {
  it("credit receipt: goes out at landed cost and credits the receipt", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "2", unitCost: "18" }], [{ description: "Delivery", amount: "2" }]);
      await postGoodsReceipt(w.owner, r.id);
      const line = (await getReceipt(w.owner, r.id)).lines[0];
      await createSupplierReturn(w.owner, { receiptId: r.id, returnDate: "2026-11-03", reason: "Sour", lines: [{ receiptLineId: line.id, qty: "1" }] });
      const [mv] = await tx.select().from(stockMovements).where(and(eq(stockMovements.movementType, "purchase_return"), eq(stockMovements.itemId, w.milk.id)));
      expect(mv).toMatchObject({ qtyBase: "-12000.0000", unitCost: "0.001583", totalCost: "-19.0000" });
      const after = await getReceipt(w.owner, r.id);
      expect(after).toMatchObject({ returnedTotal: "19.0000", amountDue: "19.0000", paymentStatus: "partial" });
      await expect(
        createSupplierReturn(w.owner, { receiptId: r.id, returnDate: "2026-11-03", reason: "Again", lines: [{ receiptLineId: line.id, qty: "1.5" }] }),
      ).rejects.toThrow(/more than/);
    });
  });

  it("direct receipt: records a refund, no AP", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await saveReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "direct", receiptDate: "2026-11-08", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1000", unitCost: "0.002" }], extraCosts: [] });
      await postGoodsReceipt(w.owner, r.id, { methodId: w.cash.id, currencyCode: "USD" });
      const line = (await getReceipt(w.owner, r.id)).lines[0];
      const ret = await createSupplierReturn(w.owner, { receiptId: r.id, returnDate: "2026-11-08", reason: "Spoiled", lines: [{ receiptLineId: line.id, qty: "500" }], refund: { methodId: w.cash.id, currencyCode: "USD" } });
      expect(ret).toMatchObject({ total: "1.0000", refundAmount: "1.0000", creditPaymentId: null });
      expect(await getReceipt(w.owner, r.id)).toMatchObject({ amountDue: "0.0000", paymentStatus: "paid" });
    });
  });
});

describe("AP aging and statements", () => {
  it("buckets open invoices by days overdue as of a date", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r1 = await w.creditReceipt([{ qty: "1", unitCost: "10" }], [], "2026-09-01"); // due 2026-10-01
      const r2 = await w.creditReceipt([{ qty: "1", unitCost: "5" }], [], "2026-11-01"); // due 2026-12-01
      await postGoodsReceipt(w.owner, r1.id);
      await postGoodsReceipt(w.owner, r2.id);
      const aging = await apAging(w.owner, { branchId: w.b1.id, asOf: "2026-11-08" });
      expect(aging.rows).toHaveLength(1);
      expect(aging.rows[0]).toMatchObject({ supplierName: "Dairy Co", current: "5.0000", d31_60: "10.0000", total: "15.0000" });
      expect(aging.totals.total).toBe("15.0000");
    });
  });

  it("statement shows invoices and payments with a running balance", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.creditReceipt([{ qty: "1", unitCost: "50" }]);
      await postGoodsReceipt(w.owner, r.id);
      await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "20" });
      const st = await supplierStatement(w.owner, { supplierId: w.supplier.id, branchId: w.b1.id });
      expect(st.rows.map((x: { kind: string; debit: string | null; credit: string | null; balance: string }) => [x.kind, x.debit, x.credit, x.balance])).toEqual([
        ["receipt", "50.0000", null, "50.0000"],
        ["payment", null, "20.0000", "30.0000"],
      ]);
    });
  });
});

describe("permissions and branches", () => {
  it("rejects cashiers for suppliers, receipts and payments", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const c = await w.ctxFor(w.users.cashier);
      await expect(createSupplier(c, { name: "X" })).rejects.toThrow(ForbiddenError);
      await expect(w.creditReceipt([{ qty: "1", unitCost: "1" }]).then((r) => postGoodsReceipt(c, r.id))).rejects.toThrow(ForbiddenError);
      await expect(recordSupplierPayment(c, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "1" })).rejects.toThrow(ForbiddenError);
      await expect(apAging(c, { branchId: w.b1.id, asOf: "2026-11-08" })).rejects.toThrow(ForbiddenError);
    });
  });

  it("rejects receipts, returns and payments at a branch the user isn't in", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const b2 = await w.ctxFor(w.users.b2user);
      const r = await saveReceipt(b2, null, { branchId: w.b2.id, purchaseType: "credit", supplierId: w.supplier.id, receiptDate: "2026-11-01", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] });
      await expect(postGoodsReceipt(w.owner, r.id)).rejects.toThrow(ForbiddenError);
      await expect(getReceipt(w.owner, r.id)).rejects.toThrow();
      await expect(recordSupplierPayment(w.owner, { branchId: w.b2.id, supplierId: w.supplier.id, paymentDate: "2026-11-05", methodId: w.bank.id, currencyCode: "USD", amount: "1" })).rejects.toThrow(ForbiddenError);
      await postGoodsReceipt(b2, r.id);
      const line = (await getReceipt(b2, r.id)).lines[0];
      await expect(createSupplierReturn(w.owner, { receiptId: r.id, returnDate: "2026-11-02", reason: "x", lines: [{ receiptLineId: line.id, qty: "1" }] })).rejects.toThrow(ForbiddenError);
      await expect(apAging(w.owner, { branchId: w.b2.id, asOf: "2026-11-08" })).rejects.toThrow(ForbiddenError);

    });
  });
});
