"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import {
  cancelCount,
  createAdjustment,
  createCategory,
  createCount,
  createItem,
  deleteAdjustment,
  postAdjustment,
  postCount,
  saveCountLines,
  setOpeningStock,
  setReorderLevel,
  updateAdjustment,
  updateCategory,
  updateItem,
} from "@/lib/services/inventory";
import type { AdjustmentInput, ItemInput } from "@/lib/validators/inventory";

// Thin actions (plan §2.2): context → one service → refresh.
const refresh = () => revalidatePath("/inventory", "layout");

export async function createCategoryAction(name: string) {
  return toActionResult(async () => {
    const c = await createCategory(await getContext(), { name });
    refresh();
    return { id: c.id };
  });
}

export async function updateCategoryAction(id: string, name: string, isActive: boolean) {
  return toActionResult(async () => {
    await updateCategory(await getContext(), id, { name, isActive });
    refresh();
  });
}

export async function createItemAction(input: ItemInput) {
  return toActionResult(async () => {
    const item = await createItem(await getContext(), input);
    refresh();
    return { id: item.id };
  });
}

export async function updateItemAction(id: string, input: ItemInput & { isActive?: boolean }) {
  return toActionResult(async () => {
    await updateItem(await getContext(), id, input);
    refresh();
  });
}

export async function setReorderLevelAction(input: { branchId: string; itemId: string; unitKey: string; qty: string | null }) {
  return toActionResult(async () => {
    await setReorderLevel(await getContext(), input);
    revalidatePath("/", "layout");
  });
}

export async function setOpeningStockAction(input: { branchId: string; itemId: string; unitKey: string; qty: string; unitCost: string }) {
  return toActionResult(async () => {
    await setOpeningStock(await getContext(), input);
    revalidatePath("/", "layout");
  });
}

export async function saveAdjustmentAction(id: string | null, input: AdjustmentInput) {
  return toActionResult(async () => {
    const ctx = await getContext();
    let adjId = id;
    if (adjId) await updateAdjustment(ctx, adjId, input);
    else adjId = (await createAdjustment(ctx, input)).id;
    refresh();
    return { id: adjId };
  });
}

export async function postAdjustmentAction(id: string) {
  return toActionResult(async () => {
    await postAdjustment(await getContext(), id);
    revalidatePath("/", "layout");
  });
}

export async function deleteAdjustmentAction(id: string) {
  return toActionResult(async () => {
    await deleteAdjustment(await getContext(), id);
    refresh();
  });
}

export async function createCountAction(input: { branchId: string; categoryId?: string | null; note?: string | null }) {
  return toActionResult(async () => {
    const c = await createCount(await getContext(), input);
    refresh();
    return { id: c.id };
  });
}

export async function saveCountLinesAction(id: string, lines: { itemId: string; unitKey: string; qty: string | null }[]) {
  return toActionResult(async () => {
    await saveCountLines(await getContext(), id, lines);
    refresh();
  });
}

export async function postCountAction(id: string) {
  return toActionResult(async () => {
    await postCount(await getContext(), id);
    revalidatePath("/", "layout");
  });
}

export async function cancelCountAction(id: string) {
  return toActionResult(async () => {
    await cancelCount(await getContext(), id);
    refresh();
  });
}
