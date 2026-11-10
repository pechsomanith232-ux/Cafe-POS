import { sql } from "drizzle-orm";
import { dec, toMoneyString } from "@/lib/domain/money";
import type { AppContext } from "@/lib/permissions";
import { lineFacts, m4 } from "./facts";
import { parseFilter, resolveScope, rows, type ReportFilter } from "./scope";

type Agg = { key: string | null; label: string; qty: number; net: string; cogs: string; theo: string };

const shape = (x: Pick<Agg, "net" | "cogs" | "theo">) => {
  const grossProfit = toMoneyString(dec(x.net).minus(x.cogs));
  return { netSales: x.net, cogs: x.cogs, grossProfit, marginPct: dec(x.net).isZero() ? null : dec(grossProfit).div(x.net).times(100).toFixed(2), theoreticalCost: x.theo };
};

/**
 * Profit / COGS (plan §7): net sales (ex tax, less refunds) − COGS, where COGS
 * comes from the stock ledger — sale movements minus restocked refunds — so it
 * reconciles with stock_movements. Recipe cost of items that don't deduct stock
 * is shown separately as theoretical cost (not in the ledger, not in COGS).
 * Sales are dated by payment, refunds by the refund.
 */
export async function profitReport(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.profit", f.branch);
  const by = (key: ReturnType<typeof sql>, label: ReturnType<typeof sql>) => rows<Agg>(ctx, sql`
    with facts as (${lineFacts(branchIds, f)})
    select ${key} as key, ${label} as label, sum(facts.qty)::int as qty, ${m4("sum(facts.net)")} as net, ${m4("sum(facts.cogs)")} as cogs, ${m4("sum(facts.theo)")} as theo
    from facts join products p on p.id = facts.product_id left join menu_categories c on c.id = p.category_id
    group by 1`);
  const order = <T extends { netSales: string; label: string }>(xs: T[]) => xs.sort((a, b) => dec(b.netSales).cmp(a.netSales) || a.label.localeCompare(b.label));
  const products = await by(sql`p.id::text`, sql`max(p.name)`);
  const categories = await by(sql`c.id::text`, sql`coalesce(max(c.name), 'Uncategorized')`);
  const sources = await rows<{ source: string | null; lines: number; cost: string }>(ctx, sql`
    with facts as (${lineFacts(branchIds, f)})
    select cost_source as source, count(*) filter (where kind = 'sale')::int as lines, ${m4("sum(cost_total)")} as cost
    from facts group by cost_source order by cost_source`);
  const sum = (k: "net" | "cogs" | "theo") => toMoneyString(products.reduce((a, x) => a.plus(x[k]), dec(0)));
  return {
    totals: shape({ net: sum("net"), cogs: sum("cogs"), theo: sum("theo") }),
    byProduct: order(products.map((x) => ({ key: x.key ?? "none", label: x.label, qty: x.qty, ...shape(x) }))),
    byCategory: order(categories.map((x) => ({ key: x.key ?? "none", label: x.label, qty: x.qty, ...shape(x) }))),
    costSources: sources.map((s) => ({ source: s.source ?? "none", lines: s.lines, cost: s.cost })),
  };
}
export type ProfitReport = Awaited<ReturnType<typeof profitReport>>;
