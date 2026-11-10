import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { isYmd } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError, assertBranchAccess, hasPermission, requirePermission, type AppContext } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions-catalog";

export const TZ = "Asia/Phnom_Penh";

/** Every report takes a branch (an id, or "all") and an inclusive local date range. */
export type ReportFilter = { branch: string; from: string; to: string };

const ymd = z.string().refine(isYmd, "Use a real yyyy-mm-dd date");
const filterSchema = z.object({ branch: z.string().min(1), from: ymd, to: ymd }).refine((f) => f.from <= f.to, "The start date is after the end date");

export function parseFilter(f: ReportFilter): ReportFilter {
  const r = filterSchema.safeParse(f);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the report filter.");
  return r.data;
}

/**
 * Which branches a report covers (plan §7): one branch the user can see and holds
 * `perm` at, or "all" — which needs reports.all_branches at the active branch and
 * then covers every branch where the user holds `perm`.
 */
export function resolveScope(ctx: AppContext, perm: PermissionKey, branch: string): { branchIds: string[]; all: boolean } {
  if (branch === "all") {
    if (!hasPermission(ctx, ctx.branchId, "reports.all_branches")) throw new ForbiddenError("Missing permission reports.all_branches at this branch.");
    const branchIds = ctx.branchIds.filter((b) => hasPermission(ctx, b, perm));
    if (!branchIds.length) throw new ForbiddenError(`Missing permission ${perm}.`);
    return { branchIds, all: true };
  }
  assertBranchAccess(ctx, branch);
  requirePermission(ctx, branch, perm);
  return { branchIds: [branch], all: false };
}

/** A timestamp column as a local (café time zone) date. */
export const localDate = (col: SQLWrapper | SQL) => sql`((${col}) at time zone ${sql.raw(`'${TZ}'`)})::date`;
export const inRange = (col: SQLWrapper | SQL, f: { from: string; to: string }) => sql`${localDate(col)} between ${f.from}::date and ${f.to}::date`;
export const inList = (col: SQLWrapper | SQL, ids: string[]) => sql`${col} in ${ids}`;

/** Run a raw query and get typed rows. */
export async function rows<T>(ctx: AppContext, q: SQL): Promise<T[]> {
  return (await ctx.db.execute(q)) as unknown as T[];
}
