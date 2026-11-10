import { dec, type DecInput } from "./money";

// Units of measure (plan §4.1). Quantities are stored in the item's base unit;
// conversion happens only at input and display time.

export type GlobalUnit = { id: string; code: string; name: string; dimension: string; factorToDimensionBase: string };
export type ItemUnit = { id: string; name: string; factorToBase: string };

/** A unit a quantity can be entered or shown in, with its factor to the item's base unit. */
export type UnitOption = { key: string; label: string; factor: string };

/**
 * Units offered for an item: its base unit ("base"), other global units of the
 * same dimension ("g:<code>", e.g. L for an ml item) and its packaging units
 * ("iu:<id>"). Factors are relative to the base unit.
 */
export function availableUnits(base: GlobalUnit, globals: GlobalUnit[], itemUnits: ItemUnit[]): UnitOption[] {
  const baseFactor = dec(base.factorToDimensionBase);
  const options: UnitOption[] = [{ key: "base", label: base.code, factor: "1" }];
  for (const u of globals) {
    if (u.id === base.id || u.dimension !== base.dimension) continue;
    options.push({ key: `g:${u.code}`, label: u.code, factor: dec(u.factorToDimensionBase).div(baseFactor).toString() });
  }
  for (const u of itemUnits) {
    options.push({ key: `iu:${u.id}`, label: u.name, factor: dec(u.factorToBase).toString() });
  }
  return options;
}

/** Entered quantity × unit factor = quantity in base unit. */
export function toBaseQty(qty: DecInput, factor: DecInput) {
  return dec(qty).times(dec(factor));
}

const trim = (d: ReturnType<typeof dec>) => d.toDecimalPlaces(4).toString();

/**
 * Greedy breakdown into packaging units, largest first, remainder in the base
 * unit: 30,500 ml with bottle = 1000 and case = 12000 → "2 case 6 bottle 500 ml".
 */
export function breakdown(qtyBase: DecInput, baseLabel: string, packaging: ItemUnit[]): string {
  const total = dec(qtyBase);
  if (total.isZero()) return `0 ${baseLabel}`;
  let rest = total.abs();
  const parts: string[] = [];
  const sorted = [...packaging]
    .filter((u) => dec(u.factorToBase).gt(1))
    .sort((a, b) => dec(b.factorToBase).cmp(dec(a.factorToBase)));
  for (const u of sorted) {
    const f = dec(u.factorToBase);
    const n = rest.div(f).floor();
    if (n.gt(0)) {
      parts.push(`${n.toString()} ${u.name}`);
      rest = rest.minus(n.times(f));
    }
  }
  if (rest.gt(0) || parts.length === 0) parts.push(`${trim(rest)} ${baseLabel}`);
  return (total.isNegative() ? "−" : "") + parts.join(" ");
}

/** Show a base quantity in another unit: formatQty("30500", "1000", "L") → "30.5 L". */
export function formatQty(qtyBase: DecInput, factor: DecInput, label: string): string {
  return `${trim(dec(qtyBase).div(dec(factor)))} ${label}`;
}
