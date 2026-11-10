import { describe, expect, it } from "vitest";
import { checkModifierSelection } from "@/lib/domain/modifiers";
import { effectiveDeduct, liveRecipeCost, marginPct, rehydrateRecipeLine, saleDeductions, theoreticalCost } from "@/lib/domain/recipe";

const BEANS = "beans", MILK = "milk", OAT = "oat", CUP = "cup";
const avg = new Map([[BEANS, "0.025"], [MILK, "0.0015"], [OAT, "0.004"], [CUP, "0.08"]]);

// Latte Large: 18 g beans, 300 ml milk, 1 cup. Oat milk: +300 ml oat, −300 ml milk. Extra shot: 18 g beans.
const latteLarge = [{ itemId: BEANS, qtyBase: "18" }, { itemId: MILK, qtyBase: "300" }, { itemId: CUP, qtyBase: "1" }];
const oatMilk = [{ itemId: OAT, qtyBase: "300" }, { itemId: MILK, qtyBase: "-300" }];
const extraShot = [{ itemId: BEANS, qtyBase: "18" }];

describe("theoreticalCost", () => {
  it("sums recipe qty × current average cost", () => {
    // 18×0.025 + 300×0.0015 + 1×0.08 = 0.45 + 0.45 + 0.08
    expect(theoreticalCost(latteLarge, avg)).toEqual({ cost: "0.9800", missingItemIds: [] });
  });

  it("Latte Large + Oat milk + Extra shot (Phase 4 acceptance)", () => {
    // beans 36×0.025 = 0.90, milk 0, oat 300×0.004 = 1.20, cup 0.08 → 2.18
    expect(theoreticalCost([...latteLarge, ...oatMilk, ...extraShot], avg).cost).toBe("2.1800");
  });

  it("reports items that have no cost yet", () => {
    expect(theoreticalCost([{ itemId: "sugar", qtyBase: "5" }, ...extraShot], avg)).toEqual({ cost: "0.4500", missingItemIds: ["sugar"] });
  });

  it("an empty recipe costs nothing", () => {
    expect(theoreticalCost([], avg)).toEqual({ cost: "0.0000", missingItemIds: [] });
  });
});

describe("marginPct", () => {
  it("is (price − cost) / price as a percentage with one decimal", () => {
    expect(marginPct("3.50", "0.98")).toBe("72.0");
    expect(marginPct("2", "2.5")).toBe("-25.0");
  });
  it("is null for a free item", () => {
    expect(marginPct("0", "0.5")).toBeNull();
  });
});

describe("effectiveDeduct (plan §4.3)", () => {
  it("variant override wins, null follows the product", () => {
    expect(effectiveDeduct(true, null)).toBe(true);
    expect(effectiveDeduct(false, null)).toBe(false);
    expect(effectiveDeduct(true, false)).toBe(false);
    expect(effectiveDeduct(false, true)).toBe(true);
  });
});

describe("saleDeductions (plan §4.3)", () => {
  const line = (productDeduct: boolean, variantDeduct: boolean | null, mods = [{ deductStock: true, recipe: oatMilk }, { deductStock: true, recipe: extraShot }]) => ({
    productDeduct, variant: { deductStock: variantDeduct, recipe: latteLarge }, modifiers: mods,
  });

  it("deducts variant + modifier recipes × qty, netting substitutions", () => {
    const d = saleDeductions(line(true, null), "2");
    expect(d.deduct).toBe(true);
    expect(Object.fromEntries(d.lines)).toEqual({ [BEANS]: "72.0000", [CUP]: "2.0000", [OAT]: "600.0000" });
  });

  it("skips modifiers whose deduct_stock is off", () => {
    const d = saleDeductions(line(true, null, [{ deductStock: false, recipe: oatMilk }, { deductStock: true, recipe: extraShot }]), "1");
    expect(Object.fromEntries(d.lines)).toEqual({ [BEANS]: "36.0000", [MILK]: "300.0000", [CUP]: "1.0000" });
  });

  it("writes nothing when the product or variant doesn't deduct", () => {
    expect(saleDeductions(line(false, null), "1")).toEqual({ deduct: false, lines: new Map() });
    expect(saleDeductions(line(true, false), "1")).toEqual({ deduct: false, lines: new Map() });
  });
});

describe("checkModifierSelection", () => {
  const size = { name: "Milk", minSelect: 1, maxSelect: 1 };
  const extras = { name: "Extras", minSelect: 0, maxSelect: 3 };
  it("accepts counts within min..max", () => {
    expect(checkModifierSelection(size, 1)).toBeNull();
    expect(checkModifierSelection(extras, 0)).toBeNull();
    expect(checkModifierSelection(extras, 3)).toBeNull();
  });
  it("explains what's wrong", () => {
    expect(checkModifierSelection(size, 0)).toBe("Choose 1 option for Milk.");
    expect(checkModifierSelection(size, 2)).toBe("Choose 1 option for Milk.");
    expect(checkModifierSelection(extras, 4)).toBe("Choose at most 3 options for Extras.");
    expect(checkModifierSelection({ name: "Toppings", minSelect: 2, maxSelect: 4 }, 1)).toBe("Choose 2 to 4 options for Toppings.");
  });
});

describe("liveRecipeCost (recipe editor)", () => {
  const items = [
    { id: BEANS, avgCost: "0.025", unitOptions: [{ key: "base", label: "g", factor: "1" }, { key: "iu:shot", label: "shot", factor: "18" }] },
    { id: OAT, avgCost: null, unitOptions: [{ key: "base", label: "ml", factor: "1" }] },
  ];
  it("converts entered units to base and prices each line; blank or unknown lines cost nothing", () => {
    const r = liveRecipeCost([
      { itemId: BEANS, unitKey: "iu:shot", qty: "2" },
      { itemId: OAT, unitKey: "base", qty: "100" },
      { itemId: "", unitKey: "base", qty: "" },
      { itemId: BEANS, unitKey: "base", qty: "abc" },
    ], items);
    expect(r).toEqual({ cost: "0.9000", lineCosts: ["0.9000", null, null, null], missingItemIds: [OAT] });
  });
});

describe("rehydrateRecipeLine (review #1)", () => {
  const beans = { id: BEANS, unitOptions: [{ key: "base", label: "g", factor: "1" }, { key: "iu:shot", label: "shot", factor: "18" }] };
  const saved = { itemId: BEANS, unitLabel: "shot", unitFactor: "18.000000", qtyEntered: "1.0000", qtyBase: "18.0000" };
  it("keeps the entered unit when label and factor still match", () => {
    expect(rehydrateRecipeLine(saved, [beans])).toEqual({ itemId: BEANS, unitKey: "iu:shot", qty: "1" });
  });
  it("falls back to the base quantity when the unit was renamed, re-sized or the item is missing", () => {
    expect(rehydrateRecipeLine({ ...saved, unitLabel: "single shot" }, [beans])).toEqual({ itemId: BEANS, unitKey: "base", qty: "18" });
    expect(rehydrateRecipeLine({ ...saved, unitFactor: "20" }, [beans])).toEqual({ itemId: BEANS, unitKey: "base", qty: "18" });
    expect(rehydrateRecipeLine(saved, [])).toEqual({ itemId: BEANS, unitKey: "base", qty: "18" });
  });
});
