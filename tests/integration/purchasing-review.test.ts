import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditLog, branches, goodsReceiptLines, goodsReceipts, items, organizations, paymentMethods, roles, stockLevels, stockMovements,
  supplierPaymentAllocations, supplierPayments, suppliers, userBranchRoles,
} from "@/db/schema";
import { insertAuthUser } from "@/lib/auth-users";
import { buildContext } from "@/lib/context-builder";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { apAging, getReceipt, getSupplier, listOpenReceipts, listSupplierOptions } from "@/lib/queries/purchasing";
import { createItem } from "@/lib/services/inventory";
import {
  allocateSupplierCredit, createSupplier, createSupplierReturn, deleteReceipt, postGoodsReceipt, recordSupplierPayment,
  saveAndPostReceipt, saveReceipt, updateSupplier,
} from "@/lib/services/purchasing";
import { createRole } from "@/lib/services/roles";
import { assignBranchRole } from "@/lib/services/users";
import { cleanupCommitted, closeTestDb, testDb, withRollback, type TestTx } from "./helpers/db";
import { createItem as createRawItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const milk = await createItem(owner, { name: "Milk", baseUnitCode: "ml", units: [{ name: "case", factor: "12000", isPurchaseDefault: true, isCountDefault: false }] });
  const supplier = await createSupplier(owner, { name: "Dairy Co", paymentTermsDays: 30 });
  const methods = await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id));
  const cash = methods.find((m) => m.type === "cash")!;
  const credit = async (amount: string, date = "2026-08-01", qty = "1") => {
    const r = await saveReceipt(owner, null, { branchId: w.b1.id, purchaseType: "credit", supplierId: supplier.id, receiptDate: date, lines: [{ itemId: milk.id, unitKey: "base", qty, unitCost: amount }], extraCosts: [] });
    await postGoodsReceipt(owner, r.id);
    return r;
  };
  return { ...w, owner, milk, supplier, cash, credit };
}

describe("review #1: Post & Pay is one transaction", () => {
  it("leaves no draft behind when payment details are invalid", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const input = { branchId: w.b1.id, purchaseType: "direct" as const, receiptDate: "2026-11-08", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "100", unitCost: "0.002" }], extraCosts: [] };
      await expect(saveAndPostReceipt(w.owner, null, input, { methodId: w.cash.id, currencyCode: "XXX" })).rejects.toThrow(/currency/i);
      expect((await tx.select({ n: count() }).from(goodsReceipts))[0].n).toBe(0);
      const ok = await saveAndPostReceipt(w.owner, null, input, { methodId: w.cash.id, currencyCode: "USD" });
      expect((await getReceipt(w.owner, ok.id)).status).toBe("posted");
    });
  });
});

describe("review #2: AP aging as of a past date", () => {
  it("uses the balance owed on that date, ignoring later payments", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await w.credit("40", "2026-08-01"); // due 2026-08-31
      await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2099-01-01", methodId: w.cash.id, currencyCode: "USD", amount: "40" });
      const past = await apAging(w.owner, { branchId: w.b1.id, asOf: "2026-10-31" });
      expect(past.rows[0]).toMatchObject({ d61_90: "40.0000", total: "40.0000" });
      const later = await apAging(w.owner, { branchId: w.b1.id, asOf: "2099-02-01" });
      expect(later.rows).toHaveLength(0);
    });
  });
});

describe("review #3: riel payments at uneven rates close the invoice", () => {
  it("$10 paid with 41,200 riel at 4,123 is paid, writing off the sub-cent difference", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.credit("10");
      await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-08-05", methodId: w.cash.id, currencyCode: "KHR", amount: "41200", rate: "4123" });
      const after = await getReceipt(w.owner, r.id);
      expect(after).toMatchObject({ paymentStatus: "paid", amountDue: "0.0000", roundingBase: "0.0073" });
      expect(await listOpenReceipts(w.owner, w.supplier.id, w.b1.id)).toHaveLength(0);
      expect((await apAging(w.owner, { branchId: w.b1.id, asOf: "2026-08-10" })).rows).toHaveLength(0);
    });
  });
});

describe("review #5: direct-only users can't see credit purchasing", () => {
  it("can open direct receipts but not credit receipts, open invoices or balances", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const creditR = await w.credit("10");
      const directOnly = await createRole(w.owner, { name: "Market buyer", permissions: [{ key: "purchasing.direct" }, { key: "inventory.view" }] });
      await assignBranchRole(w.owner, { userId: w.users.cashier, branchId: w.b1.id, roleId: directOnly.id });
      const buyer = await w.ctxFor(w.users.cashier);
      const d = await saveAndPostReceipt(buyer, null, { branchId: w.b1.id, purchaseType: "direct", receiptDate: "2026-11-08", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] }, { methodId: w.cash.id, currencyCode: "USD" });
      expect((await getReceipt(buyer, d.id)).purchaseType).toBe("direct");
      await expect(getReceipt(buyer, creditR.id)).rejects.toThrow(ForbiddenError);
      await expect(listOpenReceipts(buyer, w.supplier.id, w.b1.id)).rejects.toThrow(ForbiddenError);
      const opts = await listSupplierOptions(buyer);
      expect(opts[0].owed).toBeNull();
    });
  });
});

describe("review minor: returns and credit", () => {
  it("three returns of 1/3 never credit more than the line cost", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.credit("12.666667", "2026-08-01", "3");
      const line = (await getReceipt(w.owner, r.id)).lines[0];
      for (let i = 0; i < 3; i++) await createSupplierReturn(w.owner, { receiptId: r.id, returnDate: "2026-08-02", reason: "x", lines: [{ receiptLineId: line.id, qty: "1" }] });
      const after = await getReceipt(w.owner, r.id);
      expect(after.returnedTotal).toBe(after.total);
      expect((await getSupplier(w.owner, w.supplier.id)).creditBalance).toBe("0.0000");
    });
  });
});

describe("review #4: §13 gaps", () => {
  it("updates a supplier with an audit row; cashiers are refused", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await updateSupplier(w.owner, w.supplier.id, { name: "Dairy Co Ltd", paymentTermsDays: 15 });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "supplier.update"));
      expect(log.after).toMatchObject({ name: "Dairy Co Ltd", paymentTermsDays: 15 });
      await expect(updateSupplier(await w.ctxFor(w.users.cashier), w.supplier.id, { name: "X" })).rejects.toThrow(ForbiddenError);
    });
  });

  it("deletes drafts only, with permission, at the user's branch", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const input = { branchId: w.b1.id, purchaseType: "credit" as const, supplierId: w.supplier.id, receiptDate: "2026-11-01", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }], extraCosts: [] };
      const d = await saveReceipt(w.owner, null, input);
      await expect(deleteReceipt(await w.ctxFor(w.users.cashier), d.id)).rejects.toThrow(ForbiddenError);
      const b2 = await w.ctxFor(w.users.b2user);
      const other = await saveReceipt(b2, null, { ...input, branchId: w.b2.id });
      await expect(deleteReceipt(w.owner, other.id)).rejects.toThrow(ForbiddenError);
      await deleteReceipt(w.owner, d.id);
      await expect(getReceipt(w.owner, d.id)).rejects.toThrow(NotFoundError);
      const posted = await w.credit("1");
      await expect(deleteReceipt(w.owner, posted.id)).rejects.toThrow(/can't be deleted/);
    });
  });

  it("refuses credit allocation without permission or at another branch, and returns by cashiers", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await w.credit("10");
      const p = await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: w.supplier.id, paymentDate: "2026-08-05", methodId: w.cash.id, currencyCode: "USD", amount: "15" });
      const cashier = await w.ctxFor(w.users.cashier);
      await expect(allocateSupplierCredit(cashier, p.id, [{ receiptId: r.id, amount: "1" }])).rejects.toThrow(ForbiddenError);
      await expect(allocateSupplierCredit(await w.ctxFor(w.users.b2user), p.id, [{ receiptId: r.id, amount: "1" }])).rejects.toThrow();
      const line = (await getReceipt(w.owner, r.id)).lines[0];
      await expect(createSupplierReturn(cashier, { receiptId: r.id, returnDate: "2026-08-06", reason: "x", lines: [{ receiptLineId: line.id, qty: "1" }] })).rejects.toThrow(ForbiddenError);
    });
  });

  it("refuses another organization's supplier, item or payment method", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const [other] = await tx.insert(organizations).values({ name: "Other" }).returning();
      const [foreignSupplier] = await tx.insert(suppliers).values({ orgId: other.id, name: "Foreign" }).returning();
      const foreignItem = await createRawItem(tx, other.id, { name: "Foreign item", base: "pcs" });
      const [otherBranch] = await tx.insert(branches).values({ orgId: other.id, code: "OB", name: "Other branch" }).returning();
      const [foreignMethod] = await tx.insert(paymentMethods).values({ orgId: other.id, branchId: otherBranch.id, name: "Foreign cash", type: "cash" }).returning();
      const base = { branchId: w.b1.id, receiptDate: "2026-11-01", extraCosts: [] };
      await expect(saveReceipt(w.owner, null, { ...base, purchaseType: "credit", supplierId: foreignSupplier.id, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }] })).rejects.toThrow(ValidationError);
      await expect(saveReceipt(w.owner, null, { ...base, purchaseType: "credit", supplierId: w.supplier.id, lines: [{ itemId: foreignItem.id, unitKey: "base", qty: "1", unitCost: "1" }] })).rejects.toThrow(ValidationError);
      await expect(saveAndPostReceipt(w.owner, null, { ...base, purchaseType: "direct", lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1", unitCost: "1" }] }, { methodId: foreignMethod.id, currencyCode: "USD" })).rejects.toThrow(ValidationError);
    });
  });
});

describe("review #4: purchasing concurrency (committed data)", () => {
  it("two parallel $30 payments on a $50 invoice: one succeeds, nothing over-allocated; double post refused", async () => {
    const ids = { org: "", branch: "", users: [] as string[] };
    try {
      // Minimal committed world: org, branch, Owner-like role, one user, item, supplier, method.
      const [org] = await testDb.insert(organizations).values({ name: "PCO" }).returning(); ids.org = org.id;
      const [branch] = await testDb.insert(branches).values({ orgId: org.id, code: "PC", name: "PC" }).returning(); ids.branch = branch.id;
      const [role] = await testDb.insert(roles).values({ orgId: org.id, name: "Boss" }).returning();
      const { permissions, rolePermissions } = await import("@/db/schema");
      const keys = ["purchasing.view", "purchasing.receive", "purchasing.pay", "inventory.manage_items"];
      await testDb.insert(permissions).values(keys.map((k) => ({ key: k, description: k }))).onConflictDoNothing();
      await testDb.insert(rolePermissions).values(keys.map((k) => ({ roleId: role.id, permissionKey: k })));
      const uid = await insertAuthUser(testDb, { orgId: org.id, email: "pc-boss@test.local", name: "Boss", password: "boss-pass-1" }); ids.users.push(uid);
      await testDb.insert(userBranchRoles).values({ userId: uid, branchId: branch.id, roleId: role.id });
      const ctx = await buildContext(testDb, { userId: uid });
      const item = await createRawItem(testDb, org.id, { name: "Beans", base: "g" });
      const [sup] = await testDb.insert(suppliers).values({ orgId: org.id, name: "S" }).returning();
      const [method] = await testDb.insert(paymentMethods).values({ orgId: org.id, branchId: branch.id, name: "Bank", type: "bank_transfer" }).returning();
      const draft = await saveReceipt(ctx, null, { branchId: branch.id, purchaseType: "credit", supplierId: sup.id, receiptDate: "2026-11-01", lines: [{ itemId: item.id, unitKey: "base", qty: "1000", unitCost: "0.05" }], extraCosts: [] });

      const posts = await Promise.allSettled([postGoodsReceipt(ctx, draft.id), postGoodsReceipt(ctx, draft.id)]);
      expect(posts.filter((p) => p.status === "fulfilled")).toHaveLength(1);
      expect((await testDb.select({ n: count() }).from(stockMovements).where(eq(stockMovements.refId, draft.id)))[0].n).toBe(1);

      const pay = () => recordSupplierPayment(ctx, { branchId: branch.id, supplierId: sup.id, paymentDate: "2026-11-05", methodId: method.id, currencyCode: "USD", amount: "30", allocations: [{ receiptId: draft.id, amount: "30" }] });
      const pays = await Promise.allSettled([pay(), pay()]);
      expect(pays.filter((p) => p.status === "fulfilled")).toHaveLength(1);
      const [r] = await testDb.select().from(goodsReceipts).where(eq(goodsReceipts.id, draft.id));
      expect(r.amountDue).toBe("20.0000");
    } finally {
      await cleanupCommitted(async (tx) => {
        if (!ids.org) return;
        const recs = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.branchId, ids.branch));
        const recIds = recs.map((r) => r.id);
        if (recIds.length) {
          await tx.delete(supplierPaymentAllocations).where(inArray(supplierPaymentAllocations.receiptId, recIds));
          await tx.delete(goodsReceiptLines).where(inArray(goodsReceiptLines.receiptId, recIds));
        }
        await tx.delete(supplierPayments).where(eq(supplierPayments.branchId, ids.branch));
        await tx.delete(goodsReceipts).where(eq(goodsReceipts.branchId, ids.branch));
        await tx.delete(stockMovements).where(eq(stockMovements.branchId, ids.branch));
        await tx.delete(stockLevels).where(eq(stockLevels.branchId, ids.branch));
        await tx.delete(auditLog).where(eq(auditLog.orgId, ids.org));
        await tx.delete(userBranchRoles).where(eq(userBranchRoles.branchId, ids.branch));
        const { account, session, user, rolePermissions } = await import("@/db/schema");
        if (ids.users.length) {
          // FKs are off during cleanup (replica mode), so remove auth rows explicitly.
          await tx.delete(session).where(inArray(session.userId, ids.users));
          await tx.delete(account).where(inArray(account.userId, ids.users));
          await tx.delete(user).where(inArray(user.id, ids.users));
        }
        const rs = await tx.select({ id: roles.id }).from(roles).where(eq(roles.orgId, ids.org));
        if (rs.length) await tx.delete(rolePermissions).where(inArray(rolePermissions.roleId, rs.map((x) => x.id)));
        await tx.delete(roles).where(eq(roles.orgId, ids.org));
        await tx.delete(paymentMethods).where(eq(paymentMethods.orgId, ids.org));
        await tx.delete(suppliers).where(eq(suppliers.orgId, ids.org));
        await tx.delete(items).where(eq(items.orgId, ids.org));
        await tx.delete(branches).where(eq(branches.id, ids.branch));
        await tx.delete(organizations).where(and(eq(organizations.id, ids.org)));
      });
    }
  });
});
