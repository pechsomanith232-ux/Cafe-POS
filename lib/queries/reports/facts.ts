import { sql, type SQL } from "drizzle-orm";
import { inList, inRange, type ReportFilter } from "./scope";

/** Orders that count as sales: paid, even if later (partly) refunded. Voided orders never do. */
export const SOLD = sql.raw(`('paid', 'partially_refunded', 'refunded')`);

const saleLedger = sql`coalesce((select -sum(m.total_cost) from stock_movements m where m.ref_type = 'order_line' and m.ref_id = ol.id::text), 0)`;

/**
 * One row per sold line (dated by the order's payment) and per refunded line
 * (dated by the refund, negative), so every sales and profit report nets
 * refunds the same way:
 *   net   = sales excluding tax (refunds: their share of the line, ex tax)
 *   cogs  = from the stock ledger: −(sale movements) for sold lines,
 *           −(restock movements) for refunded lines
 *   theo  = recipe cost that never moved stock (lines or modifiers that don't deduct)
 * Use as `with facts as (${lineFacts(...)}) select … from facts`.
 */
export function lineFacts(branchIds: string[], f: Pick<ReportFilter, "from" | "to">): SQL {
  return sql`
    select 'sale'::text as kind, o.id as order_id, o.branch_id, o.created_by as user_id, ol.id as line_id, null::uuid as refund_line_id,
      ol.product_id, ol.variant_id, ol.qty::numeric as qty,
      ((ol.unit_price + ol.modifiers_total) * ol.qty)::numeric as gross,
      (ol.line_discount_amount + ol.discount_alloc)::numeric as discount,
      ol.tax_amount::numeric as tax, ol.line_total::numeric as total, (ol.line_total - ol.tax_amount)::numeric as net,
      ${saleLedger}::numeric as cogs,
      (coalesce(ol.cost_total, 0) - ${saleLedger})::numeric as theo,
      ol.cost_source, coalesce(ol.cost_total, 0)::numeric as cost_total, o.paid_at as at
    from order_lines ol join orders o on o.id = ol.order_id
    where o.status in ${SOLD} and ${inList(sql`o.branch_id`, branchIds)} and ${inRange(sql`o.paid_at`, f)}
    union all
    select 'refund'::text, o.id, o.branch_id, r.created_by, ol.id, rl.id,
      ol.product_id, ol.variant_id, -rl.qty::numeric,
      0::numeric, 0::numeric,
      -(rl.amount - round(rl.amount * coalesce((ol.line_total - ol.tax_amount) / nullif(ol.line_total, 0), 0), 4)),
      -rl.amount::numeric,
      -round(rl.amount * coalesce((ol.line_total - ol.tax_amount) / nullif(ol.line_total, 0), 0), 4),
      coalesce((select -sum(m.total_cost) from stock_movements m where m.ref_type = 'refund_line' and m.ref_id = rl.id::text), 0)::numeric,
      -round((coalesce(ol.cost_total, 0) - ${saleLedger}) * rl.qty / ol.qty, 4),
      ol.cost_source, -round(coalesce(ol.cost_total, 0) * rl.qty / ol.qty, 4), r.created_at
    from refund_lines rl join refunds r on r.id = rl.refund_id join order_lines ol on ol.id = rl.order_line_id join orders o on o.id = ol.order_id
    where ${inList(sql`r.branch_id`, branchIds)} and ${inRange(sql`r.created_at`, f)}`;
}

export const m4 = (expr: SQL | string) => sql`coalesce(${typeof expr === "string" ? sql.raw(expr) : expr}, 0)::numeric(18,4)::text`;
