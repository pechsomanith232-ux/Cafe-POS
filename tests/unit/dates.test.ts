import { describe, expect, it } from "vitest";
import { isYmd } from "@/lib/dates";

describe("isYmd", () => {
  it("accepts real dates and rejects impossible ones without throwing", () => {
    expect(isYmd("2026-02-28")).toBe(true);
    expect(isYmd("2024-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-40", "2026-02-31", "2026-2-3", "", null, 5]) expect(isYmd(bad)).toBe(false);
  });
});
