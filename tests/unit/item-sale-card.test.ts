import { describe, expect, it } from "vitest";
import { defaultSaleUnit } from "@/lib/domain/units";

describe("defaultSaleUnit", () => {
  it("prefers the first packaging unit, so ml items sell per bottle by default", () => {
    expect(defaultSaleUnit([{ key: "base", label: "ml" }, { key: "g:L", label: "L" }, { key: "iu:abc", label: "bottle" }])).toBe("iu:abc");
  });
  it("falls back to the base unit when the item has no packaging", () => {
    expect(defaultSaleUnit([{ key: "base", label: "pcs" }])).toBe("base");
  });
});
