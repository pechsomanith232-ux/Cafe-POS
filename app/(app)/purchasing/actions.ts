"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import {
  allocateSupplierCredit,
  createSupplier,
  createSupplierReturn,
  deleteReceipt,
  recordSupplierPayment,
  saveAndPostReceipt, saveReceipt,
  updateSupplier,
} from "@/lib/services/purchasing";
import { listOpenReceipts } from "@/lib/queries/purchasing";
import type { PaymentDetails, ReceiptInput, SupplierInput, SupplierPaymentInput, SupplierReturnInput } from "@/lib/validators/purchasing";

// Thin actions (plan §2.2): context → one service → refresh.
const refresh = () => revalidatePath("/", "layout");

export async function createSupplierAction(input: SupplierInput) {
  return toActionResult(async () => {
    const s = await createSupplier(await getContext(), input);
    refresh();
    return { id: s.id };
  });
}

export async function updateSupplierAction(id: string, input: SupplierInput & { isActive?: boolean }) {
  return toActionResult(async () => {
    await updateSupplier(await getContext(), id, input);
    refresh();
  });
}

export async function saveReceiptAction(id: string | null, input: ReceiptInput) {
  return toActionResult(async () => {
    const r = await saveReceipt(await getContext(), id, input);
    refresh();
    return { id: r.id };
  });
}

/** Save the draft, then post it (with payment for direct purchases), in one click. */
export async function saveAndPostReceiptAction(id: string | null, input: ReceiptInput, payment?: PaymentDetails | null) {
  return toActionResult(async () => {
    const ctx = await getContext();
    const r = await saveAndPostReceipt(ctx, id, input, payment);
    refresh();
    return { id: r.id };
  });
}

export async function deleteReceiptAction(id: string) {
  return toActionResult(async () => {
    await deleteReceipt(await getContext(), id);
    refresh();
  });
}

export async function createSupplierReturnAction(input: SupplierReturnInput) {
  return toActionResult(async () => {
    await createSupplierReturn(await getContext(), input);
    refresh();
  });
}

export async function recordSupplierPaymentAction(input: SupplierPaymentInput) {
  return toActionResult(async () => {
    const p = await recordSupplierPayment(await getContext(), input);
    refresh();
    return { id: p.id };
  });
}

export async function allocateSupplierCreditAction(paymentId: string, allocations: { receiptId: string; amount: string }[]) {
  return toActionResult(async () => {
    await allocateSupplierCredit(await getContext(), paymentId, allocations);
    refresh();
  });
}

export async function openReceiptsAction(supplierId: string) {
  return toActionResult(async () => {
    const ctx = await getContext();
    return listOpenReceipts(ctx, supplierId, ctx.branchId);
  });
}
