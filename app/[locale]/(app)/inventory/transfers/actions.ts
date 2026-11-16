"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { cancelTransfer, createTransfer, receiveTransfer, sendTransfer } from "@/lib/services/transfers";
import type { ReceiveTransferInput, TransferInput } from "@/lib/validators/inventory";

const refresh = () => revalidatePath("/inventory", "layout");

export async function createTransferAction(input: TransferInput, send: boolean) {
  return toActionResult(async () => {
    const ctx = await getContext();
    const t = await createTransfer(ctx, input, { send });
    refresh();
    return { id: t.id };
  });
}
export async function sendTransferAction(id: string) {
  return toActionResult(async () => { await sendTransfer(await getContext(), id); refresh(); });
}
export async function cancelTransferAction(id: string) {
  return toActionResult(async () => { await cancelTransfer(await getContext(), id); refresh(); });
}
export async function receiveTransferAction(id: string, input: ReceiveTransferInput) {
  return toActionResult(async () => { await receiveTransfer(await getContext(), id, input); refresh(); });
}
