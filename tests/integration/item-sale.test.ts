import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { items, paymentMethods, products, registers, stockMovements } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getItemSale } from "@/lib/queries/menu";
import { getPosMenu } from "@/lib/queries/pos";
import { setOpeningStock } from "@/lib/services/inventory";
import { setItemSale } from "@/lib/services/item-sale";
import { saveProduct } from "@/lib/services/menu";
import { uploadProductImage } from "@/lib/services/menu-images";
import { saveOrder } from "@/lib/services/orders";
import { payOrder } from "@/lib/services/payments";
import { openShift } from "@/lib/services/shifts";
import { localDriver } from "@/lib/storage";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  await closeTestDb();
});

const on = (price = "0.75", unitKey = "base") => ({ enabled: true, price, categoryId: null, unitKey });

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const cashier = await w.ctxFor(w.users.cashier);
  const water = await createItem(tx, w.org.id, { name: "Water Bottle", base: "pcs" });
  return { ...w, tx, owner, cashier, water };
}

const posProduct = async (ctx: Awaited<ReturnType<typeof setup>>["owner"], name: string) =>
  (await getPosMenu(ctx)).products.find((p) => p.name === name);

describe("setItemSale", () => {
  it("enabling creates a POS product at the price", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await setItemSale(f.owner, f.water.id, on("0.75"));
      const p = await posProduct(f.owner, "Water Bottle");
      expect(p).toBeDefined();
      expect(p!.variants).toHaveLength(1);
      expect(p!.variants[0].name).toBe("Each");
      expect(p!.variants[0].price).toBe("0.7500");
    });
  });

  it("deducts the unit factor", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const milk = await createItem(tx, f.org.id, { name: "Spring Water", base: "ml", packaging: [{ name: "bottle", factor: "1000" }] });
      const beans = await createItem(tx, f.org.id, { name: "Beans", base: "g" });
      const [bottle] = await tx.select().from(items).where(eq(items.id, milk.id));
      const unitKey = `iu:${(await tx.query.itemUnits.findFirst({ where: (u, { eq }) => eq(u.itemId, bottle.id) }))!.id}`;
      await setOpeningStock(f.owner, { branchId: f.b1.id, itemId: milk.id, unitKey: "base", qty: "10000", unitCost: "0.001" });
      await setOpeningStock(f.owner, { branchId: f.b1.id, itemId: beans.id, unitKey: "base", qty: "1000", unitCost: "0.02" });
      await saveProduct(f.owner, null, { name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [], variants: [
        { name: "Regular", price: "2.50", deductStock: null, isDefault: true, recipe: [{ itemId: beans.id, unitKey: "base", qty: "18" }] },
      ] });
      await setItemSale(f.owner, milk.id, on("1.00", unitKey));

      const menu = await getPosMenu(f.owner);
      const latte = menu.products.find((p) => p.name === "Latte")!.variants[0].id;
      const water = menu.products.find((p) => p.name === "Spring Water")!.variants[0].id;
      const [reg] = await tx.select().from(registers).where(eq(registers.branchId, f.b1.id));
      await openShift(f.owner, { branchId: f.b1.id, registerId: reg.id, floats: [] });
      const [cash] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.branchId, f.b1.id), eq(paymentMethods.type, "cash")));
      const order = await saveOrder(f.owner, { branchId: f.b1.id, registerId: reg.id, orderType: "takeaway", orderDiscount: null, lines: [
        { variantId: latte, qty: 1, modifierIds: [], discount: null },
        { variantId: water, qty: 1, modifierIds: [], discount: null },
      ] });
      await payOrder(f.owner, order.id, { registerId: reg.id, tenders: [{ methodId: cash.id, currencyCode: "USD", amount: order.total }] });

      const sales = await tx.select().from(stockMovements).where(eq(stockMovements.movementType, "sale"));
      const waterMove = sales.find((m) => m.itemId === milk.id)!;
      expect(waterMove.qtyBase).toBe("-1000.0000");
      expect(waterMove.unitCost).toBe("0.001000");
      expect(sales.find((m) => m.itemId === beans.id)!.qtyBase).toBe("-18.0000");
    });
  });

  it("switching off hides it and keeps history", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const { productId } = await setItemSale(f.owner, f.water.id, on());
      await setItemSale(f.owner, f.water.id, { ...on(), enabled: false });
      expect(await posProduct(f.owner, "Water Bottle")).toBeUndefined();
      const [p] = await tx.select().from(products).where(eq(products.id, productId));
      expect(p.isActive).toBe(false);
    });
  });

  it("off then on reuses the product", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const a = await setItemSale(f.owner, f.water.id, on());
      await setItemSale(f.owner, f.water.id, { ...on(), enabled: false });
      const b = await setItemSale(f.owner, f.water.id, on("0.80"));
      expect(b.productId).toBe(a.productId);
      const linked = await tx.select().from(products).where(eq(products.sourceItemId, f.water.id));
      expect(linked).toHaveLength(1);
      expect((await posProduct(f.owner, "Water Bottle"))!.variants[0].price).toBe("0.8000");
    });
  });

  it("name clash is a clear error", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await saveProduct(f.owner, null, { name: "Water Bottle", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1", deductStock: null, isDefault: true, recipe: [] }] });
      await expect(setItemSale(f.owner, f.water.id, on())).rejects.toThrow(ConflictError);
      await expect(setItemSale(f.owner, f.water.id, on())).rejects.toThrow(/already exists/);
    });
  });

  it("saveProduct refuses a managed product", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const { productId } = await setItemSale(f.owner, f.water.id, on());
      await expect(saveProduct(f.owner, productId, { name: "Water Bottle", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "5", deductStock: null, isDefault: true, recipe: [] }] }))
        .rejects.toThrow("Edit this from its inventory item.");
    });
  });

  it("photo upload still works", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const dir = await mkdtemp(join(tmpdir(), "item-img-"));
      dirs.push(dir);
      const { productId } = await setItemSale(f.owner, f.water.id, on());
      await uploadProductImage(f.owner, productId, JPG, localDriver(dir));
      expect((await getItemSale(f.owner, f.water.id))!.imageUrl).not.toBeNull();
    });
  });

  it("needs menu.manage", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await expect(setItemSale(f.cashier, f.water.id, on())).rejects.toThrow(ForbiddenError);
    });
  });

  it("other org's item is refused", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await expect(setItemSale(f.owner, "00000000-0000-4000-8000-000000000000", on())).rejects.toThrow(NotFoundError);
    });
  });

  it("inactive item can't be enabled", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await tx.update(items).set({ isActive: false }).where(eq(items.id, f.water.id));
      await expect(setItemSale(f.owner, f.water.id, on())).rejects.toThrow(ValidationError);
    });
  });

  it("getItemSale reads back the settings", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const juice = await createItem(tx, f.org.id, { name: "Juice", base: "ml", packaging: [{ name: "carton", factor: "1000" }] });
      const unit = (await tx.query.itemUnits.findFirst({ where: (u, { eq }) => eq(u.itemId, juice.id) }))!;
      expect(await getItemSale(f.owner, juice.id)).toBeNull();
      await setItemSale(f.owner, juice.id, on("2.00", `iu:${unit.id}`));
      const s = await getItemSale(f.owner, juice.id);
      expect(s).toMatchObject({ enabled: true, price: "2.0000", categoryId: null, unitKey: `iu:${unit.id}` });
    });
  });
});

