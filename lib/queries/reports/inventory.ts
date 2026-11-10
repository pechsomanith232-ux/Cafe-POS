import { sql } from "drizzle-orm";
import { isYmd } from "@/lib/dates";
import { dec, toMoneyString } from "@/lib/domain/money";
import { ValidationError } from "@/lib/errors";
import type { AppContext } from "@/lib/permissions";
import { SOLD, m4 } from "./facts";
import { inList, inRange, localDate, parseFilter, resolveScope, rows, type ReportFilter } from "./scope";

const q4 = (v: ReturnType<typeof dec> | string) => dec(v).toFixed(4);

export type ValuationUnit = "base" | "purchase" | "count";

/**
 * Stock on hand and value as of the end of a date (plan §7): each item's last
 * movement on or before that date gives the quantity and average cost then.
 * `unit` shows quantities in the base unit or the item's default purchase/count unit.
 */
export async function stockValuation(ctx: AppContext, opts: { branch: string; asOf: string; unit: ValuationUnit }) {
  if (!isYmd(opts.asOf)) throw new ValidationError("Use a real yyyy-mm-dd date");
  const { branchIds } = resolveScope(ctx, "reports.inventory", opts.branch);
  const unitFlag = opts.unit === "purchase" ? sql`iu.is_purchase_default` : opts.unit === "count" ? sql`iu.is_count_default` : sql`false`;
  const r = await rows<{ branch_id: string; branch: string; item_id: string; item: string; category: string | null; qty: string; avg_cost: string; value: string; unit: string; factor: string }>(ctx, sql`
    with last as (
      select distinct on (m.branch_id, m.item_id) m.branch_id, m.item_id, m.qty_after, m.avg_cost_after
      from stock_movements m where ${inList(sql`m.branch_id`, branchIds)} and ${localDate(sql`m.created_at`)} <= ${opts.asOf}::date
      order by m.branch_id, m.item_id, m.seq desc)
    select b.id as branch_id, b.name as branch, i.id as item_id, i.name as item, ic.name as category,
      last.qty_after::text as qty, last.avg_cost_after::text as avg_cost, round(last.qty_after * last.avg_cost_after, 4)::numeric(18,4)::text as value,
      coalesce(du.name, u.code) as unit, coalesce(du.factor_to_base, 1)::text as factor
    from last join items i on i.id = last.item_id join branches b on b.id = last.branch_id join units u on u.id = i.base_unit_id
      left join item_categories ic on ic.id = i.category_id
      left join lateral (select iu.name, iu.factor_to_base from item_units iu where iu.item_id = i.id and ${unitFlag} limit 1) du on true
    where i.org_id = ${ctx.orgId} and last.qty_after <> 0
    order by b.name, i.name`);
  const out = r.map((x) => ({
    branchId: x.branch_id, branch: x.branch, itemId: x.item_id, item: x.item, category: x.category,
    qty: q4(dec(x.qty).div(x.factor)), unit: x.unit, avgCost: dec(x.factor).eq(1) ? x.avg_cost : dec(x.avg_cost).times(x.factor).toFixed(6), value: x.value,
  }));
  return { asOf: opts.asOf, rows: out, total: toMoneyString(out.reduce((a, x) => a.plus(x.value), dec(0))) };
}
export type ValuationRow = Awaited<ReturnType<typeof stockValuation>>["rows"][number];

/**
 * Low stock (on hand at or below the reorder level) with a suggested order that
 * brings stock back up to twice the reorder level, valued at the last cost.
 */
export async function reorderReport(ctx: AppContext, opts: { branch: string }) {
  const { branchIds } = resolveScope(ctx, "reports.inventory", opts.branch);
  const r = await rows<{ branch: string; item_id: string; item: string; unit: string; on_hand: string; reorder_level: string; cost: string; last_supplier: string | null }>(ctx, sql`
    select b.name as branch, i.id as item_id, i.name as item, u.code as unit, sl.qty_on_hand::text as on_hand, sl.reorder_level::text as reorder_level,
      coalesce(nullif(sl.last_cost, 0), sl.avg_cost)::text as cost, ls.supplier as last_supplier
    from stock_levels sl
      left join lateral (
        select coalesce(s.name, g.supplier_name_text) as supplier from goods_receipt_lines gl join goods_receipts g on g.id = gl.receipt_id
          left join suppliers s on s.id = g.supplier_id
        where gl.item_id = sl.item_id and g.branch_id = sl.branch_id and g.status = 'posted'
        order by g.receipt_date desc, g.number desc limit 1) ls on true join items i on i.id = sl.item_id join units u on u.id = i.base_unit_id join branches b on b.id = sl.branch_id
    where ${inList(sql`sl.branch_id`, branchIds)} and i.is_active and sl.reorder_level > 0 and sl.qty_on_hand <= sl.reorder_level
    order by b.name, i.name`);
  return r.map((x) => {
    const suggested = dec(x.reorder_level).times(2).minus(x.on_hand);
    return {
      branch: x.branch, itemId: x.item_id, item: x.item, unit: x.unit, onHand: q4(x.on_hand), reorderLevel: q4(x.reorder_level),
      suggested: q4(suggested), suggestedValue: toMoneyString(suggested.times(x.cost)), lastSupplier: x.last_supplier,
    };
  });
}
export type ReorderRow = Awaited<ReturnType<typeof reorderReport>>[number];

/** Posted stock adjustments (waste, damage, …) by reason and line, valued from the ledger. */
export async function wasteReport(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.inventory", f.branch);
  const r = await rows<{ date: string; branch: string; reason: string; item: string; unit: string; qty: string; value: string; note: string | null; adjustment_id: string }>(ctx, sql`
    select ${localDate(sql`m.created_at`)}::text as date, b.name as branch, a.reason_code as reason, i.name as item, u.code as unit,
      m.qty_base::text as qty, m.total_cost::numeric(18,4)::text as value, a.note, a.id::text as adjustment_id
    from stock_movements m join stock_adjustments a on a.id::text = m.ref_id join items i on i.id = m.item_id
      join units u on u.id = i.base_unit_id join branches b on b.id = m.branch_id
    where m.ref_type = 'stock_adjustment' and ${inList(sql`m.branch_id`, branchIds)} and ${inRange(sql`m.created_at`, f)}
    order by m.seq`);
  const reasons = new Map<string, { reason: string; lines: number; value: ReturnType<typeof dec> }>();
  for (const x of r) {
    const e = reasons.get(x.reason) ?? { reason: x.reason, lines: 0, value: dec(0) };
    e.lines += 1;
    e.value = e.value.minus(x.value); // a loss shows as a positive value
    reasons.set(x.reason, e);
  }
  return {
    byReason: [...reasons.values()].map((e) => ({ reason: e.reason, lines: e.lines, value: toMoneyString(e.value) })).sort((a, b) => dec(b.value).cmp(a.value)),
    rows: r.map((x) => ({ date: x.date, branch: x.branch, reason: x.reason, item: x.item, unit: x.unit, qty: q4(x.qty), value: x.value, note: x.note, adjustmentId: x.adjustment_id })),
  };
}
export type WasteReport = Awaited<ReturnType<typeof wasteReport>>;

/**
 * Theoretical vs actual usage per item for a period (plan §7), in base units:
 *   recorded     = recipe usage the POS took out of stock (sales − restocked refunds)
 *   estimated    = recipe usage of sales that don't deduct stock, from CURRENT recipes
 *   adjustments  = stock taken out by posted adjustments (waste, damage, …)
 *   countVariance= stock counts' corrections (negative = shortage)
 *   actual       = recorded + adjustments − countVariance
 *   variance     = actual − (recorded + estimated), valued at today's average cost —
 *                  only for items counted in the period (otherwise nothing measured it: null)
 */
export async function usageVariance(ctx: AppContext, filter: ReportFilter) {
  const f = parseFilter(filter);
  const { branchIds } = resolveScope(ctx, "reports.inventory", f.branch);
  const moved = await rows<{ branch_id: string; item_id: string; recorded: string; adjustments: string; count_variance: string }>(ctx, sql`
    select m.branch_id, m.item_id,
      ${m4("-sum(m.qty_base) filter (where m.movement_type in ('sale', 'refund_restock'))")} as recorded,
      ${m4("-sum(m.qty_base) filter (where m.ref_type = 'stock_adjustment')")} as adjustments,
      ${m4("sum(m.qty_base) filter (where m.movement_type = 'count_adjustment')")} as count_variance
    from stock_movements m where ${inList(sql`m.branch_id`, branchIds)} and ${inRange(sql`m.created_at`, f)}
    group by m.branch_id, m.item_id`);
  // Counted items: an exact count writes no movement, so read the posted counts themselves.
  const counted = new Set((await rows<{ k: string }>(ctx, sql`
    select distinct c.branch_id || ':' || cl.item_id as k from stock_counts c join stock_count_lines cl on cl.count_id = c.id
    where c.status = 'posted' and cl.counted_qty_base is not null and ${inList(sql`c.branch_id`, branchIds)} and ${inRange(sql`c.posted_at`, f)}`)).map((x) => x.k));
  // Recipe usage that never touched stock: whole lines that don't deduct, and
  // modifiers that don't deduct on lines that do. Net of refunds in the period.
  const estimated = await rows<{ branch_id: string; item_id: string; qty: string }>(ctx, sql`
    with sold as (
      select o.branch_id, ol.id as line_id, ol.variant_id, ol.deduct_stock, ol.qty::numeric as qty
      from order_lines ol join orders o on o.id = ol.order_id
      where o.status in ${SOLD} and ${inList(sql`o.branch_id`, branchIds)} and ${inRange(sql`o.paid_at`, f)}
      union all
      select o.branch_id, ol.id, ol.variant_id, ol.deduct_stock, -rl.qty::numeric
      from refund_lines rl join refunds r on r.id = rl.refund_id join order_lines ol on ol.id = rl.order_line_id join orders o on o.id = ol.order_id
      where ${inList(sql`r.branch_id`, branchIds)} and ${inRange(sql`r.created_at`, f)}),
    usage as (
      select s.branch_id, rl.item_id, rl.qty_base * s.qty as q from sold s join recipe_lines rl on rl.variant_id = s.variant_id where not s.deduct_stock
      union all
      select s.branch_id, rl.item_id, rl.qty_base * s.qty from sold s join order_line_modifiers olm on olm.order_line_id = s.line_id
        join recipe_lines rl on rl.modifier_id = olm.modifier_id where not s.deduct_stock or not olm.deduct_stock)
    select branch_id, item_id, sum(q)::numeric(18,4)::text as qty from usage group by branch_id, item_id`);

  type Acc = { branchId: string; itemId: string; counted: boolean; recorded: ReturnType<typeof dec>; estimated: ReturnType<typeof dec>; adjustments: ReturnType<typeof dec>; countVariance: ReturnType<typeof dec> };
  const acc = new Map<string, Acc>();
  const get = (b: string, i: string) => {
    const k = `${b}:${i}`;
    const e = acc.get(k) ?? { branchId: b, itemId: i, counted: false, recorded: dec(0), estimated: dec(0), adjustments: dec(0), countVariance: dec(0) };
    acc.set(k, e);
    return e;
  };
  for (const m of moved) Object.assign(get(m.branch_id, m.item_id), { recorded: dec(m.recorded), adjustments: dec(m.adjustments), countVariance: dec(m.count_variance) });
  for (const e of estimated) get(e.branch_id, e.item_id).estimated = dec(e.qty);
  for (const k of counted) {
    const [b, i] = k.split(":");
    get(b, i).counted = true;
  }
  const pairs = [...acc.values()];
  if (!pairs.length) return [];
  const info = await rows<{ branch_id: string; item_id: string; item: string; unit: string; avg_cost: string }>(ctx, sql`
    select b.id as branch_id, i.id as item_id, i.name as item, u.code as unit, coalesce(sl.avg_cost, 0)::text as avg_cost
    from items i join units u on u.id = i.base_unit_id cross join branches b
      left join stock_levels sl on sl.item_id = i.id and sl.branch_id = b.id
    where i.org_id = ${ctx.orgId} and ${inList(sql`b.id`, branchIds)} and ${inList(sql`i.id`, [...new Set(pairs.map((p) => p.itemId))])}`);

  // One row per item (summed across branches); value uses each branch's own average cost.
  const out = new Map<string, { itemId: string; item: string; unit: string; counted: boolean; recorded: ReturnType<typeof dec>; estimated: ReturnType<typeof dec>; adjustments: ReturnType<typeof dec>; countVariance: ReturnType<typeof dec>; value: ReturnType<typeof dec> }>();
  for (const p of pairs) {
    const i = info.find((x) => x.item_id === p.itemId && x.branch_id === p.branchId);
    if (!i) continue;
    const actual = p.recorded.plus(p.adjustments).minus(p.countVariance);
    const variance = actual.minus(p.recorded).minus(p.estimated);
    const e = out.get(p.itemId) ?? { itemId: p.itemId, item: i.item, unit: i.unit, counted: true, recorded: dec(0), estimated: dec(0), adjustments: dec(0), countVariance: dec(0), value: dec(0) };
    e.counted = e.counted && p.counted;
    e.recorded = e.recorded.plus(p.recorded);
    e.estimated = e.estimated.plus(p.estimated);
    e.adjustments = e.adjustments.plus(p.adjustments);
    e.countVariance = e.countVariance.plus(p.countVariance);
    e.value = e.value.plus(variance.times(i.avg_cost));
    out.set(p.itemId, e);
  }
  return [...out.values()]
    .map((e) => {
      const actual = e.recorded.plus(e.adjustments).minus(e.countVariance);
      return {
        itemId: e.itemId, item: e.item, unit: e.unit, recorded: q4(e.recorded), estimated: q4(e.estimated), adjustments: q4(e.adjustments),
        countVariance: q4(e.countVariance), actual: q4(actual), counted: e.counted,
        variance: e.counted ? q4(actual.minus(e.recorded).minus(e.estimated)) : null, varianceValue: e.counted ? toMoneyString(e.value) : null,
      };
    })
    // Purchases alone leave an all-zero row: nothing to report.
    .filter((r) => r.counted || [r.recorded, r.estimated, r.adjustments, r.countVariance].some((v) => !dec(v).isZero()))
    .sort((a, b) => dec(b.varianceValue ?? 0).abs().cmp(dec(a.varianceValue ?? 0).abs()) || a.item.localeCompare(b.item));
}
export type UsageRow = Awaited<ReturnType<typeof usageVariance>>[number];
