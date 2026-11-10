"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult } from "@/lib/action-result";
import { BRANCH_COOKIE, getContext } from "@/lib/context";
import { assertBranchAccess } from "@/lib/permissions";
import { setUserPin } from "@/lib/services/users";

/** Branch switcher: remember the active branch (validated against the user's branches). */
export async function switchBranch(branchId: string) {
  return toActionResult(async () => {
    const ctx = await getContext();
    const id = z.uuid().parse(branchId);
    assertBranchAccess(ctx, id);
    (await cookies()).set(BRANCH_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath("/", "layout");
  });
}

/** Set your own manager PIN. */
export async function setMyPin(pin: string) {
  return toActionResult(async () => {
    const ctx = await getContext();
    await setUserPin(ctx, ctx.userId, pin);
  });
}
