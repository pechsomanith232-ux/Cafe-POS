import { sql } from "drizzle-orm";
import { dec, toMoneyString } from "@/lib/domain/money";
import { hasPermission, type AppContext } from "@/lib/permissions";
import { lineFacts, m4 } from "./facts";
import { profitReport } from "./profit";
import { inList, inRange, localDate, parseFilter, resolveScope, rows, type ReportFilter } from "./scope";

const div = (a: string, b: number | string) => (dec(b).isZero() ? "0.0000" : toMoneyString(dec(a).div(b)));
const pct = (a: string, b: string) => (dec(b).isZero() ? "0.00" : dec(a).div(b).times(100).toFixed(2));

type DayRow = { date: string; hour: number; orders: number; gross: string; discount: string; tax: string; net: string; total: string; refunds: string; refunds_ex_tax: string };

/**
 * Sales summary (plan §7). Sales are dated by payment, refunds by the refund.
 *   gross − discounts = sales after discount; net sales exclude tax;
 *   net after refunds = net sales − refunds (ex tax); average ticket = total incl. tax ÷ orders.
 */
export async function salesSummary(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  const r = await rows<DayRow>(ctx, sql`
    with facts as (${lineFacts(branchIds, f)})
    select ${localDate(sql`at`)}::text as date, extract(hour from (at at time zone 'Asia/Phnom_Penh'))::int as hour,
      count(distinct order_id) filter (where kind = 'sale')::int as orders,
      ${m4("sum(gross)")} as gross, ${m4("sum(discount)")} as discount,
      ${m4("sum(tax) filter (where kind = 'sale')")} as tax, ${m4("sum(net) filter (where kind = 'sale')")} as net,
      ${m4("sum(total) filter (where kind = 'sale')")} as total,
      ${m4("-sum(total) filter (where kind = 'refund')")} as refunds, ${m4("-sum(net) filter (where kind = 'refund')")} as refunds_ex_tax
    from facts group by 1, 2 order by 1, 2`);

  const add = (xs: DayRow[], k: keyof DayRow) => toMoneyString(xs.reduce((a, x) => a.plus(x[k] as string), dec(0)));
  const summarize = (xs: DayRow[]) => {
    const orders = xs.reduce((a, x) => a + x.orders, 0);
    const netSales = add(xs, "net");
    const refundsExTax = add(xs, "refunds_ex_tax");
    const totalSales = add(xs, "total");
    return {
      orders, grossSales: add(xs, "gross"), discounts: add(xs, "discount"), tax: add(xs, "tax"), netSales, totalSales,
      refunds: add(xs, "refunds"), refundsExTax, netAfterRefunds: toMoneyString(dec(netSales).minus(refundsExTax)), avgTicket: div(totalSales, orders),
    };
  };
  const group = <K extends string | number>(key: (x: DayRow) => K) => {
    const m = new Map<K, DayRow[]>();
    for (const x of r) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return [...m.entries()];
  };
  return {
    totals: summarize(r),
    byDay: group((x) => x.date).map(([date, xs]) => ({ date, ...summarize(xs) })),
    byHour: group((x) => x.hour).sort((a, b) => a[0] - b[0]).map(([hour, xs]) => ({ hour, ...summarize(xs) })),
  };
}
export type SalesSummary = Awaited<ReturnType<typeof salesSummary>>;

export type SalesDimension = "product" | "category" | "variant" | "modifier";

/** Sales by product / category / variant (net of refunds, ex tax), or add-on sales by modifier. */
export async function salesByItem(ctx: AppContext, filter: ReportFilter & { by: SalesDimension }) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  let r: { key: string | null; label: string; qty: number; net_sales: string }[];
  if (filter.by === "modifier") {
    // Modifiers are priced add-ons: their sales are price × quantity before discounts.
    r = await rows(ctx, sql`
      with facts as (${lineFacts(branchIds, f)})
      select olm.modifier_id::text as key, max(olm.name_snapshot) as label, sum(facts.qty)::int as qty, ${m4("sum(olm.price_delta * facts.qty)")} as net_sales
      from facts join order_line_modifiers olm on olm.order_line_id = facts.line_id
      group by olm.modifier_id`);
  } else {
    const key = { product: sql`p.id::text`, variant: sql`v.id::text`, category: sql`c.id::text` }[filter.by];
    const label = {
      product: sql`max(p.name)`, variant: sql`max(p.name) || ' · ' || max(v.name)`, category: sql`coalesce(max(c.name), 'Uncategorized')`,
    }[filter.by];
    r = await rows(ctx, sql`
      with facts as (${lineFacts(branchIds, f)})
      select ${key} as key, ${label} as label, sum(facts.qty)::int as qty, ${m4("sum(facts.net)")} as net_sales
      from facts join products p on p.id = facts.product_id join product_variants v on v.id = facts.variant_id
      left join menu_categories c on c.id = p.category_id
      group by 1`);
  }
  const total = toMoneyString(r.reduce((a, x) => a.plus(x.net_sales), dec(0)));
  return r
    .map((x) => ({ key: x.key ?? "none", label: x.label, qty: x.qty, netSales: x.net_sales, pct: pct(x.net_sales, total) }))
    .sort((a, b) => dec(b.netSales).cmp(a.netSales) || a.label.localeCompare(b.label));
}
export type SalesByItemRow = Awaited<ReturnType<typeof salesByItem>>[number];

/**
 * Takings by payment method and currency, and cash per currency (KHR vs USD):
 * received − change given − refunds paid out = net cash.
 */
export async function salesByPayment(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  const where = sql`${inList(sql`p.branch_id`, branchIds)} and ${inRange(sql`p.created_at`, f)}`;
  const methods = await rows<{ method: string; method_type: string; currency: string; count: number; received: string; received_base: string; refunded: string; refunded_base: string }>(ctx, sql`
    select pm.name as method, p.method_type, p.currency_code as currency,
      count(*) filter (where not p.is_refund)::int as count,
      ${m4("sum(p.amount_tendered) filter (where not p.is_refund)")} as received, ${m4("sum(p.amount_base) filter (where not p.is_refund)")} as received_base,
      ${m4("sum(p.amount_tendered) filter (where p.is_refund)")} as refunded, ${m4("sum(p.amount_base) filter (where p.is_refund)")} as refunded_base
    from payments p join payment_methods pm on pm.id = p.method_id where ${where}
    group by pm.name, p.method_type, p.currency_code order by pm.name, p.currency_code`);
  const change = await rows<{ currency: string; amount: string }>(ctx, sql`
    select p.change_currency as currency, ${m4("sum(p.change_amount)")} as amount from payments p
    where ${where} and p.change_currency is not null and p.change_amount <> 0 group by p.change_currency`);
  const currencies = [...new Set([...methods.filter((m) => m.method_type === "cash").map((m) => m.currency), ...change.map((c) => c.currency)])].sort().reverse();
  const cash = currencies.map((currency) => {
    const cm = methods.filter((m) => m.method_type === "cash" && m.currency === currency);
    const received = toMoneyString(cm.reduce((a, m) => a.plus(m.received), dec(0)));
    const refunded = toMoneyString(cm.reduce((a, m) => a.plus(m.refunded), dec(0)));
    const chg = change.find((c) => c.currency === currency)?.amount ?? "0.0000";
    return { currency, received, change: toMoneyString(chg), refunded, net: toMoneyString(dec(received).minus(chg).minus(refunded)) };
  });
  return {
    methods: methods.map((m) => ({ method: m.method, methodType: m.method_type, currency: m.currency, count: m.count, received: m.received, receivedBase: m.received_base, refunded: m.refunded, refundedBase: m.refunded_base })),
    cash,
  };
}
export type SalesByPayment = Awaited<ReturnType<typeof salesByPayment>>;

/** Per staff member: orders they rang up, voids they made and refunds they gave. */
export async function salesByStaff(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.sales", f.branch);
  const r = await rows<{ user_id: string; name: string; orders: number; net_sales: string; total_sales: string; voids: number; void_total: string; refunds: number; refund_total: string }>(ctx, sql`
    with facts as (${lineFacts(branchIds, f)}),
    s as (select user_id, count(distinct order_id)::int as orders, sum(net) as net, sum(total) as total from facts where kind = 'sale' group by user_id),
    v as (select voided_by as user_id, count(*)::int as n, sum(total) as amt from orders o
          where o.status = 'voided' and ${inList(sql`o.branch_id`, branchIds)} and ${inRange(sql`o.voided_at`, f)} group by voided_by),
    rf as (select created_by as user_id, count(*)::int as n, sum(total_base) as amt from refunds r
          where ${inList(sql`r.branch_id`, branchIds)} and ${inRange(sql`r.created_at`, f)} group by created_by),
    ids as (select user_id from s union select user_id from v union select user_id from rf)
    select ids.user_id, coalesce(u.name, 'Unknown') as name, coalesce(s.orders, 0) as orders, ${m4("s.net")} as net_sales, ${m4("s.total")} as total_sales,
      coalesce(v.n, 0) as voids, ${m4("v.amt")} as void_total, coalesce(rf.n, 0) as refunds, ${m4("rf.amt")} as refund_total
    from ids left join "user" u on u.id = ids.user_id left join s on s.user_id = ids.user_id
      left join v on v.user_id = ids.user_id left join rf on rf.user_id = ids.user_id
    where ids.user_id is not null order by coalesce(s.net, 0) desc, name`);
  return r.map((x) => ({
    userId: x.user_id, name: x.name, orders: x.orders, netSales: x.net_sales, avgTicket: div(x.total_sales, x.orders),
    voids: x.voids, voidTotal: x.void_total, refunds: x.refunds, refundTotal: x.refund_total,
  }));
}
export type StaffRow = Awaited<ReturnType<typeof salesByStaff>>[number];

/**
 * Branch comparison (needs reports.all_branches): per branch, orders, net sales
 * after refunds, average ticket, COGS and gross profit — same definitions as the
 * sales summary and profit reports.
 */
export async function branchComparison(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  // Branches where the user holds both reports this combines.
  const branchIds = resolveScope(ctx, "reports.profit", "all").branchIds.filter((b) => hasPermission(ctx, b, "reports.sales"));
  const names = new Map([...ctx.access.values()].map((a) => [a.branchId, a.branchName]));
  const out = [];
  for (const b of branchIds) {
    const [s, p] = await Promise.all([salesSummary(ctx, { ...f, branch: b }), profitReport(ctx, { ...f, branch: b })]);
    out.push({ branchId: b, branch: names.get(b) ?? b, orders: s.totals.orders, netSales: s.totals.netAfterRefunds, avgTicket: s.totals.avgTicket, cogs: p.totals.cogs, grossProfit: p.totals.grossProfit, marginPct: p.totals.marginPct });
  }
  return out.sort((a, b) => a.branch.localeCompare(b.branch));
}
export type BranchComparisonRow = Awaited<ReturnType<typeof branchComparison>>[number];
