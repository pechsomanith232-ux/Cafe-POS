import { randomUUID } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, asc, count, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { pinAttempts, profiles, rolePermissions, user, userBranchRoles } from "@/db/schema";
import { PinError } from "@/lib/errors";
import { assertBranchAccess, type AppContext } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions-catalog";

export const PIN_MAX_FAILURES = 5;
export const PIN_WINDOW_MS = 5 * 60 * 1000;

/** People who can approve `permission` at a branch with their PIN (for the PIN dialog). */
export async function listPinApprovers(ctx: AppContext, branchId: string, permission: PermissionKey) {
  assertBranchAccess(ctx, branchId);
  return ctx.db
    .select({ userId: user.id, name: user.name })
    .from(userBranchRoles)
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, userBranchRoles.roleId), eq(rolePermissions.permissionKey, permission)))
    .innerJoin(profiles, eq(profiles.userId, userBranchRoles.userId))
    .innerJoin(user, eq(user.id, userBranchRoles.userId))
    .where(and(eq(userBranchRoles.branchId, branchId), eq(profiles.isActive, true), isNotNull(profiles.pinHash), eq(profiles.orgId, ctx.orgId)))
    .orderBy(asc(user.name));
}

/**
 * Check a manager's PIN for a sensitive action (plan §5.8) and return the
 * approver's user id. The approver must be active and have `permission` at
 * the branch. 5 failed tries in 5 minutes (by the requesting user or against
 * the approver) lock PIN approval for the rest of the window.
 *
 * Call this BEFORE the service's own transaction, so failed attempts are
 * recorded even when the action is then abandoned.
 */
export async function verifyManagerPin(
  ctx: AppContext,
  input: { branchId: string; approverId: string; pin: string; permission: PermissionKey },
): Promise<string> {
  assertBranchAccess(ctx, input.branchId);

  // Count, check and record in ONE short transaction holding advisory locks on
  // the requesting user and the approver (always locked in the same order), so
  // parallel attempts are checked one at a time and can't beat the limit.
  const ok = await ctx.db.transaction(async (tx) => {
    const keys = [`pin:actor:${ctx.userId}`, `pin:approver:${input.approverId}`].sort();
    for (const key of keys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }

    const since = new Date(Date.now() - PIN_WINDOW_MS);
    const [{ failures }] = await tx
      .select({ failures: count() })
      .from(pinAttempts)
      .where(
        and(
          eq(pinAttempts.success, false),
          gt(pinAttempts.createdAt, since),
          or(eq(pinAttempts.actorUserId, ctx.userId), eq(pinAttempts.approverUserId, input.approverId)),
        ),
      );
    if (failures >= PIN_MAX_FAILURES) return "locked" as const;

    const [approver] = await tx
      .select({ pinHash: profiles.pinHash, isActive: profiles.isActive, permission: rolePermissions.permissionKey })
      .from(profiles)
      .leftJoin(userBranchRoles, and(eq(userBranchRoles.userId, profiles.userId), eq(userBranchRoles.branchId, input.branchId)))
      .leftJoin(rolePermissions, and(eq(rolePermissions.roleId, userBranchRoles.roleId), eq(rolePermissions.permissionKey, input.permission)))
      .where(and(eq(profiles.userId, input.approverId), eq(profiles.orgId, ctx.orgId)));

    // Always run a hash check (against a dummy when there's nothing to check)
    // so timing doesn't reveal whether the approver exists or has a PIN.
    const pinOk = await argonVerify(approver?.pinHash ?? (await dummyHash()), input.pin).catch(() => false);
    const success = Boolean(approver?.pinHash && approver.isActive && approver.permission && pinOk);

    await tx.insert(pinAttempts).values({
      actorUserId: ctx.userId,
      approverUserId: approver ? input.approverId : null,
      branchId: input.branchId,
      success,
    });
    return success;
  });

  if (ok === "locked") throw new PinError("Too many incorrect PINs. Wait 5 minutes and try again.");
  if (!ok) throw new PinError("PIN incorrect, or this person can't approve this action.");
  return input.approverId;
}

// Hash of a random value nobody knows; only used to equalise timing.
let dummy: Promise<string> | undefined;
function dummyHash() {
  dummy ??= argonHash(randomUUID());
  return dummy;
}
