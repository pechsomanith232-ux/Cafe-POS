import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { rolePermissions, roles, userBranchRoles } from "@/db/schema";
import { dec } from "@/lib/domain/money";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { ForbiddenError, requirePermission, type AppContext } from "@/lib/permissions";
import { OWNER_ROLE, PERMISSIONS, PERMISSIONS_WITH_LIMIT, type PermissionKey } from "@/lib/permissions-catalog";
import { roleInput, type RoleInput } from "@/lib/validators/settings";
import { writeAudit } from "./audit";
import { inTransaction } from "./tx";

type Role = typeof roles.$inferSelect;

/** permission key → limit (numeric string or null) for a role. */
export async function loadRolePermissions(tx: Executor, roleId: string): Promise<Record<string, string | null>> {
  const rows = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  return Object.fromEntries(rows.map((r) => [r.permissionKey, r.limitValue]));
}

export async function loadRole(tx: Executor, ctx: AppContext, roleId: string): Promise<Role> {
  const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId)));
  if (!role) throw new NotFoundError("Role not found.");
  return role;
}

/**
 * Throws unless every permission in `perms` is held by the editor's own role
 * at `branchId`, with a limit no higher than theirs. This is the one rule
 * that stops privilege escalation through users.manage and roles.manage.
 */
export function assertWithinOwnPermissions(
  ctx: AppContext,
  branchId: string,
  perms: Record<string, string | null>,
  what = "grant",
) {
  const mine = ctx.access.get(branchId)?.permissions;
  if (!mine) throw new ForbiddenError("You don't have access to that branch.");
  for (const [key, limit] of Object.entries(perms)) {
    if (!mine.has(key)) {
      throw new ForbiddenError(`You can't ${what} ${key}: your own role doesn't have it.`);
    }
    const myLimit = mine.get(key) ?? null;
    if (myLimit !== null && (limit === null || dec(limit).gt(myLimit))) {
      throw new ForbiddenError(`You can't ${what} a higher ${key} limit than your own.`);
    }
  }
}

/**
 * You can only hand out (or take away) a role at a branch if it gives no more
 * than your own role there.
 */
export async function assertCanGrantRole(tx: Executor, ctx: AppContext, branchId: string, roleId: string) {
  await loadRole(tx, ctx, roleId);
  assertWithinOwnPermissions(ctx, branchId, await loadRolePermissions(tx, roleId));
}

/** Roles the editor holds at any branch can't be edited by them (no self-escalation). */
function assertNotOwnRole(ctx: AppContext, roleId: string) {
  if ([...ctx.access.values()].some((a) => a.roleId === roleId)) {
    throw new ForbiddenError("You can't edit your own role. Ask someone else with roles.manage.");
  }
}

function normalizePermissions(perms: { key: string; limit: string | null }[]) {
  const out = new Map<PermissionKey, string | null>();
  for (const { key, limit } of perms) {
    if (!Object.hasOwn(PERMISSIONS, key)) throw new ValidationError(`Unknown permission: ${key}`);
    if (limit !== null && !PERMISSIONS_WITH_LIMIT.includes(key as PermissionKey)) {
      throw new ValidationError(`${key} doesn't take a limit.`);
    }
    out.set(key as PermissionKey, limit);
  }
  return out;
}

async function assertNameFree(tx: Executor, orgId: string, name: string, exceptId?: string) {
  const [dupe] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.orgId, orgId), sql`lower(${roles.name}) = lower(${name})`));
  if (dupe && dupe.id !== exceptId) throw new ConflictError(`A role named "${name}" already exists.`);
}

async function writePermissions(tx: Executor, roleId: string, perms: Map<PermissionKey, string | null>) {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (perms.size) {
    await tx.insert(rolePermissions).values(
      [...perms].map(([permissionKey, limitValue]) => ({ roleId, permissionKey, limitValue })),
    );
  }
}

export async function createRole(ctx: AppContext, input: RoleInput): Promise<Role> {
  requirePermission(ctx, ctx.branchId, "roles.manage");
  const data = parseInput(roleInput, input);
  const perms = normalizePermissions(data.permissions);
  assertWithinOwnPermissions(ctx, ctx.branchId, Object.fromEntries(perms), "create a role with");
  return inTransaction(ctx, async (tx, ctx) => {
    await assertNameFree(tx, ctx.orgId, data.name);
    const [role] = await tx.insert(roles).values({ orgId: ctx.orgId, name: data.name }).returning();
    await writePermissions(tx, role.id, perms);
    await writeAudit(tx, ctx, {
      action: "role.create", entity: "role", entityId: role.id,
      after: { name: role.name, permissions: await loadRolePermissions(tx, role.id) },
    });
    return role;
  });
}

/** Rename a role and replace its permissions. The Owner role can't be changed. */
export async function updateRole(ctx: AppContext, roleId: string, input: RoleInput): Promise<void> {
  requirePermission(ctx, ctx.branchId, "roles.manage");
  const data = parseInput(roleInput, input);
  const perms = normalizePermissions(data.permissions);
  assertWithinOwnPermissions(ctx, ctx.branchId, Object.fromEntries(perms), "give a role");
  await inTransaction(ctx, async (tx, ctx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId)))
      .for("update");
    if (!role) throw new NotFoundError("Role not found.");
    if (role.name === OWNER_ROLE && role.isSystem) {
      throw new ValidationError("The Owner role always has every permission and can't be changed.");
    }
    assertNotOwnRole(ctx, roleId);
    if (role.isSystem && data.name !== role.name) throw new ValidationError("Built-in roles can't be renamed.");
    await assertNameFree(tx, ctx.orgId, data.name, roleId);

    const before = { name: role.name, permissions: await loadRolePermissions(tx, roleId) };
    // You may only edit roles that are within your own power.
    assertWithinOwnPermissions(ctx, ctx.branchId, before.permissions, "edit a role with");
    await tx.update(roles).set({ name: data.name }).where(eq(roles.id, roleId));
    await writePermissions(tx, roleId, perms);
    const after = { name: data.name, permissions: await loadRolePermissions(tx, roleId) };
    await writeAudit(tx, ctx, { action: "role.update", entity: "role", entityId: roleId, before, after });
  });
}

/** Delete a custom role that nobody is using. */
export async function deleteRole(ctx: AppContext, roleId: string): Promise<void> {
  requirePermission(ctx, ctx.branchId, "roles.manage");
  await inTransaction(ctx, async (tx, ctx) => {
    const role = await loadRole(tx, ctx, roleId);
    if (role.isSystem) throw new ValidationError("Built-in roles can't be deleted.");
    assertNotOwnRole(ctx, roleId);
    assertWithinOwnPermissions(ctx, ctx.branchId, await loadRolePermissions(tx, roleId), "delete a role with");
    const [inUse] = await tx.select({ id: userBranchRoles.id }).from(userBranchRoles).where(eq(userBranchRoles.roleId, roleId)).limit(1);
    if (inUse) throw new ValidationError("This role is still assigned to users. Change their role first.");
    const before = { name: role.name, permissions: await loadRolePermissions(tx, roleId) };
    await tx.delete(roles).where(eq(roles.id, roleId));
    await writeAudit(tx, ctx, { action: "role.delete", entity: "role", entityId: roleId, before });
  });
}
