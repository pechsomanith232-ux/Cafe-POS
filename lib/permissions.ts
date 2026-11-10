import { inArray, type AnyColumn, type SQL } from "drizzle-orm";
import type { Executor } from "@/db/client";
import type { PermissionKey } from "./permissions-catalog";

/** What a user may do at one branch: their role there and its permissions. */
export type BranchAccess = {
  branchId: string;
  branchCode: string;
  branchName: string;
  roleId: string;
  roleName: string;
  /** permission key → limit (numeric string) or null when the permission has no limit */
  permissions: Map<string, string | null>;
};

/**
 * Request context (plan §5.9). Built once per request by `getContext()`.
 * `db` is what services run queries on: the app db, or a test transaction.
 */
export type AppContext = {
  db: Executor;
  userId: string;
  userName: string;
  orgId: string;
  /** Active branch (branch switcher). Always one of `branchIds`. */
  branchId: string;
  /** Every active branch the user belongs to. */
  branchIds: string[];
  access: Map<string, BranchAccess>;
  ip?: string | null;
};

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasPermission(ctx: AppContext, branchId: string, key: PermissionKey): boolean {
  return ctx.access.get(branchId)?.permissions.has(key) ?? false;
}

/** Throws ForbiddenError unless the user's role at `branchId` has `key`. */
export function requirePermission(ctx: AppContext, branchId: string, key: PermissionKey): void {
  if (!hasPermission(ctx, branchId, key)) {
    throw new ForbiddenError(`Missing permission ${key} at this branch.`);
  }
}

/**
 * The role's limit for a permission at a branch (e.g. max discount %).
 * `null` = permission held with no limit; `undefined` = permission not held.
 */
export function permissionLimit(
  ctx: AppContext,
  branchId: string,
  key: PermissionKey,
): string | null | undefined {
  const perms = ctx.access.get(branchId)?.permissions;
  if (!perms?.has(key)) return undefined;
  return perms.get(key) ?? null;
}

/** Throws unless the branch is one of the user's branches. */
export function assertBranchAccess(ctx: AppContext, branchId: string): void {
  if (!ctx.branchIds.includes(branchId)) {
    throw new ForbiddenError("You don't have access to that branch.");
  }
}

/**
 * WHERE fragment limiting rows to the user's branches (plan §2.7, §5.9).
 * There is no RLS, so every query on branch data must use this.
 *   branchScope(ctx, orders.branchId)                 → all of the user's branches
 *   branchScope(ctx, orders.branchId, { branchId })   → one branch (must be the user's)
 */
export function branchScope(
  ctx: AppContext,
  column: AnyColumn,
  options: { branchId?: string } = {},
): SQL {
  if (options.branchId) {
    assertBranchAccess(ctx, options.branchId);
    return inArray(column, [options.branchId]);
  }
  return inArray(column, ctx.branchIds);
}
