import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { products } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission, type AppContext } from "@/lib/permissions";
import { getStorage, MAX_IMAGE_BYTES, sniffImage, type Storage } from "@/lib/storage";
import { setProductImageKey } from "./menu";

/**
 * Store a product image and point the product at it. The file is written
 * first; if saving the key fails it is deleted again. The previous image is
 * removed afterwards (best effort — a leftover file is harmless).
 */
export async function uploadProductImage(ctx: AppContext, productId: string, bytes: Uint8Array, storage: Storage = getStorage()) {
  requirePermission(ctx, ctx.branchId, "menu.manage");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError("Images must be 2 MB or smaller.");
  const type = sniffImage(bytes);
  if (!type) throw new ValidationError("Use a JPEG, PNG or WebP image.");
  const [p] = await ctx.db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId)));
  if (!p) throw new NotFoundError("Product not found.");

  const key = `products/${productId}/${randomUUID().replaceAll("-", "")}.${type.ext}`;
  await storage.put(key, bytes, type.contentType);
  let old: string | null;
  try {
    old = await setProductImageKey(ctx, productId, key);
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
  if (old && old !== key) await storage.delete(old).catch(() => {});
  return { key };
}

export async function removeProductImage(ctx: AppContext, productId: string, storage: Storage = getStorage()) {
  const old = await setProductImageKey(ctx, productId, null);
  if (old) await storage.delete(old).catch(() => {});
}
