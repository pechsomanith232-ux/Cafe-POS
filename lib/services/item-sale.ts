import { and, eq } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import { parseInput, ValidationError } from "@/lib/errors";
import { requirePermission, type AppContext } from "@/lib/permissions";
import { itemSaleInput, type ItemSaleInput } from "@/lib/validators/item-sale";
import { writeAudit } from "./audit";
import { loadItem } from "./inventory";
import { upsertProduct } from "./menu";
import { inTransaction } from "./tx";

/**
 * Turn selling an inventory item on the POS on or off (spec 2026-11-23). The item owns one
 * product (products.source_item_id) with a single variant "Each" whose recipe is 1 × the
 * chosen unit, so orders, stock deduction, refunds and reports work as for any product.
 */
export async function setItemSale(ctx: AppContext, itemId: string, input: ItemSaleInput): Promise<{ productId: string }> {
  requirePermission(ctx, ctx.branchId, "menu.manage");
  const data = parseInput(itemSaleInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const item = await loadItem(tx, ctx, itemId, true);
    if (data.enabled && !item.isActive) throw new ValidationError("This item is inactive. Activate it before selling it on the POS.");
    const [existing] = await tx.select().from(products).where(eq(products.sourceItemId, item.id)).for("update");
    const [variant] = existing
      ? await tx.select({ id: productVariants.id, price: productVariants.price }).from(productVariants)
        .where(and(eq(productVariants.productId, existing.id), eq(productVariants.isActive, true)))
      : [];

    const product = await upsertProduct(tx, ctx, existing?.id ?? null, {
      name: item.name, description: null, categoryId: data.categoryId, kitchenStation: "none", deductStock: true,
      sortOrder: existing?.sortOrder ?? 0, isActive: data.enabled, modifierGroupIds: [],
      variants: [{
        id: variant?.id, name: "Each", price: data.price, sku: null, deductStock: null, isDefault: true,
        recipe: [{ itemId: item.id, unitKey: data.unitKey, qty: "1" }],
      }],
    }, { sourceItemId: item.id });

    await writeAudit(tx, ctx, {
      action: "item.sale", entity: "item", entityId: item.id,
      before: existing ? { enabled: existing.isActive, price: variant?.price ?? null, categoryId: existing.categoryId } : undefined,
      after: { enabled: data.enabled, price: data.price, categoryId: data.categoryId, unitKey: data.unitKey, productId: product.id },
    });
    return { productId: product.id };
  });
}
