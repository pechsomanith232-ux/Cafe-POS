import { hash as argonHash } from "@node-rs/argon2";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { account, profiles, roles, session, user, userBranchRoles } from "@/db/schema";
import { insertAuthUser } from "@/lib/auth-users";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { ForbiddenError, requirePermission, type AppContext } from "@/lib/permissions";
import { OWNER_ROLE } from "@/lib/permissions-catalog";
import { branchRoleInput, createUserInput, password as passwordSchema, pin as pinSchema, type CreateUserInput } from "@/lib/validators/settings";
import { writeAudit } from "./audit";
import { assertCanGrantRole } from "./roles";
import { inTransaction } from "./tx";

async function assertSameOrg(tx: Executor, ctx: AppContext, userId: string) {
  const [p] = await tx.select().from(profiles).where(and(eq(profiles.userId, userId), eq(profiles.orgId, ctx.orgId)));
  if (!p) throw new NotFoundError("User not found.");
  return p;
}

/**
 * You may change a user's password, PIN, name or status only if you could
 * grant EVERY role they hold: at each branch they work at (including
 * deactivated branches, which aren't in your context and so deny), you need
 * users.manage and a role at least as powerful as theirs. Otherwise adding a
 * powerful user to your branch with a low role would let you take them over.
 * A user with no branch needs users.manage at your active branch.
 */
async function assertCanManageUser(tx: Executor, ctx: AppContext, userId: string) {
  await assertSameOrg(tx, ctx, userId);
  const assignments = await tx.select().from(userBranchRoles).where(eq(userBranchRoles.userId, userId));
  if (assignments.length === 0) {
    requirePermission(ctx, ctx.branchId, "users.manage");
    return;
  }
  for (const a of assignments) {
    if (!ctx.access.get(a.branchId)?.permissions.has("users.manage")) {
      throw new ForbiddenError("You can't manage this user: they also work at a branch you don't manage.");
    }
    await assertCanGrantRole(tx, ctx, a.branchId, a.roleId);
  }
}

/** Throws if removing `userId`'s Owner role (at `branchId`, or everywhere) would leave no active Owner. */
async function assertNotLastOwner(tx: Executor, ctx: AppContext, userId: string, branchId?: string) {
  const owners = await tx
    .select({ userId: userBranchRoles.userId, branchId: userBranchRoles.branchId })
    .from(userBranchRoles)
    .innerJoin(roles, eq(roles.id, userBranchRoles.roleId))
    .innerJoin(profiles, eq(profiles.userId, userBranchRoles.userId))
    .where(and(eq(roles.orgId, ctx.orgId), eq(roles.name, OWNER_ROLE), eq(roles.isSystem, true), eq(profiles.isActive, true)));
  const affected = owners.filter((o) => o.userId === userId && (!branchId || o.branchId === branchId));
  if (affected.length === 0) return;
  const remaining = owners.filter((o) => !affected.includes(o));
  if (remaining.length === 0) throw new ValidationError("There must always be at least one active Owner.");
}

async function signOutEverywhere(tx: Executor, userId: string) {
  await tx.delete(session).where(eq(session.userId, userId));
}

/** Create a user with a password and a role at one branch (plan §5.1: no public sign-up). */
export async function createUser(ctx: AppContext, input: CreateUserInput): Promise<string> {
  const data = parseInput(createUserInput, input);
  requirePermission(ctx, data.branchId, "users.manage");
  return inTransaction(ctx, async (tx, ctx) => {
    await assertCanGrantRole(tx, ctx, data.branchId, data.roleId);
    const [dupe] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${data.email}`);
    if (dupe) throw new ConflictError(`A user with email ${data.email} already exists.`);

    const userId = await insertAuthUser(tx, { orgId: ctx.orgId, email: data.email, name: data.name, password: data.password });
    await tx.insert(userBranchRoles).values({ userId, branchId: data.branchId, roleId: data.roleId, createdBy: ctx.userId });
    if (data.pin) await tx.update(profiles).set({ pinHash: await argonHash(data.pin) }).where(eq(profiles.userId, userId));
    await writeAudit(tx, ctx, {
      action: "user.create", entity: "user", entityId: userId, branchId: data.branchId,
      after: { email: data.email, name: data.name, branchId: data.branchId, roleId: data.roleId, pinSet: Boolean(data.pin) },
    });
    return userId;
  });
}

export async function updateUserName(ctx: AppContext, userId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new ValidationError("Name is required");
  if (clean.length > 100) throw new ValidationError("Name is too long (max 100 characters)");
  await inTransaction(ctx, async (tx, ctx) => {
    await assertCanManageUser(tx, ctx, userId);
    const [before] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));
    await tx.update(user).set({ name: clean }).where(eq(user.id, userId));
    await tx.update(profiles).set({ fullName: clean }).where(eq(profiles.userId, userId));
    await writeAudit(tx, ctx, { action: "user.update", entity: "user", entityId: userId, before, after: { name: clean } });
  });
}

/** Admin password reset. Signs the user out everywhere. */
export async function setUserPassword(ctx: AppContext, userId: string, newPassword: string): Promise<void> {
  const pw = parseInput(passwordSchema, newPassword);
  await inTransaction(ctx, async (tx, ctx) => {
    await assertCanManageUser(tx, ctx, userId);
    const updated = await tx
      .update(account)
      .set({ password: await hashPassword(pw) })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) throw new NotFoundError("This user has no password login.");
    await signOutEverywhere(tx, userId);
    await writeAudit(tx, ctx, { action: "user.password_reset", entity: "user", entityId: userId });
  });
}

/** Set a manager PIN (4–6 digits, stored as an argon2 hash). Users may set their own. */
export async function setUserPin(ctx: AppContext, userId: string, newPin: string): Promise<void> {
  const value = parseInput(pinSchema, newPin);
  await inTransaction(ctx, async (tx, ctx) => {
    if (userId === ctx.userId) await assertSameOrg(tx, ctx, userId);
    else await assertCanManageUser(tx, ctx, userId);
    await tx.update(profiles).set({ pinHash: await argonHash(value) }).where(eq(profiles.userId, userId));
    await writeAudit(tx, ctx, { action: "user.pin_set", entity: "user", entityId: userId });
  });
}

/** Activate / deactivate a user. Deactivation signs them out everywhere. */
export async function setUserActive(ctx: AppContext, userId: string, active: boolean): Promise<void> {
  if (userId === ctx.userId) throw new ValidationError("You can't deactivate your own account.");
  await inTransaction(ctx, async (tx, ctx) => {
    await assertCanManageUser(tx, ctx, userId);
    const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
    if (p.isActive === active) return;
    if (!active) {
      await assertNotLastOwner(tx, ctx, userId);
      await signOutEverywhere(tx, userId);
    }
    await tx.update(profiles).set({ isActive: active }).where(eq(profiles.userId, userId));
    await writeAudit(tx, ctx, {
      action: active ? "user.activate" : "user.deactivate", entity: "user", entityId: userId,
      before: { isActive: p.isActive }, after: { isActive: active },
    });
  });
}

/** Give a user a role at a branch (adds the branch, or changes their role there). */
export async function assignBranchRole(
  ctx: AppContext,
  input: { userId: string; branchId: string; roleId: string },
): Promise<void> {
  const data = parseInput(branchRoleInput, input);
  requirePermission(ctx, data.branchId, "users.manage");
  if (data.userId === ctx.userId) throw new ValidationError("You can't change your own role.");
  await inTransaction(ctx, async (tx, ctx) => {
    await assertSameOrg(tx, ctx, data.userId);
    await assertCanGrantRole(tx, ctx, data.branchId, data.roleId);
    const [existing] = await tx
      .select()
      .from(userBranchRoles)
      .where(and(eq(userBranchRoles.userId, data.userId), eq(userBranchRoles.branchId, data.branchId)))
      .for("update");
    if (existing?.roleId === data.roleId) return;
    if (existing) {
      await assertCanGrantRole(tx, ctx, data.branchId, existing.roleId);
      await assertNotLastOwner(tx, ctx, data.userId, data.branchId);
      await tx.update(userBranchRoles).set({ roleId: data.roleId }).where(eq(userBranchRoles.id, existing.id));
    } else {
      await tx.insert(userBranchRoles).values({ ...data, createdBy: ctx.userId });
    }
    await writeAudit(tx, ctx, {
      action: "user.role_assign", entity: "user", entityId: data.userId, branchId: data.branchId,
      before: existing ? { roleId: existing.roleId } : null, after: { roleId: data.roleId },
    });
  });
}

/** Remove a user from a branch. */
export async function removeBranchRole(ctx: AppContext, input: { userId: string; branchId: string }): Promise<void> {
  requirePermission(ctx, input.branchId, "users.manage");
  await inTransaction(ctx, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(userBranchRoles)
      .where(and(eq(userBranchRoles.userId, input.userId), eq(userBranchRoles.branchId, input.branchId)))
      .for("update");
    if (!existing) return;
    await assertNotLastOwner(tx, ctx, input.userId, input.branchId);
    if (input.userId === ctx.userId) throw new ValidationError("You can't remove yourself from a branch.");
    await assertCanGrantRole(tx, ctx, input.branchId, existing.roleId);
    await tx.delete(userBranchRoles).where(eq(userBranchRoles.id, existing.id));
    await writeAudit(tx, ctx, {
      action: "user.role_remove", entity: "user", entityId: input.userId, branchId: input.branchId,
      before: { roleId: existing.roleId }, after: null,
    });
  });
}

