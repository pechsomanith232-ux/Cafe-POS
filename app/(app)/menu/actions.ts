"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { ValidationError } from "@/lib/errors";
import { comboCost } from "@/lib/queries/menu";
import {
  createMenuCategory,
  saveModifierGroup,
  saveProduct,
  setBranchVariantPrice,
  updateMenuCategory,
} from "@/lib/services/menu";
import { removeProductImage, uploadProductImage } from "@/lib/services/menu-images";
import { MAX_IMAGE_BYTES } from "@/lib/storage";
import type { MenuCategoryInput, ModifierGroupInput, ProductInput } from "@/lib/validators/menu";

// Thin actions (plan §2.2): context → one service → refresh.
const refresh = () => revalidatePath("/", "layout");

export async function saveProductAction(id: string | null, input: ProductInput) {
  return toActionResult(async () => {
    const p = await saveProduct(await getContext(), id, input);
    refresh();
    return { id: p.id };
  });
}

export async function uploadProductImageAction(productId: string, form: FormData) {
  return toActionResult(async () => {
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) throw new ValidationError("Images must be 2 MB or smaller.");
    await uploadProductImage(await getContext(), productId, new Uint8Array(await file.arrayBuffer()));
    refresh();
  });
}

export async function removeProductImageAction(productId: string) {
  return toActionResult(async () => {
    await removeProductImage(await getContext(), productId);
    refresh();
  });
}

export async function setBranchPriceAction(input: { branchId: string; variantId: string; price: string | null; isAvailable: boolean }) {
  return toActionResult(async () => {
    await setBranchVariantPrice(await getContext(), input);
    refresh();
  });
}

export async function comboCostAction(variantId: string, modifierIds: string[]) {
  return toActionResult(async () => comboCost(await getContext(), { variantId, modifierIds }));
}

export async function saveModifierGroupAction(id: string | null, input: ModifierGroupInput) {
  return toActionResult(async () => {
    const g = await saveModifierGroup(await getContext(), id, input);
    refresh();
    return { id: g.id };
  });
}

export async function createMenuCategoryAction(input: MenuCategoryInput) {
  return toActionResult(async () => {
    await createMenuCategory(await getContext(), input);
    refresh();
  });
}

export async function updateMenuCategoryAction(id: string, input: MenuCategoryInput & { isActive?: boolean }) {
  return toActionResult(async () => {
    await updateMenuCategory(await getContext(), id, input);
    refresh();
  });
}
