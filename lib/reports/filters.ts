import "server-only";
import { addDays, isYmd, todayLocal } from "@/lib/dates";
import { hasPermission, type AppContext } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions-catalog";
import type { ReportFilter } from "@/lib/queries/reports/scope";

type SP = Record<string, string | string[] | undefined>;
const ymd = (v: unknown) => (isYmd(v) ? v : null);
export const asOfParam = (v: unknown, today: string) => (isYmd(v) && v <= today ? v : today);
export const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export type BranchOption = { id: string; name: string };
export type FilterState = ReportFilter & { branches: BranchOption[]; canAll: boolean; branchLabel: string; today: string };

/**
 * Read a report's branch + date range from the URL. Defaults: the active branch
 * and the last 7 days ending today. "all" is offered only with reports.all_branches.
 */
export function readReportFilter(ctx: AppContext, sp: SP, perm: PermissionKey, opts: { allowAll?: boolean; defaultDays?: number } = {}): FilterState {
  const today = todayLocal();
  const branches = [...ctx.access.values()].filter((a) => hasPermission(ctx, a.branchId, perm)).map((a) => ({ id: a.branchId, name: a.branchName }));
  const canAll = (opts.allowAll ?? true) && hasPermission(ctx, ctx.branchId, "reports.all_branches") && branches.length > 1;
  const wanted = str(sp.branch);
  const fallback = branches.some((b) => b.id === ctx.branchId) ? ctx.branchId : branches[0]?.id ?? ctx.branchId;
  const branch = wanted === "all" && canAll ? "all" : branches.some((b) => b.id === wanted) ? wanted! : fallback;
  let from = ymd(sp.from) ?? addDays(today, -((opts.defaultDays ?? 7) - 1));
  let to = ymd(sp.to) ?? today;
  if (from > to) [from, to] = [to, from];
  const branchLabel = branch === "all" ? "All branches" : branches.find((b) => b.id === branch)?.name ?? ctx.access.get(branch)?.branchName ?? "";
  return { branch, from, to, branches, canAll, branchLabel, today };
}

/** Props for <ReportFilters> from a filter state. */
export const filterProps = (f: FilterState) => ({ branch: f.branch, branches: f.branches, canAll: f.canAll, from: f.from, to: f.to, today: f.today });
