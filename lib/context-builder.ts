import { and, asc, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, profiles, rolePermissions, roles, user, userBranchRoles } from "@/db/schema";
import type { AppContext, BranchAccess } from "./permissions";

export class UnauthorizedError extends Error {
  constructor(message = "Please sign in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NoBranchAccessError extends Error {
  constructor(message = "Your account isn't assigned to any active branch yet. Ask an admin.") {
    super(message);
    this.name = "NoBranchAccessError";
  }
}

/**
 * Load a user's branches, roles and permissions and pick the active branch.
 * `requestedBranchId` (from the branch-switcher cookie) is only honoured if
 * the user belongs to that branch. No Next.js imports, so tests can call it.
 */
export async function buildContext(
  db: Executor,
  input: { userId: string; requestedBranchId?: string | null; ip?: string | null },
): Promise<AppContext> {
  const [profile] = await db
    .select({ orgId: profiles.orgId, isActive: profiles.isActive, name: user.name })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(eq(profiles.userId, input.userId));
  if (!profile || !profile.isActive) throw new UnauthorizedError();

  const rows = await db
    .select({
      branchId: branches.id,
      branchCode: branches.code,
      branchName: branches.name,
      roleId: roles.id,
      roleName: roles.name,
      permissionKey: rolePermissions.permissionKey,
      limitValue: rolePermissions.limitValue,
    })
    .from(userBranchRoles)
    .innerJoin(branches, eq(branches.id, userBranchRoles.branchId))
    .innerJoin(roles, eq(roles.id, userBranchRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(userBranchRoles.userId, input.userId),
        eq(branches.isActive, true),
        eq(branches.orgId, profile.orgId),
      ),
    )
    .orderBy(asc(branches.code));

  const access = new Map<string, BranchAccess>();
  for (const r of rows) {
    let entry = access.get(r.branchId);
    if (!entry) {
      entry = {
        branchId: r.branchId,
        branchCode: r.branchCode,
        branchName: r.branchName,
        roleId: r.roleId,
        roleName: r.roleName,
        permissions: new Map(),
      };
      access.set(r.branchId, entry);
    }
    if (r.permissionKey) entry.permissions.set(r.permissionKey, r.limitValue);
  }

  const branchIds = [...access.keys()];
  if (branchIds.length === 0) throw new NoBranchAccessError();

  const branchId =
    input.requestedBranchId && access.has(input.requestedBranchId)
      ? input.requestedBranchId
      : branchIds[0];

  return {
    db,
    userId: input.userId,
    userName: profile.name,
    orgId: profile.orgId,
    branchId,
    branchIds,
    access,
    ip: input.ip ?? null,
  };
}
