"use server";

import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { setKitchenStatus } from "@/lib/services/orders";

export async function setKitchenStatusAction(lineId: string, status: string) {
  return toActionResult(async () => setKitchenStatus(await getContext(), lineId, status));
}
