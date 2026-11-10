import { describe, expect, it } from "vitest";
import { settlePayment, type SettleCurrency } from "@/lib/domain/currency";

const USD: SettleCurrency = { code: "USD", decimals: 2, cashRounding: "0.01", rate: "1" };
const KHR: SettleCurrency = { code: "KHR", decimals: 0, cashRounding: "100", rate: "4100" };

describe("settlePayment (plan §4.4)", () => {
  it("total $4.75, customer pays $5 cash, change in riel: 1,025 → 1,000, rounding ≈ $0.006 recorded", () => {
    const r = settlePayment("4.75", [{ cash: true, currency: USD, amount: "5" }], KHR);
    expect(r).toMatchObject({ paid: true, paidBase: "5.0000", change: { currency: "KHR", amount: "1000", base: "0.2439", roundingBase: "0.0061" } });
    expect(r.tenders[0]).toMatchObject({ amountBase: "5.0000", rateUsed: "1" });
  });

  it("change in USD is exact", () => {
    expect(settlePayment("4.75", [{ cash: true, currency: USD, amount: "5" }], USD).change).toMatchObject({ amount: "0.25", base: "0.2500", roundingBase: "0.0000" });
  });

  it("split: $10 = $5 cash + 20,500 riel cash → paid, no change", () => {
    const r = settlePayment("10", [{ cash: true, currency: USD, amount: "5" }, { cash: true, currency: KHR, amount: "20500" }], USD);
    expect(r).toMatchObject({ paid: true, remainingBase: "0.0000", change: { amount: "0", base: "0.0000", roundingBase: "0.0000" } });
    expect(r.tenders.map((t) => t.amountBase)).toEqual(["5.0000", "5.0000"]);
  });

  it("a shortfall smaller than half the riel cash step counts as paid and is written off", () => {
    // $4.76 = 19,516 riel; customer pays 19,500 → $0.0039 short, under 50 riel.
    const r = settlePayment("4.76", [{ cash: true, currency: KHR, amount: "19500" }], KHR);
    expect(r).toMatchObject({ paid: true, writeOffBase: "0.0039" });
  });

  it("not paid while a real amount remains; shows it in both currencies", () => {
    const r = settlePayment("10", [{ cash: true, currency: USD, amount: "4" }], USD);
    expect(r).toMatchObject({ paid: false, remainingBase: "6.0000" });
  });

  it("card/QR can't be more than what's due (no change from non-cash)", () => {
    expect(() => settlePayment("4.75", [{ cash: false, currency: USD, amount: "5" }], USD)).toThrow(/more than/);
    // …but cash on top of an exact card amount can give change.
    const r = settlePayment("4.75", [{ cash: false, currency: USD, amount: "2" }, { cash: true, currency: USD, amount: "3" }], USD);
    expect(r.change).toMatchObject({ amount: "0.25" });
  });

  it("net received = total + rounding (the identity the shift report relies on)", () => {
    const r = settlePayment("4.75", [{ cash: true, currency: USD, amount: "5" }], KHR);
    const net = Number(r.paidBase) - Number(r.change.base);
    expect(net.toFixed(4)).toBe((4.75 + Number(r.change.roundingBase) - Number(r.writeOffBase)).toFixed(4));
  });
});
