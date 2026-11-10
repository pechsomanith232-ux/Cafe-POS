import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { ensureBranchDefaults } from "@/lib/branch-defaults";
import type { Executor } from "@/db/client";
import { branches, userBranchRoles } from "@/db/schema";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { ForbiddenError, requirePermission, type AppContext } from "@/lib/permissions";
import { branchInput, type BranchInput } from "@/lib/validators/settings";
import { writeAudit } from "./audit";
import { inTransaction } from "./tx";

type Branch = typeof branches.$inferSelect;

function snapshot(b: Branch) {
  const { code, name, address, phone, receiptHeader, receiptFooter, taxRate, taxInclusive, isActive } = b;
  return { code, name, address, phone, receiptHeader, receiptFooter, taxRate, taxInclusive, isActive };
}

async function assertCodeFree(tx: Executor, orgId: string, code: string, exceptId?: string) {
  const [dupe] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.orgId, orgId),
        sql`upper(${branches.code}) = ${code}`,
        exceptId ? ne(branches.id, exceptId) : undefined,
      ),
    );
  if (dupe) throw new ConflictError(`Branch code ${code} is already used.`);
}

async function loadBranch(tx: Executor, ctx: AppContext, id: string): Promise<Branch> {
  const [b] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.orgId, ctx.orgId)))
    .for("update");
  if (!b) throw new NotFoundError("Branch not found.");
  return b;
}

/**
 * settings.manage at the branch itself, or — for a deactivated branch, which
 * isn't in the context — settings.manage at the active branch plus
 * membership of that branch.
 */
async function authorizeBranchAdmin(tx: Executor, ctx: AppContext, id: string) {
  if (ctx.branchIds.includes(id)) {
    requirePermission(ctx, id, "settings.manage");
    return;
  }
  requirePermission(ctx, ctx.branchId, "settings.manage");
  const [member] = await tx
    .select({ id: userBranchRoles.id })
    .from(userBranchRoles)
    .where(and(eq(userBranchRoles.userId, ctx.userId), eq(userBranchRoles.branchId, id)));
  if (!member) throw new ForbiddenError("You don't have access to that branch.");
}

/** Create a branch. The creator joins it with their role at the active branch. */
export async function createBranch(ctx: AppContext, input: BranchInput): Promise<Branch> {
  requirePermission(ctx, ctx.branchId, "settings.manage");
  const data = parseInput(branchInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    await assertCodeFree(tx, ctx.orgId, data.code);
    const [b] = await tx
      .insert(branches)
      .values({ ...data, orgId: ctx.orgId, createdBy: ctx.userId })
      .returning();
    const myRole = ctx.access.get(ctx.branchId)!.roleId;
    await tx.insert(userBranchRoles).values({ userId: ctx.userId, branchId: b.id, roleId: myRole, createdBy: ctx.userId });
    await ensureBranchDefaults(tx, b.id);
    await writeAudit(tx, ctx, { action: "branch.create", entity: "branch", entityId: b.id, branchId: b.id, after: snapshot(b) });
    return b;
  });
}

export async function updateBranch(ctx: AppContext, id: string, input: BranchInput): Promise<Branch> {
  const data = parseInput(branchInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    await authorizeBranchAdmin(tx, ctx, id);
    const before = await loadBranch(tx, ctx, id);
    await assertCodeFree(tx, ctx.orgId, data.code, id);
    const [after] = await tx.update(branches).set(data).where(eq(branches.id, id)).returning();
    await writeAudit(tx, ctx, {
      action: "branch.update", entity: "branch", entityId: id, branchId: id,
      before: snapshot(before), after: snapshot(after),
    });
    return after;
  });
}

/** Activate / deactivate a branch. You can't deactivate your last active branch. */
export async function setBranchActive(ctx: AppContext, id: string, active: boolean): Promise<void> {
  await inTransaction(ctx, async (tx, ctx) => {
    await authorizeBranchAdmin(tx, ctx, id);
    const before = await loadBranch(tx, ctx, id);
    if (before.isActive === active) return;
    if (!active) {
      const others = ctx.branchIds.filter((b) => b !== id);
      const [{ n }] = others.length
        ? await tx.select({ n: count() }).from(branches).where(and(inArray(branches.id, others), eq(branches.isActive, true)))
        : [{ n: 0 }];
      if (n === 0) throw new ValidationError("You can't deactivate your only active branch.");
    }
    await tx.update(branches).set({ isActive: active }).where(eq(branches.id, id));
    await writeAudit(tx, ctx, {
      action: active ? "branch.activate" : "branch.deactivate", entity: "branch", entityId: id, branchId: id,
      before: { isActive: before.isActive }, after: { isActive: active },
    });
  });
}
