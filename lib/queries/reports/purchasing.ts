import { sql } from "drizzle-orm";
import { statementWindow } from "@/lib/domain/statement";
import type { AppContext } from "@/lib/permissions";
import { dec, toMoneyString } from "@/lib/domain/money";
import { apAging, buildSupplierStatement } from "@/lib/queries/purchasing";
import { m4 } from "./facts";
import { inList, parseFilter, resolveScope, rows, type ReportFilter } from "./scope";

/** Direct (pay-now) purchases by receipt date: supplier, total, how they were paid, and whether from the drawer. */
export async function directPurchases(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.ap", f.branch);
  const r = await rows<{ id: string; number: number; date: string; branch: string; supplier: string; total: string; method: string | null; currency: string | null; amount: string | null; paid_from_drawer: boolean; invoice_no: string | null }>(ctx, sql`
    select g.id::text as id, g.number::int as number, g.receipt_date::text as date, b.name as branch,
      coalesce(s.name, g.supplier_name_text, '—') as supplier, ${m4("g.total")} as total,
      pay.method, pay.currency, pay.amount, g.paid_from_shift_id is not null as paid_from_drawer, g.supplier_invoice_no as invoice_no
    from goods_receipts g join branches b on b.id = g.branch_id left join suppliers s on s.id = g.supplier_id
      left join lateral (
        select string_agg(distinct pm.name, ', ') as method, string_agg(distinct sp.currency_code, ', ') as currency,
          sum(sp.amount)::numeric(18,4)::text as amount
        from supplier_payment_allocations a join supplier_payments sp on sp.id = a.payment_id left join payment_methods pm on pm.id = sp.method_id
        where a.receipt_id = g.id) pay on true
    where g.purchase_type = 'direct' and g.status = 'posted' and ${inList(sql`g.branch_id`, branchIds)}
      and g.receipt_date between ${f.from}::date and ${f.to}::date
    order by g.receipt_date, g.number`);
  return r.map((x) => ({
    id: x.id, ref: `GR-${String(x.number).padStart(6, "0")}`, date: x.date, branch: x.branch, supplier: x.supplier, invoiceNo: x.invoice_no,
    total: x.total, method: x.method, currency: x.currency, amount: x.amount, paidFromDrawer: x.paid_from_drawer,
  }));
}
export type DirectPurchaseRow = Awaited<ReturnType<typeof directPurchases>>[number];

/** Supplier statement for a period at one branch: opening balance, entries, running and closing balance. */
export async function supplierStatementReport(ctx: AppContext, opts: { supplierId: string; branchId: string; from: string; to: string }) {
  resolveScope(ctx, "reports.ap", opts.branchId);
  const s = await buildSupplierStatement(ctx, { supplierId: opts.supplierId, branchId: opts.branchId });
  return { supplier: s.supplier, ...statementWindow(s.rows.map(({ balance: _b, ...r }) => { void _b; return r; }), opts.from, opts.to) };
}

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "total"] as const;
const addBuckets = <T extends Record<(typeof BUCKETS)[number], string>>(a: T, b: T): T =>
  ({ ...a, ...Object.fromEntries(BUCKETS.map((k) => [k, toMoneyString(dec(a[k]).plus(b[k]))])) });

/** AP aging for one branch or all of them (reports.all_branches): each supplier's branches are added together. */
export async function apAgingReport(ctx: AppContext, opts: { branch: string; asOf: string }) {
  const { branchIds } = resolveScope(ctx, "reports.ap", opts.branch);
  const parts = await Promise.all(branchIds.map((branchId) => apAging(ctx, { branchId, asOf: opts.asOf })));
  const bySupplier = new Map<string, (typeof parts)[number]["rows"][number]>();
  for (const r of parts.flatMap((p) => p.rows)) {
    const e = bySupplier.get(r.supplierId);
    bySupplier.set(r.supplierId, e ? { ...addBuckets(e, r), invoices: [...e.invoices, ...r.invoices] } : r);
  }
  return {
    asOf: opts.asOf,
    rows: [...bySupplier.values()].sort((a, b) => dec(b.total).cmp(a.total)),
    totals: parts.map((p) => p.totals).reduce(addBuckets),
  };
}
