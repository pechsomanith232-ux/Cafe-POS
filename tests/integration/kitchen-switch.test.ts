import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { orderLines, paymentMethods, registers } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { getPosMenu } from "@/lib/queries/pos";
import { saveProduct } from "@/lib/services/menu";
import { saveOrder } from "@/lib/services/orders";
import { payOrder } from "@/lib/services/payments";
import { saveBranchPosSettings } from "@/lib/services/pos-settings";
import { openShift } from "@/lib/services/shifts";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("kitchen switch (owner's answer, 2026-11-10: kitchen is optional)", () => {
  it("with the kitchen off, nothing is sent: Kitchen is refused and paying doesn't queue lines", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const owner = await w.ctxFor(w.users.owner);
      await saveBranchPosSettings(owner, { branchId: w.b1.id, varianceThreshold: "1.00", variancePinRequired: true, allowNegativeStock: true, kitchenEnabled: false });
      await saveProduct(owner, null, { name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [], variants: [{ name: "Cup", price: "2.00", deductStock: null, isDefault: true, recipe: [] }] });
      const v = (await getPosMenu(owner)).products[0].variants[0].id;
      const [reg] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
      await openShift(owner, { branchId: w.b1.id, registerId: reg.id, floats: [] });
      const input = { branchId: w.b1.id, registerId: reg.id, orderType: "takeaway" as const, orderDiscount: null, lines: [{ variantId: v, qty: 1, modifierIds: [], discount: null }] };
      await expect(saveOrder(owner, { ...input, then: "send" })).rejects.toThrow(ValidationError);
      const o = await saveOrder(owner, input);
      const [cash] = (await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id))).filter((m) => m.type === "cash");
      await payOrder(owner, o.id, { registerId: reg.id, tenders: [{ methodId: cash.id, currencyCode: "USD", amount: "2" }], changeCurrency: "USD" });
      const [l] = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
      expect(l.sentToKitchenAt).toBeNull();
    });
  });
});
