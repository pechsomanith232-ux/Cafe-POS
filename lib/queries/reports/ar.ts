import { and, eq, sql } from "drizzle-orm";
import { customers } from "@/db/schema";
import { statementWindow } from "@/lib/domain/statement";
import { NotFoundError } from "@/lib/errors";
import { requirePermission, type AppContext } from "@/lib/permissions";
import { localDate, rows } from "./scope";

export type CustomerStatementRow = { date: string; kind: "charge" | "refund" | "payment"; ref: string; debit: string | null; credit: string | null; balance: string };

/**
 * Customer statement (plan §7): charges to account (debit), refunds back to the
 * account and payments received (credit), with an opening balance for the period.
 */
export async function customerStatement(ctx: AppContext, opts: { customerId: string; from: string; to: string }) {
  requirePermission(ctx, ctx.branchId, "reports.ar");
  const [c] = await ctx.db.select().from(customers).where(and(eq(customers.id, opts.customerId), eq(customers.orgId, ctx.orgId)));
  if (!c) throw new NotFoundError("Customer not found.");
  const entries = await rows<Omit<CustomerStatementRow, "balance">>(ctx, sql`
    select * from (
      select ${localDate(sql`p.created_at`)}::text as date, case when p.is_refund then 'refund' else 'charge' end as kind, o.order_no as ref,
        case when p.is_refund then null else p.amount_base::numeric(18,4)::text end as debit,
        case when p.is_refund then p.amount_base::numeric(18,4)::text else null end as credit, p.created_at as at
      from payments p join orders o on o.id = p.order_id
      where p.method_type = 'account' and o.customer_id = ${c.id}
      union all
      select cp.payment_date::text, 'payment', coalesce(cp.reference, 'Payment'), null, cp.amount_base::numeric(18,4)::text, cp.created_at
      from customer_payments cp where cp.customer_id = ${c.id}) e
    order by date, at`);
  return { customer: c, ...statementWindow(entries.map(({ at: _a, ...e }: Omit<CustomerStatementRow, "balance"> & { at?: unknown }) => { void _a; return e; }), opts.from, opts.to) };
}
