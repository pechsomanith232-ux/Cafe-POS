"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { saveBranchPosSettings, saveDiningTable, savePaymentMethod, setExchangeRate } from "@/lib/services/pos-settings";
import type { BranchPosSettingsInput, DiningTableInput, PaymentMethodInput } from "@/lib/validators/pos";

export async function saveDiningTableAction(id: string | null, input: DiningTableInput) {
  return toActionResult(async () => {
    await saveDiningTable(await getContext(), id, input);
    revalidatePath("/", "layout");
  });
}

export async function setExchangeRateAction(input: { branchId: string; currencyCode: string; rate: string }) {
  return toActionResult(async () => {
    await setExchangeRate(await getContext(), input);
    revalidatePath("/", "layout");
  });
}

export async function savePaymentMethodAction(id: string | null, input: PaymentMethodInput) {
  return toActionResult(async () => {
    await savePaymentMethod(await getContext(), id, input);
    revalidatePath("/", "layout");
  });
}

export async function saveBranchPosSettingsAction(input: BranchPosSettingsInput) {
  return toActionResult(async () => {
    await saveBranchPosSettings(await getContext(), input);
    revalidatePath("/", "layout");
  });
}
