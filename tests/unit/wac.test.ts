import { describe, expect, it } from "vitest";
import { computeMovement } from "@/lib/domain/wac";

// Plan §4.2 test table, step by step (avg stored with 6 decimals).
describe("computeMovement — plan §4.2 weighted average cost example", () => {
  it("reproduces the table exactly", () => {
    const s1 = computeMovement({ qty: "0", avg: "0" }, { type: "purchase", qtyBase: "12000", unitCost: "0.0015" });
    expect(s1).toMatchObject({ qtyAfter: "12000.0000", avgAfter: "0.001500", unitCost: "0.001500", totalCost: "18.0000" });

    const s2 = computeMovement({ qty: s1.qtyAfter, avg: s1.avgAfter }, { type: "sale", qtyBase: "-200" });
    expect(s2).toMatchObject({ qtyAfter: "11800.0000", avgAfter: "0.001500", unitCost: "0.001500", totalCost: "-0.3000" });

    const s3 = computeMovement({ qty: s2.qtyAfter, avg: s2.avgAfter }, { type: "purchase", qtyBase: "12000", unitCost: "0.00175" });
    // (11,800 × 0.0015 + 12,000 × 0.00175) / 23,800 = 0.0016260504 → 0.001626
    expect(s3).toMatchObject({ qtyAfter: "23800.0000", avgAfter: "0.001626", unitCost: "0.001750", totalCost: "21.0000" });

    const s4 = computeMovement({ qty: s3.qtyAfter, avg: s3.avgAfter }, { type: "waste", qtyBase: "-800" });
    expect(s4).toMatchObject({ qtyAfter: "23000.0000", avgAfter: "0.001626", unitCost: "0.001626", totalCost: "-1.3008" });
  });
});

describe("computeMovement rules", () => {
  it("inbound with cost when stock is zero or negative sets avg to the incoming cost", () => {
    expect(computeMovement({ qty: "-50", avg: "0.002" }, { type: "purchase", qtyBase: "1000", unitCost: "0.003" }).avgAfter).toBe("0.003000");
  });
  it("lets sales go negative (cafés can't block a sale) and values them at avg", () => {
    expect(computeMovement({ qty: "100", avg: "0.01" }, { type: "sale", qtyBase: "-150" })).toMatchObject({ qtyAfter: "-50.0000", totalCost: "-1.5000" });
  });
  it("positive adjustment without a cost uses the current avg and leaves avg unchanged", () => {
    expect(computeMovement({ qty: "100", avg: "0.01" }, { type: "adjustment_in", qtyBase: "50" })).toMatchObject({ qtyAfter: "150.0000", avgAfter: "0.010000", unitCost: "0.010000" });
  });
  it("positive adjustment WITH a cost is averaged in", () => {
    expect(computeMovement({ qty: "100", avg: "0.01" }, { type: "adjustment_in", qtyBase: "100", unitCost: "0.03" }).avgAfter).toBe("0.020000");
  });
  it("count_adjustment adds at avg or removes at avg by sign", () => {
    expect(computeMovement({ qty: "100", avg: "0.01" }, { type: "count_adjustment", qtyBase: "-10" })).toMatchObject({ qtyAfter: "90.0000", totalCost: "-0.1000" });
    expect(computeMovement({ qty: "100", avg: "0.01" }, { type: "count_adjustment", qtyBase: "10" })).toMatchObject({ qtyAfter: "110.0000", avgAfter: "0.010000" });
  });
  it("transfer_in and refund_restock need a cost and average it in", () => {
    expect(() => computeMovement({ qty: "0", avg: "0" }, { type: "transfer_in", qtyBase: "10" })).toThrow(/cost/);
    expect(computeMovement({ qty: "10", avg: "1" }, { type: "refund_restock", qtyBase: "10", unitCost: "2" }).avgAfter).toBe("1.500000");
  });
  it("purchase_return removes at the receipt cost and re-averages what's left", () => {
    // 20 @ avg 1.5 (10 @1 + 10 @2); return 10 @2 → 10 left @1
    expect(computeMovement({ qty: "20", avg: "1.5" }, { type: "purchase_return", qtyBase: "-10", unitCost: "2" })).toMatchObject({ qtyAfter: "10.0000", avgAfter: "1.000000", totalCost: "-20.0000" });
  });
  it("rejects a wrong sign for the movement type and zero quantities", () => {
    expect(() => computeMovement({ qty: "10", avg: "1" }, { type: "sale", qtyBase: "5" })).toThrow(/negative/);
    expect(() => computeMovement({ qty: "10", avg: "1" }, { type: "purchase", qtyBase: "-5", unitCost: "1" })).toThrow(/positive/);
    expect(() => computeMovement({ qty: "10", avg: "1" }, { type: "count_adjustment", qtyBase: "0" })).toThrow(/zero/);
  });
  it("rejects a negative cost", () => {
    expect(() => computeMovement({ qty: "0", avg: "0" }, { type: "purchase", qtyBase: "5", unitCost: "-1" })).toThrow(/cost/);
  });

  it("uses an exact inbound total when given, so 10 cases @ $20 is worth exactly $200 (review #5)", () => {
    const r = computeMovement({ qty: "0", avg: "0" }, { type: "opening", qtyBase: "120000", unitCost: "0.001667", totalCost: "200" });
    expect(r).toMatchObject({ totalCost: "200.0000", unitCost: "0.001667", avgAfter: "0.001667" });
    const r2 = computeMovement({ qty: "120000", avg: r.avgAfter }, { type: "purchase", qtyBase: "120000", totalCost: "200" });
    // avg from exact totals: (120000 × 0.001667 + 200) / 240000
    expect(r2.totalCost).toBe("200.0000");
    expect(r2.avgAfter).toBe("0.001667");
  });
  it("rejects a total cost on outbound movements", () => {
    expect(() => computeMovement({ qty: "10", avg: "1" }, { type: "sale", qtyBase: "-1", totalCost: "5" })).toThrow(/total/);
  });

  it("purchase_return can use an exact total (share of the landed line), re-averaging what's left", () => {
    // 24000 @ 0.001583 (landed $38); return half the line = exactly $19
    const r = computeMovement({ qty: "24000", avg: "0.001583" }, { type: "purchase_return", qtyBase: "-12000", totalCost: "19" });
    expect(r).toMatchObject({ qtyAfter: "12000.0000", totalCost: "-19.0000", unitCost: "0.001583" });
  });
});
