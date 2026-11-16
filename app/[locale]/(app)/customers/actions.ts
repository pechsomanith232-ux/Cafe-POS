"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { recordCustomerPayment, saveCustomer } from "@/lib/services/customers";
import type { CustomerInput, CustomerPaymentInput } from "@/lib/validators/customers";

export async function saveCustomerAction(id: string | null, input: CustomerInput) {
  return toActionResult(async () => {
    const c = await saveCustomer(await getContext(), id, input);
    revalidatePath("/customers");
    return { id: c.id };
  });
}

export async function customerPaymentAction(input: CustomerPaymentInput) {
  return toActionResult(async () => {
    await recordCustomerPayment(await getContext(), input);
    revalidatePath("/customers", "layout");
  });
}
