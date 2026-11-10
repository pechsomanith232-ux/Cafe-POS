import { sql } from "drizzle-orm";
import type { AppContext } from "@/lib/permissions";
import { m4 } from "./facts";
import { inList, inRange, parseFilter, resolveScope, rows, type ReportFilter } from "./scope";

/** Voids and refunds with who did them, who approved and why (plan §7), oldest first. */
export async function voidRefundLog(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  const r = await rows<{ kind: "void" | "refund"; at: Date | string; order_id: string; order_no: string; branch: string; amount: string; reason: string | null; by_name: string | null; approved_by_name: string | null }>(ctx, sql`
    select * from (
      select 'refund' as kind, r.created_at as at, o.id::text as order_id, o.order_no, b.name as branch, ${m4("r.total_base")} as amount, r.reason,
        ub.name as by_name, ua.name as approved_by_name
      from refunds r join orders o on o.id = r.order_id join branches b on b.id = r.branch_id
        left join "user" ub on ub.id = r.created_by left join "user" ua on ua.id = r.approved_by
      where ${inList(sql`r.branch_id`, branchIds)} and ${inRange(sql`r.created_at`, f)}
      union all
      select 'void', o.voided_at, o.id::text, o.order_no, b.name, ${m4("o.total")}, o.void_reason, ub.name,
        (select ua.name from audit_log al join "user" ua on ua.id = al.approved_by
          where al.action = 'order.void' and al.entity_id = o.id::text order by al.created_at desc limit 1)
      from orders o join branches b on b.id = o.branch_id left join "user" ub on ub.id = o.voided_by
      where o.status = 'voided' and ${inList(sql`o.branch_id`, branchIds)} and ${inRange(sql`o.voided_at`, f)}) x
    order by at`);
  return r.map((x) => ({
    kind: x.kind, at: new Date(x.at).toISOString(), orderId: x.order_id, orderNo: x.order_no, branch: x.branch, amount: x.amount,
    reason: x.reason, byName: x.by_name, approvedByName: x.approved_by_name,
  }));
}
export type VoidRefundRow = Awaited<ReturnType<typeof voidRefundLog>>[number];

/** Shifts opened in the period, with their register, people and sales; each links to its X/Z report. */
export async function shiftList(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  const r = await rows<{ id: string; branch: string; register: string; status: string; opened_at: Date | string; closed_at: Date | string | null; opened_by: string | null; closed_by: string | null; orders: number; sales: string }>(ctx, sql`
    select s.id::text as id, b.name as branch, rg.name as register, s.status, s.opened_at, s.closed_at, uo.name as opened_by, uc.name as closed_by,
      (select count(*) from orders o where o.shift_id = s.id and o.status in ('paid', 'partially_refunded', 'refunded'))::int as orders,
      ${m4("(select sum(o.total) from orders o where o.shift_id = s.id and o.status in ('paid', 'partially_refunded', 'refunded'))")} as sales
    from shifts s join branches b on b.id = s.branch_id join registers rg on rg.id = s.register_id
      left join "user" uo on uo.id = s.opened_by left join "user" uc on uc.id = s.closed_by
    where ${inList(sql`s.branch_id`, branchIds)} and ${inRange(sql`s.opened_at`, f)}
    order by s.opened_at desc`);
  return r.map((x) => ({
    id: x.id, branch: x.branch, register: x.register, status: x.status, openedAt: new Date(x.opened_at).toISOString(),
    closedAt: x.closed_at ? new Date(x.closed_at).toISOString() : null, openedBy: x.opened_by, closedBy: x.closed_by, orders: x.orders, sales: x.sales,
  }));
}
export type ShiftListRow = Awaited<ReturnType<typeof shiftList>>[number];
