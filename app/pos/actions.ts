"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { ValidationError } from "@/lib/errors";
import { listCustomers } from "@/lib/queries/customers";
import { getOrder, getRefundable, getShiftReport, listOpenOrders, listRecentOrders } from "@/lib/queries/pos";
import { addCashMovement, refundOrder, saveAndPayOrder, voidOrder } from "@/lib/services/payments";
import { resumeOrder, saveOrder } from "@/lib/services/orders";
import { closeShift, openShift } from "@/lib/services/shifts";
import type { CashMovementInput, CloseShiftInput, OpenShiftInput, PayOrderInput, RefundOrderInput, SaveOrderInput } from "@/lib/validators/pos";

// POS actions: thin wrappers (plan §2.2). The cart comes back as the server saw it.

export async function openShiftAction(input: OpenShiftInput) {
  return toActionResult(async () => {
    await openShift(await getContext(), input);
    revalidatePath("/pos");
  });
}

export async function closeShiftAction(shiftId: string, input: CloseShiftInput) {
  return toActionResult(async () => {
    // No revalidate here: the dialog shows the counted-vs-expected summary first and refreshes on "Done".
    const r = await closeShift(await getContext(), shiftId, input);
    return { cash: r.cash, varianceBase: r.varianceBase };
  });
}

export async function shiftReportAction(shiftId: string) {
  return toActionResult(async () => getShiftReport(await getContext(), shiftId));
}

/** Save the cart and pay in one transaction (a failed payment leaves nothing saved). */
export async function payAction(cart: SaveOrderInput, pay: PayOrderInput) {
  return toActionResult(async () => {
    const r = await saveAndPayOrder(await getContext(), cart, pay);
    revalidatePath("/pos");
    return r;
  });
}

export async function voidOrderAction(orderId: string, input: { reason: string; approval: { approverId: string; pin: string } }) {
  return toActionResult(async () => {
    await voidOrder(await getContext(), orderId, input);
    revalidatePath("/pos");
  });
}

export async function recentOrdersAction() {
  return toActionResult(async () => {
    const ctx = await getContext();
    return listRecentOrders(ctx, ctx.branchId);
  });
}

export async function refundableAction(orderId: string) {
  return toActionResult(async () => getRefundable(await getContext(), orderId));
}

export async function refundOrderAction(orderId: string, input: RefundOrderInput) {
  return toActionResult(async () => {
    const r = await refundOrder(await getContext(), orderId, input);
    revalidatePath("/pos");
    return r;
  });
}

export async function cashMovementAction(input: CashMovementInput) {
  return toActionResult(async () => {
    await addCashMovement(await getContext(), input);
  });
}

export async function customersAction() {
  return toActionResult(async () => (await listCustomers(await getContext())).filter((c) => c.creditLimit !== null));
}

/** Save the cart; with then = "hold" the bill is parked, with "send" its new lines go to the kitchen. */
export async function saveOrderAction(input: SaveOrderInput) {
  return toActionResult(async () => {
    const ctx = await getContext();
    const order = await saveOrder(ctx, input);
    return getOrder(ctx, order.id);
  });
}

export async function openOrdersAction() {
  return toActionResult(async () => {
    const ctx = await getContext();
    return listOpenOrders(ctx, ctx.branchId);
  });
}

/** Load an open (not held) order into the cart. */
export async function openOrderAction(orderId: string) {
  return toActionResult(async () => {
    const ctx = await getContext();
    const order = await getOrder(ctx, orderId);
    if (order.status !== "open") throw new ValidationError("This order isn't open any more.");
    return order;
  });
}

export async function resumeOrderAction(orderId: string, registerId: string) {
  return toActionResult(async () => {
    const ctx = await getContext();
    await resumeOrder(ctx, orderId, registerId);
    return getOrder(ctx, orderId);
  });
}
