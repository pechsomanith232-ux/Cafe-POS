import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "./client";
import {
  branches,
  organizations,
  permissions,
  rolePermissions,
  roles,
  user,
  userBranchRoles,
} from "./schema";
import { insertAuthUser } from "@/lib/auth-users";
import { ensureBranchDefaults, ensureOrgDefaults } from "@/lib/branch-defaults";
import { DEFAULT_ROLES, OWNER_ROLE, PERMISSIONS } from "@/lib/permissions-catalog";

export type SeedInput = {
  orgName: string;
  branch: { code: string; name: string };
  owner: { email: string; password: string; name: string };
};

/**
 * Idempotent base data (plan Phase 1): permissions, default roles and their
 * permissions, the organization, the first branch and the first Owner.
 * Safe to re-run: existing rows are kept, an existing owner's password is
 * never changed, and custom edits to roles are left alone.
 */
export async function seedDatabase(tx: Executor, input: SeedInput): Promise<void> {
  // Permissions: insert new keys, refresh descriptions.
  await tx
    .insert(permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoUpdate({ target: permissions.key, set: { description: sql`excluded.description` } });

  // Organization (single org).
  let [org] = await tx.select().from(organizations).limit(1);
  if (!org) {
    [org] = await tx.insert(organizations).values({ name: input.orgName }).returning();
  }

  await ensureOrgDefaults(tx, org.id);


  // Default roles. Permissions are only filled in for roles created now, so a
  // re-seed never undoes changes made in Settings → Roles.
  const roleIds = new Map<string, string>();
  for (const seed of DEFAULT_ROLES) {
    const [existing] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, org.id), eq(roles.name, seed.name)));
    if (existing) {
      roleIds.set(seed.name, existing.id);
      continue;
    }
    const [created] = await tx
      .insert(roles)
      .values({ orgId: org.id, name: seed.name, isSystem: seed.isSystem })
      .returning();
    roleIds.set(seed.name, created.id);
    const rows = Object.entries(seed.permissions).map(([key, limit]) => ({
      roleId: created.id,
      permissionKey: key,
      limitValue: limit == null ? null : String(limit),
    }));
    if (rows.length) await tx.insert(rolePermissions).values(rows);
  }

  // The Owner role is locked in Settings, so the seed keeps it complete:
  // permission keys added in later versions are granted to Owner here.
  const ownerSeed = DEFAULT_ROLES.find((r) => r.name === OWNER_ROLE)!;
  await tx
    .insert(rolePermissions)
    .values(
      Object.entries(ownerSeed.permissions).map(([key, limit]) => ({
        roleId: roleIds.get(OWNER_ROLE)!,
        permissionKey: key,
        limitValue: limit == null ? null : String(limit),
      })),
    )
    .onConflictDoNothing();

  // First branch.
  let [branch] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.orgId, org.id), eq(branches.code, input.branch.code)));
  if (!branch) {
    [branch] = await tx
      .insert(branches)
      .values({ orgId: org.id, code: input.branch.code, name: input.branch.name })
      .returning();
  }
  await ensureBranchDefaults(tx, branch.id);

  // Owner user with the Owner role at the first branch.
  const email = input.owner.email.trim().toLowerCase();
  const [existingUser] = await tx.select().from(user).where(eq(user.email, email));
  const ownerId =
    existingUser?.id ??
    (await insertAuthUser(tx, { orgId: org.id, email, name: input.owner.name, password: input.owner.password }));

  await tx
    .insert(userBranchRoles)
    .values({ userId: ownerId, branchId: branch.id, roleId: roleIds.get(OWNER_ROLE)! })
    .onConflictDoNothing();
}
