import { sql } from "drizzle-orm";
import { addDays, todayLocal } from "@/lib/dates";
import { dec, toMoneyString } from "@/lib/domain/money";
import type { AppContext } from "@/lib/permissions";
import { lineFacts, m4 } from "./facts";
import { inList, localDate, resolveScope, rows } from "./scope";

/**
 * Dashboard numbers for one branch (needs reports.sales): today's sales, orders,
 * average ticket and top products, open shifts, and daily net sales (after
 * refunds) for the last 30 days, zero-filled.
 */
export async function dashboard(ctx: AppContext, branchId: string) {
  const { branchIds } = resolveScope(ctx, "reports.sales", branchId);
  const today = todayLocal();
  const from = addDays(today, -29);
  const days = await rows<{ date: string; orders: number; net: string; total: string }>(ctx, sql`
    with facts as (${lineFacts(branchIds, { from, to: today })})
    select ${localDate(sql`at`)}::text as date, count(distinct order_id) filter (where kind = 'sale')::int as orders,
      ${m4("sum(net)")} as net, ${m4("sum(total) filter (where kind = 'sale')")} as total
    from facts group by 1`);
  const top = await rows<{ label: string; qty: number; net: string }>(ctx, sql`
    with facts as (${lineFacts(branchIds, { from: today, to: today })})
    select max(p.name) as label, sum(facts.qty)::int as qty, ${m4("sum(facts.net)")} as net
    from facts join products p on p.id = facts.product_id group by p.id
    having sum(facts.qty) > 0 order by sum(facts.net) desc, max(p.name) limit 5`);
  const openShifts = await rows<{ id: string; register: string; opened_by: string | null; opened_at: Date | string }>(ctx, sql`
    select s.id::text as id, rg.name as register, u.name as opened_by, s.opened_at from shifts s
      join registers rg on rg.id = s.register_id left join "user" u on u.id = s.opened_by
    where s.status = 'open' and ${inList(sql`s.branch_id`, branchIds)} order by s.opened_at`);

  const series30 = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(from, i);
    const d = days.find((x) => x.date === date);
    return { date, orders: d?.orders ?? 0, netSales: d?.net ?? "0.0000" };
  });
  const t = days.find((x) => x.date === today);
  const orders = t?.orders ?? 0;
  return {
    today: { date: today, orders, netSales: t?.net ?? "0.0000", avgTicket: orders ? toMoneyString(dec(t!.total).div(orders)) : "0.0000" },
    topProducts: top.map((x) => ({ label: x.label, qty: x.qty, netSales: x.net })),
    openShifts: openShifts.map((s) => ({ id: s.id, register: s.register, openedBy: s.opened_by, openedAt: new Date(s.opened_at).toISOString() })),
    series7: series30.slice(-7),
    series30,
  };
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
