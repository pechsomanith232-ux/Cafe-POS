"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult } from "@/lib/action-result";
import { getContext } from "@/lib/context";
import { requirePermission } from "@/lib/permissions";
import { PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions-catalog";
import { createBranch, setBranchActive, updateBranch } from "@/lib/services/branches";
import { listPinApprovers, verifyManagerPin } from "@/lib/services/pin";
import { createRole, deleteRole, updateRole } from "@/lib/services/roles";
import {
  assignBranchRole,
  createUser,
  removeBranchRole,
  setUserActive,
  setUserPassword,
  setUserPin,
  updateUserName,
} from "@/lib/services/users";
import type { BranchInput, CreateUserInput, RoleInput } from "@/lib/validators/settings";

// Thin actions (plan §2.2): build the context, call ONE service, refresh the page.
// Services validate input and check permissions themselves.

export async function createBranchAction(input: BranchInput) {
  return toActionResult(async () => {
    await createBranch(await getContext(), input);
    revalidatePath("/", "layout");
  });
}

export async function updateBranchAction(id: string, input: BranchInput) {
  return toActionResult(async () => {
    await updateBranch(await getContext(), id, input);
    revalidatePath("/", "layout");
  });
}

export async function setBranchActiveAction(id: string, active: boolean) {
  return toActionResult(async () => {
    await setBranchActive(await getContext(), id, active);
    revalidatePath("/", "layout");
  });
}

export async function createUserAction(input: CreateUserInput) {
  return toActionResult(async () => {
    await createUser(await getContext(), input);
    revalidatePath("/settings/users");
  });
}

export async function updateUserNameAction(userId: string, name: string) {
  return toActionResult(async () => {
    await updateUserName(await getContext(), userId, name);
    revalidatePath("/settings/users");
  });
}

export async function resetPasswordAction(userId: string, password: string) {
  return toActionResult(async () => setUserPassword(await getContext(), userId, password));
}

export async function setUserPinAction(userId: string, pin: string) {
  return toActionResult(async () => {
    await setUserPin(await getContext(), userId, pin);
    revalidatePath("/settings/users");
  });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  return toActionResult(async () => {
    await setUserActive(await getContext(), userId, active);
    revalidatePath("/settings/users");
  });
}

export async function assignRoleAction(input: { userId: string; branchId: string; roleId: string }) {
  return toActionResult(async () => {
    await assignBranchRole(await getContext(), input);
    revalidatePath("/settings/users");
  });
}

export async function removeRoleAction(input: { userId: string; branchId: string }) {
  return toActionResult(async () => {
    await removeBranchRole(await getContext(), input);
    revalidatePath("/settings/users");
  });
}

export async function createRoleAction(input: RoleInput) {
  return toActionResult(async () => {
    await createRole(await getContext(), input);
    revalidatePath("/settings/roles");
  });
}

export async function updateRoleAction(roleId: string, input: RoleInput) {
  return toActionResult(async () => {
    await updateRole(await getContext(), roleId, input);
    revalidatePath("/", "layout");
  });
}

export async function deleteRoleAction(roleId: string) {
  return toActionResult(async () => {
    await deleteRole(await getContext(), roleId);
    revalidatePath("/settings/roles");
  });
}

const permissionKey = z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);
const approvalInput = z.object({ approverId: z.string().min(1).max(64), pin: z.string().max(12) });

/** People who can approve `permission` at the active branch (Manager PIN dialog). */
export async function listApproversAction(permission: PermissionKey) {
  return toActionResult(async () => {
    const ctx = await getContext();
    return listPinApprovers(ctx, ctx.branchId, permissionKey.parse(permission));
  });
}

/**
 * Settings → Users "Test a PIN": checks a PIN without doing anything else.
 * Limited to users.manage so it can't serve as a PIN-guessing tool.
 */
export async function testPinAction(approval: { approverId: string; pin: string }, permission: PermissionKey) {
  return toActionResult(async () => {
    const ctx = await getContext();
    requirePermission(ctx, ctx.branchId, "users.manage");
    await verifyManagerPin(ctx, {
      branchId: ctx.branchId,
      permission: permissionKey.parse(permission),
      ...approvalInput.parse(approval),
    });
    return true;
  });
}
