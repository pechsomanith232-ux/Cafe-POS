import Decimal from "decimal.js";

/**
 * Exact decimal arithmetic for money, quantities and costs (plan §2.5).
 * Drizzle returns `numeric` columns as strings: pass them straight to `dec()`
 * and never convert to `number` for maths.
 *
 * Phase 0 stub: currency conversion and cash rounding arrive in Phase 6
 * (`lib/domain/currency.ts`).
 */
export const Dec = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
export type Dec = InstanceType<typeof Dec>;

export type DecInput = Decimal.Value | Dec;

/** Parse a value into an exact decimal. Throws on empty, non-numeric or non-finite input. */
export function dec(value: DecInput): Dec {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Expected a finite number, got ${value}`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new Error("Expected a number, got an empty string");
  }
  const d = new Dec(value);
  if (!d.isFinite()) {
    throw new Error(`Expected a finite number, got ${String(value)}`);
  }
  return d;
}

/** Round to `dp` decimal places, half away from zero (2.345 → 2.35, −2.345 → −2.35). */
export function roundTo(value: DecInput, dp: number): Dec {
  return dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Exact sum of a list of values. */
export function sum(values: readonly DecInput[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(dec(v)), new Dec(0));
}

/** Money for a `numeric(18,4)` column. */
export function toMoneyString(value: DecInput): string {
  return dec(value).toFixed(4, Decimal.ROUND_HALF_UP);
}

/** Quantity (in base unit) for a `numeric(18,4)` column. */
export function toQtyString(value: DecInput): string {
  return dec(value).toFixed(4, Decimal.ROUND_HALF_UP);
}

/** Cost per base unit for a `numeric(18,6)` column. */
export function toCostString(value: DecInput): string {
  return dec(value).toFixed(6, Decimal.ROUND_HALF_UP);
}
