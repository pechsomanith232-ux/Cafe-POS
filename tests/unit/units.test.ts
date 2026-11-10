import { describe, expect, it } from "vitest";
import { availableUnits, breakdown, formatQty, toBaseQty } from "@/lib/domain/units";

const ml = { id: "u-ml", code: "ml", name: "Millilitre", dimension: "volume", factorToDimensionBase: "1" };
const L = { id: "u-L", code: "L", name: "Litre", dimension: "volume", factorToDimensionBase: "1000" };
const g = { id: "u-g", code: "g", name: "Gram", dimension: "mass", factorToDimensionBase: "1" };
const milkUnits = [
  { id: "iu-bottle", name: "bottle", factorToBase: "1000" },
  { id: "iu-case", name: "case", factorToBase: "12000" },
];

describe("availableUnits", () => {
  it("offers the base unit, compatible global units and the item's packaging units", () => {
    const list = availableUnits(ml, [ml, L, g], milkUnits);
    expect(list.map((u) => [u.key, u.label, u.factor])).toEqual([
      ["base", "ml", "1"],
      ["g:L", "L", "1000"],
      ["iu:iu-bottle", "bottle", "1000"],
      ["iu:iu-case", "case", "12000"],
    ]);
  });
});

describe("toBaseQty (plan §4.1)", () => {
  it("receiving 2 case of milk stores 24,000 ml", () => {
    expect(toBaseQty("2", "12000").toString()).toBe("24000");
  });
  it("keeps decimals exactly", () => {
    expect(toBaseQty("1.5", "1000").toString()).toBe("1500");
  });
});

describe("breakdown (greedy, plan §4.1)", () => {
  it("shows 30,500 ml as 2 case 6 bottle 500 ml", () => {
    expect(breakdown("30500", "ml", milkUnits)).toBe("2 case 6 bottle 500 ml");
  });
  it("skips zero parts and handles exact packs", () => {
    expect(breakdown("24000", "ml", milkUnits)).toBe("2 case");
    expect(breakdown("500", "ml", milkUnits)).toBe("500 ml");
  });
  it("handles zero and negative stock", () => {
    expect(breakdown("0", "ml", milkUnits)).toBe("0 ml");
    expect(breakdown("-1200", "ml", milkUnits)).toBe("−1 bottle 200 ml");
  });
  it("keeps a fractional remainder in the base unit", () => {
    expect(breakdown("1000.5", "ml", milkUnits)).toBe("1 bottle 0.5 ml");
  });
});

describe("formatQty", () => {
  it("shows a quantity in another unit, trimming zeros: 30,500 ml = 30.5 L", () => {
    expect(formatQty("30500", "1000", "L")).toBe("30.5 L");
    expect(formatQty("200.0000", "1", "ml")).toBe("200 ml");
  });
});
