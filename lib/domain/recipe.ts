import { dec, toMoneyString, toQtyString } from "./money";

// Recipes, theoretical cost and the stock-deduction rule (plan §4.3).

export type RecipeQty = { itemId: string; qtyBase: string };

/** Σ (recipe qty × current average cost). Items with no average yet cost 0 and are listed. */
export function theoreticalCost(lines: readonly RecipeQty[], avgCost: ReadonlyMap<string, string>) {
  let cost = dec(0);
  const missing = new Set<string>();
  for (const l of lines) {
    const avg = avgCost.get(l.itemId);
    if (avg === undefined) missing.add(l.itemId);
    else cost = cost.plus(dec(l.qtyBase).times(avg));
  }
  return { cost: toMoneyString(cost), missingItemIds: [...missing] };
}

/** Margin % = (price − cost) / price, one decimal; null when the price is 0. */
export function marginPct(price: string, cost: string): string | null {
  if (dec(price).isZero()) return null;
  return dec(price).minus(cost).div(price).times(100).toFixed(1);
}

/** Effective deduction for an order line: variant override, else the product setting. */
export function effectiveDeduct(productDeduct: boolean, variantDeduct: boolean | null): boolean {
  return variantDeduct ?? productDeduct;
}

export type SaleLine = {
  productDeduct: boolean;
  variant: { deductStock: boolean | null; recipe: readonly RecipeQty[] };
  modifiers: readonly { deductStock: boolean; recipe: readonly RecipeQty[] }[];
};

/**
 * Stock to deduct for one order line × qty: variant recipe plus recipes of
 * modifiers that deduct, netted per item (zero totals dropped). Nothing at all
 * when the line doesn't deduct.
 */
export function saleDeductions(line: SaleLine, lineQty: string): { deduct: boolean; lines: Map<string, string> } {
  if (!effectiveDeduct(line.productDeduct, line.variant.deductStock)) return { deduct: false, lines: new Map() };
  const totals = new Map<string, ReturnType<typeof dec>>();
  const add = (recipe: readonly RecipeQty[]) => {
    for (const r of recipe) totals.set(r.itemId, (totals.get(r.itemId) ?? dec(0)).plus(dec(r.qtyBase).times(lineQty)));
  };
  add(line.variant.recipe);
  for (const m of line.modifiers) if (m.deductStock) add(m.recipe);
  const lines = new Map<string, string>();
  for (const [itemId, q] of totals) if (!q.isZero()) lines.set(itemId, toQtyString(q));
  return { deduct: true, lines };
}

type LiveItem = { id: string; avgCost: string | null; unitOptions: readonly { key: string; factor: string }[] };

/**
 * Live cost for the recipe editor: entered qty × unit factor × average cost
 * per line. Blank or invalid lines cost nothing; items without a cost are listed.
 */
export function liveRecipeCost(lines: readonly { itemId: string; unitKey: string; qty: string }[], items: readonly LiveItem[]) {
  const base: RecipeQty[] = [];
  const avg = new Map<string, string>();
  const lineCosts = lines.map((l) => {
    const item = items.find((i) => i.id === l.itemId);
    const unit = item?.unitOptions.find((u) => u.key === l.unitKey);
    if (!item || !unit || !/^-?\d+(\.\d+)?$/.test(l.qty.trim())) return null;
    const qtyBase = dec(l.qty.trim()).times(unit.factor).toString();
    base.push({ itemId: item.id, qtyBase });
    if (item.avgCost === null) return null;
    avg.set(item.id, item.avgCost);
    return toMoneyString(dec(qtyBase).times(item.avgCost));
  });
  const tc = theoreticalCost(base, avg);
  return { cost: tc.cost, lineCosts, missingItemIds: tc.missingItemIds };
}

/**
 * Editor line for a saved recipe row. The entered unit is kept only if an
 * option with the same label AND factor still exists; otherwise (unit renamed
 * or re-sized, item not offered) the line is shown in the base unit with the
 * saved base quantity, so re-saving never changes what the recipe uses.
 */
export function rehydrateRecipeLine(
  saved: { itemId: string; unitLabel: string; unitFactor: string; qtyEntered: string; qtyBase: string },
  items: readonly { id: string; unitOptions: readonly { key: string; label: string; factor: string }[] }[],
): { itemId: string; unitKey: string; qty: string } {
  const unit = items.find((i) => i.id === saved.itemId)?.unitOptions.find((u) => u.label === saved.unitLabel && dec(u.factor).eq(saved.unitFactor));
  return unit
    ? { itemId: saved.itemId, unitKey: unit.key, qty: dec(saved.qtyEntered).toString() }
    : { itemId: saved.itemId, unitKey: "base", qty: dec(saved.qtyBase).toString() };
}
