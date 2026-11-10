import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cashDisplay } from "@/lib/domain/currency";
import { dec } from "@/lib/domain/money";
import { computeOrder, discountPct, type CartLine } from "@/lib/domain/pricing";

const line = (unitPrice: string, qty: number, extra: Partial<CartLine> = {}): CartLine => ({ unitPrice, qty, modifiers: [], discount: null, ...extra });
const noTax = { rate: "0", inclusive: true };

describe("computeOrder", () => {
  it("prices lines with modifiers × qty", () => {
    const r = computeOrder([line("3.50", 2, { modifiers: ["0.50", "0.50"] }), line("2.80", 1)], null, noTax);
    expect(r.lines.map((l) => [l.gross, l.lineTotal])).toEqual([["9.0000", "9.0000"], ["2.8000", "2.8000"]]);
    expect(r).toMatchObject({ subtotal: "11.8000", discountTotal: "0.0000", taxTotal: "0.0000", total: "11.8000" });
  });

  it("applies line discounts (percent rounded to the cent, amount capped at the line)", () => {
    const r = computeOrder([line("3.33", 1, { discount: { type: "percent", value: "10" } }), line("2.00", 1, { discount: { type: "amount", value: "5" } })], null, noTax);
    expect(r.lines.map((l) => l.lineDiscount)).toEqual(["0.3300", "2.0000"]);
    expect(r.total).toBe("3.0000");
  });

  it("splits an order discount across lines in proportion, to the cent, summing exactly (plan §4.5)", () => {
    const r = computeOrder([line("1.00", 1), line("1.00", 1), line("1.00", 1)], { type: "amount", value: "1" }, noTax);
    expect(r.orderDiscount).toBe("1.0000");
    expect(r.lines.map((l) => l.discountAlloc)).toEqual(["0.3400", "0.3300", "0.3300"]);
    expect(r.total).toBe("2.0000");
  });

  it("tax-exclusive adds tax on top; tax-inclusive takes it out of the price (plan §4.6)", () => {
    const excl = computeOrder([line("10.00", 1)], null, { rate: "10", inclusive: false });
    expect(excl).toMatchObject({ taxTotal: "1.0000", total: "11.0000" });
    expect(excl.lines[0].lineTotal).toBe("11.0000");
    const incl = computeOrder([line("11.00", 1)], null, { rate: "10", inclusive: true });
    expect(incl).toMatchObject({ taxTotal: "1.0000", total: "11.0000" });
  });

  it("tax applies after discounts", () => {
    const r = computeOrder([line("10.00", 1)], { type: "percent", value: "50" }, { rate: "10", inclusive: false });
    expect(r).toMatchObject({ subtotal: "10.0000", orderDiscount: "5.0000", taxTotal: "0.5000", total: "5.5000" });
  });

  it("an empty cart is all zeros", () => {
    expect(computeOrder([], { type: "percent", value: "10" }, noTax)).toMatchObject({ subtotal: "0.0000", total: "0.0000", orderDiscount: "0.0000" });
  });
});

describe("discountPct (for the role limit)", () => {
  it("expresses any discount as a percent of what it applies to", () => {
    expect(discountPct({ type: "percent", value: "15" }, "10")).toBe(15);
    expect(discountPct({ type: "amount", value: "1" }, "4")).toBe(25);
    expect(discountPct({ type: "amount", value: "9" }, "4")).toBe(100);
    expect(discountPct(null, "4")).toBe(0);
  });
});

describe("computeOrder properties (random carts)", () => {
  const money = fc.integer({ min: 0, max: 5000 }).map((c) => (c / 100).toFixed(2));
  const disc = fc.option(fc.oneof(
    fc.record({ type: fc.constant("percent" as const), value: fc.integer({ min: 0, max: 100 }).map(String) }),
    fc.record({ type: fc.constant("amount" as const), value: money }),
  ), { nil: null });
  const cart = fc.array(fc.record({ unitPrice: money, qty: fc.integer({ min: 1, max: 20 }), modifiers: fc.array(money, { maxLength: 3 }), discount: disc }), { maxLength: 12 });
  const tax = fc.record({ rate: fc.constantFrom("0", "10", "7.5"), inclusive: fc.boolean() });

  it("totals add up, never go negative, and the order discount is fully allocated", () => {
    fc.assert(fc.property(cart, disc, tax, (lines, od, t) => {
      const r = computeOrder(lines, od, t);
      const sum = (k: "lineDiscount" | "discountAlloc" | "taxAmount" | "lineTotal" | "net") => r.lines.reduce((a, l) => a.plus(l[k]), dec(0));
      expect(sum("discountAlloc").eq(r.orderDiscount)).toBe(true);
      expect(sum("lineTotal").eq(r.total)).toBe(true);
      expect(sum("taxAmount").eq(r.taxTotal)).toBe(true);
      expect(dec(r.discountTotal).eq(sum("lineDiscount").plus(r.orderDiscount))).toBe(true);
      const expected = dec(r.subtotal).minus(r.orderDiscount).plus(t.inclusive ? 0 : r.taxTotal);
      expect(dec(r.total).eq(expected)).toBe(true);
      for (const l of r.lines) for (const v of Object.values(l)) expect(dec(v).gte(0)).toBe(true);
      // Every amount is whole cents.
      for (const v of [r.subtotal, r.total, r.taxTotal, r.discountTotal]) expect(dec(v).times(100).isInteger()).toBe(true);
    }), { numRuns: 300 });
  });
});

describe("cashDisplay (KHR shown on the POS, plan §4.4)", () => {
  it("converts and rounds to the nearest 100 riel", () => {
    expect(cashDisplay("4.75", "4100", "100")).toBe("19500"); // 19,475 → 19,500
    expect(cashDisplay("0.25", "4100", "100")).toBe("1000"); // 1,025 → 1,000
    expect(cashDisplay("10", "4100", "100")).toBe("41000");
  });
});
