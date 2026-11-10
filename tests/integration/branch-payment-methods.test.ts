import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { paymentMethods, registers, userBranchRoles } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getPosMenu } from "@/lib/queries/pos";
import { listAllPaymentMethods } from "@/lib/queries/pos";
import { listPaymentMethods } from "@/lib/queries/purchasing";
import { saveProduct } from "@/lib/services/menu";
import { saveOrder } from "@/lib/services/orders";
import { payOrder } from "@/lib/services/payments";
import { savePaymentMethod } from "@/lib/services/pos-settings";
import { openShift } from "@/lib/services/shifts";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("payment methods are per branch (owner's answer, 2026-11-10)", () => {
  it("every branch gets its own default methods", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const rows = await tx.select().from(paymentMethods).where(eq(paymentMethods.orgId, w.org.id));
      for (const b of [w.b1.id, w.b2.id]) {
        expect(rows.filter((m) => m.branchId === b).map((m) => m.type).sort()).toEqual(["account", "bank_transfer", "card", "cash", "khqr"]);
      }
    });
  });

  it("a method added at one branch shows only there, and another branch can't edit it", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
      const owner = await w.ctxFor(w.users.owner, w.b1.id);
      const b2 = await w.ctxFor(w.users.owner, w.b2.id); // same owner, working at B2
      const aba = await savePaymentMethod(owner, null, { name: "ABA Pay", type: "khqr", isActive: true });
      expect(aba.branchId).toBe(w.b1.id);
      expect((await listPaymentMethods(owner)).map((m) => m.name)).toContain("ABA Pay");
      expect((await listAllPaymentMethods(b2)).map((m) => m.name)).not.toContain("ABA Pay");
      // Same name is fine at another branch; editing B1's method from B2 is not.
      await savePaymentMethod(b2, null, { name: "ABA Pay", type: "khqr", isActive: true });
      await expect(savePaymentMethod(b2, aba.id, { name: "Hacked", type: "khqr", isActive: true })).rejects.toThrow(NotFoundError);
      // A document of another branch lists that branch's methods (e.g. a B1 receipt opened while working at B2).
      expect((await listPaymentMethods(b2, w.b1.id)).map((m) => m.branchId)).toEqual(expect.arrayContaining([w.b1.id]));
      expect((await listPaymentMethods(b2, w.b1.id)).every((m) => m.branchId === w.b1.id)).toBe(true);
    });
  });

  it("a B2 method can't take payment for a B1 order", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const owner = await w.ctxFor(w.users.owner);
      await saveProduct(owner, null, { name: "Cookie", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1.00", deductStock: null, isDefault: true, recipe: [] }] });
      const v = (await getPosMenu(owner)).products[0].variants[0].id;
      const [reg] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
      await openShift(owner, { branchId: w.b1.id, registerId: reg.id, floats: [{ currencyCode: "USD", amount: "0" }] });
      const o = await saveOrder(owner, { branchId: w.b1.id, registerId: reg.id, orderType: "takeaway", orderDiscount: null, lines: [{ variantId: v, qty: 1, modifierIds: [], discount: null }] });
      const [b2cash] = await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b2.id)).then((r) => r.filter((m) => m.type === "cash"));
      await expect(payOrder(owner, o.id, { registerId: reg.id, tenders: [{ methodId: b2cash.id, currencyCode: "USD", amount: "1" }], changeCurrency: "USD" })).rejects.toThrow(ValidationError);
    });
  });
});
