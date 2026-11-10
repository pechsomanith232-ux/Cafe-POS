import { describe, expect, it } from "vitest";
import { agingBuckets, daysBetween } from "@/lib/domain/aging";
import { autoAllocate } from "@/lib/domain/allocation";
import { allocateExtraCosts } from "@/lib/domain/landed";

describe("allocateExtraCosts (plan §4.9: by value, before WAC)", () => {
  it("2 cases @ $18 + $2 delivery → line landed at $38", () => {
    expect(allocateExtraCosts([{ lineTotal: "36" }], "2")).toEqual([{ allocated: "2.0000", landedTotal: "38.0000" }]);
  });
  it("splits by value and the parts add up exactly", () => {
    const r = allocateExtraCosts([{ lineTotal: "10" }, { lineTotal: "20" }, { lineTotal: "70" }], "1");
    expect(r.map((x) => x.allocated)).toEqual(["0.1000", "0.2000", "0.7000"]);
    const odd = allocateExtraCosts([{ lineTotal: "1" }, { lineTotal: "1" }, { lineTotal: "1" }], "1");
    expect(odd.reduce((s, x) => s + Number(x.allocated), 0)).toBeCloseTo(1, 10);
    expect(odd.map((x) => x.allocated).sort()).toEqual(["0.3333", "0.3333", "0.3334"]);
  });
  it("spreads evenly when every line is free, and does nothing with no extra cost", () => {
    expect(allocateExtraCosts([{ lineTotal: "0" }, { lineTotal: "0" }], "3").map((x) => x.allocated)).toEqual(["1.5000", "1.5000"]);
    expect(allocateExtraCosts([{ lineTotal: "5" }], "0")).toEqual([{ allocated: "0.0000", landedTotal: "5.0000" }]);
  });
});

describe("autoAllocate (oldest first)", () => {
  const open = [
    { receiptId: "a", amountDue: "50" },
    { receiptId: "b", amountDue: "30" },
  ];
  it("pays the oldest receipt first and leaves the rest unallocated", () => {
    expect(autoAllocate("20", open)).toEqual({ allocations: [{ receiptId: "a", amount: "20.0000" }], unallocated: "0.0000" });
    expect(autoAllocate("100", open)).toEqual({
      allocations: [{ receiptId: "a", amount: "50.0000" }, { receiptId: "b", amount: "30.0000" }],
      unallocated: "20.0000",
    });
  });
});

describe("agingBuckets (as of a date)", () => {
  it("counts days overdue in calendar days", () => {
    expect(daysBetween("2026-10-01", "2026-11-08")).toBe(38);
  });
  it("puts each open amount in Current, 1–30, 31–60, 61–90 or 90+", () => {
    const asOf = "2026-11-08";
    const r = agingBuckets(
      [
        { dueDate: "2026-11-20", amountDue: "10" }, // not due yet
        { dueDate: "2026-11-08", amountDue: "1" }, // due today → current
        { dueDate: "2026-11-07", amountDue: "2" }, // 1 day
        { dueDate: "2026-10-09", amountDue: "3" }, // 30 days
        { dueDate: "2026-10-08", amountDue: "4" }, // 31 days
        { dueDate: "2026-09-09", amountDue: "5" }, // 60
        { dueDate: "2026-08-10", amountDue: "6" }, // 90
        { dueDate: "2026-08-09", amountDue: "7" }, // 91
        { dueDate: null, amountDue: "8" }, // no due date → current
      ],
      asOf,
    );
    expect(r).toEqual({ current: "19.0000", d1_30: "5.0000", d31_60: "9.0000", d61_90: "6.0000", d90_plus: "7.0000", total: "46.0000" });
  });
});
