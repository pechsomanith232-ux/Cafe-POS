import { aliasedTable, and, asc, countDistinct, desc, eq, gte, ilike, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { auditLog, branches, profiles, rolePermissions, roles, user, userBranchRoles } from "@/db/schema";
import { requirePermission, type AppContext } from "@/lib/permissions";
import { DEFAULT_ROLES, type PermissionKey } from "@/lib/permissions-catalog";

/** The viewer's branches where their role has `key`. */
function branchesWith(ctx: AppContext, key: PermissionKey): string[] {
  return ctx.branchIds.filter((id) => ctx.access.get(id)?.permissions.has(key));
}

/** Branches the viewer belongs to, including deactivated ones. */
export async function listBranches(ctx: AppContext) {
  return ctx.db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      address: branches.address,
      phone: branches.phone,
      receiptHeader: branches.receiptHeader,
      receiptFooter: branches.receiptFooter,
      taxRate: branches.taxRate,
      taxInclusive: branches.taxInclusive,
      isActive: branches.isActive,
    })
    .from(branches)
    .innerJoin(userBranchRoles, and(eq(userBranchRoles.branchId, branches.id), eq(userBranchRoles.userId, ctx.userId)))
    .where(eq(branches.orgId, ctx.orgId))
    .orderBy(asc(branches.code));
}

export type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

/** Roles of the organization with their permissions and how many users have them. */
export async function listRoles(ctx: AppContext) {
  const roleRows = await ctx.db
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(eq(roles.orgId, ctx.orgId))
    .orderBy(asc(roles.createdAt), asc(roles.name));
  const ids = roleRows.map((r) => r.id);
  if (ids.length === 0) return [];
  const perms = await ctx.db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids));
  const usage = await ctx.db
    .select({ roleId: userBranchRoles.roleId, n: countDistinct(userBranchRoles.userId) })
    .from(userBranchRoles)
    .where(inArray(userBranchRoles.roleId, ids))
    .groupBy(userBranchRoles.roleId);
  // Built-in roles in their natural order (Owner, Admin, Manager, ...), then custom roles A–Z.
  const rank = (r: { name: string; isSystem: boolean }) => {
    const i = DEFAULT_ROLES.findIndex((d) => d.name === r.name);
    return r.isSystem && i >= 0 ? i : DEFAULT_ROLES.length;
  };
  roleRows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return roleRows.map((r) => ({
    ...r,
    permissions: Object.fromEntries(
      perms.filter((p) => p.roleId === r.id).map((p) => [p.permissionKey, p.limitValue]),
    ) as Record<string, string | null>,
    userCount: usage.find((u) => u.roleId === r.id)?.n ?? 0,
  }));
}

export type RoleRow = Awaited<ReturnType<typeof listRoles>>[number];

/**
 * Users who work at any of the viewer's branches (plus users with no branch
 * yet). Each user's assignments are limited to the viewer's branches.
 */
export async function listUsers(ctx: AppContext) {
  requirePermission(ctx, ctx.branchId, "users.manage");
  // Only branches where the viewer may manage users.
  const manageable = branchesWith(ctx, "users.manage");
  const ubr = aliasedTable(userBranchRoles, "ubr_any");
  const people = await ctx.db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      isActive: profiles.isActive,
      hasPin: sql<boolean>`${profiles.pinHash} is not null`,
    })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(
      and(
        eq(profiles.orgId, ctx.orgId),
        or(
          sql`exists (select 1 from ${userBranchRoles} where ${userBranchRoles.userId} = ${user.id} and ${inArray(userBranchRoles.branchId, manageable)})`,
          notExists(ctx.db.select({ one: sql`1` }).from(ubr).where(eq(ubr.userId, user.id))),
        ),
      ),
    )
    .orderBy(asc(user.name));
  const ids = people.map((p) => p.userId);
  const assignments = ids.length
    ? await ctx.db
        .select({
          userId: userBranchRoles.userId,
          branchId: userBranchRoles.branchId,
          branchCode: branches.code,
          roleId: roles.id,
          roleName: roles.name,
        })
        .from(userBranchRoles)
        .innerJoin(branches, eq(branches.id, userBranchRoles.branchId))
        .innerJoin(roles, eq(roles.id, userBranchRoles.roleId))
        .where(and(inArray(userBranchRoles.userId, ids), inArray(userBranchRoles.branchId, manageable)))
        .orderBy(asc(branches.code))
    : [];
  return people.map((p) => ({ ...p, assignments: assignments.filter((a) => a.userId === p.userId) }));
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

export type AuditFilters = {
  q?: string;
  userId?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd (inclusive)
  page?: number;
};

export const AUDIT_PAGE_SIZE = 50;

/** Audit log for the viewer's branches plus organization-wide entries. Needs audit.view. */
export async function listAudit(ctx: AppContext, filters: AuditFilters) {
  requirePermission(ctx, ctx.branchId, "audit.view");
  const visibleBranches = branchesWith(ctx, "audit.view");
  const page = Math.max(1, filters.page ?? 1);
  const approver = aliasedTable(user, "approver");
  const conditions = [
    eq(auditLog.orgId, ctx.orgId),
    or(inArray(auditLog.branchId, visibleBranches), isNull(auditLog.branchId)),
  ];
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(or(ilike(auditLog.action, like), ilike(auditLog.entity, like), ilike(auditLog.reason, like)));
  }
  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId));
  if (filters.from) conditions.push(gte(auditLog.createdAt, new Date(`${filters.from}T00:00:00`)));
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    conditions.push(lt(auditLog.createdAt, end));
  }

  const rows = await ctx.db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      branchCode: branches.code,
      userName: user.name,
      approverName: approver.name,
      reason: auditLog.reason,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .leftJoin(approver, eq(approver.id, auditLog.approvedBy))
    .leftJoin(branches, eq(branches.id, auditLog.branchId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1)
    .offset((page - 1) * AUDIT_PAGE_SIZE);

  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), page, hasMore: rows.length > AUDIT_PAGE_SIZE };
}

export type AuditRow = Awaited<ReturnType<typeof listAudit>>["rows"][number];
